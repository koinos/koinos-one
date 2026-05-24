package main

import (
	"bufio"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/dgraph-io/badger/v3"
)

const magic = "KBS1\n"

func main() {
	dbPath := flag.String("db", "", "legacy Badger block_store/db path")
	progressEvery := flag.Uint64("progress-every", 100000, "stderr progress interval")
	flag.Parse()

	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "missing --db")
		os.Exit(2)
	}

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
