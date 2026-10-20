import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { offers,sources,profile } from '../seed/catalog.mjs';

export function openDb(path){
  if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});chmodSync(dirname(path),0o700);}
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS orders(network TEXT NOT NULL,order_id TEXT NOT NULL,campaign_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(network,order_id));
    CREATE TABLE IF NOT EXISTS clicks(id INTEGER PRIMARY KEY, campaign_id TEXT NOT NULL, occurred_at TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS clicks_campaign ON clicks(campaign_id);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL,value TEXT NOT NULL);`);
  const get=(kind,id)=>{const r=db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.value):null;};
  const put=(kind,id,value)=>db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,JSON.stringify(value));
  const all=(kind)=>db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.value));
  const audit=(kind,value)=>db.prepare('INSERT INTO audit(kind,created_at,value) VALUES(?,?,?)').run(kind,new Date().toISOString(),JSON.stringify(value));
  for(const s of sources)if(!get('source',s.id))put('source',s.id,s);
  for(const o of offers)if(!get('offer',o.id))put('offer',o.id,o);
  for(const oid of ['jd','taobao','meituan']){
    const o=get('offer',oid);if(o?.verified_at==='2026-10-20'&&!o.verification_origin)put('offer',oid,{...o,verified_at:null,verification_origin:'official_entry_only'});
  }
  if(!get('setting','profile'))put('setting','profile',profile);
  return {db,get,put,all,audit,orders:()=>db.prepare('SELECT value FROM orders').all().map(r=>JSON.parse(r.value)),clicks:()=>db.prepare('SELECT * FROM clicks').all()};
}
