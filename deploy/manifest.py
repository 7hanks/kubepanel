#!/usr/bin/env python3
"""Create/verify an exact source tree, or stage a clean committed Git archive."""
import argparse
import hashlib
import io
import pathlib
import re
import subprocess
import tarfile

META = {'RELEASE', 'SHA256SUMS'}


def revision(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('revision must be a full lowercase Git SHA-1')
    return value


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def sources(root):
    result = {}
    for file in sorted(root.rglob('*')):
        if file.is_symlink():
            raise ValueError('source symlinks are not permitted')
        if file.is_file():
            name = file.relative_to(root).as_posix()
            if name in META:
                continue
            if '\n' in name or '\r' in name or '\\' in name:
                raise ValueError('unsupported source filename')
            result[name] = digest(file)
    return result


def create(root, sha):
    revision(sha)
    files = sources(root)
    if not files:
        raise ValueError('source tree is empty')
    (root / 'RELEASE').write_bytes((sha + '\n').encode())
    (root / 'SHA256SUMS').write_bytes(''.join(f'{value}  {name}\n' for name, value in files.items()).encode())
    return digest(root / 'SHA256SUMS')


def verify(root):
    revision((root / 'RELEASE').read_text().strip())
    expected = {}
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        if not re.fullmatch(r'[0-9a-f]{64}  .+', line):
            raise ValueError('invalid source manifest line')
        value, name = line.split('  ', 1)
        file = pathlib.PurePosixPath(name)
        if file.is_absolute() or '..' in file.parts or '\\' in name or ':' in name or name in expected or name in META:
            raise ValueError('unsafe or duplicate source manifest path')
        expected[name] = value
    if not expected or expected != sources(root):
        raise ValueError('source tree differs from SHA256SUMS (changed, missing, or extra files)')
    return digest(root / 'SHA256SUMS')


def stage(repo, sha, dest):
    revision(sha)
    if dest.exists():
        raise ValueError('staging directory must not exist')
    archive = subprocess.check_output(['git', '-C', str(repo), 'archive', '--format=tar', sha])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for entry in tar.getmembers():
            name = pathlib.PurePosixPath(entry.name)
            if name.is_absolute() or '..' in name.parts or not (entry.isfile() or entry.isdir()):
                raise ValueError('unsafe Git archive member')
            if name.name.startswith('.env') and name.name != '.env.example':
                raise ValueError('private environment file in source')
            if any(part in {'node_modules', '.git', '.local', 'data', 'clusters'} for part in name.parts):
                raise ValueError('runtime directory in source')
        dest.mkdir(parents=True, mode=0o700)
        for entry in tar.getmembers():
            target = dest / entry.name
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(entry) as stream:
                    target.write_bytes(stream.read())
    return create(dest, sha)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'verify', 'stage'])
    parser.add_argument('root', type=pathlib.Path)
    parser.add_argument('revision', nargs='?')
    parser.add_argument('destination', nargs='?', type=pathlib.Path)
    args = parser.parse_args()
    try:
        if args.command == 'stage':
            print(stage(args.root, args.revision, args.destination))
        elif args.command == 'create':
            print(create(args.root, args.revision))
        else:
            print(verify(args.root))
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        parser.exit(1, str(error) + '\n')
