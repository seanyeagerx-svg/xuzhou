const test=require('node:test'),assert=require('node:assert/strict');const routing=require('../../../../src/continuity/session.cjs');const {continuation}=require('../../workspace/context/continuation.cjs');const {records,search}=require('../../workspace/context/history.cjs');
test('1000 simulated provider switches retain all messages, late corrections and restart cursors',()=>{
  let c={id:'synthetic-stress',agentId:'codex',remoteId:'native-codex',model:'test',messages:[{id:'goal',role:'user',text:'必须保留原始文件，预算 9000。'}],routes:{codex:{agentId:'codex',remoteId:'native-codex',cursor:0}}};
  for(let i=0;i<1000;i++){
    const provider=['codex','kiro-v3','zcode'][i%3];routing.bindSession(c,provider,'native-'+provider);routing.activateRoute(c,provider);
    if(i===800)c.messages.push({id:'correction',role:'user',text:'更正：预算改为 7300，原先的 9000 作废。'});
    const before=c.messages.length,carried=continuation(c,'继续，预算是多少？');c.messages.push({id:'u'+i,role:'user',text:'继续 '+i+' 资料'.repeat(30)},{id:'a'+i,role:'assistant',text:'合成回复 '+i,status:i%31===0?'interrupted':'completed'});c.activeTurn={agentId:provider,remoteId:c.remoteId,transfer:carried.transfer};routing.finishTurn(c,i%31===0?'error':'completed');assert.equal(c.messages.length,before+2);
    if(i%50===0)c=JSON.parse(JSON.stringify(c));
  }
  const result=search(records(c.messages),{query:'预算改为 7300'});assert.ok(result.results.some(row=>row.text.includes('7300')));assert.equal(c.messages.length,2002);assert.equal(c.messages[0].text,'必须保留原始文件，预算 9000。');
});
