import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyLink,publicUrl,rankOffer,parseCsv,validateOrder,strategy,generateDrafts,recommendChannels } from '../lib/core.mjs';
import { isPublicIp,collectSource,directoryItems } from '../lib/network.mjs';
import { openDb } from '../lib/db.mjs';
import { offers,profile } from '../seed/catalog.mjs';

const ready={eligibility_cn:'yes',individual:'yes',payout_confirmed:true,application_status:'approved'};
const viator={...offers.find(o=>o.id==='viator'),verified_at:new Date().toISOString()};
test('非公网、凭证、非HTTP和保留地址不可进入来源',()=>{
  for(const url of ['file:///etc/passwd','javascript:alert(1)','http://localhost/','http://127.0.0.1/','http://0x7f000001/','http://192.168.1.1','https://u:p@example.com/','http://[::1]/','https://example.com:8080'])assert.throws(()=>publicUrl(url));
  assert.equal(publicUrl('https://example.com/').host,'example.com');
  for(const ip of ['127.0.0.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.3','2001:db8::1','::ffff:127.0.0.1'])assert.equal(isPublicIp(ip),false,ip);
  assert.equal(isPublicIp('8.8.8.8'),true);
});
test('识别参数但逐字保留原URL及未知邀请码',()=>{
  const original='https://example.com/go/encoded-path?fpr=My_Code&sig=a%2Bb%2fc&utm_source=youtube';
  const found=identifyLink('推广链接 '+original+' 邀请码：ABCD12');
  assert.equal(found.url,original);assert.equal(found.codes.find(c=>c.key==='fpr').value,'My_Code');assert.equal(found.codes.find(c=>c.key==='utm_source').kind,'tracking');assert.equal(found.codes.find(c=>c.key==='邀请码').value,'ABCD12');
  assert.equal(identifyLink('https://example.com/?coupon=SAVE20').codes.length,0);
});
test('0门槛与未知不同；四项本人资格缺一不通过',()=>{
  assert.equal(rankOffer(viator,profile,ready).ready,true);
  for(const key of Object.keys(ready)){const partial={...ready};delete partial[key];assert.equal(rankOffer(viator,profile,partial).ready,false,key);}
  assert.equal(rankOffer({...viator,payout_min:null},profile,ready).ready,false);
});
test('高奖金不能抵消主体不符、非现金、到期或条款过旧',()=>{
  assert.equal(rankOffer({...viator,fixed_min:100000},profile,{...ready,eligibility_cn:'no'}).excluded,true);
  for(const patch of [{cash_type:'points'},{verified_at:'2020-01-01'},{ends_at:'2020-01-01'}])assert.equal(rankOffer({...viator,...patch},profile,ready).ready,false);
  assert.equal(rankOffer(viator,profile,ready,[{pending_review:true}]).ready,false);
});
test('奖励用下限；最高档位不改变默认分数',()=>{
  const a=rankOffer({...viator,fixed_min:100,fixed_max:300},profile,{});
  const b=rankOffer({...viator,fixed_min:100,fixed_max:50000},profile,{});
  assert.equal(a.score,b.score);
});
test('禁投渠道不推荐；无链接草稿明确缺口且没有体验造假',()=>{
  const apify=offers.find(o=>o.id==='apify');const p={...profile,channels:['paid','youtube','blog','xhs']};
  assert(!recommendChannels(apify,p).some(c=>c.key==='paid'));
  const drafts=generateDrafts(apify,p,null);assert(drafts.length);assert(drafts.every(d=>d.status==='link_missing'));assert(drafts.every(d=>!d.body.includes('我亲测')));
});
test('CSV支持带引号的逗号、换行、BOM，拒绝重复列名和破损行',()=>{
  assert.deepEqual(parseCsv('\uFEFFa,b\n"one,two","three\nfour"\n'),[{a:'one,two',b:'three\nfour'}]);
  assert.throws(()=>parseCsv('a,a\n1,2'));assert.throws(()=>parseCsv('a,b\n"broken,2'));assert.throws(()=>parseCsv('a,b\n1,2,3'));
});
test('银行到账必须有凭据；金额精确到分且拒绝负数和未知状态',()=>{
  const row={network:'test',order_id:'o',campaign_id:'c',amount:'0.29',currency:'USD',status:'approved',occurred_at:'2026-10-20T00:00:00Z'};
  assert.equal(validateOrder(row).amount_minor,29);
  for(const patch of [{status:'bank_received'},{amount:'-1'},{amount:'1.999'},{status:'success'},{currency:'$'}])assert.throws(()=>validateOrder({...row,...patch}));
});
test('币种、待审、平台付款与有效到账分开；预览点击不进入分母',()=>{
  const data=strategy([{id:'c'}],[{campaign_id:'c',currency:'USD',status:'paid',amount_minor:10000},{campaign_id:'c',currency:'CNY',status:'bank_received',amount_minor:20000},{campaign_id:'c',currency:'USD',status:'refunded',amount_minor:5000}],[{campaign_id:'c',excluded:0},{campaign_id:'c',excluded:1}])[0];
  assert.equal(data.clicks,1);assert.equal(data.money.USD.bank_received,0);assert.equal(data.money.USD.paid,10000);assert.equal(data.money.CNY.bank_received,20000);assert(data.recommendation.includes('样本不足'));
});
test('网页变化产生复核状态，不能自动改写佣金；失败保留既有快照',async()=>{
  const s=openDb(':memory:');const source=s.get('source','n8n');
  const html=n=>'<html><body>'+('<p>Affiliate commission '+n+'%. Payout minimum 100 EUR. Public official affiliate terms.</p>'.repeat(10))+'</body></html>';
  await collectSource(s,source,async()=>({status:200,text:html(30)}));
  const next=await collectSource(s,s.get('source','n8n'),async()=>({status:200,text:html(20)}));
  assert.equal(next.changed,true);assert.equal(s.get('source','n8n').pending_review,true);assert.equal(s.get('offer','n8n').percent_min,30);
  await collectSource(s,s.get('source','n8n'),async()=>{throw new Error('network failed');});
  assert(s.get('snapshot','n8n').text.includes('20%'));assert.equal(s.get('source','n8n').last_status,'error');s.db.close();
});
test('公开JSON数据保留第三方口径、类目和旧核对日，不变成大陆资格',()=>{
  const items=directoryItems(JSON.stringify({updated:'2026-10-18',programs:[{slug:'x',name:'Example',cat:'finance',commission:'up to 40%',geo:'Global',verified:'2026-06-21',domain:'example.com'},{slug:'y',name:'Closed',commission:'No public program'}]}),{url:'https://example.org/data/programs.json'});
  assert.equal(items[0].category,'金融服务');assert.equal(items[0].reported_checked_at,'2026-06-21');assert.equal(items[0].status,'unverified');assert.equal(items[0].eligibility_cn,undefined);assert.equal(items[1].status,'no_public_program');
});
test('Affplus只提取活动路径并按标题初分，不把网络与导航当活动',()=>{
  const items=directoryItems('<a href="/o/mobile-ios-cpi">Mobile iOS CPI</a><a href="/n/network">A Network</a><a href="/about">About</a>',{id:'affplus',url:'https://www.affplus.com/'});
  assert.equal(items.length,1);assert.equal(items[0].category,'应用推广');
});
test('X草稿为分帖英文，旅行与商品稿有各自的任务检查项',()=>{
  const x=generateDrafts(viator,{...profile,channels:['x','blog']},null).find(d=>d.channel==='x');
  const n8n=generateDrafts(offers.find(o=>o.id==='n8n'),profile,null).find(d=>d.channel==='x');
  assert(n8n);assert(!/[\u4e00-\u9fff]/.test(n8n.body));assert(n8n.body.includes('1/3'));assert(n8n.body.includes('3/3'));
  const travel=generateDrafts(viator,profile,null).find(d=>d.channel==='blog');assert(travel.body.includes('出行日期'));
});
