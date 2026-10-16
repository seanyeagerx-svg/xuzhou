const {execFileSync}=require('node:child_process');
function transform(value,decrypt=false){
  if(process.platform!=='win32')throw new Error('DPAPI 需要 Windows');
  const action=decrypt?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $taskResult=[Security.Cryptography.ProtectedData]::${action}($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskResult))`;
  return execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
}
function protect(value){return 'dpapi:'+transform(Buffer.from(JSON.stringify(value),'utf8').toString('base64'));}
function unprotect(value){return JSON.parse(Buffer.from(transform(value.slice(6),true),'base64').toString('utf8'));}
module.exports={protect,unprotect};
