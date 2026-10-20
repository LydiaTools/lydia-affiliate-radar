import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.mjs';
import { awinLink,awinOffers,awinTransactions,upsertOrders } from '../lib/integrations.mjs';
const config={publisher_id:'123',token:'fake-test-token-not-a-credential'};
const order={network:'test',order_id:'o1',campaign_id:'c1',amount:'12.34',currency:'USD',status:'pending',occurred_at:'2026-10-20T00:00:00Z',evidence:''};
function fixture(){const s=openDb(':memory:');s.put('campaign','c1',{id:'c1',offer_id:'awin-test'});s.put('offer','awin-test',{id:'awin-test',network:'awin',network_program_id:'42',apply_url:'https://example.com/product'});return s;}
test('重复导入不重复计佣；更新状态覆盖同一订单快照',()=>{
  const s=fixture();assert.equal(upsertOrders(s,[order]).added,1);assert.equal(upsertOrders(s,[order]).duplicates,1);
  assert.equal(upsertOrders(s,[{...order,status:'approved'}]).updated,1);assert.equal(s.orders().length,1);assert.equal(s.orders()[0].status,'approved');s.db.close();
});
test('冲突订单整批回滚，不能跨渠道改绑、跨币种改写',()=>{
  const s=fixture();upsertOrders(s,[order]);
  assert.throws(()=>upsertOrders(s,[{...order,order_id:'new'},{...order,currency:'CNY'}]));assert.equal(s.orders().length,1);
  s.put('campaign','c2',{id:'c2'});assert.throws(()=>upsertOrders(s,[{...order,campaign_id:'c2'}]));
  assert.throws(()=>upsertOrders(s,[{...order,occurred_at:'2020-01-01',status:'approved'}]));s.db.close();
});
test('Awin按官方endpoint发送Bearer和clickref，只接受真实返回URL',async()=>{
  const built=await awinLink(config,{network:'awin',network_program_id:'42',apply_url:'https://example.com/product'},'c1',async(url,args)=>{
    assert.equal(url,'https://api.awin.com/publishers/123/linkbuilder/generate');assert.equal(args.headers.Authorization,'Bearer '+config.token);
    const body=JSON.parse(args.body);assert.equal(body.advertiserId,42);assert.equal(body.parameters.clickref,'c1');return {status:200,text:'{"url":"https://www.awin1.com/track?clickref=c1"}'};
  });assert.equal(built.provider,'awin');
  await assert.rejects(awinLink(config,{network:'awin',network_program_id:'42'},null,async()=>({status:200,text:'{"description":"not available"}'})));
});
test('Awin消费者优惠码与推广归因分开，未获批商家不自动成为可推广',async()=>{
  const s=fixture();const result=await awinOffers(s,config,async(url,args)=>{
    assert.equal(url,'https://api.awin.com/publisher/123/promotions');assert.equal(JSON.parse(args.body).filters.membership,'all');assert(!JSON.parse(args.body).filters.regionCodes);
    return {status:200,text:JSON.stringify([{promotionId:10,advertiser:{id:42,name:'Example',joined:false},title:'Summer offer',url:'https://example.com/sale',voucher:{code:'SAVE',attributable:false}}])};
  });assert.equal(result.count,1);const o=s.get('offer','awin-10');assert.equal(o.network_joined,false);assert.equal(o.percent_min,null);assert.equal(o.verified_at,null);assert.equal(o.voucher.kind,'consumer_coupon');s.db.close();
});
test('Awin订单按clickref和广告主严格关联，不将approved当付款',async()=>{
  const s=fixture();const result=await awinTransactions(s,config,{startDate:'2026-10-01',endDate:'2026-10-20'},async(url,args)=>{
    assert(url.includes('dateType=amendment'));assert(!url.includes(config.token));return {status:200,text:JSON.stringify([
      {id:1,advertiserId:42,clickRefs:{clickRef:'c1'},commissionStatus:'approved',commissionAmount:{amount:3.2,currency:'USD'},transactionDate:'2026-10-19T00:00:00Z'},
      {id:2,advertiserId:42,clickRefs:{clickRef:'unknown'},commissionStatus:'approved',commissionAmount:{amount:50,currency:'USD'},transactionDate:'2026-10-19T00:00:00Z'}
    ])};
  });assert.equal(result.added,1);assert.equal(result.unmatched,1);assert.equal(s.orders()[0].status,'approved');s.db.close();
});
test('后续API查询不降级已有银行凭据；退款状态仍可剔除',()=>{
  const s=fixture();upsertOrders(s,[{...order,status:'bank_received',evidence:'local-receipt-001'}]);
  upsertOrders(s,[{...order,status:'approved'}],{origin:'awin'});assert.equal(s.orders()[0].status,'bank_received');
  upsertOrders(s,[{...order,status:'refunded'}],{origin:'awin'});assert.equal(s.orders()[0].status,'refunded');s.db.close();
});
