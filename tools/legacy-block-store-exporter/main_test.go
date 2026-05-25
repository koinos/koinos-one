package main

import (
	"os"
	"strings"
	"testing"
)

func TestHashManifestSelection(t *testing.T) {
	path := t.TempDir() + "/hashes.tsv"
	manifest, err := newHashManifest(path, 2, 1)
	if err != nil {
		t.Fatalf("newHashManifest: %v", err)
	}

	records := []struct {
		recordIndex uint64
		blockIndex  uint64
		key         []byte
		value       []byte
	}{
		{1, 0, []byte{1}, []byte("meta")},
		{2, 1, []byte("block-a"), []byte("value-a")},
		{3, 2, []byte("block-b"), []byte("value-b")},
		{4, 3, []byte("block-c"), []byte("value-c")},
	}

	for _, record := range records {
		if err := manifest.MaybeWrite(record.recordIndex, record.blockIndex, record.key, record.value); err != nil {
			t.Fatalf("MaybeWrite: %v", err)
		}
	}
	if err := manifest.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 manifest rows, got %d: %q", len(lines), string(raw))
	}
	if !strings.Contains(lines[0], "\tblock_meta\t") {
		t.Fatalf("expected metadata row first, got %q", lines[0])
	}
	if !strings.Contains(lines[1], "\tblocks\t") || !strings.HasPrefix(lines[1], "3\t") {
		t.Fatalf("expected second sampled block row, got %q", lines[1])
	}
}
