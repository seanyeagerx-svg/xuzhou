const {Backup}=require('../../../../src/continuity/backup.cjs');
const {Updates}=require('../../../../src/continuity/updates.cjs');
class Operations{
  constructor(directory){this.backup=new Backup({directory});this.updates=new Updates(directory);}
  async call(action,data,caller){if(caller.source!=='desktop'&&action!=='operations-state')throw Error('XUZHOU_DEVICE_DESKTOP_REQUIRED');
    if(action==='operations-state')return {backup:this.backup.snapshot(),updates:this.updates.snapshot(),capabilities:{codex:{text:true,image:true,audio:false,sync:'native'},'kiro-v3':{text:true,image:'negotiated',audio:false,sync:'native'},zcode:{text:true,image:false,audio:false,sync:'native-injection-unavailable'}},cloud:{requiresMaintenanceLogin:true},signing:{certificateConfigured:false}};
    if(action==='backup-configure')return this.backup.configure(data);if(action==='backup-run')return this.backup.run();if(action==='update-configure')return this.updates.configure(data);if(action==='update-check-own')return this.updates.check();throw Error('Unknown operation');}
  close(){this.backup.close();}
}
module.exports={Operations};
