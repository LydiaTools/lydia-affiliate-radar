import { openDb } from './lib/db.mjs';
import { runCollection } from './lib/network.mjs';
import { fileURLToPath } from 'node:url';
const store=openDb(process.env.LYDIA_DB||fileURLToPath(new URL('./data/radar.sqlite',import.meta.url)));
if(process.argv[2]!=='collect'){console.error('用法: npm run collect -- [source-id ...]');process.exitCode=1;}
else {const run=await runCollection(store,process.argv.slice(3));console.log(JSON.stringify({run_id:run.id,ok:run.ok,errors:run.errors,results:run.results},null,2));}
