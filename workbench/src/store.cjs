const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function atomicJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,JSON.stringify(value,null,2));
    const delays=[10,20,40,80,160,250,400];
    for(let attempt=0;;attempt++){
      try{fs.renameSync(tmp,file);break;}
      catch(error){
        if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=delays.length)throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delays[attempt]);
      }
    }
  }finally{try{fs.unlinkSync(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
class Store {
  constructor(directory,defaults){this.file=path.join(directory,'workspace.json');this.value=readJson(this.file,defaults);this.save();}
  save(){atomicJson(this.file,this.value);}
}
class Vault {
  constructor(directory,safeStorage){this.file=path.join(directory,'credentials.json');this.safeStorage=safeStorage;this.data=readJson(this.file,{});}
  get(key){if(!this.data[key])return null;try{if(this.data[key].startsWith('dpapi:'))return require('./dpapi.cjs').unprotect(this.data[key]);return JSON.parse(this.safeStorage.decryptString(Buffer.from(this.data[key],'base64')));}catch{return null;}}
  set(key,value){if(!this.safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，不能保存连接凭据');this.data[key]=this.safeStorage.encryptString(JSON.stringify(value)).toString('base64');atomicJson(this.file,this.data);}
}
function insideProject(root,target){
  const base=fs.realpathSync(root);const resolved=fs.realpathSync(path.resolve(root,target));
  const relative=path.relative(base,resolved);if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('只能查看当前项目中的文件');return resolved;
}
module.exports={Store,Vault,atomicJson,insideProject};
