#!/usr/bin/env python3
"""Validate a DevOs release and build its GitHub release archives.

  package.py check --version v0.3.6      version format, package.json match, release notes present
  package.py build --version v0.3.6 --output dist/releases/v0.3.6

`build` writes, next to a SHA256SUMS file:
  devos-<version>-runtime.tar.gz  the desktop payload that distro/oe/prepare.dev builds (same file list as its
                                  buildRuntimeArchive, plus profiles/), under the top directory devos-runtime/
  devos-<version>-source.tar.gz   tracked sources, under devos-<version>/

The Font Awesome webfonts (assets/) and the outlines derived from them (data/icons/fa/, with its NOTICE.md) are
shipped like every other file. Tests, build outputs, node_modules, caches and secrets are not. A full Live USB image
is not built here: it needs a long OpenEmbedded build and exceeds the 2 GiB GitHub release asset limit.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
# One place for the notes directory; the workflows set the same variable.
NOTES_DIR = os.environ.get('RELEASE_NOTES_DIR', 'docs/releases')
VERSION = re.compile(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-ux3407na-dev)?')

# Mirrors buildRuntimeArchive in distro/oe/prepare.dev (tests/release-package.test.py keeps them in step).
RUNTIME_DIRS = ('bin', 'lib', 'dist', 'config', 'data', 'extensions')
RUNTIME_EXTRAS = (
    'native/window-tracker.c', 'native/protocols/wlr-foreign-toplevel-management-unstable-v1.xml',
    'native/protocols/devos-workspaces-v1.xml', 'native/devos_accounts_system.dev', 'native/privileged.dev',
    'native/devos-account-admin', 'native/devos-pam-auth', 'native/devos-account-askpass',
    'native/devos-account-askpass.dev', 'native/devos_app_store.dev', 'native/devos-app-store-admin',
    'native/devos-radio-admin', 'native/radio-system.dev', 'native/devos-battery-care', 'native/devos-fan-profile',
    'native/devos-swap', 'native/devos-system-update', 'native/devos-keyboard', 'native/devos-connectivity')
# Hardware profiles (the UX3407NA profile lives in profiles/asus/ux3407na); the image build reads these.
RUNTIME_PROFILES = ('profiles',)
# Shipped in the runtime archive besides RUNTIME_DIRS (not in distro/oe/prepare.dev's list): the Font Awesome webfonts.
RUNTIME_ASSETS = ('assets',)
SECRET_NAMES = re.compile(r'(^|/)(\.env(\..*)?|id_(rsa|ed25519|ecdsa)|[^/]*\.(pem|key|p12|pfx|keystore))$')


def fail(message):
    print(f'error: {message}', file=sys.stderr)
    raise SystemExit(1)


def package_version(root=ROOT):
    return json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']


def check(version, root=ROOT, notes_dir=None):
    """Raise SystemExit with a clear message unless `version` can be released from this checkout."""
    notes_dir = notes_dir or NOTES_DIR
    if not VERSION.fullmatch(version or ''):
        fail(f'release version {version!r} is not vMAJOR.MINOR.PATCH (for example v0.3.6)')
    declared = package_version(root)
    if version != 'v' + declared:
        fail(f'release version {version} does not match package.json version {declared}; bump package.json '
             f'(and package-lock.json) first, because dist/build-info.json and the updater take it from there')
    notes = root / notes_dir / f'{version}.md'
    if not notes.is_file():
        fail(f'release notes {notes_dir}/{version}.md do not exist; write them before releasing '
             f'(see {notes_dir}/README.md)')
    if not notes.read_text(encoding='utf-8').strip():
        fail(f'release notes {notes_dir}/{version}.md are empty')
    return notes


def excluded(relative):
    return bool(SECRET_NAMES.search(relative))


def runtime_skipped(relative):
    """The `find ... ! -path` filters of buildRuntimeArchive, applied to a relative path."""
    name = relative.rsplit('/', 1)[-1]
    return '__pycache__' in relative or '/types/' in relative or name.endswith(('.pyc', '.ps1', '-test.js'))


def walk(root, directory):
    base = root / directory
    if not base.is_dir():
        fail(f'{directory}/ is missing' + ('; run `npm run build` first' if directory == 'dist' else ''))
    for current, dirs, files in os.walk(base):
        dirs.sort()
        for name in sorted(files):
            path = Path(current) / name
            if path.is_file() and not path.is_symlink():
                yield path.relative_to(root).as_posix()


def runtime_files(root=ROOT):
    files = set()
    for directory in (*RUNTIME_DIRS, *RUNTIME_ASSETS, *RUNTIME_PROFILES):
        files.update(walk(root, directory))
    files = {name for name in files if not runtime_skipped(name)}
    for extra in RUNTIME_EXTRAS:
        if not (root / extra).is_file():
            fail(f'{extra} is listed in distro/oe/prepare.dev but missing')
        files.add(extra)
    return sorted(name for name in files if not excluded(name))


def source_files(root=ROOT):
    listed = subprocess.run(['git', '-C', str(root), 'ls-files', '-z'], capture_output=True, check=True).stdout
    names = [name for name in listed.decode('utf-8').split('\0') if name]
    return sorted(name for name in names if (root / name).is_file() and not excluded(name))


def commit_time(root):
    if os.environ.get('SOURCE_DATE_EPOCH'):
        return int(os.environ['SOURCE_DATE_EPOCH'])
    try:
        return int(subprocess.run(['git', '-C', str(root), 'log', '-1', '--format=%ct'], capture_output=True,
                                  check=True, text=True).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        return 0


def mode_of(path):
    # Files committed from Windows lose the executable bit, so decide by content: scripts start with #!.
    with open(path, 'rb') as handle:
        return 0o755 if handle.read(2) == b'#!' else 0o644


def write_archive(destination, prefix, root, names, extra=None, mtime=0):
    """Deterministic .tar.gz: sorted names, fixed owner, fixed mtime, fixed gzip header."""
    with open(destination, 'wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=9, mtime=mtime) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.GNU_FORMAT) as archive:
            def add(name, data, mode):
                info = tarfile.TarInfo(f'{prefix}/{name}')
                info.size, info.mtime, info.mode = len(data), mtime, mode
                archive.addfile(info, io.BytesIO(data))
            for name in names:
                add(name, (root / name).read_bytes(), mode_of(root / name))
            for name, data in (extra or {}).items():
                add(name, data, 0o644)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def build(version, output, root=ROOT, notes_dir=None):
    check(version, root, notes_dir)
    info_path = root / 'dist/build-info.json'
    if not info_path.is_file():
        fail('dist/build-info.json is missing; run `npm run build` first')
    built = json.loads(info_path.read_text(encoding='utf-8')).get('version')
    if str(built) != version[1:].removesuffix('-ux3407na-dev'):
        fail(f'dist/build-info.json says {built}, not {version[1:]}; rebuild')
    output.mkdir(parents=True, exist_ok=True)
    mtime = commit_time(root)
    commit = os.environ.get('GITHUB_SHA') or subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    manifest = json.dumps({'format': 1, 'version': version, 'commit': commit, 'profile': 'asus/ux3407na',
                           'includes_font_awesome': True}, indent=2).encode() + b'\n'
    runtime = output / f'devos-{version[1:]}-runtime.tar.gz'
    source = output / f'devos-{version[1:]}-source.tar.gz'
    write_archive(runtime, 'devos-runtime', root, runtime_files(root), {'release.json': manifest}, mtime)
    write_archive(source, f'devos-{version[1:]}', root, source_files(root), None, mtime)
    assets = [runtime, source]
    (output / 'SHA256SUMS').write_text(''.join(f'{sha256(path)}  {path.name}\n' for path in assets), encoding='utf-8', newline='\n')
    for path in assets:
        print(f'{path.name}: {path.stat().st_size:,} bytes')
    return assets


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('check', 'build'):
        sub = commands.add_parser(name)
        sub.add_argument('--version', required=True, help='release tag such as v0.3.6')
        sub.add_argument('--notes-dir', default=None, help=f'default: $RELEASE_NOTES_DIR or {NOTES_DIR}')
        if name == 'build':
            sub.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == 'check':
        notes = check(args.version, ROOT, args.notes_dir)
        print(f'{args.version}: package.json matches, notes at {notes.relative_to(ROOT).as_posix()}')
    else:
        build(args.version, args.output.resolve(), ROOT, args.notes_dir)


if __name__ == '__main__':
    main()
