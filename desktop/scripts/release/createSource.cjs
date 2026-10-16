// Explicit publish tree; no local Git history, profiles, evidence or executable cache is copied.
const fs = require('node:fs');
const path = require('node:path');
const { manifest } = require('../licensing/artifact.cjs');
const build = path.resolve(process.argv[2] || process.env.XUZHOU_BUILD_ROOT || path.resolve(__dirname, '../../..'));
const desktop = path.join(build, 'desktop');
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
const coreSource = process.env.XUZHOU_CORE_SOURCE;
const coreTools = process.env.XUZHOU_CORE_RECIPE;
if (!coreSource || !coreTools)
  throw Error('Set XUZHOU_CORE_SOURCE and XUZHOU_CORE_RECIPE to the exact reviewed source and portable build recipe');
const output = path.resolve(process.argv[3] || path.join(build, 'source-distribution'));
if (fs.existsSync(output)) throw Error('Preserve the existing source snapshot and use a fresh output directory');
const deny =
  /(^|\/)(node_modules|out|release-app|dist|target|evidence|profiles?|profile-local|sessions-local|backups?|\.git|\.codex|\.kiro|\.ssh|memory-consult)(\/|$)|(^|\/)\.env(?:\.|$)|settings\.local\.json$|\.(?:log|sqlite3?|db|jsonl|dmp|pdb|pem|key)$/i;
let copies = 0;
function copy(from, to, relative = '') {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink() || deny.test(relative.replaceAll('\\', '/'))) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from))
      copy(path.join(from, entry), path.join(to, entry), relative ? relative + '/' + entry : entry);
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copies++;
  }
}
for (const name of ['packages', 'patches', 'public', 'scripts', 'tests', '.claude'])
  copy(path.join(desktop, name), path.join(output, 'desktop', name), name);
for (const name of [
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'uno.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'LICENSE',
  'AGENTS.md',
  '.npmrc',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  '.prettierrc.json',
  '.prettierignore',
  'justfile',
])
  if (fs.existsSync(path.join(desktop, name))) copy(path.join(desktop, name), path.join(output, 'desktop', name), name);
for (const name of ['hub', 'windows'])
  copy(path.join(desktop, 'resources', name), path.join(output, 'desktop/resources', name), 'resources/' + name);
copy(coreSource, path.join(output, 'core'));
copy(path.join(build, 'workbench'), path.join(output, 'workbench'));
copy(coreTools, path.join(output, 'build-tools/core'));
for (const name of ['README.md', 'PRIVACY.md', 'SECURITY.md', 'RELEASE-REPORT.md', '.gitignore', 'docs', '.github'])
  copy(path.join(build, name), path.join(output, name), name);
copy(path.join(desktop, 'LICENSE'), path.join(output, 'LICENSE'), 'LICENSE');
copy(path.join(desktop, 'public/branding/NOTICE'), path.join(output, 'NOTICE'), 'NOTICE');
// Sanitize recorded recipe defaults without changing production Rust/SQL.
function portable(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) portable(file);
    else if (/\.(?:cjs|ps1|md)$/.test(entry.name)) {
      let text = fs.readFileSync(file, 'utf8');
      text = text
        .replaceAll("'D:/codex/XuzhouBuild/desktop'", "path.resolve(__dirname, '../../desktop')")
        .replaceAll("'D:/codex/XuzhouBuild'", "path.resolve(__dirname, '../..')")
        .replaceAll("'D:\\codex\\XuzhouBuild'", '(Split-Path -Parent (Split-Path -Parent $PSScriptRoot))');
      fs.writeFileSync(file, text);
    }
  }
}
portable(path.join(output, 'build-tools'));
fs.writeFileSync(
  path.join(output, 'REBUILD.md'),
  `# Rebuilding Xuzhou ${version} on Windows x64\n\nUse Node.js 24, Bun 1.4.3, Rust/MSVC C++ Build Tools, CMake and NSIS 3.12. The pinned dependency locks and original license notices are included. Install tools into a location you control; no developer account, server login or private profile is needed.\n\n1. Run the core recipe in build-tools/core against this source root. Keep the documented Windows migration checksums and independent PDF skill. New Core bytes require a fresh Core source/build review. Add --remap-path-prefix for your build directory if publishing newly compiled binaries.\n2. Run bun install --frozen-lockfile in desktop and workbench. The desktop Node graph and the workbench runtime graph have separate locks. Build hooks for compiler dependencies may require explicit trust; do not enable scripts from unrelated packages.\n3. Use resources/bundled-aioncore from the matching reviewed installer for the managed runtime assets. If rebuilding Core, replace its executable, update the manifest and independently review the new binary. Set XUZHOU_CORE_RESOURCES to that reviewed bundled-aioncore directory, then run node scripts/release/stageResources.cjs <source-root>. The script stages the bridge and pinned production dependencies and refuses to overwrite existing runtime trees. The hub is already included in this snapshot.\n4. In desktop, run node scripts/generate-i18n-types.js, node scripts/check-i18n.js, type checking, focused and integration tests, then electron-vite build with packages/desktop/electron.vite.config.ts. Diagnostic telemetry and source-map upload are disabled by product policy.\n5. Provide the checksum-verified Electron 44.8.0 Windows x64 distribution via XUZHOU_ELECTRON_DIST and the NSIS 3.12 bundle via XUZHOU_NSIS_ROOT. Set XUZHOU_BUILD_ROOT to this layout. Run node scripts/licensing/package.cjs <source-root> --prepare, then node scripts/release/reviewCandidate.cjs. Use a short junction to the exact unpacked payload via XUZHOU_NSIS_APP_DIR if your build path is long; package.cjs verifies that the junction resolves to that payload. Then invoke scripts/licensing/package.cjs.\n6. A candidate policy permits packaging only. Independently verify the exact new installer, clean source archive, chat continuity, device controls, phone consent/revocation and original-data preservation before publishing. Never copy old final-approval JSON onto new bytes.\n\nThis source snapshot excludes all personal data, runtime binaries, node_modules, developer caches and local Git history. Dependencies must be rebuilt or fetched from their pinned sources. PUBLIC-FILES.json records every file in this clean tree, excluding itself.\n`
);
fs.writeFileSync(
  path.join(output, 'PUBLIC-FILES.json'),
  JSON.stringify(
    { version, scope: 'Explicit clean source tree, excluding this manifest', files: manifest(output) },
    null,
    2
  ) + '\n'
);
console.log(JSON.stringify({ output, files: copies, publicTree: true, gitHistoryCopied: false }));
