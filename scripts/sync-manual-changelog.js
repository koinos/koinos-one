#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'CHANGELOG.md')
const OUTPUT = path.join(ROOT, 'docs', 'manual', 'reference', 'changelog.md')

function versionAnchor(version) {
  return `${version}`.trim().toLowerCase().replace(/^v/, '').replace(/[^a-z0-9.-]+/g, '-')
}

const source = fs.readFileSync(SOURCE, 'utf8').trimEnd()
const lines = source.split(/\r?\n/)
const output = []

output.push('<!-- This file is generated from ../../CHANGELOG.md by scripts/sync-manual-changelog.js. -->')
output.push('')

for (const line of lines) {
  const versionMatch = line.match(/^## \[([^\]]+)\](.*)$/)
  if (versionMatch) {
    const version = versionMatch[1]
    const anchor = versionAnchor(version)
    output.push('')
    output.push(`<a id="version-${anchor}"></a>`)
    output.push(`<a id="v${anchor}"></a>`)
  } else if (/^## Unreleased\b/i.test(line)) {
    output.push('')
    output.push('<a id="unreleased"></a>')
  }
  output.push(line)
}

output.push('')

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, `${output.join('\n')}`, 'utf8')
console.log(`Synced ${path.relative(ROOT, OUTPUT)} from ${path.relative(ROOT, SOURCE)}`)
