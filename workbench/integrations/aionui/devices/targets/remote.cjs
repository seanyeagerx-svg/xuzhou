const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./policy.cjs');

/** Shares the authenticated, host-key-verified maintenance transport; no second login or agent install. */
class RemoteTarget {
  constructor(maintenance) { this.maintenance = maintenance; }
  async run(request, signal) {
    const maintenance = this.maintenance;
    if (!maintenance?.ready || !maintenance.client) fail('CLOUD_DISCONNECTED');
    const generation = maintenance.generation;
    const source = fs.readFileSync(path.join(__dirname, 'worker.py')).toString('base64');
    const command = "python3 -c 'import base64;exec(base64.b64decode(\"" + source + "\"))'";
    return new Promise((resolve, reject) => {
      let finished = false, stream, output = '', errors = '', size = 0;
      const done = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => { stream?.signal?.('TERM'); stream?.close(); done(new Error('XUZHOU_DEVICE_CANCELLED')); };
      const timer = setTimeout(() => { stream?.signal?.('TERM'); stream?.close(); done(new Error('XUZHOU_DEVICE_TIMEOUT')); }, (request.timeoutMs || 30000) + 5000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      maintenance.client.exec(command, (error, channel) => {
        if (error) return done(error);
        stream = channel;
        if (finished) { channel.close(); return; }
        const append = (chunk, stderr) => {
          size += chunk.length;
          if (size > 4 * 1024 ** 2) { channel.close(); done(new Error('XUZHOU_DEVICE_OUTPUT_LIMIT')); return; }
          if (stderr) errors += chunk.toString('utf8'); else output += chunk.toString('utf8');
        };
        channel.on('data', chunk => append(chunk, false));
        channel.stderr.on('data', chunk => append(chunk, true));
        channel.once('error', done);
        channel.once('close', code => {
          if (maintenance.generation !== generation || !maintenance.ready) return done(new Error('XUZHOU_DEVICE_CONNECTION_CHANGED'));
          try {
            if (code !== 0) throw new Error('XUZHOU_DEVICE_REMOTE_FAILED');
            const value = JSON.parse(output);
            if (value.error) throw new Error('XUZHOU_DEVICE_' + value.error);
            done(null, value);
          } catch (error) { done(error); }
        });
        // Send the payload on stdin, avoiding command-line length limits and shell interpolation.
        channel.end(JSON.stringify(request));
      });
    });
  }
  probe() { return this.run({ operation: 'capacity' }); }
  files(root, request) { return this.run({ ...request, root }); }
  command(root, request, signal) { return this.run({ ...request, operation: 'command', root }, signal); }
}
module.exports = { RemoteTarget };
