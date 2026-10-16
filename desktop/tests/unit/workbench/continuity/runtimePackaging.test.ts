import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { prepareApplication } = require('../../../../scripts/licensing/runtimeModules.cjs') as {
  prepareApplication: (root: string) => { destination: string };
};
const roots: string[] = [];
function fixture(runtimeExternals: string[], declared = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-package-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'out/main/chunks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/ws'), { recursive: true });
  fs.writeFileSync(path.join(root, 'LICENSE'), 'test');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'test',
      version: '1.0.0',
      dependencies: declared ? { ws: '8.18.3' } : {},
      xuzhou: { runtimeExternals },
    })
  );
  fs.writeFileSync(path.join(root, 'out/main/index.js'), "module.exports = () => require('./chunks/browser.js');");
  fs.writeFileSync(path.join(root, 'out/main/chunks/browser.js'), "module.exports = require('ws');");
  fs.writeFileSync(
    path.join(root, 'node_modules/ws/package.json'),
    JSON.stringify({ name: 'ws', version: '8.18.3', license: 'MIT', main: 'index.js' })
  );
  fs.writeFileSync(path.join(root, 'node_modules/ws/index.js'), "module.exports = 'ws-test';");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe('Packaged lazy runtime dependencies', () => {
  it('runs a lazy browser chunk without borrowing development dependencies', () => {
    const root = fixture(['ws']);
    const staged = prepareApplication(root);
    fs.renameSync(path.join(root, 'node_modules'), path.join(root, 'original-dependencies'));
    const packagedRequire = createRequire(path.join(staged.destination, 'out/main/index.js'));
    expect(packagedRequire.resolve('ws')).toBe(path.join(staged.destination, 'node_modules/ws/index.js'));
    expect(require(path.join(staged.destination, 'out/main/index.js'))()).toBe('ws-test');
  });
  it('rejects an undeclared lazy dependency before producing a package', () => {
    expect(() => prepareApplication(fixture(['ws'], false))).toThrow('Unlisted main-process dependency');
  });
});
