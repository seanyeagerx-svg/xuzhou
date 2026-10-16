// Reproducible locale additions for the optional desktop integration.
const fs = require('node:fs'), path = require('node:path');
const source = path.resolve(__dirname, '../../../evidence/aionui-review-2026-10-14/AionUi');
const config = require(path.join(source, 'packages/desktop/src/common/config/i18n-config.json'));
const en = {
  title: 'Lobster assistant', intro: 'Work reports and independent repair, alongside your Codex / Kiro conversation.', project: 'Project',
  gateway: 'Lobster chat', repairChannel: 'Independent repair', connected: 'Connected', offline: 'Disconnected',
  sync: 'Work sync', maintenance: 'Check & repair', connection: 'Connections', allowOnce: 'Allow once', deny: 'Deny',
  autoSync: 'Automatically report work', syncHint: 'Codex and Kiro report starts, results and your acceptance. Offline reports stay on this computer; delivery requires a durable receipt.',
  delivered: 'Delivered: {{count}}', pending: 'Pending: {{count}}', records: 'Delivery records', received: 'Received', queued: 'Pending verification', receipt: 'Receipt',
  accept: 'Accept result', assistantChat: 'This project’s Lobster conversation', workReport: 'Work report', you: 'You', replying: 'Lobster is replying…',
  noMessages: 'No messages in this project yet', message: 'Send a message to this project’s Lobster assistant', send: 'Send to Lobster',
  start: 'Start and verify', recover: 'Maintain and recover', startHint: 'Start the existing OpenClaw service and verify that it is running and ready.',
  recoverHint: 'Stop the service, create backups, perform only the selected maintenance, then attempt to start and verify it. Closing the app does not stop an already dispatched repair job.',
  compact: 'Compact the main database', heap: 'Optional heap limit', keep: 'Keep existing setting', yes: 'Yes', no: 'No',
  maintenanceHint: 'Repair uses an independent SSH connection and remains available when Lobster is offline.', loginFirst: 'Open Connections and sign in to the independent repair channel first.',
  diagnose: 'Read-only health check', diagnosis: 'Last health check', jobs: 'Repair jobs', completed: 'Recovery verified', running: 'Running', failed: 'Failed / unverified',
  service: 'Service', readiness: 'Ready', checkJob: 'Check job result', jobHint: 'Historical jobs describe their last verified result. Use a new health check to confirm the server’s current state.',
  connectGateway: 'Connect Lobster', disconnect: 'Disconnect', pairing: 'Approve this device request in your existing OpenClaw console', gatewayUrl: 'Gateway address',
  gatewayToken: 'Replacement token (leave blank to keep the current token)', credentialsHint: 'Existing encrypted connection data is reused. The SSH password is used for this connection only and is never saved or sent to an AI.',
  hostIdentity: 'Verify server identity', trust: 'Trust this fingerprint', host: 'Server', username: 'Login user', sshPort: 'SSH port',
  password: 'SSH password / key passphrase for this connection', keyFile: 'Existing SSH key file (optional)', servicePort: 'OpenClaw port', scope: 'Service scope',
  userService: 'User service', systemService: 'System service', connectSsh: 'Connect independent repair', logs: 'Recent logs', disk: 'Disk', memory: 'Memory',
};
const zh = {
  title: '龙虾助理', intro: '在 Codex / Kiro 对话旁，查看工作汇报、联系龙虾和独立维修。', project: '项目',
  gateway: '龙虾对话', repairChannel: '独立维修', connected: '已连接', offline: '未连接', sync: '工作同步', maintenance: '检查维修', connection: '连接', allowOnce: '允许本次', deny: '拒绝',
  autoSync: '自动向龙虾汇报', syncHint: 'Codex、Kiro 自动同步开始、结果和用户验收状态。离线时留在本机；取得持久回执后才显示送达。',
  delivered: '已送达 {{count}} 条', pending: '待同步 {{count}} 条', records: '同步记录与回执', received: '已送达', queued: '待核对送达', receipt: '回执',
  accept: '确认验收', assistantChat: '当前项目的龙虾对话', workReport: '工作汇报', you: '你', replying: '龙虾正在回复…', noMessages: '当前项目还没有龙虾消息',
  message: '给当前项目的龙虾助理发消息', send: '发送给龙虾', start: '启动并验证', recover: '维护并恢复', startHint: '启动现有 OpenClaw 服务，并检查服务运行和就绪状态。',
  recoverHint: '停止服务并备份，只执行勾选的维护，然后尝试启动和验证。已派发的维修任务会在服务器继续运行，关闭窗口不会终止任务。',
  compact: '压缩主数据库', heap: '内存堆上限（可留空）', keep: '保留现有设置', yes: '是', no: '否', maintenanceHint: '通过独立 SSH 通道检查和恢复，龙虾离线时也能使用。',
  loginFirst: '请先到「连接」页登录独立维修通道。', diagnose: '只读健康检查', diagnosis: '最近一次检查', jobs: '维修任务', completed: '已验证恢复', running: '执行中', failed: '失败／未确认',
  service: '服务', readiness: '就绪', checkJob: '核对任务结果', jobHint: '历史任务显示上次验证结果；服务器当前是否正常，需要重新检查。', connectGateway: '连接龙虾', disconnect: '断开',
  pairing: '请在原 OpenClaw 控制台批准此设备申请', gatewayUrl: '龙虾网关地址', gatewayToken: '更新连接令牌（留空保留原令牌）',
  credentialsHint: '沿用原工作台的加密连接资料。SSH 密码仅用于本次连接，不保存、不发给 AI。', hostIdentity: '核对服务器身份', trust: '信任此指纹', host: '服务器', username: '登录用户', sshPort: 'SSH 端口',
  password: '本次 SSH 密码／密钥口令', keyFile: '现有 SSH 密钥文件（可选）', servicePort: 'OpenClaw 端口', scope: '服务范围', userService: '用户服务', systemService: '系统服务', connectSsh: '连接独立维修通道',
  logs: '最近日志', disk: '磁盘', memory: '内存',
};
const tw = { ...zh, title: '龍蝦助理', intro: '在 Codex / Kiro 對話旁，查看工作回報、聯絡龍蝦和獨立維修。', project: '專案', gateway: '龍蝦對話', repairChannel: '獨立維修', connected: '已連線', offline: '未連線',
  sync: '工作同步', maintenance: '檢查維修', connection: '連線', allowOnce: '允許本次', deny: '拒絕', autoSync: '自動向龍蝦回報', syncHint: 'Codex、Kiro 自動同步開始、結果和使用者驗收狀態。離線時留在本機；取得持久收據後才顯示送達。',
  delivered: '已送達 {{count}} 筆', pending: '待同步 {{count}} 筆', records: '同步紀錄與收據', received: '已送達', queued: '待核對送達', receipt: '收據', accept: '確認驗收', assistantChat: '目前專案的龍蝦對話', workReport: '工作回報', you: '你', replying: '龍蝦正在回覆…',
  noMessages: '目前專案尚無龍蝦訊息', message: '傳送訊息給目前專案的龍蝦助理', send: '傳送給龍蝦', start: '啟動並驗證', recover: '維護並復原', startHint: '啟動現有 OpenClaw 服務，並檢查服務執行及就緒狀態。',
  recoverHint: '停止服務並備份，只執行勾選的維護，然後嘗試啟動和驗證。已派發的維修工作會在伺服器繼續執行，關閉視窗不會終止工作。', compact: '壓縮主資料庫', heap: '記憶體堆積上限（可留空）', keep: '保留現有設定',
  maintenanceHint: '透過獨立 SSH 通道檢查和復原，龍蝦離線時也能使用。', loginFirst: '請先到「連線」頁登入獨立維修通道。', diagnose: '唯讀健康檢查', diagnosis: '最近一次檢查', jobs: '維修工作', completed: '已驗證復原', running: '執行中', failed: '失敗／未確認', readiness: '就緒', checkJob: '核對工作結果',
  jobHint: '歷史工作顯示上次驗證結果；伺服器目前是否正常，需要重新檢查。', connectGateway: '連線龍蝦', disconnect: '中斷連線', pairing: '請在原 OpenClaw 控制台核准此裝置申請', gatewayUrl: '龍蝦閘道位址', gatewayToken: '更新連線權杖（留空保留原權杖）',
  credentialsHint: '沿用原工作台的加密連線資料。SSH 密碼僅用於本次連線，不儲存、不傳給 AI。', hostIdentity: '核對伺服器身分', trust: '信任此指紋', host: '伺服器', username: '登入使用者', sshPort: 'SSH 連接埠', password: '本次 SSH 密碼／金鑰密語', keyFile: '現有 SSH 金鑰檔案（選用）', servicePort: 'OpenClaw 連接埠', scope: '服務範圍', userService: '使用者服務', systemService: '系統服務', connectSsh: '連線獨立維修通道', logs: '最近記錄', disk: '磁碟', memory: '記憶體',
};
// Other locales receive explicit English fallback strings, preserving existing translations.
for (const locale of config.supportedLanguages) {
  const file = path.join(source, 'packages/desktop/src/renderer/services/i18n/locales', locale, 'settings.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.lobster = locale === 'zh-CN' ? zh : locale === 'zh-TW' ? tw : en;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const ui = path.join(source, 'packages/desktop/src/renderer/components/layout/Sider/SiderNav/LobsterPanel');
for (const file of fs.readdirSync(ui).filter(f => f.endsWith('.tsx'))) {
  const target = path.join(ui, file);
  let text = fs.readFileSync(target, 'utf8');
  for (const key of ['save', 'confirm', 'cancel', 'refresh', 'retry']) text = text.replaceAll('settings.lobster.' + key + "'", 'common.' + key + "'");
  fs.writeFileSync(target, text);
}
