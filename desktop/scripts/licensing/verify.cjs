// Xuzhou addition, 2026-10-15. Build-time only: never opens a user profile or chat database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const forbidden =
  /(^|[\\/])(profile(?:-local)?|sessions-local|backup|backups|evidence|\.codex|\.kiro|\.ssh)([\\/]|$)|(^|[\\/])(?:auth|credentials|secrets)\.json$|\.pem$/i;

function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid audit path');
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep) || forbidden.test(relative)) {
    throw new Error(`Private or escaping path is not distributable: ${relative}`);
  }
  const real = fs.realpathSync(file);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Audit path escapes via link: ${relative}`);
  return real;
}

function verifyRelease(root, { noticesOnly = false, forBuild = false, artifactApproval } = {}) {
  const policyFile = path.join(root, 'public/branding/compliance/release-policy.json');
  if (!fs.existsSync(policyFile))
    throw new Error('Missing Xuzhou release license policy; public packaging is blocked.');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  if (policy.schemaVersion !== 1 || policy.product !== 'Xuzhou' || !Array.isArray(policy.blockers)) {
    throw new Error('Invalid Xuzhou release license policy');
  }
  const inputs = Object.entries(policy.inputSha256 || {});
  for (const required of [
    'package.json',
    'bun.lock',
    'packages/desktop/electron-builder.yml',
    'public/branding/LICENSE',
    'public/branding/NOTICE',
    'public/branding/MODIFICATIONS.md',
    'public/branding/license-inventory.json',
    'public/branding/third-party-notices.html',
    'public/branding/compliance/license-decisions.json',
    'public/branding/compliance/source-materials.json',
  ]) {
    if (!policy.inputSha256?.[required]) throw new Error(`Untracked required licensing input: ${required}`);
  }
  for (const [file, expected] of inputs) {
    if (!/^[a-f0-9]{64}$/.test(expected) || sha(fs.readFileSync(safeFile(root, file))) !== expected) {
      throw new Error(`License review is stale or the notice was changed: ${file}`);
    }
  }
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'public/branding/license-inventory.json'), 'utf8'));
  if (
    !Array.isArray(inventory.missingLicenseText) ||
    inventory.missingLicenseText.length ||
    inventory.unresolvedDependencies?.length
  ) {
    throw new Error('Dependency notices are incomplete');
  }
  if (noticesOnly)
    return { noticesVerified: true, releaseReady: false, status: policy.status, blockers: policy.blockers };
  const candidate =
    policy.status === 'candidate' && policy.blockers.length === 1 && policy.blockers[0].id === 'final-artifact-review';
  if (!candidate && (policy.status !== 'ready' || policy.blockers.length)) {
    throw new Error(
      'Xuzhou public distribution is blocked:\n' + policy.blockers.map((b) => `[${b.id}] ${b.message}`).join('\n')
    );
  }
  // A policy flag alone cannot approve a different executable or unreviewed resource archive.
  if (!policy.approvedCoreBinaries?.length || !policy.resourceSha256 || !Object.keys(policy.resourceSha256).length) {
    throw new Error('Missing reviewed rebuilt Core and resource manifest');
  }
  let reviewedCore = 0;
  for (const [file, expected] of Object.entries(policy.resourceSha256)) {
    const bytes = fs.readFileSync(safeFile(root, file));
    if (sha(bytes) !== expected) throw new Error(`Unreviewed release resource: ${file}`);
    if (/aioncore(?:\.exe)?$/i.test(file)) {
      if (
        !policy.approvedCoreBinaries.includes(expected) ||
        bytes.includes(Buffer.from('Distribute, sublicense, or transfer these materials'))
      ) {
        throw new Error('Restricted or unapproved AionCore executable');
      }
      reviewedCore++;
    }
  }
  if (reviewedCore !== 1) throw new Error('Exactly one reviewed Windows Core is required');
  for (const required of [
    'resources/bundled-aioncore/win32-x64/aioncore.exe',
    'resources/bundled-aioncore/win32-x64/manifest.json',
    'resources/bundled-aioncore/win32-x64/managed-resources/manifest.json',
    'resources/hub/index.json',
    'resources/hub/LICENSE',
    'resources/workbench/integrations/aionui/bridge.mjs',
  ]) {
    if (!policy.resourceSha256[required]) throw new Error(`Untracked required release resource: ${required}`);
  }
  const actual = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Release resource links are not approved');
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile()) actual.push(path.relative(root, filename).replaceAll('\\', '/'));
      else throw new Error('Unsupported release resource');
    }
  }
  for (const name of ['bundled-aioncore', 'hub', 'workbench']) walk(path.join(root, 'resources', name));
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(policy.resourceSha256).sort())) {
    throw new Error('Unlisted or missing release resource');
  }
  require('./runtimeModules.cjs').validateRelativeModules(path.join(root, 'resources/workbench'));
  if (forBuild) return { noticesVerified: true, buildAllowed: true, releaseReady: false };
  // The installer cannot contain its own final hash. Approval is a separate report for that exact artifact.
  if (!artifactApproval) throw new Error('Final installer approval is required; build review alone is insufficient');
  const { verifyArtifactApproval } = require('./artifact.cjs');
  verifyArtifactApproval(policyFile, artifactApproval);
  return { noticesVerified: true, releaseReady: true };
}

function beforePack(context) {
  return verifyRelease(context.packager.projectDir, { forBuild: true });
}
module.exports = beforePack;
module.exports.verifyRelease = verifyRelease;
if (require.main === module) {
  try {
    const reportIndex = process.argv.indexOf('--artifact-report');
    if (reportIndex >= 0 && !process.argv[reportIndex + 1]) throw Error('Missing --artifact-report path');
    console.log(
      JSON.stringify(
        verifyRelease(path.resolve(__dirname, '../..'), {
          noticesOnly: process.argv.includes('--notices-only'),
          forBuild: process.argv.includes('--for-build'),
          ...(reportIndex >= 0 ? { artifactApproval: path.resolve(process.argv[reportIndex + 1]) } : {}),
        })
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
