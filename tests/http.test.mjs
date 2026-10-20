import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp } from '../server.mjs';
const app=makeApp({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const state=await (await fetch(base+'/api/state')).json();
const post=async(path,b,extra={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Lydia-CSRF':state.csrf,...extra},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
test.after(()=>{app.server.close();app.store.db.close();});
test('新安装不伪造流量、个人资格、收益和API连接',()=>{
  assert.equal(state.offers.length,15);assert.equal(state.campaigns.length,0);assert.equal(state.orders.length,0);assert(state.offers.every(o=>!o.ranking.ready));assert.equal(state.application_stats.rate,null);assert.equal(state.integrations.awin.configured,false);
});
test('跨站写入和DNS重绑定Host被拒绝',async()=>{
  assert.equal((await post('/api/identify',{text:'x'},{Origin:'https://evil.example'})).status,400);
  const code=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);});assert.equal(code,400);
  const noToken=await fetch(base+'/api/identify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noToken.status,400);
});
test('未配置密钥时真实接口失败，不返回伪造链接',async()=>{
  const r=await post('/api/awin/link',{offer_id:'viator'});assert.equal(r.status,400);assert(!r.body.url);
});
test('本人资格、真实链接和渠道许可通过后才建计划，原链接完全保留',async()=>{
  const original='https://www.viator.com/?pid=P000TEST&sig=a%2Bb%2fc';
  const link=await post('/api/links',{offer_id:'viator',text:original,ownership_confirmed:true});assert.equal(link.status,200);assert.equal(link.body.url,original);
  const blocked=await post('/api/campaigns',{offer_id:'viator',link_id:link.body.id,channel:'blog',channel_terms_confirmed:true});assert.equal(blocked.status,400);
  await post('/api/accounts',{offer_id:'viator',application_status:'approved',eligibility_cn:'yes',individual:'yes',payout_confirmed:true,payout_method:'test only',evidence:'synthetic acceptance fixture, not an actual account'});
  const created=await post('/api/campaigns',{offer_id:'viator',link_id:link.body.id,channel:'blog',channel_terms_confirmed:true});assert.equal(created.status,200);assert.equal(created.body.public_tracking_verified,false);
  const redirect=await fetch(created.body.local_test_url,{redirect:'manual',headers:{'User-Agent':'Lydia-QA'}});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),original);
  const next=await (await fetch(base+'/api/state')).json();assert.equal(next.analytics[0].clicks,0);assert.equal(next.analytics[0].excluded_clicks,1);
});
test('接口密钥在状态与备份中均不可回显',async()=>{
  await post('/api/settings/awin',{publisher_id:'123',token:'FAKE_SECRET_FOR_TEST_ONLY'});
  assert(!(await (await fetch(base+'/api/state')).text()).includes('FAKE_SECRET_FOR_TEST_ONLY'));
  assert(!(await (await fetch(base+'/api/export')).text()).includes('FAKE_SECRET_FOR_TEST_ONLY'));
});
test('无模型也可自动生成渠道草稿，缺链接状态与后续编辑可保存',async()=>{
  const g=await post('/api/generate',{offer_id:'n8n',use_ai:false});assert.equal(g.status,200);assert(g.body.drafts.length>=3);assert(g.body.drafts.every(d=>d.generator==='rule'&&d.status==='link_missing'));
  const edited=await post('/api/generations/update',{id:g.body.id,index:0,title:'edited title',body:'edited body'});assert.equal(edited.status,200);assert.equal(app.store.get('generation',g.body.id).drafts[0].body,'edited body');
});
test('不限新类目导入；批量中存在坏链接则完全不写入',async()=>{
  const count=app.store.all('offer').length;
  const bad=await post('/api/offers/import',{offers:[{name:'new',category:'任意新类目',source_url:'https://example.com/terms',apply_url:'https://example.com/affiliate'},{name:'bad',source_url:'http://127.0.0.1/',apply_url:'https://example.com/other'}]});assert.equal(bad.status,400);assert.equal(app.store.all('offer').length,count);
  const good=await post('/api/offers/import',{offers:[{name:'new',category:'任意新类目',source_url:'https://example.com/terms',apply_url:'https://example.com/affiliate'}]});assert.equal(good.status,200);assert.equal(app.store.all('offer').at(-1).category,'任意新类目');assert.equal(app.store.all('offer').at(-1).verified_at,null);
});
