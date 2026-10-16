// Triage is bound to exact source bytes. Unknown findings remain blocking.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = path.resolve(process.argv[2]);
const findingsFile = path.resolve(process.argv[3]);
const output = path.resolve(process.argv[4]);
const reference = process.env.XUZHOU_REFERENCE_SOURCE;
if (!reference) throw Error('An exact previously reviewed source snapshot is required');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const matches = JSON.parse(fs.readFileSync(findingsFile, 'utf8')) || [];
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'PUBLIC-FILES.json'), 'utf8'));
for (const [relative, expected] of Object.entries(manifest.files)) {
  const target = path.resolve(source, relative);
  if (!target.startsWith(source + path.sep) || hash(fs.readFileSync(target)) !== expected)
    throw Error('Source manifest is stale: ' + relative);
}
const rows = [];
for (const finding of matches) {
  const file = path.resolve(finding.File);
  if (!file.startsWith(source + path.sep)) throw Error('Scanner result escapes the selected source tree');
  const relative = path.relative(source, file).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8'),
    lines = text.split(/\r?\n/);
  const line = lines[finding.StartLine - 1] || '';
  const fileHash = hash(fs.readFileSync(file));
  const original = path.join(reference, relative);
  const unchanged = fs.existsSync(original) && hash(fs.readFileSync(original)) === fileHash;
  let classification;
  if (
    [
      'PUBLIC-FILES.json',
      'desktop/public/branding/compliance/release-policy.json',
      'desktop/public/branding/compliance/build-provenance.json',
      'build-tools/core/migrations.json',
    ].includes(relative) &&
    /"[a-f0-9]{64,96}"/.test(line)
  ) {
    // These are checksum manifests, not configuration fields carrying credentials.
    if (relative === 'PUBLIC-FILES.json' || relative.endsWith('release-policy.json') || unchanged)
      classification = 'generated-or-verified-checksum';
  } else if (
    unchanged &&
    /^core\/crates\/aionui-app\/assets\/builtin-skills\/moltbook\/(?:SKILL|MESSAGING|HEARTBEAT)\.md$/.test(relative)
  ) {
    const context = lines.slice(Math.max(0, finding.StartLine - 4), finding.EndLine + 3).join('\n');
    if (/\$MOLTBOOK_API_KEY|your[_ -]?(?:api[_ -]?)?(?:key|token)|example[_-]?key/i.test(context))
      classification = 'pinned-upstream-environment-variable-example';
  } else if (
    unchanged &&
    (relative.includes('/tests/') ||
      /\.unit\.test\./.test(relative) ||
      relative === 'core/crates/aionui-api-types/src/auth.rs')
  ) {
    const cfgLine = lines.findIndex((value) => value.includes('#[cfg(test)]'));
    if (relative !== 'core/crates/aionui-api-types/src/auth.rs' || (cfgLine >= 0 && finding.StartLine > cfgLine))
      classification =
        relative.endsWith('static-server.unit.test.ts') && /Sec-WebSocket-Key/.test(line)
          ? 'public-websocket-handshake-fixture'
          : 'pinned-upstream-test-fixture';
  }
  rows.push({
    ruleId: finding.RuleID,
    path: relative,
    line: finding.StartLine,
    sourceSha256: fileHash,
    contextSha256: hash(line),
    classification: classification || 'UNREVIEWED',
  });
}
const counts = {};
for (const row of rows) counts[row.classification] = (counts[row.classification] || 0) + 1;
const report = {
  scanner: 'gitleaks 8.30.1, default rules, redacted output',
  rawScannerFindings: rows.length,
  classifications: counts,
  unreviewed: rows
    .filter((row) => row.classification === 'UNREVIEWED')
    .map((row) => ({ path: row.path, line: row.line, ruleId: row.ruleId })),
  sourceManifestVerified: true,
  scope: 'Exact clean source tree only. Synthetic positive canary and packaged payload are checked separately.',
  findings: rows,
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ findings: rows.length, classifications: counts, unreviewed: report.unreviewed.length }));
if (report.unreviewed.length) process.exitCode = 1;
