const fs=require('node:fs'),path=require('node:path'),{isBuiltin}=require('node:module');
const root=process.argv[2]||path.resolve(__dirname, '../../desktop');
const files=fs.readdirSync(path.join(root,'out/main')).filter(f=>f.endsWith('.js'));
const names=new Set();
for(const file of files){const text=fs.readFileSync(path.join(root,'out/main',file),'utf8');for(const m of text.matchAll(/require\(["']([^"']+)["']\)/g)){const n=m[1];if(!n.startsWith('.')&&!isBuiltin(n))names.add(n);}}
console.log([...names].sort().join('\n'));
