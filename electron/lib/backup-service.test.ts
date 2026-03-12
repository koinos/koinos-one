import { describe, expect, it } from 'vitest'

import {
  blockchainBackupChecksumUrl,
  extractHeadInfoSummary,
  normalizeBlockchainBackupArchiveUrl,
  parseBlockchainBackupMetadataDirectories,
  parseBlockchainBackupSha256Checksum
} from './backup-service'

describe('backup-service helpers', () => {
  it('normalizes valid backup archive urls and rejects invalid ones', () => {
    expect(normalizeBlockchainBackupArchiveUrl('https://example.com/backup.tar.gz')).toBe(
      'https://example.com/backup.tar.gz'
    )
    expect(() => normalizeBlockchainBackupArchiveUrl('ftp://example.com/backup.tar.gz')).toThrow(/http o https/)
    expect(() => normalizeBlockchainBackupArchiveUrl('https://example.com/backup.zip')).toThrow(/\.tar\.gz/)
  })

  it('parses checksum files and validates the referenced archive name', () => {
    const archiveUrl = 'https://example.com/releases/blockchain.tar.gz'
    const parsed = parseBlockchainBackupSha256Checksum(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  blockchain.tar.gz\n',
      archiveUrl
    )

    expect(parsed.checksum).toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(parsed.output).toContain(blockchainBackupChecksumUrl(archiveUrl))
    expect(() =>
      parseBlockchainBackupSha256Checksum(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  other.tar.gz\n',
        archiveUrl
      )
    ).toThrow(/referencia other.tar.gz/)
  })

  it('extracts included directories from backup metadata', () => {
    const raw = `Backup Metadata
---------------
Included Directories:
chain/   12 GB
block_store/   9 GB

Other Section:
foo
`

    expect(parseBlockchainBackupMetadataDirectories(raw)).toEqual(['chain', 'block_store'])
  })

  it('summarizes head info responses', () => {
    expect(
      extractHeadInfoSummary({
        head_topology: {
          height: '123',
          id: '0xabc'
        }
      })
    ).toEqual({
      ok: true,
      height: '123',
      headId: '0xabc',
      output: 'Verified local node head 123 (0xabc)'
    })

    expect(extractHeadInfoSummary({})).toEqual({
      ok: false,
      height: '',
      headId: '',
      output: 'chain.get_head_info no devolvio head_topology.id'
    })
  })
})
