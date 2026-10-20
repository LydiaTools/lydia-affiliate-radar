import { requestPublic } from './network.mjs';
import { assert,InputError,publicUrl,now,id,validateOrder,cleanText } from './core.mjs';

async function awinRequest(config,path,{method='GET',body}={},request=requestPublic){
  assert(config?.token&&/^\d+$/.test(config.publisher_id||''),'先在设置接入本人 Awin Publisher ID 与 API Token');
  const r=await request('https://api.awin.com'+path,{method,headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined,maxBytes:5_000_000,timeout:20000,redirects:0});
  if(r.status!==200)throw new InputError(`Awin 返回 HTTP ${r.status}；核对 Token、账户和接口权限`,502);
  try{return JSON.parse(r.text);}catch{throw new InputError('Awin 未返回有效 JSON',502);}
}
export async function awinLink(config,offer,campaignId,request){
  assert(offer.network==='awin'&&/^\d+$/.test(String(offer.network_program_id||'')),'此活动未绑定已核对的 Awin 广告主 ID');
  const data=await awinRequest(config,`/publishers/${config.publisher_id}/linkbuilder/generate`,{method:'POST',body:{advertiserId:Number(offer.network_program_id),destinationUrl:offer.apply_url,parameters:campaignId?{clickref:campaignId}:{},shorten:false}},request);
  assert(typeof data.url==='string','Awin 未返回推广链接，该商家可能未授权深链');publicUrl(data.url);
  return {url:data.url,provider:'awin',fetched_at:now()};
}
export async function awinOffers(store,config,request){
  let count=0,page=1,truncated=false;
  for(;page<=20;page++){
    const data=await awinRequest(config,`/publisher/${config.publisher_id}/promotions`,{method:'POST',body:{filters:{membership:'all',status:'active',type:'all'},pagination:{page,pageSize:200}}},request);
    const list=Array.isArray(data)?data:data.promotions||data.data||data.content||data.offers;
    assert(Array.isArray(list),'Awin 活动响应结构与已知格式不符，已停止；未导入猜测数据');
    for(const p of list){
      if(!/^\d+$/.test(String(p.promotionId||''))||!/^\d+$/.test(String(p.advertiser?.id||''))||!p.url)continue;
      try{publicUrl(p.url);}catch{continue;}
      const oid='awin-'+p.promotionId;
      const previous=store.get('offer',oid);
      const candidate={id:oid,name:cleanText(p.title,150),merchant:cleanText(p.advertiser.name,100),category:previous?.category||'商家活动',network:'awin',network_program_id:String(p.advertiser.id),model:'CPS',cash_type:'cash',currency:'USD',commission_text:'商家促销活动，推广佣金需核对合作合同',fixed_min:null,fixed_max:null,percent_min:null,percent_max:null,payout_min:null,payout_currency:'USD',payout_methods:[],hold_days:null,min_referrals:0,eligibility_cn:'unknown',individual:'unknown',application_mode:'manual',application_note:p.advertiser.joined?'Awin API 返回已加入此广告主；地区与本人收款仍需核对':'Awin API 返回尚未加入此广告主',payout_note:'促销优惠不等于推广佣金，佣金与提现按本人合同核验。',conditions:[],allowed_channels:[],blocked_channels:[],verified_at:null,source_ids:['awin-api'],facts:[],apply_url:p.url,description:cleanText(p.description,1000),network_terms:cleanText(p.terms,5000),starts_at:p.startDate||null,ends_at:p.endDate||null,voucher:p.voucher?{code:p.voucher.code||'',attributable:p.voucher.attributable===true,kind:'consumer_coupon'}:null,network_joined:p.advertiser.joined===true,last_network_sync:now()};
      store.put('offer',oid,previous?{...previous,last_network_sync:now(),network_terms:candidate.network_terms,ends_at:candidate.ends_at,network_joined:candidate.network_joined,voucher:candidate.voucher}:candidate);count++;
    }
    if(list.length<200)break;if(page===20)truncated=true;
  }
  return {count,pages:page,truncated,note:truncated?'本次达到20页资源上限，需要按更新时间继续同步':'已读取本次API返回的活动；未把促销折扣视为佣金'};
}
export function upsertOrders(store,rows,{origin='csv'}={}){
  const validated=rows.map(validateOrder);
  for(const row of validated){assert(store.get('campaign',row.campaign_id),`未找到推广计划 ${row.campaign_id}，本批次未写入`);}
  let added=0,updated=0,duplicates=0;
  store.db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of validated){
      const existing=store.db.prepare('SELECT value FROM orders WHERE network=? AND order_id=?').get(row.network,row.order_id);
      const old=existing?JSON.parse(existing.value):null;
      if(old){assert(old.campaign_id===row.campaign_id,'同一网络订单不能改绑渠道计划');assert(old.currency===row.currency,'同一网络订单币种变化，需人工核对');}
      let value={...row,origin,updated_at:now()};
      if(origin==='awin'&&old&&['paid','bank_received'].includes(old.status)&&['pending','approved'].includes(row.status))value={...value,status:old.status,evidence:old.evidence,network_status:row.status};
      if(old&&old.status===value.status&&old.amount_minor===value.amount_minor&&old.evidence===value.evidence){duplicates++;continue;}
      if(old&&Date.parse(row.occurred_at)<Date.parse(old.occurred_at))throw new InputError('订单更新早于已有记录，需先核对时间');
      if(old)updated++;else added++;
      store.db.prepare('INSERT INTO orders(network,order_id,campaign_id,value) VALUES(?,?,?,?) ON CONFLICT(network,order_id) DO UPDATE SET value=excluded.value').run(row.network,row.order_id,row.campaign_id,JSON.stringify(value));
      store.audit('order_update',{before:old,after:value});
    }
    store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  return {added,updated,duplicates};
}
export async function awinTransactions(store,config,{startDate,endDate,dateType='amendment'},request){
  assert(['transaction','validation','amendment'].includes(dateType),'日期类型无效');
  assert(Number.isFinite(Date.parse(startDate))&&Number.isFinite(Date.parse(endDate)),'填写有效同步起止日期');
  const span=Date.parse(endDate)-Date.parse(startDate);assert(span>=0&&span<=31*86400000,'单次同步窗口最多31天');
  const q=new URLSearchParams({startDate:new Date(startDate).toISOString(),endDate:new Date(endDate).toISOString(),timezone:'UTC',dateType});
  const data=await awinRequest(config,`/publishers/${config.publisher_id}/transactions/?${q}`,{},request);
  assert(Array.isArray(data),'Awin 订单响应不是已知数组结构，未导入');
  const matched=[],unmatched=[];
  for(const t of data){
    const campaignId=String(t.clickRefs?.clickRef||t.clickRef||'');const campaign=store.get('campaign',campaignId);
    const offer=campaign&&store.get('offer',campaign.offer_id);
    if(!campaign||offer?.network!=='awin'||String(offer.network_program_id)!==String(t.advertiserId)){
      unmatched.push({id:String(t.id||''),reason:'clickRef不能唯一匹配本工具计划与广告主'});continue;
    }
    const status={pending:'pending',approved:'approved',declined:'rejected',deleted:'refunded'}[t.commissionStatus];
    if(!status||!t.commissionAmount?.currency||t.commissionAmount.amount==null){unmatched.push({id:String(t.id),reason:'未知佣金状态或金额结构'});continue;}
    matched.push({network:'awin',order_id:String(t.id),campaign_id:campaignId,amount:String(t.commissionAmount.amount),currency:t.commissionAmount.currency,status,occurred_at:t.amendmentDate||t.validationDate||t.transactionDate,evidence:'Awin API transaction '+t.id});
  }
  const result=upsertOrders(store,matched,{origin:'awin'});
  if(unmatched.length)store.put('unmatched_sync',id('sync-'),{at:now(),items:unmatched});
  return {...result,unmatched:unmatched.length,dateType,note:'Awin批准佣金不等于平台付款或银行到账；未匹配订单不猜测归因'};
}
