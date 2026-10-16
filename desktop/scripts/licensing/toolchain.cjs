// Collect exact installer plugin sources/notices without installing or executing them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const build = process.argv[2] || process.env.XUZHOU_BUILD_ROOT || path.resolve(__dirname, '../../..');
const directory = path.join(build, 'installer-sources');
fs.mkdirSync(directory, { recursive: true });
const rows = [
  [
    'StdUtils.zip',
    'https://github.com/lordmulder/stdutils/releases/download/1.14/StdUtils.2018-10-27.zip',
    '3ffe893dc7477fdb1cac551a86ae017509e1f2d0ebdc7185fd0fbaf20870688c',
  ],
  [
    'SpiderBanner.zip',
    'https://nsis.sourceforge.io/mediawiki/images/4/4c/SpiderBanner_plugin.zip',
    '45c79a024e5122834a3473a87649757bc11958a11602a3ce2d9f7ce006f0e2b7',
  ],
  [
    'NsProcess.zip',
    'https://nsis.sourceforge.io/mediawiki/images/1/18/NsProcess.zip',
    'fc19fc66a5219a233570fafd5daeb0c9b85387b379f6df5ac8898159a57c5944',
  ],
  [
    'UAC.zip',
    'https://nsis.sourceforge.io/mediawiki/images/8/8f/UAC.zip',
    '20e3192af5598568887c16d88de59a52c2ce4a26e42c5fb8bee8105dcbbd1760',
  ],
  [
    'WinShell.zip',
    'https://nsis.sourceforge.io/mediawiki/images/5/54/WinShell.zip',
    '34e111f8aacf64c540d848fd06b9d6f3e2c10cb825ec9329a01d1141973e749b',
  ],
  [
    'Nsis7z.7z',
    'https://nsis.sourceforge.io/mediawiki/images/6/69/Nsis7z_19.00.7z',
    '6f2f3730049926f40442ee0c8b7d3e3dee7ace544d82467ff8059ea3f4201c58',
  ],
];
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function download(name, url, expected) {
  const target = path.join(directory, name);
  if (!fs.existsSync(target)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (expected && sha(bytes) !== expected) throw Error(`${name}: checksum mismatch`);
    fs.writeFileSync(target, bytes);
  }
  const digest = sha(fs.readFileSync(target));
  if (expected && digest !== expected) throw Error(`${name}: cached checksum mismatch`);
  return { name, url, sha256: digest };
}
async function main() {
  const results = await Promise.all(rows.map((row) => download(...row)));
  const source = await download(
    'nsis-v312.tar.gz',
    'https://codeload.github.com/NSIS-Dev/nsis/tar.gz/e3f60402bcdf7be822d159b531c6e38ddf32de12'
  );
  results.push(source);
  const q = createRequire(require.resolve('electron-builder'));
  const r = createRequire(q.resolve('app-builder-lib'));
  const seven = process.env.XUZHOU_7ZIP;
  if (!seven || !fs.existsSync(seven))
    throw Error('Set XUZHOU_7ZIP to the checksum-verified electron-builder 7zip tool');
  for (const row of results.filter((row) => !row.name.endsWith('.tar.gz'))) {
    execFileSync(
      seven,
      ['x', '-y', '-o' + path.join(directory, row.name.replace(/\.(zip|7z)$/, '')), path.join(directory, row.name)],
      { stdio: 'ignore', windowsHide: true }
    );
  }
  fs.writeFileSync(path.join(build, 'evidence/installer-sources.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
