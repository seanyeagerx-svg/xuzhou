const {Operations}=require('./context/operations.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {History} = require('./history.cjs');
const {ContinuityDesk} = require('./context/desk.cjs');
const {AutoSync} = require('./auto-sync.cjs');
const {NativeCatalog} = require('./native-catalog.cjs');
const {NativeApp, discoverGrok} = require('../../../src/native-app.cjs');
const {atomicJson} = require('../../../src/store.cjs');
const {ChatCompanion} = require('../lobster/companion.cjs');
const {Computers} = require('../devices/index.cjs');
class WorkspaceRuntime {
  constructor({directory,legacyDirectory,window,backend,chooseFile,chooseDirectory,nativeFactory,lobster,native}) {
    this.operations=new Operations(directory); this.directory = directory; this.chooseFile = chooseFile; this.chooseDirectory = chooseDirectory;
    this.preferences = path.join(directory,'workspace-integrations.json');
    const saved = fs.existsSync(this.preferences) ? JSON.parse(fs.readFileSync(this.preferences,'utf8')) : {};
    const legacy = JSON.parse(fs.readFileSync(path.join(legacyDirectory,'workspace.json'),'utf8'));
    const executable = [saved.grokExecutable,legacy.grokExecutable].find(p=>typeof p==='string' && path.isAbsolute(p) && path.basename(p).toLowerCase()==='grok bot.exe' && fs.existsSync(p)) || discoverGrok();
    this.makeNative = nativeFactory || (exe=>new NativeApp(window,exe));
    this.grok = this.makeNative(executable);
    this.history = new History({directory:process.env.XUZHOU_SESSIONS_DIR || path.resolve(__dirname,'../sessions-local'),workspaceDirectory:path.join(directory,'workspaces'),legacyDirectory,backend});
    this.sync = new AutoSync({history:this.history}); this.sync.start();
    this.desk = new ContinuityDesk({history:this.history,sync:this.sync,backend});
    this.nativeCatalog=new NativeCatalog({history:this.history});
    if(lobster)this.companion=new ChatCompanion({directory,sessionsDirectory:this.history.directory,backend,lobster});
    this.computers=new Computers({directory,sessionsDirectory:this.history.directory,backend,lobster,native,dispatch:(action,data,caller)=>this.call(action,data,caller)});
  }
  async call(action,data={},caller={source:'desktop',actor:'desktop'}) {
    if(typeof action!=='string')throw Error('未知工作台操作');
    if(action==='operations-state'||action.startsWith('backup-')||action.startsWith('update-'))return this.operations.call(action,data,caller);
    if(action.startsWith('computer-'))return this.computers.call(action,data,caller);
    if(caller.source==='phone'&&(action.startsWith('grok-')||action==='choose-directory'))throw Error('XUZHOU_DEVICE_DESKTOP_REQUIRED');
    if(action.startsWith('companion-')){
      if(!this.companion){if(action==='companion-state')return {available:false};throw Error('小龙虾连接尚未就绪');}
      return this.companion.call(action,data);
    }
    if (action==='state') return {available:true,grok:await this.grok.status()};
    if (['chat-continuity','chat-sync-now','chat-sync-toggle'].includes(action)) return this.desk.call(action,data);
    if (action==='chat-options') return {available:true,assistantId:(await this.history.assistant()).id};
    if (action==='chat-create') return this.history.createNew(data.cwd,data.requestId,{name:data.name,locale:data.locale,overrides:data.overrides,extra:data.extra});
    if (action==='history-list') return this.history.list(data.agentId,data.cursor);
    if (action==='codex-catalog') return this.nativeCatalog.list();
    if (action==='codex-open') {
      const entry=await this.history.openNative(data.id);
      this.sync.schedule(0);
      return entry;
    }
    if (action==='history-preview') return this.history.preview(data.agentId,data.id);
    if (action==='history-import') return this.history.import(data.token,data.cwd);
    if (action==='history-create-v3') return this.history.createNew(data.cwd,data.requestId);
    if (action==='history-snapshot') return this.history.snapshot(data.id);
    if (action==='history-sync-state') return this.sync.status(data.id);
    if (action==='history-sync-toggle') return this.sync.setEnabled(data.id,data.enabled);
    if (action==='history-check-updates') return this.history.previewUpdates(data.id);
    if (action==='history-accept-updates') return this.history.acceptUpdates(data.token);
    if (action==='choose-directory') return this.chooseDirectory();
    if (action==='grok-open') return this.grok.show(data.bounds);
    if (action==='grok-layout') return this.grok.layout(data.bounds);
    if (action==='grok-hide') return this.grok.hide();
    if (action==='grok-status') return this.grok.status();
    if (action==='grok-choose') {
      const executable = await this.chooseFile(); if (!executable) return this.grok.info;
      if (!path.isAbsolute(executable) || path.basename(executable).toLowerCase()!=='grok bot.exe' || !fs.statSync(executable).isFile()) throw new Error('请选择已安装的 Grok Bot.exe');
      await this.grok.close(); this.grok = this.makeNative(executable);
      atomicJson(this.preferences,{grokExecutable:executable}); return this.grok.info;
    }
    throw new Error('未知工作台操作');
  }
  async close() { this.operations.close(); await this.computers.close(); await this.companion?.close(); await this.sync.close(); this.history.close(); await this.grok.close(); }
}
module.exports = {createWorkspaceRuntime: options=>new WorkspaceRuntime(options)};
