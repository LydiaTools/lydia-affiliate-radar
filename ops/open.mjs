import { spawn } from 'node:child_process';
const url='http://127.0.0.1:'+(process.env.LYDIA_PORT||8876);
for(let n=0;n<35;n++){
  try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});const data=await response.json();if(data.app_id==='lydia-affiliate-radar'){spawn('open',[url],{stdio:'ignore',detached:true}).unref();process.exit(0);}}catch{}
  await new Promise(r=>setTimeout(r,250));
}
console.error('暂未启动成功，请查看当前终端提示。');
