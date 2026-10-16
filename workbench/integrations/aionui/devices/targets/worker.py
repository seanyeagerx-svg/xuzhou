"""Xuzhou SSH operations. Uses only the Python standard library; installs no remote agent."""
import base64
import hashlib
import json
import os
import pathlib
import select
import signal
import subprocess
import sys
import time

LIMIT = 2 * 1024 * 1024


def reject(code):
    raise ValueError(code)


def capacity(root=None):
    location = pathlib.Path(root or pathlib.Path.home())
    while not location.exists():
        location = location.parent
    disk = os.statvfs(str(location))
    memory = {}
    with open('/proc/meminfo', encoding='ascii') as source:
        for line in source:
            key, value = line.split(':', 1)
            if key in ('MemTotal', 'MemAvailable'):
                memory[key] = int(value.split()[0]) * 1024
    return dict(diskFree=disk.f_bavail * disk.f_frsize,
                diskTotal=disk.f_blocks * disk.f_frsize,
                memoryAvailable=memory.get('MemAvailable', 0),
                memoryTotal=memory.get('MemTotal', 0),
                home=str(pathlib.Path.home()), platform=sys.platform,
                hostname=os.uname().nodename)


def resolve(root, name):
    if not isinstance(name, str) or '\x00' in name or '\\' in name or ':' in name:
        reject('PATH_OUTSIDE')
    relative = pathlib.PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts:
        reject('PATH_OUTSIDE')
    base = pathlib.Path(root).resolve(strict=True)
    target = (base / relative).resolve()
    if target != base and base not in target.parents:
        reject('PATH_OUTSIDE')
    return base, target


def digest(data):
    return hashlib.sha256(data).hexdigest()


def files(request):
    base, target = resolve(request['root'], request.get('path', ''))
    operation = request['operation']
    if operation == 'list':
        entries = []
        truncated = False
        with os.scandir(target) as listing:
            for entry in listing:
                if len(entries) >= 500:
                    truncated = True
                    break
                entries.append(dict(name=entry.name, directory=entry.is_dir(follow_symlinks=False), link=entry.is_symlink()))
        return dict(path=request.get('path', ''), entries=entries, truncated=truncated)
    if target == base:
        reject('PATH_INVALID')
    if operation == 'mkdir':
        target.mkdir(mode=0o700)
        return dict(created=True, path=request['path'])
    if operation == 'read':
        if target.stat().st_size > LIMIT:
            reject('FILE_TOO_LARGE')
        with target.open('rb') as source:
            data = source.read(LIMIT + 1)
        if len(data) > LIMIT:
            reject('FILE_TOO_LARGE')
        return dict(path=request['path'], size=len(data), sha256=digest(data), base64=base64.b64encode(data).decode('ascii'))
    if operation != 'write':
        reject('FILE_OPERATION_INVALID')
    resource = capacity(base)
    if resource['diskFree'] < 1024 ** 3 or resource['diskFree'] / resource['diskTotal'] < .05:
        reject('CLOUD_SPACE_LOW')
    data = base64.b64decode(request['base64'], validate=True)
    if len(data) > LIMIT:
        reject('FILE_TOO_LARGE')
    expected = request.get('expectedSha256')
    flags = os.O_RDWR | os.O_NOFOLLOW
    flags |= os.O_CREAT | os.O_EXCL if expected is None else 0
    try:
        fd = os.open(target, flags, 0o600)
    except (FileExistsError, FileNotFoundError):
        reject('FILE_CONFLICT')
    with os.fdopen(fd, 'r+b') as output:
        if expected is not None:
            existing = output.read(LIMIT + 1)
            if digest(existing) != expected:
                reject('FILE_CONFLICT')
        # Recheck the directory boundary immediately before modifying the opened file.
        if resolve(request['root'], request['path'])[1] != target:
            reject('PATH_OUTSIDE')
        output.seek(0)
        output.write(data)
        output.truncate()
        output.flush()
        os.fsync(output.fileno())
    return dict(path=request['path'], size=len(data), sha256=digest(data), saved=True)


def command(request):
    process = None

    def stop_group():
        if process:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def cancel(_signal, _frame):
        stop_group()
        raise InterruptedError('CANCELLED')

    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGHUP, cancel)
    try:
        root = str(pathlib.Path(request['root']).resolve(strict=True))
        process = subprocess.Popen(request['command'], shell=True, cwd=root,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, start_new_session=True)
        until = time.monotonic() + request['timeoutMs'] / 1000
        output = bytearray()
        stopped = None
        while True:
            if time.monotonic() > until:
                stopped = 'TIMEOUT'
                break
            ready, _, _ = select.select([process.stdout], [], [], .1)
            if not ready:
                continue
            chunk = os.read(process.stdout.fileno(), 16384)
            if not chunk:
                break
            if len(output) + len(chunk) > 1024 ** 2:
                stopped = 'OUTPUT_LIMIT'
                break
            output.extend(chunk)
        if stopped:
            stop_group()
        code = process.wait(timeout=2)
        return dict(exitCode=code, output=output.decode('utf-8', errors='replace'), stopped=stopped)
    finally:
        if process and process.poll() is None:
            stop_group()


def main():
    request = json.loads(sys.stdin.read(4 * 1024 * 1024))
    operation = request.get('operation')
    if operation == 'capacity':
        return capacity(request.get('root'))
    if operation == 'prepare':
        current = capacity()
        if current['diskFree'] < 1024 ** 3 or current['diskFree'] / current['diskTotal'] < .05:
            reject('CLOUD_SPACE_LOW')
        if current['memoryAvailable'] < 128 * 1024 ** 2:
            reject('CLOUD_MEMORY_LOW')
        identifier = request.get('sessionId', '')
        if not identifier or any(c not in 'abcdef0123456789-' for c in identifier) or len(identifier) > 64:
            reject('CHAT_INVALID')
        root = pathlib.Path.home() / '.xuzhou' / 'workspaces' / identifier
        for ancestor in (root, *root.parents):
            if ancestor.is_symlink():
                reject('PATH_OUTSIDE')
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if root.resolve() != root.absolute():
            reject('PATH_OUTSIDE')
        return dict(root=str(root), **current)
    if operation == 'command':
        current = capacity(request['root'])
        if current['diskFree'] < 1024 ** 3 or current['diskFree'] / current['diskTotal'] < .05:
            reject('CLOUD_SPACE_LOW')
        return command(request)
    return files(request)


try:
    print(json.dumps(main(), ensure_ascii=True))
except ValueError as error:
    allowed = ('PATH_OUTSIDE', 'PATH_INVALID', 'FILE_TOO_LARGE', 'FILE_CONFLICT', 'FILE_OPERATION_INVALID', 'CLOUD_SPACE_LOW', 'CLOUD_MEMORY_LOW', 'CHAT_INVALID')
    print(json.dumps(dict(error=str(error) if str(error) in allowed else 'REQUEST_INVALID')))
except Exception:
    print(json.dumps(dict(error='REMOTE_FAILED')))
