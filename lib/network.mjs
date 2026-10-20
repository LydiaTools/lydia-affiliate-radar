import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { gunzipSync,inflateSync,brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { publicUrl,InputError,now,id } from './core.mjs';

export function isPublicIp(ip){
  if(isIP(ip)===4){const a=ip.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&(a[1]===168||a[1]===0||a[1]===2)||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&[18,19,51].includes(a[1])||a[0]===203&&a[1]===0&&a[2]===113);}
  return isIP(ip)===6&&/^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0|10|20):/i.test(ip);
}
export async function requestPublic(value,{method='GET',headers={},body=null,maxBytes=2_000_000,timeout=14000,redirects=3}={}){
  const u=publicUrl(value);const hostname=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=await dns.lookup(hostname,{all:true});
  if(!addresses.length||addresses.some(a=>!isPublicIp(a.address)))throw new InputError('来源解析到非公网地址，已停止请求');
  const chosen=addresses.find(a=>a.family===4)||addresses[0];
  const response=await new Promise((resolve,reject)=>{
    const req=(u.protocol==='https:'?https:http).request(u,{
      method,headers:{'User-Agent':'LydiaAffiliateRadar/0.1 (public research; on-demand)','Accept-Encoding':'identity',...headers},
      lookup:(_h,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)
    },res=>{
      let length=0;const chunks=[];
      res.on('data',chunk=>{length+=chunk.length;if(length>maxBytes){req.destroy(new InputError('来源正文过大，已停止'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{
        try{let b=Buffer.concat(chunks);const enc=res.headers['content-encoding'];const options={maxOutputLength:maxBytes};
          if(enc==='gzip')b=gunzipSync(b,options);else if(enc==='deflate')b=inflateSync(b,options);else if(enc==='br')b=brotliDecompressSync(b,options);
          resolve({status:res.statusCode,headers:res.headers,text:b.toString('utf8'),url:u.href});
        }catch{reject(new InputError('来源正文无法安全解压'));}
      });
    });
    const deadline=setTimeout(()=>req.destroy(new Error('来源请求超时')),timeout);
    req.on('close',()=>clearTimeout(deadline));req.setTimeout(timeout,()=>req.destroy(new Error('来源请求超时')));req.on('error',reject);if(body)req.write(body);req.end();
  });
  if(response.status>=300&&response.status<400&&response.headers.location){
    if(redirects<=0)throw new Error('来源重定向过多');
    const next=new URL(response.headers.location,u);const nextHeaders={...headers};
    if(next.origin!==u.origin){delete nextHeaders.Authorization;delete nextHeaders.authorization;}
    return requestPublic(next.href,{method,headers:nextHeaders,body,maxBytes,timeout,redirects:redirects-1});
  }
  return response;
}
export function textFromHtml(html){
  return html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
}
const termsDigest=(text)=>{
  const parts=text.split(/(?<=[.!?。；;])\s*|\n+/).filter(s=>/(commission|payout|payment|affiliate|minimum|threshold|referr|佣金|提现|返佣|结算|云气值|推广奖励)/i.test(s));
  return [...new Set(parts.map(s=>s.replace(/\s+/g,' ').trim()))].sort().join('\n').slice(0,160000);
};
const digest=t=>createHash('sha256').update(t).digest('hex');
const categoryNames={'ai-tools':'AI与自动化',saas:'软件与订阅',hosting:'建站与云服务',vpn:'网络与隐私',seo:'营销与电商工具',finance:'金融服务','email-marketing':'营销与电商工具',ecommerce:'商品与零售',travel:'旅行与体验',education:'教育与职业',design:'设计与创作',productivity:'效率工具',security:'安全工具','creator-economy':'创作者经济',other:'其他活动'};
function classifyTitle(name){
  for(const [pattern,category] of [[/casino|slots|betting|poker/i,'游戏与娱乐'],[/health|nutra|adenofrin|medical|beauty/i,'健康与个人护理'],[/crypto|coin|loan|bank|insurance|finance/i,'金融服务'],[/survey|reward|incent/i,'调研与用户任务'],[/dating|adult/i,'成人与交友'],[/android|ios|cpi|mobile/i,'应用推广'],[/shop|store|retail|coupon/i,'商品与零售']])if(pattern.test(name))return category;
  return '未分类';
}
export function directoryItems(body,source){
  if(source.url.endsWith('.json')){
    const data=JSON.parse(body);const rows=Array.isArray(data)?data:data.programs||data.offers;
    if(!Array.isArray(rows))throw new InputError('数据源格式不符合已支持的公开活动列表');
    return rows.slice(0,2000).map(r=>{
      const url=r.url||(r.slug&&new URL('/programs/'+encodeURIComponent(r.slug),source.url).href);
      if(!url||!r.name)return null;try{publicUrl(url);}catch{return null;}
      let merchantUrl='';try{if(r.domain)merchantUrl=publicUrl('https://'+r.domain).href;}catch{}
      return {url,name:String(r.name).slice(0,120),category:categoryNames[r.cat]||r.cat_display||r.category||'未分类',reported_commission:String(r.commission||'').slice(0,300),reported_network:String(r.network||'').slice(0,100),reported_geo:String(r.geo||'').slice(0,100),directory_updated:data.updated||null,reported_checked_at:r.verified||null,merchant_url:merchantUrl,status:/no public program|closed|discontinued/i.test(r.commission||'')?'no_public_program':'unverified',note:'第三方目录报告；佣金、地区和提现条件需回查官方，Global不证明大陆个人可参加'};
    }).filter(Boolean);
  }
  const links=[];
  for(const m of body.matchAll(/\[([^\]\n]{3,100})\]\((https?:\/\/[^)\s]+)\)|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const url=new URL(m[2]||m[3],source.url);const name=textFromHtml(m[1]||m[4]).slice(0,120);
      const activityPath=/\/(offer|offers|program|programs|affiliate-program|affiliate-programs)\/[a-z0-9]/i.test(url.pathname)||(source.id==='affplus'&&/^\/o\/[a-z0-9]/i.test(url.pathname));
      if(!activityPath||!name||/^(learn more|view|read more|details|next)$/i.test(name))continue;
      publicUrl(url.href);links.push({url:url.href,name,category:classifyTitle(name),classification_origin:'title_heuristic',status:'unverified',note:'目录发现的候选；类目按标题初分，佣金、资格和收款尚未官方核实'});
    }catch{}
  }
  return [...new Map(links.map(l=>[l.url,l])).values()].slice(0,200);
}
export async function collectSource(store,source,request=requestPublic){
  const start=Date.now();let via='direct';
  try{
    const publicSource=publicUrl(source.url);
    if([...publicSource.searchParams.keys()].some(k=>/token|secret|password|api.?key|authorization/i.test(k)))throw new InputError('公开来源不能包含密钥或登录凭证；请使用专用连接设置');
    let r=await request(source.url);let body=r.text;let text=textFromHtml(body);
    if(r.status!==200||text.length<350||/(verify you are human|just a moment|captcha|access denied|启用javascript)/i.test(text.slice(0,800))){
      via='jina';r=await request('https://r.jina.ai/'+source.url,{timeout:18000});body=r.text;text=body.trim();
    }
    if(r.status!==200)throw new Error(`来源返回 HTTP ${r.status}`);
    if(text.length<200||/^(Error|Access denied|Forbidden)|^Title: Just a moment/i.test(text))throw new Error('来源需登录、动态渲染或专用接口');
    const terms=termsDigest(text);const previous=store.get('snapshot',source.id);
    const hash=digest(terms||text);
    const changed=!!previous&&previous.hash!==hash;
    const snapshot={id:source.id,hash,body_hash:digest(text),text:text.slice(0,180000),terms:terms.slice(0,100000),fetched_at:now(),via};
    if(previous&&changed)store.put('previous_snapshot',source.id,previous);
    store.put('snapshot',source.id,snapshot);
    const state={...source,last_fetch_at:now(),last_status:'ok',last_error:'',duration_ms:Date.now()-start,via,pending_review:!!source.pending_review||changed,change_note:changed?'页面条款文本变化；需要核对活动字段后再用于执行':'',hash};
    let discovered=0;
    if(source.kind==='directory'){
      const links=directoryItems(body,source);
      for(const l of links){
        const cid='discovery-'+digest(l.url).slice(0,14);const previousCandidate=store.get('candidate',cid);
        store.put('candidate',cid,{...previousCandidate,id:cid,...l,source_id:source.id,discovered_at:previousCandidate?.discovered_at||now(),last_seen_at:now()});if(!previousCandidate)discovered++;
      }
      state.total_candidates_seen=links.length;
    }
    state.last_discovered=discovered;state.discovery_status=source.kind==='directory'?(discovered?'found':'no_new_items'):'not_directory';
    store.put('source',source.id,state);
    return {source_id:source.id,status:'ok',via,changed,discovered,duration_ms:Date.now()-start};
  }catch(error){
    const message=error instanceof InputError?error.message:/timeout|timed out/i.test(error.message)?'请求超时':'来源暂不可读取，需要登录、专用接口或稍后重试';
    store.put('source',source.id,{...source,last_fetch_at:now(),last_status:'error',last_error:message,duration_ms:Date.now()-start});
    return {source_id:source.id,status:'error',error:message,duration_ms:Date.now()-start};
  }
}
export async function runCollection(store,sourceIds){
  const sources=store.all('source').filter(s=>s.enabled&&(!sourceIds?.length||sourceIds.includes(s.id)));
  const run={id:id('run-'),pid:process.pid,started_at:now(),status:'running',total:sources.length,results:[]};store.put('run',run.id,run);
  const queue=[...sources];
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
    while(queue.length){const s=queue.shift();run.results.push(await collectSource(store,s));store.put('run',run.id,run);}
  }));
  run.status='completed';run.finished_at=now();run.ok=run.results.filter(r=>r.status==='ok').length;run.errors=run.results.filter(r=>r.status==='error').length;store.put('run',run.id,run);return run;
}
