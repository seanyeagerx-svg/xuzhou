const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail, hash, MAX_FILE_BYTES, relativeName } = require('./policy.cjs');

class LocalTarget {
  async readBounded(handle) {
    if ((await handle.stat()).size > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1); let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');
    return buffer.subarray(0, offset);
  }
  async resolve(root, name, create = false) {
    const base = await fs.realpath(root), target = path.join(base, relativeName(name));
    let actual;
    try { actual = await fs.realpath(target); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      actual = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
    }
    const relative = path.relative(base, actual);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('PATH_OUTSIDE');
    return actual;
  }
  async files(root, request) {
    const target = await this.resolve(root, request.path, ['mkdir', 'write'].includes(request.operation));
    if (request.operation === 'list') {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return { path: request.path, entries: entries.slice(0, 500).map(e => ({ name: e.name, directory: e.isDirectory(), link: e.isSymbolicLink() })), truncated: entries.length > 500 };
    }
    if (request.operation === 'mkdir') { await fs.mkdir(target); return { path: request.path, created: true }; }
    if (request.operation === 'read') {
      const handle = await fs.open(target, 'r');
      let bytes;
      try { bytes = await this.readBounded(handle); } finally { await handle.close(); }
      return { path: request.path, size: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') };
    }
    const bytes = Buffer.from(request.base64, 'base64');
    const handle = await fs.open(target, request.expectedSha256 === null ? 'wx' : syncFs.constants.O_RDWR | (syncFs.constants.O_NOFOLLOW || 0), 0o600).catch(error => {
      if (error.code === 'EEXIST' || error.code === 'ENOENT') fail('FILE_CONFLICT');
      throw error;
    });
    try {
      if (request.expectedSha256 !== null) {
        if (hash(await this.readBounded(handle)) !== request.expectedSha256) fail('FILE_CONFLICT');
        // Recheck scope after opening so a changed final link cannot redirect the write.
        if (await this.resolve(root, request.path) !== target) fail('PATH_OUTSIDE');
      }
      let offset = 0;
      while (offset < bytes.length) {
        const written = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!written.bytesWritten) fail('FILE_WRITE_FAILED');
        offset += written.bytesWritten;
      }
      await handle.truncate(bytes.length);
      await handle.sync();
    } finally { await handle.close(); }
    return { path: request.path, size: bytes.length, sha256: hash(bytes), saved: true };
  }
  command(root, request, signal) {
    return new Promise((resolve, reject) => {
      const windows = process.platform === 'win32';
      const encoded = Buffer.from("$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; " + request.command, 'utf16le').toString('base64');
      const child = spawn(windows ? 'powershell.exe' : '/bin/sh', windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encoded] : ['-c', request.command], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(windows ? {} : { detached: true }) });
      let output = '', bytes = 0, stopped = null, settled = false;
      const stop = reason => {
        if (stopped) return;
        stopped = reason;
        if (windows && child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
      };
      const collect = chunk => {
        if (stopped) return;
        bytes += chunk.length;
        if (bytes > 1024 ** 2) { stop('OUTPUT_LIMIT'); return; }
        output += chunk.toString('utf8');
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      const cancel = () => stop('CANCELLED');
      const timer = setTimeout(() => stop('TIMEOUT'), request.timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      child.once('error', error => { if (!settled) { settled = true; clean(); reject(error); } });
      child.once('close', code => { if (!settled) { settled = true; clean(); resolve({ exitCode: code, output, stopped }); } });
    });
  }
}
module.exports = { LocalTarget };
