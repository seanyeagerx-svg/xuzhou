const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');
function prepareApplication(root) {
  const destination = path.join(root, 'release-app');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  // Renderer dependencies are already bundled. Ship only actual main-process
  // externals instead of copying the full development dependency graph.
  // Lazy chunks are not entry points. Declare their reviewed runtime externals
  // explicitly so packaging never relies on a developer's node_modules folder.
  const lazy = pkg.xuzhou?.runtimeExternals || [];
  if (!Array.isArray(lazy) || lazy.some((name) => typeof name !== 'string'))
    throw Error('Invalid lazy runtime dependency manifest');
  const external = new Set(lazy);
  for (const entry of fs.readdirSync(path.join(root, 'out/main')).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, 'out/main', entry), 'utf8');
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (name.startsWith('.') || name === 'electron' || isBuiltin(name)) continue;
      external.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
    }
  }
  pkg.dependencies = Object.fromEntries(
    [...external].sort().map((name) => {
      if (!pkg.dependencies[name]) throw Error('Unlisted main-process dependency: ' + name);
      return [name, pkg.dependencies[name]];
    })
  );
  delete pkg.workspaces;
  delete pkg.devDependencies;
  delete pkg.scripts;
  delete pkg.optionalDependencies;
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.cpSync(path.join(root, 'out'), path.join(destination, 'out'), { recursive: true });
  const rows = [];
  const top = { directory: path.join(destination, 'node_modules'), provided: new Map() };
  const copied = new Map();
  function resolve(name, from) {
    const q = createRequire(path.join(from, 'package.json'));
    const location = q.resolve
      .paths('__lookup__')
      .map((dir) => path.join(dir, name))
      .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
    if (!location) throw Error('Required runtime dependency missing: ' + name);
    return fs.realpathSync(location);
  }
  // Reserve direct dependencies before hoisting transitive packages to preserve root version choices.
  for (const name of Object.keys(pkg.dependencies)) top.provided.set(name, resolve(name, root));
  function copy(name, from, scopes, force = false) {
    if (name === 'electron' || isBuiltin(name)) return;
    const source = resolve(name, from);
    const nearest = scopes.find((scope) => scope.provided.has(name));
    if (!force && nearest?.provided.get(name) === source) return;
    const placement = force ? top : nearest ? scopes[0] : top;
    const target = path.join(placement.directory, name);
    if (copied.has(target)) {
      if (copied.get(target) !== source) throw Error('Conflicting runtime dependency destination: ' + name);
      return;
    }
    placement.provided.set(name, source);
    copied.set(target, source);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    fs.cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (file) =>
        !file
          .slice(source.length)
          .split(path.sep)
          .some((part) => ['node_modules', 'test', 'tests', '__tests__', 'examples', '.git'].includes(part)),
    });
    rows.push({ name: metadata.name, version: metadata.version, license: metadata.license });
    const dependencies = { directory: path.join(target, 'node_modules'), provided: new Map() };
    const childScopes = [dependencies, ...(placement === top ? [top] : scopes)];
    for (const child of Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies })) {
      if (metadata.peerDependenciesMeta?.[child]?.optional) continue;
      copy(child, source, childScopes);
    }
  }
  for (const name of Object.keys(pkg.dependencies)) copy(name, root, [top], true);
  return { destination, packages: rows };
}
async function normalizePackageMetadata(directory) {
  const q = createRequire(require.resolve('electron-builder'));
  const r = createRequire(q.resolve('app-builder-lib'));
  const transform = r('./fileTransformer').createTransformer(directory, {});
  async function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name === 'package.json') {
        const transformed = await transform(file);
        if (transformed != null) fs.writeFileSync(file, transformed);
      }
    }
  }
  await walk(directory);
}
function validateRelativeModules(directory) {
  let checked = 0;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(cjs|mjs|js)$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8');
        const q = createRequire(file);
        for (const match of source.matchAll(/(?:require\(\s*|from\s*|import\(\s*)['"](\.[^'"]+)['"]/g)) {
          const resolved = q.resolve(match[1]);
          if (!resolved.startsWith(path.resolve(directory) + path.sep))
            throw Error('Relative bridge import escapes the release: ' + file);
          checked++;
        }
      }
    }
  }
  walk(directory);
  return checked;
}
module.exports = { prepareApplication, normalizePackageMetadata, validateRelativeModules };
