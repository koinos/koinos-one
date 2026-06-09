const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const brandingDir = path.join(projectRoot, 'assets', 'branding')
const sourcePath = path.join(projectRoot, 'assets', 'newbranding', 'icon.png')
const iconsetDir = path.join(brandingDir, 'icon.iconset')
const iconPath = path.join(brandingDir, 'icon.icns')

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing source image: ${sourcePath}`)
}

for (const tool of ['sips', 'iconutil']) {
  try {
    execFileSync('xcrun', ['--find', tool], { stdio: 'ignore' })
  } catch {
    throw new Error(`Required macOS tool not found: ${tool}`)
  }
}

fs.mkdirSync(brandingDir, { recursive: true })
fs.rmSync(iconsetDir, { recursive: true, force: true })
fs.rmSync(iconPath, { force: true })
fs.mkdirSync(iconsetDir, { recursive: true })

const iconVariants = [16, 32, 128, 256, 512]

for (const size of iconVariants) {
  const standardPath = path.join(iconsetDir, `icon_${size}x${size}.png`)
  const retinaPath = path.join(iconsetDir, `icon_${size}x${size}@2x.png`)

  execFileSync('sips', ['-z', String(size), String(size), sourcePath, '--out', standardPath], { stdio: 'inherit' })
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), sourcePath, '--out', retinaPath], { stdio: 'inherit' })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', iconPath], { stdio: 'inherit' })

console.log(iconPath)
