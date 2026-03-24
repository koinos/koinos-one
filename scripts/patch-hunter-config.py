#!/usr/bin/env python3
"""Patch Hunter/config.cmake to use local patched tarballs on macOS.

Usage:
    python3 patch-hunter-config.py <config.cmake> <zlib_url> <zlib_sha1> <abseil_url> <abseil_sha1> <exc_url> <exc_sha1> [--arm64]
"""
import re
import sys


def replace_hunter_block(content: str, package: str, url: str, sha1: str) -> str:
    """Replace a hunter_config(PACKAGE ...) block to use a custom URL + SHA1."""
    # Match: hunter_config(PACKAGE\n   VERSION ...\n   CMAKE_ARGS\n      ...\n)
    # or:    hunter_config(PACKAGE\n   URL ...\n   SHA1 ...\n   CMAKE_ARGS\n      ...\n)
    pattern = re.compile(
        rf'(hunter_config\({package}\s*\n)'   # opening line
        rf'(.*?\n)*?'                          # intermediate lines (VERSION, URL, SHA1, etc.)
        rf'(\s+CMAKE_ARGS\s*\n)',              # CMAKE_ARGS line
        re.MULTILINE
    )
    replacement = (
        f'hunter_config({package}\n'
        f'   URL "{url}"\n'
        f'   SHA1 "{sha1}"\n'
        f'   CMAKE_ARGS\n'
    )
    new_content, count = pattern.subn(replacement, content)
    if count > 0:
        print(f"  Replaced hunter_config({package}) with local tarball URL")
    else:
        print(f"  WARNING: Could not find hunter_config({package}) block to patch")
    return new_content


def inject_arm64_arch(content: str) -> str:
    """Add CMAKE_OSX_ARCHITECTURES=arm64 to all hunter_config blocks that have CMAKE_ARGS."""
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        result.append(lines[i])
        # If we just wrote a CMAKE_ARGS line inside a hunter_config block
        if re.match(r'\s+CMAKE_ARGS\s*$', lines[i]):
            # Check if next line already has CMAKE_OSX_ARCHITECTURES
            if i + 1 < len(lines) and 'CMAKE_OSX_ARCHITECTURES' not in lines[i + 1]:
                # Add it
                indent = '      '
                result.append(f'{indent}CMAKE_OSX_ARCHITECTURES=arm64')
        i += 1
    return '\n'.join(result)


def main():
    if len(sys.argv) < 8:
        print(f"Usage: {sys.argv[0]} <config.cmake> <zlib_url> <zlib_sha1> <abseil_url> <abseil_sha1> <exc_url> <exc_sha1> [--arm64]")
        sys.exit(1)

    config_path = sys.argv[1]
    zlib_url = sys.argv[2]
    zlib_sha1 = sys.argv[3]
    abseil_url = sys.argv[4]
    abseil_sha1 = sys.argv[5]
    exc_url = sys.argv[6]
    exc_sha1 = sys.argv[7]
    arm64 = '--arm64' in sys.argv

    with open(config_path, 'r') as f:
        content = f.read()

    # Check if already patched
    if 'darwin-patched' in content:
        print("  Already patched, skipping")
        sys.exit(0)

    content = replace_hunter_block(content, 'ZLIB', zlib_url, zlib_sha1)
    content = replace_hunter_block(content, 'abseil', abseil_url, abseil_sha1)
    content = replace_hunter_block(content, 'koinos_exception', exc_url, exc_sha1)

    if arm64:
        content = inject_arm64_arch(content)
        print("  Injected CMAKE_OSX_ARCHITECTURES=arm64 into all CMAKE_ARGS blocks")

        # Fix rocksdb: PORTABLE=ON on ARM64 — the CRC check may not detect arm64
        # support when using a toolchain file. Force the ARM CRC flags in the
        # rocksdb hunter_config block only.
        rocksdb_pattern = re.compile(
            r'(hunter_config\(rocksdb\b.*?'
            r'CMAKE_CXX_FLAGS=)(-fvisibility=hidden)',
            re.DOTALL
        )
        if rocksdb_pattern.search(content):
            content = rocksdb_pattern.sub(
                r'\g<1>-fvisibility=hidden -march=armv8-a+crc+crypto -Wno-unused-function',
                content
            )
            # Also fix C flags in rocksdb block
            rocksdb_c_pattern = re.compile(
                r'(hunter_config\(rocksdb\b.*?'
                r'CMAKE_C_FLAGS=)(-fvisibility=hidden)',
                re.DOTALL
            )
            content = rocksdb_c_pattern.sub(
                r'\g<1>-fvisibility=hidden -march=armv8-a+crc+crypto -Wno-unused-function',
                content
            )
            print("  Fixed rocksdb: added -march=armv8-a+crc+crypto for ARM64 CRC support")

    with open(config_path, 'w') as f:
        f.write(content)

    print("  Config patched successfully")


if __name__ == '__main__':
    main()
