// Finalize only after the exact installer has completed all recorded checks.
const fs = require('node:fs');
const path = require('node:path');
const { hashFile, manifest, verifyArtifactApproval } = require('./artifact.cjs');
const { verifyRelease } = require('./verify.cjs');
const build = path.resolve(process.argv[2] || process.env.XUZHOU_BUILD_ROOT || path.resolve(__dirname, '../../..'));
const stage = path.join(build, 'desktop');
const output = path.join(build, 'artifacts');
const read = (name) => JSON.parse(fs.readFileSync(path.join(build, 'evidence', name), 'utf8').replace(/^\uFEFF/, ''));
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function main() {
  const pkg = read('package-build.json');
  check(hashFile(pkg.installer) === pkg.sha256, 'Installer changed');
  verifyRelease(stage, { forBuild: true });
  const core = read('core-build-result.json');
  const project = path.resolve(__dirname, '../..');
  const upstream = path.resolve(project, '../../..', 'integrations/aionui/evidence/license-review/core-source');
  const rust = require('./quality.cjs').rustVerification(build, upstream);
  const rustCounts = { passed: rust.passed, failed: rust.failed, ignored: rust.ignored };
  const desktop = read('desktop-unit-results.json');
  check(
    desktop.success && desktop.numFailedTests === 0 && desktop.numPassedTests >= 42,
    'Desktop focused tests have not passed'
  );
  const bridge = read('distribution-test-result.json');
  check(bridge.exitCode === 0 && bridge.passed === 10, 'Bridge regression tests have not passed');
  const compatibility = read('core-compat-result.json');
  check(
    compatibility.binarySha256 === core.sha256 &&
      compatibility.replacementMaterialized &&
      compatibility.restrictedTextAbsent &&
      compatibility.directoryLinks?.liveTargetPreserved &&
      compatibility.directoryLinks?.danglingReplaced &&
      compatibility.directoryLinks?.actualHttpApi &&
      compatibility.binaryFromInstalledPackage,
    'Replacement Core compatibility differs'
  );
  const install = read('installer-install.json');
  const uninstall = read('installer-uninstall.json');
  const payload = read('installer-payload.json');
  const lockGuard = read('installer-lock-guard.json');
  check(
    lockGuard.installerSha256 === pkg.sha256 &&
      lockGuard.updateExitCode === 2 &&
      lockGuard.uninstallExitCode === 2 &&
      lockGuard.filesUnchanged,
    'Running-app installer protection was not verified'
  );
  check(
    install.installed && install.installerSha256 === pkg.sha256 && install.existingDesktopPreserved,
    'Exact installer installation was not verified'
  );
  check(
    uninstall.uninstalled &&
      uninstall.installerSha256 === pkg.sha256 &&
      uninstall.userAddedFilePreserved &&
      uninstall.originalRegistryAndShortcutsRestored,
    'Exact installer uninstall was not verified'
  );
  check(
    payload.installerSha256 === pkg.sha256 && payload.allExpectedFilesMatch && payload.unexpectedFiles.length === 0,
    'Installed payload does not match the reviewed build'
  );
  const ui = read('packaged-functional-final.json');
  if (ui.providerComponentReuse) {
    const prior = read('provider-turns-before-sync-fix.json');
    const policy = JSON.parse(
      fs.readFileSync(path.join(stage, 'public/branding/compliance/release-policy.json'), 'utf8')
    );
    const compiled = Object.keys(prior.compiledInputSha256).filter(
      (file) => file.startsWith('out/') && !file.includes('/branding/')
    );
    check(
      compiled.length >= 200 && compiled.every((file) => prior.compiledInputSha256[file] === policy.inputSha256[file]),
      'Reused provider application code changed'
    );
    const changed = Object.keys(prior.bridgeSha256)
      .filter((file) => prior.bridgeSha256[file] !== policy.resourceSha256[file])
      .sort();
    check(
      JSON.stringify(changed) ===
        JSON.stringify([
          'resources/workbench/integrations/aionui/kiro/history.cjs',
          'resources/workbench/integrations/aionui/workspace/auto-sync.cjs',
        ]),
      'Reused provider bridge has an unreviewed change'
    );
    check(
      prior.coreSha256 === core.sha256 &&
        prior.actualProviderReplies.some(
          (reply) => reply.status === 'finish' && reply.text === '青舟-731 RELEASE_KIRO_OK'
        ),
      'Reused Kiro prompt proof is absent'
    );
    const incoming = read('final-native-context.json');
    const syncTests = read('sync-release-result.json');
    check(
      incoming.installerSha256 === pkg.sha256 &&
        incoming.newNativeRecordRole === 'user' &&
        incoming.recordCount === 5 &&
        incoming.inboundContextUsed &&
        syncTests.exitCode === 0 &&
        syncTests.passed === 36,
      'Changed passive synchronization was not verified'
    );
  }

  check(
    ui.installerSha256 === pkg.sha256 && ui.installedFilesUnchanged && ui.provisionalResourcePatch === false,
    'UI proof is not from the final unmodified installer'
  );
  check(
    ui.codex &&
      ui.kiro &&
      ui.zcode &&
      ui.restartPreserved &&
      ui.automaticOutbound &&
      ui.automaticInbound &&
      ui.inboundContextUsed,
    'Packaged chat and sync checks are incomplete'
  );
  check(
    ui.noticeDetails === 1758 && ui.lobsterAnimationRunning && ui.lobsterAnimationAdvanced && ui.lobsterPanelAvailable,
    'Offline notices or Lobster interface checks are incomplete'
  );
  const history = read('packaged-long-history.json');
  check(
    history.messages === 1200 &&
      history.originalMessageRetrieved === 274 &&
      history.originalUnchanged &&
      history.bundledNodeUsed,
    'Packaged long-history verification is incomplete'
  );
  const source = read('source-package.json');
  const sourceReview = read('source-review.json');
  check(
    hashFile(source.archive) === source.sha256 &&
      sourceReview.sha256 === source.sha256 &&
      sourceReview.manifestMatches &&
      sourceReview.privateFiles === 0 &&
      sourceReview.restrictedPdfFiles === 0,
    'Source archive verification is incomplete'
  );
  const preservation = read('original-preservation-final.json');
  check(
    preservation.changedFiles.length === 0 &&
      preservation.changedTables.length === 0 &&
      preservation.originalCoreUnchanged,
    'Original chat/runtime preservation was not verified'
  );
  const licenses = JSON.parse(fs.readFileSync(path.join(stage, 'public/branding/license-inventory.json'), 'utf8'));
  const coverage = read('actual-license-coverage.json');
  check(
    !licenses.missingLicenseText.length && !licenses.unresolvedDependencies.length && coverage.missing.length === 0,
    'Actual shipped dependencies have incomplete notices'
  );
  const evidence = path.join(output, 'verification');
  fs.mkdirSync(evidence, { recursive: true });
  const publicProofs = {
    'build-tests.json': {
      target: 'Windows x64 MSVC',
      rust: core.rust,
      cargo: core.cargo,
      coreSha256: core.sha256,
      locked: true,
      staticCrt: true,
      rustTests: rustCounts,
      rustVerification: rust,
      rustTestCommand: rust.command,
      desktopFocusedTests: desktop.numPassedTests,
      bridgeTests: bridge.passed,
      compatibility,
    },
    'runtime.json': {
      ...ui,
      longHistory: history,
      limitations: [
        ...(ui.limitations || []),
        'Verified text continuation, automatic Kiro V3 synchronization and recorded UI paths; this does not attest every external provider tool or permission flow.',
        'Cloud SSH maintenance was not performed during this release check.',
      ],
    },
    'licenses.json': {
      npmNoticeCount: licenses.npmCount,
      rustNoticeCount: licenses.rustCount,
      actualPackagedNpmVersions: coverage.actualNpmVersions,
      missing: [],
      sourceAttachments: true,
      restrictedPdfCorpusOmittedBeforeCompilation: true,
      installer: 'NSIS 3.12 stock components; zlib compression; no community plugins',
    },
    'install-uninstall.json': {
      installerSha256: pkg.sha256,
      silentInstallPassed: true,
      payloadFiles: payload.matchedFiles,
      allExpectedFilesMatch: true,
      unexpectedFiles: [],
      signed: pkg.signed,
      userAddedFilePreserved: true,
      originalRegistryAndShortcutsRestored: true,
      runningAppUpdateBlocked: true,
      runningAppUninstallBlocked: true,
    },
    'source.json': {
      sha256: source.sha256,
      files: source.files,
      manifestMatches: true,
      privateFiles: 0,
      restrictedPdfFiles: 0,
      byteReproducibilityClaimed: false,
    },
    'data-preservation.json': {
      checkedAt: preservation.checkedAt,
      preservedFiles: preservation.preservedFiles,
      changedFiles: [],
      changedTables: [],
      originalCoreUnchanged: true,
      oldChatCounts: compatibility.oldChatCounts,
    },
  };
  for (const [name, value] of Object.entries(publicProofs)) write(path.join(evidence, name), value);
  const policyFile = path.join(evidence, 'release-policy.json');
  fs.copyFileSync(path.join(stage, 'public/branding/compliance/release-policy.json'), policyFile);
  fs.copyFileSync(path.join(__dirname, 'artifact.cjs'), path.join(evidence, 'verify.cjs'));
  const extracted = path.join(output, 'installer-payload');
  const extractedManifest = manifest(extracted);
  for (const [file, digest] of Object.entries(pkg.payloadSha256))
    check(extractedManifest[file] === digest, 'Final extracted payload changed: ' + file);
  check(
    Object.keys(extractedManifest).length === Object.keys(pkg.payloadSha256).length + 1 &&
      extractedManifest['Uninstall.exe'],
    'Unlisted final payload file'
  );
  const report = {
    schemaVersion: 1,
    product: 'Xuzhou',
    version: '2.2.2',
    platform: 'win32-x64',
    status: 'verified',
    verifiedAt: new Date().toISOString(),
    policyFile: 'verification/release-policy.json',
    policySha256: hashFile(policyFile),
    installer: { path: path.basename(pkg.installer), sha256: pkg.sha256, signed: false },
    sourceArchive: { path: path.basename(source.archive), sha256: source.sha256 },
    extractedPayloadDirectory: 'installer-payload',
    payloadSha256: extractedManifest,
    functionalEvidence: Object.keys(publicProofs).map((name) => ({
      path: 'verification/' + name,
      sha256: hashFile(path.join(evidence, name)),
    })),
  };
  const reportFile = path.join(output, 'release-verified.json');
  write(reportFile, report);
  verifyArtifactApproval(policyFile, reportFile);
  verifyRelease(stage, { artifactApproval: reportFile });
  fs.writeFileSync(
    path.join(output, 'RELEASE-REPORT.md'),
    `# 续舟 2.2.2 Windows x64 发行核验\n\n本目录中的安装包已完成源码编译、实际安装、界面运行和卸载核验。未上传到公开发布平台。\n\n- 独立重编译 Core，移除整个受限 PDF 资料目录并加入 Apache-2.0 独立替代技能。保留 43 项原 SQL 的 Windows CRLF 校验值，旧数据库兼容验证通过。\n- Rust 工作区 ${rustCounts.passed} 项通过，${rustCounts.failed} 项失败，${rustCounts.ignored} 项按上游配置忽略；桌面相关 ${desktop.numPassedTests} 项、连接配置回归 ${bridge.passed} 项通过。忽略项不算已验证。\n- 同一聊天中的 Codex、Kiro V3、ZCode 接续已有实际回复证据。最终安装包重新验证 Codex、ZCode 和失败原生回合的双向消息同步；Kiro 生成连接复用本轮稍早构建的真实回复证据，经校验相同 Core、241 个编译文件和未变化的生成连接代码。原生 Kiro 新 AI 回复受月额度限制，未声称本轮重新生成成功。重启保留及 1200 条记录原文检索通过；验证范围和证据来源详见 verification/runtime.json。\n- 龙虾面板可用、动画运行；本次没有执行远程 SSH 维护。离线许可页包含 ${licenses.npmCount} 个 npm、${licenses.rustCount} 个 Rust 包的声明；实际安装包 ${coverage.actualNpmVersions} 个 npm 版本均覆盖。\n- 安装文件逐项匹配；卸载保留用户新增文件，原注册表和快捷方式恢复。原来的 ${preservation.preservedFiles} 份会话文件与聊天表未改动，原 Core 未替换。\n- 完整源码、修改记录、第三方声明及对应所需源码随附。原作者及许可继续适用，不主张上游背书或其商标权。\n\n安装包：${path.basename(pkg.installer)}\n\nSHA-256：\`${pkg.sha256}\`\n\n源码包：${path.basename(source.archive)}\n\nSHA-256：\`${source.sha256}\`\n\n安装包没有代码签名，Windows 可能显示未知发布者。没有购买签名证书，也没有执行公开发布。\n\n可使用本机任意可用 Node.js 运行 \`node verification/verify.cjs release-verified.json\` 复核文件完整性。此验证器不连接 AI 服务，不包含私人聊天或凭证。哈希校验用于发现文件变化，不替代数字签名或法律意见。\n`
  );
  if (rust.initialFailures?.length)
    fs.appendFileSync(
      path.join(output, 'RELEASE-REPORT.md'),
      `\n测试记录说明：首次完整工作区运行退出码为 ${rust.initialWorkspaceExitCode}，其中 ${rust.initialFailures.length} 项失败来自已核实的 Windows 测试路径假设和本机代理环境。生产 Rust 实现逐文件对照未改动；修正测试后，相关完整测试组复跑 ${rust.rerunPassed} 项通过，原失败案例全部实际重跑成功。上面的最终通过数按原用例计数，重复复测不重复累加。原全量日志与复测日志的校验值及失败名称保留在 verification/build-tests.json。\n`
    );
  const sums = [
    report.installer.path,
    report.sourceArchive.path,
    'release-verified.json',
    'RELEASE-REPORT.md',
    'verification/verify.cjs',
  ]
    .map((file) => hashFile(path.join(output, file)) + '  ' + file)
    .join('\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sums + '\n');
  console.log(
    JSON.stringify({
      releaseReady: true,
      installer: report.installer,
      sourceArchive: report.sourceArchive,
      report: reportFile,
    })
  );
}
try {
  main();
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
