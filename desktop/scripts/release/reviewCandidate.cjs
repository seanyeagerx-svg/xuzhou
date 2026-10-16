// Review a new, isolated candidate. This permits packaging only; it never grants final publication approval.
const fs = require('node:fs');
const path = require('node:path');
const { files, manifest, hashFile } = require('../licensing/artifact.cjs');
const root = path.resolve(__dirname, '../..');
const build = process.env.XUZHOU_BUILD_ROOT || path.dirname(root);
const directory = path.join(root, 'public/branding');
const policyFile = path.join(directory, 'compliance/release-policy.json');
const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(directory, 'license-inventory.json'), 'utf8'));
if (inventory.unresolvedDependencies.length || inventory.missingLicenseText.length)
  throw Error('Missing license decisions');
const inputNames = Object.keys(policy.inputSha256).filter(
  (relative) => fs.existsSync(path.join(root, relative)) && !relative.startsWith('out/')
);
for (const file of files(path.join(root, 'public/branding'))) {
  if (file !== policyFile) inputNames.push(path.relative(root, file).replaceAll('\\', '/'));
}
for (const file of files(path.join(root, 'out'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  // The self-referencing policy is a separate public resource, excluded from ASAR.
  if (relative !== 'out/renderer/branding/compliance/release-policy.json') inputNames.push(relative);
}
const resources = {};
for (const name of ['bundled-aioncore', 'hub', 'workbench'])
  for (const [file, sha] of Object.entries(manifest(path.join(root, 'resources', name))))
    resources[`resources/${name}/${file}`] = sha;
const core = 'resources/bundled-aioncore/win32-x64/aioncore.exe';
// Reuse the previously compiled and verified Core only if its bytes are unchanged.
if (!policy.approvedCoreBinaries.includes(resources[core]))
  throw Error('Core changed; a fresh Core review is required');
policy.status = 'candidate';
policy.blockers = [
  {
    id: 'final-artifact-review',
    message:
      'The new installer, source archive and packaged runtime must be independently verified before public release.',
  },
];
policy.scope =
  'Xuzhou ' +
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version +
  ' Windows x64 beta candidate. Reviewed Core and runtime dependencies are reused by exact hash. A final installer, clean source and synthetic chat-upgrade verification are required; no physical phone, remote cloud or real USB acceptance is implied.';
policy.inputSha256 = Object.fromEntries(
  [...new Set(inputNames)].sort().map((file) => [file, hashFile(path.join(root, file))])
);
policy.resourceSha256 = resources;
fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n');
const result = require('../licensing/verify.cjs').verifyRelease(root, { forBuild: true });
fs.writeFileSync(
  path.join(build, 'evidence/candidate-review.json'),
  JSON.stringify(
    {
      ...result,
      inputCount: Object.keys(policy.inputSha256).length,
      resourceCount: Object.keys(resources).length,
      approvedCoreUnchanged: true,
      finalApproved: false,
    },
    null,
    2
  )
);
console.log(
  JSON.stringify({
    ...result,
    inputs: Object.keys(policy.inputSha256).length,
    resources: Object.keys(resources).length,
  })
);
