const fs = require('node:fs'), path = require('node:path');
const source = path.resolve(__dirname, '../../../evidence/aionui-review-2026-10-14/AionUi');
const config = require(path.join(source,'packages/desktop/src/common/config/i18n-config.json'));
const en = {
  history:'Continue an existing chat',grok:'Grok Bot',you:'You',toolRecord:'Historical tool record',
  historyHint:'Choose a Codex or Kiro CLI / Crew chat, preview it, and continue in a new unified conversation. The original stays intact. Hidden reasoning and attachments are not transferred. Kiro IDE and cloud history are not connected.',
  search:'Search chat titles or project folders',refresh:'Refresh',noHistory:'No local chats found',more:'Load more',selectHistory:'Select a chat to preview',
  messages:'{{count}} visible messages / tool records',project:'Project folder',chooseProject:'Choose folder',continue:'Bring history and continue',
  carried:'History from {{provider}} · {{count}} records · View',snapshotHint:'Your next message uses the imported history. Check the original chat for updates, preview new records, then choose to bring them into this conversation. Codex / Kiro can both continue from them. Rewritten history is not merged.',
  checkUpdates:'Check original chat for updates',bringUpdates:'Bring {{count}} new records',newRecords:'{{count}} new records below. Bringing them in keeps this conversation and its replies.',noUpdates:'No new records to bring in.',updatesSaved:'Updates saved. Your next message will use them; any reply already in progress continues as before.',
  grokHint:'The original Grok Bot client runs here with its own login. It currently keeps its own chats; unified model switching is available for Codex and Kiro.',
  reconnect:'Open / reconnect',chooseGrok:'Choose Grok Bot',attached:'Connected inside this window',
};
const zh = {
  history:'接着旧聊天聊',grok:'Grok Bot',you:'你',toolRecord:'历史工具记录',
  historyHint:'选择 Codex 或 Kiro CLI / Crew 的旧聊天，预览后带入新的统一对话。原聊天保留；内部思考和附件不带入。Kiro IDE 与云端历史暂未接入。',
  search:'搜索聊天标题或项目文件夹',refresh:'刷新',noHistory:'没有找到本机聊天',more:'加载更多',selectHistory:'选择一段聊天查看前文',
  messages:'{{count}} 条可见消息／工具记录',project:'项目文件夹',chooseProject:'选择文件夹',continue:'带入前文并继续',
  carried:'已带入 {{provider}} 前文 · {{count}} 条 · 查看',snapshotHint:'下一条消息会接着已带入的前文聊。可检查原聊天更新，预览新增内容后带入当前对话，Codex / Kiro 都能接着聊。原记录被改写时不会直接合并。',
  checkUpdates:'检查原聊天更新',bringUpdates:'带入 {{count}} 条新增记录',newRecords:'以下是 {{count}} 条新增记录。带入后保留当前聊天及已有回复。',noUpdates:'没有可带入的新记录。',updatesSaved:'更新已保存，下一条消息会接着聊；正在进行的回复不受影响。',
  grokHint:'这里使用 Grok Bot 原客户端和原登录。目前保留它自己的聊天；统一对话中的模型切换已支持 Codex 和 Kiro。',
  reconnect:'打开／重新连接',chooseGrok:'选择 Grok Bot 程序',attached:'已嵌入当前窗口',
};
const tw = {
  history:'接著舊聊天聊',grok:'Grok Bot',you:'你',toolRecord:'歷史工具記錄',
  historyHint:'選擇 Codex 或 Kiro CLI / Crew 的舊聊天，預覽後帶入新的統一對話。原聊天保留；內部思考和附件不帶入。Kiro IDE 與雲端歷史暫未接入。',
  search:'搜尋聊天標題或專案資料夾',refresh:'重新整理',noHistory:'沒有找到本機聊天',more:'載入更多',selectHistory:'選擇一段聊天查看前文',
  messages:'{{count}} 條可見訊息／工具記錄',project:'專案資料夾',chooseProject:'選擇資料夾',continue:'帶入前文並繼續',
  carried:'已帶入 {{provider}} 前文 · {{count}} 條 · 查看',snapshotHint:'下一條訊息會接著已帶入的前文聊。可檢查原聊天更新，預覽新增內容後帶入目前對話，Codex / Kiro 都能接著聊。原記錄被改寫時不會直接合併。',
  checkUpdates:'檢查原聊天更新',bringUpdates:'帶入 {{count}} 條新增記錄',newRecords:'以下是 {{count}} 條新增記錄。帶入後保留目前聊天及已有回覆。',noUpdates:'沒有可帶入的新記錄。',updatesSaved:'更新已儲存，下一條訊息會接著聊；正在進行的回覆不受影響。',
  grokHint:'這裡使用 Grok Bot 原客戶端和原登入。目前保留它自己的聊天；統一對話中的模型切換已支援 Codex 和 Kiro。',
  reconnect:'開啟／重新連線',chooseGrok:'選擇 Grok Bot 程式',attached:'已嵌入目前視窗',
};
en.snapshotHint='New records from the original chat are checked automatically and used on your next message. Replies in progress are left alone. Rewritten history is never merged silently. You can still check and preview manually here.';
zh.snapshotHint='原聊天新增记录会自动检查并带入，下一条消息接着聊；正在进行的回复保持原样。原记录被改写时会提示，不直接覆盖。这里仍可手动查看更新。';
tw.snapshotHint='原聊天新增記錄會自動檢查並帶入，下一條訊息接著聊；正在進行的回覆維持原樣。原記錄被改寫時會提示，不直接覆蓋。這裡仍可手動查看更新。';
en.sync={title:'Automatic history sync',active:'Auto sync · Status',paused:'Auto sync paused',attention:'Auto sync · Needs attention',loading:'Sync status',toggle:'Enable automatic sync',hint:'While AionUi is open, checks run about every 15 seconds. Stable updates are saved and used on the next message. Connection failures retry automatically; pause here at any time.',inbound:'{{provider}} → This conversation',outbound:'This conversation → {{provider}}',records:'{{count}} records saved',lastSuccess:'Last successful sync: {{time}}',codexHint:'Codex receives completed text as background context without starting a reply. It becomes available when the original chat is reopened and does not create visible chat bubbles. If another client owns the chat, updates wait until it releases the chat. Only this imported source is linked.',kiroHint:'This Kiro version can read history but has no passive history-write API. Incoming updates are automatic; returning text to the original Kiro chat is not connected. Codex / Kiro switching within this unified conversation still shares its context.',states:{pending:'Waiting for the first check',ready:'Up to date',settling:'Waiting for a completed, stable reply',sending:'Returning completed history',waiting:'Original chat is in use; will retry automatically',conflict:'History changed; original records preserved',retrying:'Connection failed; retrying automatically',unsupported:'Return path unavailable in this provider'}};
zh.sync={title:'自动同步',active:'自动同步 · 查看状态',paused:'自动同步已暂停',attention:'自动同步 · 有问题待处理',loading:'同步状态',toggle:'开启自动同步',hint:'AionUi 开着时约每 15 秒检查一次。新增记录稳定后自动保存，下一条消息接着聊；断线会重试，也可随时暂停。',inbound:'原 {{provider}} → 本聊天',outbound:'本聊天 → 原 {{provider}}',records:'已保存 {{count}} 条记录',lastSuccess:'上次成功：{{time}}',codexHint:'Codex 接收已完成的文字作为背景上下文，不会因此自动回复。重新打开原聊天后可接着聊，原界面不会新增聊天气泡；被其他客户端占用时，释放占用后自动补传。只同步当前绑定的原聊天。',kiroHint:'当前 Kiro 版本能读取历史，但没有静默写回历史的接口。原聊天更新会自动带入；回写原 Kiro 聊天暂未接通。本统一对话里切 Codex / Kiro 仍会共享前文。',states:{pending:'等待首次检查',ready:'已跟上最新记录',settling:'等待回复完成并稳定',sending:'正在回传已完成的历史',waiting:'原聊天正在使用，稍后自动重试',conflict:'历史有改写，已保留原记录',retrying:'连接失败，正在自动重试',unsupported:'此软件的回传接口暂未接通'}};
tw.sync={title:'自動同步',active:'自動同步 · 查看狀態',paused:'自動同步已暫停',attention:'自動同步 · 有問題待處理',loading:'同步狀態',toggle:'開啟自動同步',hint:'AionUi 開著時約每 15 秒檢查一次。新增記錄穩定後自動儲存，下一條訊息接著聊；斷線會重試，也可隨時暫停。',inbound:'原 {{provider}} → 本聊天',outbound:'本聊天 → 原 {{provider}}',records:'已儲存 {{count}} 條記錄',lastSuccess:'上次成功：{{time}}',codexHint:'Codex 接收已完成的文字作為背景上下文，不會因此自動回覆。重新開啟原聊天後可接著聊，原介面不會新增聊天氣泡；被其他客戶端占用時，釋放占用後自動補傳。只同步目前綁定的原聊天。',kiroHint:'目前 Kiro 版本能讀取歷史，但沒有靜默寫回歷史的介面。原聊天更新會自動帶入；回寫原 Kiro 聊天暫未接通。本統一對話裡切 Codex / Kiro 仍會共享前文。',states:{pending:'等待首次檢查',ready:'已跟上最新記錄',settling:'等待回覆完成並穩定',sending:'正在回傳已完成的歷史',waiting:'原聊天正在使用，稍後自動重試',conflict:'歷史有改寫，已保留原記錄',retrying:'連線失敗，正在自動重試',unsupported:'此軟體的回傳介面暫未接通'}};
en.history='Import a chat';zh.history='导入旧聊天';tw.history='匯入舊聊天';
en.newChat='New chat';zh.newChat='新对话';tw.newChat='新對話';
en.unifiedHint='Switch between Codex, Kiro V3 and ZCode in one chat. Keep the conversation going.';
zh.unifiedHint='一个聊天里切换 Codex、Kiro V3、ZCode，接着前面的内容聊。';
tw.unifiedHint='一個聊天裡切換 Codex、Kiro V3、ZCode，接著前面的內容聊。';
en.grokHint='The original Grok Bot client runs here with its own login and chats. Unified model switching supports Codex, Kiro V3 and ZCode.';
zh.grokHint='这里使用 Grok Bot 原客户端、原登录和它自己的聊天。统一对话中的模型切换支持 Codex、Kiro V3 和 ZCode。';
tw.grokHint='這裡使用 Grok Bot 原客戶端、原登入和它自己的聊天。統一對話中的模型切換支援 Codex、Kiro V3 和 ZCode。';
en.retryEntry='Retry connection';zh.retryEntry='重试连接';tw.retryEntry='重試連線';
en.historyHint='Bring an existing local chat into a unified conversation. Completed text syncs as background context. Hidden reasoning and original attachments are not transferred. Kiro V2 history supports incoming updates only; IDE and cloud history are not connected.';
zh.historyHint='把本机已有聊天带入统一对话。已完成的文字作为背景上下文同步，内部思考和附件原文件不带入。Kiro V2 仅支持自动读入；IDE 与云端历史暂未接入。';
tw.historyHint='把本機既有聊天帶入統一對話。已完成的文字作為背景上下文同步，內部思考和附件原檔不帶入。Kiro V2 僅支援自動讀入；IDE 與雲端歷史暫未接入。';
en.sync.kiroV3Hint='Completed text is returned through a context attachment bound only to this Kiro V3 chat. Kiro reads the latest file on its next prompt; syncing starts no reply and adds no chat bubbles. Keep the workbench data folder available. A removed attachment or capacity limit stops the return path visibly.';
zh.sync.kiroV3Hint='已完成的文字通过仅绑定这段 Kiro V3 聊天的上下文附件回传；Kiro 在下一次提问时读取最新内容。同步不会自动发起回复，也不会新增聊天气泡。请保留工作台资料目录；附件移除或容量不足时会明确提示。';
tw.sync.kiroV3Hint='已完成的文字透過僅綁定這段 Kiro V3 聊天的上下文附件回傳；Kiro 在下一次提問時讀取最新內容。同步不會自動發起回覆，也不會新增聊天氣泡。請保留工作台資料目錄；附件移除或容量不足時會明確提示。';
en.sync.openV3='To continue this same chat in the original Kiro CLI, copy and run:';
zh.sync.openV3='要在原 Kiro CLI 中继续这段聊天，可复制并运行：';
tw.sync.openV3='要在原 Kiro CLI 中繼續這段聊天，可複製並執行：';
en.sync.partial='Auto import · Return path unavailable';
zh.sync.partial='自动读取 · 回传未接通';
tw.sync.partial='自動讀取 · 回傳未接通';
en.native={title:'Codex on this computer',free:'Chats without a project',emptyProject:'No active chats',hint:'Opens directly with automatic context sync. The list refreshes while the app is open.',transcript:'Original chat · Synced context',earlier:'Show earlier records ({{count}} remaining)',continue:'Continue below · Switch Codex / Kiro V3 / ZCode in the model menu'};
zh.native={title:'Codex 本机',free:'未分组聊天',emptyProject:'暂无未归档聊天',hint:'点开即可接着聊，自动同步上下文；列表随应用自动刷新。',transcript:'原聊天 · 已同步的前文',earlier:'查看更早记录（还有 {{count}} 条）',continue:'在下方继续聊 · 模型菜单可切 Codex / Kiro V3 / ZCode'};
tw.native={title:'Codex 本機',free:'未分組聊天',emptyProject:'暫無未封存聊天',hint:'點開即可接著聊，自動同步上下文；列表隨應用自動重新整理。',transcript:'原聊天 · 已同步的前文',earlier:'查看更早記錄（還有 {{count}} 條）',continue:'在下方繼續聊 · 模型選單可切 Codex / Kiro V3 / ZCode'};
en.native.loading='Loading more local chats…';
zh.native.loading='正在读取其余本机聊天…';
tw.native.loading='正在讀取其餘本機聊天…';
en.sync.longContext='Long chats keep their complete visible text locally. Switching models carries selected original requests, corrections, related records and recent turns; the AI can search and read earlier text when needed. These excerpts are not a complete summary. Keep the workbench data folder available.';
zh.sync.longContext='长聊天的可见原文会完整保留在本机。切模型时自动带上重点原话、后续更正、相关记录和近期对话，AI 可按需检索更早的全文。摘录不等于完整摘要，请保留工作台资料目录。';
tw.sync.longContext='長聊天的可見原文會完整保留在本機。切模型時自動帶上重點原話、後續更正、相關記錄和近期對話，AI 可按需檢索更早的全文。摘錄不等於完整摘要，請保留工作台資料目錄。';
for(const lang of config.supportedLanguages) {
  const file=path.join(source,'packages/desktop/src/renderer/services/i18n/locales',lang,'settings.json');
  const json=JSON.parse(fs.readFileSync(file,'utf8'));json.workspace=lang==='zh-CN'?zh:lang==='zh-TW'?tw:en;
  fs.writeFileSync(file,JSON.stringify(json,null,2)+'\n');
}
