const fs=require('node:fs'),path=require('node:path');
// Only repair the built-in Codex installation path. Custom commands are authoritative.
function resolveCodexCommand(command='codex',local=process.env.LOCALAPPDATA){
  if(!local)return command;
  const bin=path.join(local,'OpenAI','Codex','bin');
  if(command!=='codex' && fs.existsSync(command))return command;
  if(command!=='codex' && !(path.relative(bin,command).split(path.sep).length===2 && path.basename(command).toLowerCase()==='codex.exe' && !path.relative(bin,command).startsWith('..')))return command;
  try{return fs.readdirSync(bin).map(n=>path.join(bin,n,'codex.exe')).filter(p=>fs.existsSync(p)&&fs.statSync(p).isFile()).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0] || command;}catch{return command;}
}
module.exports={resolveCodexCommand};
