const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
class StdioRpc extends EventEmitter {
  constructor(command, args, options = {}) {
    super(); this.seq = 0; this.pending = new Map(); this.closed = false;
    this.child = spawn(command, args, {cwd: options.cwd, env: {...process.env, ...options.env}, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe']});
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 16*1024*1024) {this.close(); return;}
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,i).trim(); buffer = buffer.slice(i+1);
        if (!line) continue;
        try {this.receive(JSON.parse(line));} catch {this.emit('diagnostic','收到非协议输出');}
      }
    });
    this.child.stderr.on('data', () => {}); // Provider logs may contain credentials. Never mirror them into the UI.
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code,signal) => this.fail(new Error(`连接进程已结束 (${code ?? signal})`)));
    this.child.stdin.on('error', error => this.fail(error));
  }
  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message || '协议请求失败')) : pending.resolve(message.result);
    } else if (message.id !== undefined) {this.emit('request',message);}
    else this.emit('notification',message);
  }
  send(value) {if(this.closed) throw new Error('连接已关闭'); this.child.stdin.write(JSON.stringify(value)+'\n');}
  request(method,params={},timeout=30000) {
    if(this.closed) return Promise.reject(new Error('连接已关闭'));
    const id = ++this.seq;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(()=> {this.pending.delete(id); reject(new Error(`${method} 等待超时`));}, timeout);
      this.pending.set(id,{resolve,reject,timer});
      try {this.send({jsonrpc:'2.0',id,method,params});} catch(e) {this.pending.delete(id); clearTimeout(timer); reject(e);}
    });
  }
  notify(method,params={}) {this.send({jsonrpc:'2.0',method,params});}
  respond(id,result) {this.send({jsonrpc:'2.0',id,result});}
  reject(id,message='此客户端不支持此请求') {this.send({jsonrpc:'2.0',id,error:{code:-32601,message}});}
  fail(error) {
    if(this.closed) return; this.closed = true;
    for(const p of this.pending.values()){clearTimeout(p.timer); p.reject(error);} this.pending.clear();
    this.emit('disconnected',error.message);
  }
  close() {if(!this.closed) {this.fail(new Error('连接已关闭')); this.child.kill();}}
}
module.exports = {StdioRpc};
