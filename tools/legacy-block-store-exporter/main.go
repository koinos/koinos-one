package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/dgraph-io/badger/v3"
)

const magic = "KBS1\n"
const metaKey = "\x01"

type hashManifest struct {
	file          *os.File
	writer        *bufio.Writer
	every         uint64
	limit         uint64
	selectedBlock uint64
}

func newHashManifest(path string, every uint64, limit uint64) (*hashManifest, error) {
	if path == "" {
		return nil, nil
	}
	if every == 0 {
		return nil, fmt.Errorf("--hash-every must be greater than 0 when --hash-manifest is set")
	}
	file, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	return &hashManifest{
		file:   file,
		writer: bufio.NewWriterSize(file, 1024*1024),
		every:  every,
		limit:  limit,
	}, nil
}

func (m *hashManifest) Close() error {
	if m == nil {
		return nil
	}
	flushErr := m.writer.Flush()
	closeErr := m.file.Close()
	if flushErr != nil {
		return flushErr
	}
	return closeErr
}

func hashHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (m *hashManifest) MaybeWrite(recordIndex uint64, blockIndex uint64, key []byte, value []byte) error {
	if m == nil {
		return nil
	}

	columnFamily := "blocks"
	if string(key) == metaKey {
		columnFamily = "block_meta"
	} else {
		if blockIndex == 0 || blockIndex%m.every != 0 {
			return nil
		}
		if m.limit > 0 && m.selectedBlock >= m.limit {
			return nil
		}
		m.selectedBlock++
	}

	_, err := fmt.Fprintf(
		m.writer,
		"%d\t%s\t%d\t%d\t%s\t%s\n",
		recordIndex,
		columnFamily,
		len(key),
		len(value),
		hashHex(key),
		hashHex(value),
	)
	return err
}

func main() {
	dbPath := flag.String("db", "", "legacy Badger block_store/db path")
	progressEvery := flag.Uint64("progress-every", 100000, "stderr progress interval")
	hashManifestPath := flag.String("hash-manifest", "", "write selected record SHA-256 manifest to this path")
	hashEvery := flag.Uint64("hash-every", 0, "hash every Nth block record; use 1 for full block record verification")
	hashLimit := flag.Uint64("hash-limit", 0, "maximum sampled block records to hash; 0 means unlimited")
	flag.Parse()

	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "missing --db")
		os.Exit(2)
	}

	hashes, err := newHashManifest(*hashManifestPath, *hashEvery, *hashLimit)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open hash manifest: %v\n", err)
		os.Exit(2)
	}
	defer func() {
		if err := hashes.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "close hash manifest: %v\n", err)
			os.Exit(1)
		}
	}()

	opts := badger.DefaultOptions(*dbPath).
		WithReadOnly(true).
		WithLogger(nil)

	db, err := badger.Open(opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open badger: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	out := bufio.NewWriterSize(os.Stdout, 4*1024*1024)
	defer out.Flush()

	if _, err := out.WriteString(magic); err != nil {
		fmt.Fprintf(os.Stderr, "write magic: %v\n", err)
		os.Exit(1)
	}

	started := time.Now()
	var count uint64
	var blockCount uint64
	var bytes uint64

	err = db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.IteratorOptions{
			PrefetchValues: false,
		})
		defer it.Close()

		var header [12]byte
		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			key := item.KeyCopy(nil)
			value, err := item.ValueCopy(nil)
			if err != nil {
				return err
			}

			binary.LittleEndian.PutUint32(header[0:4], uint32(len(key)))
			binary.LittleEndian.PutUint64(header[4:12], uint64(len(value)))

			if _, err := out.Write(header[:]); err != nil {
				return err
			}
			if _, err := out.Write(key); err != nil {
				return err
			}
			if _, err := out.Write(value); err != nil {
				return err
			}

			count++
			if string(key) != metaKey {
				blockCount++
			}
			if err := hashes.MaybeWrite(count, blockCount, key, value); err != nil {
				return err
			}
			bytes += uint64(len(key) + len(value))
			if *progressEvery > 0 && count%*progressEvery == 0 {
				fmt.Fprintf(os.Stderr, "exported records=%d bytes=%d elapsed=%s\n", count, bytes, time.Since(started).Round(time.Second))
			}
		}

		return nil
	})
	if err != nil {
		if err == io.ErrClosedPipe {
			return
		}
		fmt.Fprintf(os.Stderr, "export failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "export complete records=%d bytes=%d elapsed=%s\n", count, bytes, time.Since(started).Round(time.Second))
}
