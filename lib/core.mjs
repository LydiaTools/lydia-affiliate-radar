import { randomUUID } from 'node:crypto';

export const channels = {
  blog:{name:'网站 / SEO',format:'购买决策文章',reason:'承接有明确问题与购买意图的搜索'},
  youtube:{name:'YouTube',format:'实操演示视频',reason:'用可见的操作与结果建立理解'},
  bilibili:{name:'哔哩哔哩',format:'教程与比较视频',reason:'适合中文教程、工具比较与场景拆解'},
  wechat:{name:'公众号',format:'场景文章',reason:'适合把适用条件和选择依据讲完整'},
  xhs:{name:'小红书',format:'任务型笔记',reason:'用具体任务、选择清单和真实素材表达'},
  x:{name:'X',format:'英文帖串',reason:'用简洁的任务说明触达相关英文读者'},
  pinterest:{name:'Pinterest',format:'搜索型图文',reason:'适合旅行、商品与长期可检索的攻略'},
  email:{name:'邮件订阅',format:'已订阅读者通讯',reason:'只面向主动订阅且主题相关的读者'},
  community:{name:'社区',format:'问题解答',reason:'先回答具体问题，按社区规则决定链接'},
  paid:{name:'付费广告',format:'广告素材',reason:'仅在商家明确允许后考虑'}
};
export const now = () => new Date().toISOString();
export const id = (prefix='') => prefix + randomUUID().replaceAll('-','').slice(0,14);
export class InputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function assert(condition,message){if(!condition) throw new InputError(message);}
export function cleanText(v,max=500){return String(v??'').trim().slice(0,max);}
export function publicUrl(value,{httpsOnly=false}={}) {
  let u;try {u=new URL(value);}catch{throw new InputError('请输入完整的 http 或 https 链接');}
  assert((httpsOnly?['https:']:['https:','http:']).includes(u.protocol),'仅支持 HTTP(S) 链接');
  assert(!u.username&&!u.password,'链接不能含账号密码');
  const h=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  assert(h&&!['localhost','localhost.localdomain'].includes(h)&&!h.endsWith('.local')&&!h.endsWith('.internal')&&!h.endsWith('.localhost'),'不支持内网地址');
  assert(!/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(h),'不支持内网或保留地址');
  assert(!h.includes(':')||(/^2[0-9a-f]{3}:/i.test(h)),'不支持内网 IPv6 地址');
  assert(!u.port||['80','443'].includes(u.port),'只支持标准 HTTP(S) 端口');
  return u;
}
export function identifyLink(text){
  const urls=String(text).match(/https?:\/\/[^\s<>"“”]+/g)||[];
  let url;for(const u of urls){try{publicUrl(u);url=u;break;}catch{}}
  const codes=[];
  if(url){
    const u=new URL(url);const pairs=[...u.searchParams.entries()];
    if(u.hash.includes('?'))pairs.push(...new URLSearchParams(u.hash.split('?')[1]).entries());
    for(const [key,value]of pairs){if(/^(ref|referral|referral_code|invite|invitecode|invite_code|aff|affiliate|affiliate_id|aff_id|fpr|via|sa|tag|pid|unionid|union_id|publisherid|pubid|p_id|utm_source|clickref|subid[123]?|sharedid|irclickid|irgwc|campid|mkcid|mkrid|aid)$/i.test(key))codes.push({key,value,kind:/utm_|clickref|subid|sharedid|irclickid/i.test(key)?'tracking':'candidate'});}
  }
  for(const match of String(text).matchAll(/(?:邀请码|推广码|推荐码|invite\s*code|referral\s*code)\s*[:：=]?\s*([A-Za-z0-9_-]{3,100})/gi))codes.push({key:'邀请码',value:match[1],kind:'candidate'});
  return {url:url||'',codes,note:codes.length?'识别的是参数候选，不证明链接归属或佣金资格':'未识别到公开邀请码参数；短链和加密路径可能在平台内归因'};
}
export function rankOffer(offer,profile,account={},sourceStates=[]){
  const reward=offer.fixed_min!=null?Math.min(100,Math.round(Math.log10(1+offer.fixed_min)*38)):offer.percent_min!=null?Math.min(100,Math.round(offer.percent_min*1.5)):0;
  const entry={automatic:85,registration:65,manual:35,unknown:0}[offer.application_mode]??0;
  let payout=0;
  if(offer.payout_min!=null)payout+=offer.payout_min===0?50:offer.payout_min<=30?35:offer.payout_min<=100?20:10;
  if(offer.payout_methods?.length)payout+=20;
  if(offer.hold_days!=null)payout+=offer.hold_days<=30?15:5;
  payout-=Math.min(30,(offer.min_referrals||0)*8);
  payout=Math.max(0,payout);
  const age=(Date.now()-Date.parse(offer.verified_at))/86400000;
  const evidence=Number.isFinite(age)&&age<=14?90:Number.isFinite(age)&&age<=30?50:0;
  const dimensions={reward,entry,payout,evidence};
  const weights=profile.weights;const total=Object.values(weights).reduce((a,b)=>a+b,0)||100;
  let score=Math.round(Object.entries(dimensions).reduce((n,[k,v])=>n+v*(weights[k]||0),0)/total);
  const gaps=[];
  if((account.eligibility_cn||offer.eligibility_cn)!=='yes')gaps.push('大陆个人资格待核实');
  if((account.individual||offer.individual)!=='yes')gaps.push('个人主体资格待核实');
  if(!account.payout_confirmed)gaps.push('本人收款方式待核对');
  if(account.application_status!=='approved')gaps.push('本人尚未记录获批');
  if(offer.payout_min==null)gaps.push('最低提现门槛未知');
  if(age>14||!Number.isFinite(age))gaps.push('条款需复核更新');
  if(sourceStates.some(s=>s.pending_review))gaps.push('来源网页变化待复核');
  if(offer.ends_at&&Date.parse(offer.ends_at)<Date.now())gaps.push('活动已到期');
  if(offer.cash_type!=='cash')gaps.push('奖励不是可提现现金');
  const excluded=(account.eligibility_cn||offer.eligibility_cn)==='no'||(account.individual||offer.individual)==='no'||['rejected','paused'].includes(account.application_status);
  if(excluded)score=0;
  return {score,dimensions,gaps,excluded,ready:!excluded&&!gaps.length,scope:'研究优先级，不是收益预测或审核概率'};
}
function taskBrief(offer){
  const cat=offer.category||'';
  if(/旅行/.test(cat))return {task:'把旅行体验选得更适合这次行程',en:'Choose a travel experience that fits your itinerary.',steps:['先固定出行日期、人数与预算，避免只按热门程度选体验','逐项对照集合地点、交通时间、年龄限制和包含项目','核对退改与天气处理规则，再决定是否预订'],alternatives:'自行安排行程、当地直接预订与其他预订平台',channels:['blog','youtube','xhs','pinterest','wechat']};
  if(/商品|零售/.test(cat))return {task:'把一次商品购买决定做清楚',en:'Compare a product against your actual buying requirements.',steps:['先写下必须的规格、尺寸和使用场景，把可选功能分开','核对商品详情、到手总成本、配送地区及售后范围','比较同规格的替代商品，确认退换条件后再下单'],alternatives:'同规格替代商品、品牌官方渠道与其他商家',channels:['xhs','blog','bilibili','pinterest','youtube']};
  if(/本地生活/.test(cat))return {task:'买到这次真正用得上的本地服务',en:'Check local availability and redemption terms before buying.',steps:['先确认所在城市、可用门店和预计到店时间','核对预约、可用时段、人数限制和额外费用','把核销与退改规则看完整，再判断是否购买'],alternatives:'直接向商家预订、其他服务套餐与不使用优惠券',channels:['xhs','wechat','bilibili','blog']};
  if(/教育/.test(cat))return {task:'为一个明确的学习目标选课程',en:'Choose a course around one specific learning goal.',steps:['先写下要学会的技能和现有基础，再读课程大纲','检查先修要求、语言、作业形式和完成时间','区分课程内容、证书和订阅权益，核对取消与退款条件'],alternatives:'免费公开课程、教材、自主练习与其他课程平台',channels:['bilibili','xhs','blog','youtube','wechat']};
  if(/云服务|建站/.test(cat))return {task:'为网站或工具选合适的运行环境',en:'Match a hosting plan to one real deployment task.',steps:['列出访问地区、运行方式、资源需求和维护能力','比较首期费用、续费、带宽、备份和迁移条件','先用小规模真实任务核对延迟和部署，再决定长期方案'],alternatives:'现有主机、静态托管、其他云服务与自行维护',channels:['blog','youtube','bilibili','wechat','x']};
  if(/创作者/.test(cat))return {task:'判断一项内容合作任务值不值得接',en:'Check the deliverables and payment terms of a creator campaign.',steps:['先确认本期名额、截止日期、地区与本人资格','把内容数量、验收要求、使用授权和修改次数写清楚','核对奖励档位、付款条件与税费，再决定是否申请'],alternatives:'普通联盟推广、其他品牌合作与自有产品内容',channels:['blog','youtube','wechat','x','bilibili']};
  if(/营销/.test(cat))return {task:'把一次读者访问接成可核对的业务行动',en:'Connect a reader visit to one measurable business action.',steps:['先定义一个目标行动，例如提交表单、订阅或购买','对照需要的页面、邮件与统计能力，检查数据能否导出','用一次完整任务核对从访问到行动的记录，再决定是否付费'],alternatives:'现有网站工具、独立表单与邮件工具、其他营销平台',channels:['blog','youtube','wechat','x','bilibili']};
  return {task:'把一项重复工作整理成可以检查的流程',en:'Turn one repetitive task into a workflow you can verify.',steps:['写清输入来自哪里、需要怎样处理、结果保存到哪里','选一小份真实材料，检查字段、权限、失败处理和输出','核对费用、数据使用范围与替代方案，再决定是否扩大使用'],alternatives:'现有工具、手动流程、开源方案与其他服务',channels:['blog','youtube','bilibili','wechat','x']};
}
export function recommendChannels(offer,profile){
  const proposed=[...taskBrief(offer).channels,...(offer.allowed_channels||[]),'blog','youtube'];
  return [...new Set(proposed)].filter(k=>channels[k]&&profile.channels.includes(k)&&!offer.blocked_channels.includes(k)&&k!=='paid').slice(0,5).map((key,index)=>({key,...channels[key],priority:index+1,terms_review_needed:true,basis:'依据商品任务与内容形态的规则建议，尚无本账户转化证明',caution:key==='xhs'?'使用平台允许的商品或合作入口；不自动插入站外导流链接':key==='community'?'遵守版规；未确认允许前不放联盟链接':'发布前核对商家合同与平台渠道规则'}));
}
export function generateDrafts(offer,profile,link,selected){
  const recs=recommendChannels(offer,profile).filter(c=>!selected?.length||selected.includes(c.key));
  const dest=link?.url||'';
  const disclosure='含推广合作链接；通过符合条件的链接购买，我可能获得佣金。';
  const brief=taskBrief(offer);
  return recs.map(c=>{
    const problem=brief.task;
    const title=c.key==='x'?`${offer.name}: a task-first checklist`:`${problem}：${offer.name}选择清单`;
    let body;
    if(c.key==='x')body=`1/3 ${brief.en} ${offer.name} is one option to investigate. Start with the outcome you need, then compare the conditions.\n\n2/3 Check availability, current pricing, cancellation terms and an alternative. This checklist is based on public information; add your own test results before making performance claims.\n\n3/3 ${dest?`Affiliate link: ${dest}\nI may earn a commission from qualifying purchases.`:'The personal affiliate link is not connected yet. Confirm eligibility and payment details before publishing a recommendation.'}`;
    else if(['youtube','bilibili'].includes(c.key))body=`开场：${problem}，先别急着选工具。把任务和限制写清楚，再看${offer.name}是不是合适的选项。\n\n第一步：${brief.steps[0]}。\n\n第二步：${brief.steps[1]}。画面可以展示官方当前说明，并标出和你的任务直接相关的条件。\n\n第三步：${brief.steps[2]}。如果要演示效果，就录下你有权限进行的一次真实操作，把输入、操作和输出放在同一段里。\n\n也可以比较：${brief.alternatives}。比较时用同一个任务和同一组条件，结果才有参考价值。\n\n结尾：选择的依据是你要完成的任务。这份清单供你检查适用条件；具体效果需要实际验证。\n\n简介：${dest?dest:'待导入本人推广链接'}\n${disclosure}`;
    else if(c.key==='xhs')body=`${problem}，先留好这3项检查\n\n${offer.name}是可进一步了解的选项。先按你这次的任务核对：\n\n${brief.steps.map((s,i)=>['①','②','③'][i]+' '+s+'。').join('\n\n')}\n\n比较对象：${brief.alternatives}。用同一组条件对照，才知道差别在哪里。\n\n以上为选择清单；实际体验请用真实材料记录。合作内容按平台要求标记，购买时使用平台允许的商品或合作入口。\n\n配图建议：任务条件、官方说明重点、真实操作或消费素材。`;
    else body=`${problem}，最容易遗漏的往往是使用条件。${offer.name}是可以进一步了解的一个选项，选择前先把下面三步走完。\n\n${brief.steps.map((s,i)=>`${i+1}. ${s}。`).join('\n\n')}\n\n还可以比较：${brief.alternatives}。不要只比一个宣传数字，把任务、限制和总成本放在一起看。\n\n如果你还不能确认它适合当前任务，先完成一次有权限的小规模验证。本文是一份选择清单，实际结果以你的任务为依据。\n\n${dest?`了解${offer.name}：${dest}`:'尚未导入本人推广链接，补齐后再发布。'}\n${disclosure}`;
    return {channel:c.key,channel_name:c.name,title,body,format:c.format,generator:'rule',status:dest?'needs_review':'link_missing',review_items:['核对本次活动与渠道条款','补充真实场景和实测素材','核对产品地区、价格与取消条件','保留合作披露'],caution:c.caution};
  });
}
export function parseCsv(input){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}
    else field+=c;
  }
  assert(!quoted,'CSV 引号未闭合');row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  if(!rows.length)return[];
  const header=rows.shift().map(v=>v.replace(/^\uFEFF/,'').trim());assert(new Set(header).size===header.length,'CSV 列名重复');
  return rows.map((r,i)=>{assert(r.length===header.length,`CSV 第${i+2}行列数不符`);return Object.fromEntries(header.map((h,n)=>[h,r[n].trim()]));});
}
export const orderStatuses=['pending','approved','paid','bank_received','rejected','refunded'];
export function validateOrder(row){
  assert(row.network&&row.order_id&&row.campaign_id&&row.occurred_at,'订单需 network、order_id、campaign_id、occurred_at');
  assert(orderStatuses.includes(row.status),'订单状态须为 pending / approved / paid / bank_received / rejected / refunded');
  assert(/^[A-Z]{3}$/.test(row.currency||''),'币种必须是三位大写代码');
  assert(/^\d{1,10}(\.\d{1,2})?$/.test(String(row.amount)),'金额须为非负数字，最多2位小数');
  assert(Number.isFinite(Date.parse(row.occurred_at)),'订单时间格式无效');
  if(row.status==='bank_received')assert(cleanText(row.evidence,500),'银行到账必须填写 evidence 凭证编号或本地记录位置');
  const parts=String(row.amount).split('.');return {...row,amount_minor:Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0')),network:cleanText(row.network,100),order_id:cleanText(row.order_id,160),campaign_id:cleanText(row.campaign_id,80),evidence:cleanText(row.evidence,500)};
}
export function strategy(campaigns,orders,clicks){
  return campaigns.map(c=>{
    const cs=clicks.filter(x=>x.campaign_id===c.id&&!x.excluded);const os=orders.filter(x=>x.campaign_id===c.id);
    const money={};for(const o of os){money[o.currency]??={pending:0,approved:0,paid:0,bank_received:0,rejected:0,refunded:0};money[o.currency][o.status]+=o.amount_minor;}
    const confirmed=os.filter(o=>['approved','paid','bank_received'].includes(o.status)).length;
    const hasReceipt=Object.values(money).some(m=>m.bank_received>0);
    const bad=os.filter(o=>['rejected','refunded'].includes(o.status)).length;
    const label=cs.length<30||confirmed<5?'样本不足，先补齐同一窗口的联盟订单':bad>=3&&bad/os.length>=0.3?'退款或拒付较多，先核对受众与合格订单条件':!hasReceipt?'先验证首笔提现，到账前谨慎增加投入':'有有效到账证据，下一轮做同活动、同窗口的内容对照';
    return {...c,clicks:cs.length,excluded_clicks:clicks.filter(x=>x.campaign_id===c.id&&x.excluded).length,orders:os.length,confirmed,money,recommendation:label,confidence:'观察数据，不能证明渠道造成收益变化',epc:Object.entries(money).map(([currency,m])=>({currency,value:cs.length?m.bank_received/100/cs.length:null,basis:'当前累计银行到账 / 当前累计有效点击请求；可能存在结算滞后'}))};
  });
}
