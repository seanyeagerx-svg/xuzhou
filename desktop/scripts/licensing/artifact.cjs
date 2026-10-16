const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = (file) => sha(fs.readFileSync(file));
const privatePath =
  /(^|\/)(profile(?:-local)?|sessions-local|backups?|evidence|\.codex|\.kiro|\.ssh)(\/|$)|(^|\/)(auth|credentials|secrets)\.json$|\.pem$/i;
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Unexpected link in release payload: ' + full);
    return entry.isDirectory() ? files(full) : [full];
  });
}
function manifest(directory) {
  return Object.fromEntries(
    files(directory)
      .sort()
      .map((file) => [path.relative(directory, file).replaceAll('\\', '/'), hashFile(file)])
  );
}
function assertPayload(root, appDirectory) {
  const { verifyRelease } = require('./verify.cjs');
  verifyRelease(root, { forBuild: true });
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'public/branding/compliance/release-policy.json'), 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'public/branding/license-inventory.json'), 'utf8'));
  const licensedNpm = new Set(inventory.packages.map((p) => p.name + '@' + p.version));
  const actualNpm = new Set();
  function checkNpm(metadata, location) {
    if (!metadata.name || !metadata.version) return;
    const id = metadata.name + '@' + metadata.version;
    if (!licensedNpm.has(id)) throw Error('Packaged dependency is missing from notices: ' + id + ' at ' + location);
    actualNpm.add(id);
  }
  const payload = manifest(appDirectory);
  for (const file of Object.keys(payload))
    if (privatePath.test(file)) throw Error('Private material in release payload: ' + file);
  for (const file of Object.keys(payload).filter(
    (file) => file.includes('/node_modules/') && file.endsWith('/package.json')
  )) {
    checkNpm(JSON.parse(fs.readFileSync(path.join(appDirectory, file), 'utf8')), file);
  }
  for (const [file, expected] of Object.entries(policy.resourceSha256)) {
    if (payload[file] !== expected) throw Error('Packaged resource differs from its review: ' + file);
  }
  const actualResources = Object.keys(payload).filter((file) =>
    /^resources\/(bundled-aioncore|hub|workbench)\//.test(file)
  );
  if (JSON.stringify(actualResources.sort()) !== JSON.stringify(Object.keys(policy.resourceSha256).sort()))
    throw Error('Unlisted packaged resource');
  for (const [file, expected] of Object.entries(policy.inputSha256)) {
    if (file.startsWith('public/') && payload['resources/' + file.slice(7)] !== expected)
      throw Error('Bundled notice changed: ' + file);
  }
  if (
    payload['resources/branding/compliance/release-policy.json'] !==
    hashFile(path.join(root, 'public/branding/compliance/release-policy.json'))
  )
    throw Error('Wrong bundled release policy');
  const q = createRequire(require.resolve('electron-builder'));
  const r = createRequire(q.resolve('app-builder-lib'));
  const asar = r('@electron/asar');
  const archive = path.join(appDirectory, 'resources/app.asar');
  asar.uncache(archive);
  const archiveFiles = new Set();
  function visitHeader(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files || {})) {
      const relative = prefix + name;
      if (entry.files) visitHeader(entry, relative + '/');
      else archiveFiles.add(relative);
    }
  }
  visitHeader(asar.getRawHeader(archive).header);
  const packageChecks = new Map();
  function dependencyPackage(entry) {
    let folder = path.posix.dirname(entry);
    while (folder.startsWith('node_modules/')) {
      const packageFile = folder + '/package.json';
      if (archiveFiles.has(packageFile)) {
        const metadata = JSON.parse(asar.extractFile(archive, path.normalize(packageFile)).toString());
        if (metadata.name && metadata.version) {
          checkNpm(metadata, folder);
          if (!packageChecks.has(folder))
            packageChecks.set(folder, {
              candidates: (policy.runtimePackages || []).filter(
                (p) => p.name === metadata.name && p.version === metadata.version
              ),
            });
          return { folder, check: packageChecks.get(folder) };
        }
      }
      folder = path.posix.dirname(folder);
    }
    throw Error('Unidentified packaged dependency: ' + entry);
  }
  const entries = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/').replace(/^\//, ''));
  for (const entry of entries) {
    if (privatePath.test(entry) || /\.node$|(^|\/)node_modules\/(?:@img|canvas|sharp)(\/|$)/i.test(entry))
      throw Error('Unreviewed private/native module in ASAR: ' + entry);
    if (entry.startsWith('node_modules/') && archiveFiles.has(entry)) {
      const { folder, check } = dependencyPackage(entry);
      const relative = entry.slice(folder.length + 1);
      const actual = sha(asar.extractFile(archive, path.normalize(entry)));
      check.candidates = check.candidates.filter((p) => p.files[relative] === actual);
      if (!check.candidates.length) throw Error('Unreviewed packaged runtime dependency: ' + entry);
    }
  }
  for (const [file, expected] of Object.entries(policy.inputSha256).filter(([file]) => file.startsWith('out/'))) {
    if (sha(asar.extractFile(archive, path.normalize(file))) !== expected)
      throw Error('Packaged application code differs from review: ' + file);
  }
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (pkg.name !== 'xuzhou-workbench') throw Error('Incorrect packaged product identity');
  return {
    payloadSha256: payload,
    asarEntries: entries.length,
    actualNpmVersions: actualNpm.size,
    privateFiles: 0,
    unreviewedNativeModules: 0,
  };
}
function verifyArtifactApproval(policyFile, reportFile) {
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.schemaVersion !== 1 || report.status !== 'verified' || report.policySha256 !== hashFile(policyFile))
    throw Error('Installer approval is absent or stale');
  const resolve = (relative) => path.resolve(path.dirname(path.resolve(reportFile)), relative);
  if (hashFile(resolve(report.installer.path)) !== report.installer.sha256)
    throw Error('Installer changed after verification');
  if (report.sourceArchive && hashFile(resolve(report.sourceArchive.path)) !== report.sourceArchive.sha256)
    throw Error('Release source archive changed');
  if (JSON.stringify(manifest(resolve(report.extractedPayloadDirectory))) !== JSON.stringify(report.payloadSha256))
    throw Error('Verified installer payload changed');
  if (!report.functionalEvidence?.length) throw Error('Missing actual packaged runtime evidence');
  for (const evidence of report.functionalEvidence)
    if (hashFile(resolve(evidence.path)) !== evidence.sha256) throw Error('Runtime evidence changed');
  return { releaseReady: true };
}
module.exports = { sha, hashFile, files, manifest, assertPayload, verifyArtifactApproval };
if (require.main === module) {
  try {
    const reportFile = path.resolve(process.argv[2] || 'release-verified.json');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const policy = path.resolve(path.dirname(reportFile), report.policyFile);
    console.log(JSON.stringify(verifyArtifactApproval(policy, reportFile)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
