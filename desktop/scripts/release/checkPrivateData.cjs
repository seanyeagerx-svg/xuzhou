// Compare private markers locally; never write marker values into a report.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const source = path.resolve(process.argv[2]),
  payload = path.resolve(process.argv[3]),
  output = path.resolve(process.argv[4]);
const { files, hashFile } = require('../licensing/artifact.cjs');
const markers = [];
const user = os.userInfo().username;
for (const value of ['C:/Users/' + user, 'C:\\Users\\' + user]) markers.push({ label: 'local-user-path', value });
if (process.env.XUZHOU_PRIVATE_CONFIG && fs.existsSync(process.env.XUZHOU_PRIVATE_CONFIG)) {
  const config = JSON.parse(fs.readFileSync(process.env.XUZHOU_PRIVATE_CONFIG, 'utf8'));
  if (typeof config.maintenanceProfile?.host === 'string' && config.maintenanceProfile.host)
    markers.push({ label: 'configured-ssh-host', value: config.maintenanceProfile.host });
  for (const agent of config.agents || [])
    if (agent.type === 'openclaw' && agent.url)
      try {
        markers.push({ label: 'configured-gateway-host', value: new URL(agent.url).hostname });
      } catch {}
}
const forbidden =
  /(^|\/)(profile(?:-local)?|sessions-local|memory-consult|evidence|backups?|\.ssh|\.codex|\.kiro)(\/|$)|(^|\/)(auth|credentials|secrets|workspace)\.json$|\.(?:db|sqlite3?|jsonl|dmp|pdb|pem|key)$/i;
const findings = [];
let scanned = 0,
  bytes = 0;
function check(relative, buffer, area) {
  scanned++;
  bytes += buffer.length;
  if (forbidden.test(relative)) findings.push({ area, path: relative, reason: 'private-file-name' });
  for (const marker of markers)
    for (const encoding of ['utf8', 'utf16le'])
      if (buffer.includes(Buffer.from(marker.value, encoding)))
        findings.push({ area, path: relative, reason: marker.label, encoding });
}
for (const [area, root] of [
  ['source', source],
  ['payload', payload],
])
  for (const file of files(root)) check(path.relative(root, file).replaceAll('\\', '/'), fs.readFileSync(file), area);
// ASAR is not compressed; raw comparison above catches markers, while entry inspection catches private filenames.
const { createRequire } = require('node:module');
const q = createRequire(require.resolve('electron-builder')),
  r = createRequire(q.resolve('app-builder-lib')),
  asar = r('@electron/asar');
const archive = path.join(payload, 'resources/app.asar');
const entries = asar.listPackage(archive);
for (const entry of entries) {
  const relative = entry.replaceAll('\\', '/').replace(/^\//, '');
  if (forbidden.test(relative)) findings.push({ area: 'asar', path: relative, reason: 'private-file-name' });
}
const coreBytes = fs.readFileSync(path.join(payload, 'resources/bundled-aioncore/win32-x64/aioncore.exe'));
const report = {
  scannedFiles: scanned,
  scannedBytes: bytes,
  asarEntries: entries.length,
  privateMarkerKinds: [...new Set(markers.map((m) => m.label))],
  findings,
  originalDataDeleted: false,
  scope: 'Exact staged source, unpacked payload and ASAR paths/bytes. Marker values are never exported.',
  coreSha256: hashFile(path.join(payload, 'resources/bundled-aioncore/win32-x64/aioncore.exe')),
  coreContainsNonPersonalBuildRoot: ['D:/codex/XuzhouBuild', 'D:\\codex\\XuzhouBuild'].some((marker) =>
    coreBytes.includes(Buffer.from(marker))
  ),
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({ files: scanned, asarEntries: entries.length, findings: findings.length, originalDataDeleted: false })
);
if (findings.length) process.exitCode = 1;
