// Build a reviewed desktop directory, then a stock-NSIS installer without community plugins.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build: electronBuild, Platform, Arch } = require('electron-builder');
const { assertPayload, manifest, hashFile } = require('./artifact.cjs');
const build = process.argv[2] || process.env.XUZHOU_BUILD_ROOT || path.resolve(__dirname, '../../..');
const root = path.join(build, 'desktop');
const output = path.join(build, 'artifacts');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const originalElectron = fs.realpathSync(
  process.env.XUZHOU_ELECTRON_DIST || path.join(root, 'node_modules/electron/dist')
);
const electronVersion = fs.existsSync(path.join(originalElectron, 'version'))
  ? fs.readFileSync(path.join(originalElectron, 'version'), 'utf8').trim()
  : JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
if (electronVersion !== pkg.devDependencies.electron) throw Error('Electron runtime does not match the pinned release');
async function main() {
  if (process.argv.includes('--normalize')) {
    await require('./runtimeModules.cjs').normalizePackageMetadata(path.join(root, 'release-app'));
    return;
  }
  if (process.argv.includes('--prepare')) {
    const prepared = require('./runtimeModules.cjs').prepareApplication(root);
    await require('./runtimeModules.cjs').normalizePackageMetadata(prepared.destination);
    fs.writeFileSync(
      path.join(build, 'evidence/main-runtime-dependencies.json'),
      JSON.stringify(prepared.packages, null, 2)
    );
    console.log(JSON.stringify({ appDirectory: prepared.destination, runtimePackages: prepared.packages.length }));
    return;
  }
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  if (!process.argv.includes('--installer-only'))
    await electronBuild({
      projectDir: root,
      publish: 'never',
      targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
      config: {
        extends: path.join(root, 'packages/desktop/electron-builder.yml'),
        directories: { output },
        electronDist: originalElectron,
        electronVersion,
        npmRebuild: false,
        nodeGypRebuild: false,
        forceCodeSigning: false,
        beforePack: () => require('./verify.cjs').verifyRelease(root, { forBuild: true }),
        win: { signExecutable: false },
        afterPack: (context) => {
          assertPayload(root, context.appOutDir);
        },
      },
    });
  const appDirectory = path.join(output, 'win-unpacked');
  assertPayload(root, appDirectory);
  const payload = manifest(appDirectory);
  const escape = (text) => text.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const paths = Object.keys(payload);
  const directories = [
    ...new Set(
      paths.flatMap((file) => {
        const result = [];
        let d = path.posix.dirname(file);
        while (d !== '.') {
          result.push(d);
          d = path.posix.dirname(d);
        }
        return result;
      })
    ),
  ].sort((a, b) => b.length - a.length);
  const cleanup = path.join(build, 'uninstall-files.nsh');
  fs.writeFileSync(
    cleanup,
    paths
      .map((file) => 'Delete "$INSTDIR\\' + escape(file.replaceAll('/', '\\')) + '"')
      .concat(directories.map((dir) => 'RMDir "$INSTDIR\\' + escape(dir.replaceAll('/', '\\')) + '"'))
      .join('\r\n') + '\r\n'
  );
  const installer = path.join(output, `Xuzhou-${pkg.version}-win-x64-setup.exe`);
  const nsisRoot = process.env.XUZHOU_NSIS_ROOT;
  if (!nsisRoot) throw Error('Set XUZHOU_NSIS_ROOT to the verified NSIS 3.12 bundle directory');
  const nsisAppDirectory = process.env.XUZHOU_NSIS_APP_DIR || appDirectory;
  if (fs.realpathSync(nsisAppDirectory) !== fs.realpathSync(appDirectory))
    throw Error('Short compiler input must resolve to this exact reviewed payload');
  const maximumInstallRootLength = Math.min(
    180,
    248 - Math.max(...paths.map((file) => file.replaceAll('/', '\\').length))
  );
  const nsis = path.join(nsisRoot, 'windows/makensis.exe');
  const args = [
    '/V3',
    '/INPUTCHARSET',
    'UTF8',
    '/DXUZHOU_APP_DIR=' + nsisAppDirectory,
    '/DXUZHOU_MAX_INSTALL_ROOT=' + maximumInstallRootLength,
    '/DXUZHOU_INSTALLER=' + installer,
    '/DXUZHOU_VERSION=' + pkg.version,
    '/DXUZHOU_FILE_VERSION=' + require('semver').parse(pkg.version).version.split('-')[0] + '.0',
    '/DXUZHOU_ICON=' + path.join(root, 'public/branding/app.ico'),
    '/DXUZHOU_UNINSTALL_FILES=' + cleanup,
    path.join(root, 'scripts/licensing/installer.nsi'),
  ];
  const log = fs.openSync(path.join(build, 'evidence/installer-build.log'), 'w');
  try {
    execFileSync(nsis, args, {
      env: { ...process.env, NSISDIR: path.join(nsisRoot, 'windows') },
      windowsHide: true,
      stdio: ['ignore', log, log],
      maxBuffer: 1024 * 1024,
    });
  } finally {
    fs.closeSync(log);
  }
  const report = {
    installer,
    sha256: hashFile(installer),
    payloadDirectory: appDirectory,
    payloadSha256: payload,
    installerEngine: 'NSIS 3.12; stock plugins; zlib compression',
    signed: false,
  };
  fs.writeFileSync(path.join(build, 'evidence/package-build.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ installer, sha256: report.sha256, files: paths.length, signed: false }));
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
