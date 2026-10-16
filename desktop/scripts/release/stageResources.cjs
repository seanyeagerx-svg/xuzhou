// Xuzhou addition, 2026-10-16. Apache-2.0. Stage only code and pinned production dependencies.
const fs = require('node:fs'),
  path = require('node:path'),
  { createRequire } = require('node:module');
const build = path.resolve(process.argv[2] || path.resolve(__dirname, '../../..'));
const output = path.resolve(process.argv[3] || path.join(build, 'desktop/resources'));
const workbench = path.join(build, 'workbench'),
  core = process.env.XUZHOU_CORE_RESOURCES;
if (
  !core ||
  !fs.existsSync(path.join(core, 'win32-x64/aioncore.exe')) ||
  !fs.existsSync(path.join(core, 'win32-x64/managed-resources/manifest.json'))
)
  throw Error('XUZHOU_CORE_RESOURCES must name the exact reviewed bundled-aioncore directory');
for (const name of ['workbench', 'bundled-aioncore'])
  if (fs.existsSync(path.join(output, name)))
    throw Error('Preserve existing staged resources; select a fresh output directory');
fs.mkdirSync(output, { recursive: true });
fs.cpSync(core, path.join(output, 'bundled-aioncore'), { recursive: true });
const destination = path.join(output, 'workbench');
function code(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (
      ['node_modules', 'test', 'tests', 'evidence', 'profile', 'profile-local', 'sessions-local'].includes(entry.name)
    )
      continue;
    const file = path.join(from, entry.name),
      target = path.join(to, entry.name);
    if (entry.isSymbolicLink()) throw Error('Unexpected link in source code');
    if (entry.isDirectory()) code(file, target);
    else if (/\.(?:cjs|mjs|js|py|ps1|json)$/.test(entry.name)) {
      if (/^(?:workspace|auth|credentials|secrets)\.json$/.test(entry.name))
        throw Error('Private configuration is not a resource');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  }
}
code(path.join(workbench, 'src'), path.join(destination, 'src'));
const integration = 'integrations/aionui';
for (const name of ['devices', 'lobster', 'workspace', 'kiro', 'distribution'])
  code(path.join(workbench, integration, name), path.join(destination, integration, name));
for (const name of ['bridge.mjs', 'service.mjs', 'store.mjs', 'package.json'])
  fs.copyFileSync(path.join(workbench, integration, name), path.join(destination, integration, name));
for (const name of ['package.json', 'LICENSE'])
  fs.copyFileSync(path.join(workbench, name), path.join(destination, name));
const copied = new Map();
function dependency(name, from, modules) {
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) throw Error('Invalid dependency name');
  const req = createRequire(path.join(from, 'package.json'));
  const found = req.resolve
    .paths('__lookup__')
    .map((dir) => path.join(dir, name))
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!found) throw Error('Missing installed production dependency: ' + name);
  const source = fs.realpathSync(found),
    target = path.join(modules, name),
    meta = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (copied.has(target)) {
    if (copied.get(target) !== source) throw Error('Conflicting production dependency');
    return;
  }
  copied.set(target, source);
  fs.cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (file) =>
      !file
        .slice(source.length)
        .split(path.sep)
        .some((part) => ['node_modules', 'test', 'tests', '__tests__', 'prebuilds', 'build', '.git'].includes(part)) &&
      !/\.(?:node|dll|obj|pdb)$/.test(file),
  });
  for (const child of Object.keys(meta.dependencies || {}))
    dependency(child, source, path.join(target, 'node_modules'));
}
for (const name of ['@agentclientprotocol/sdk', 'ssh2', 'ws'])
  dependency(name, workbench, path.join(destination, 'node_modules'));
const resolved = require('../licensing/runtimeModules.cjs').validateRelativeModules(destination);
console.log(
  JSON.stringify({
    productionPackages: copied.size,
    relativeImportsVerified: resolved,
    privateProfilesCopied: false,
    nativeOptionalModulesCopied: false,
  })
);
