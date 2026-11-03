#!/usr/bin/env node
/**
 * Rebuild or validate the SOURCE-ONLY canonical tables and separately
 * requested hypothetical pre-1997 draws. No numerical statistics or other
 * derived columns are added to the historical factual datasets.
 *
 * node build_archive.js --check
 * node build_archive.js --rebuild
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root=__dirname;
const source=path.join(root,'source','la-scimmia-vince');
const ranges=['1939_1948','1949_1958','1959_1968','1969_1978','1979_1988','1989_1997'];
const mode=process.argv[2]||'--check';
assert(['--check','--rebuild'].includes(mode),'Usage: node build_archive.js --check|--rebuild');
function readFile(p){return fs.readFileSync(p,'utf8');}
function parse(csv,sep){
 const lines=csv.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/),header=lines.shift().split(sep);
 return lines.filter(x=>x).map(line=>{
  const columns=line.split(sep);
  assert.equal(columns.length,header.length,'Unexpected CSV column count');
  return Object.fromEntries(header.map((x,i)=>[x,columns[i]]));
 });
}
function format(rows){return rows.map(r=>r.join(';')).join('\n')+'\n';}
function writeOrCheck(name,content){
 const full=path.join(root,name);
 if(mode==='--check')assert.equal(readFile(full),content,'Mismatch '+name);
 else fs.writeFileSync(full,content,'utf8');
}
const original=parse(readFile(path.join(root,'..','estrazioni_con_ritardi.csv')),';');
const draws=parse(readFile(path.join(source,'draws.csv')),',');
const pools=parse(readFile(path.join(source,'pools.csv')),',');
const prizes=parse(readFile(path.join(source,'prizes.csv')),',');
assert.equal(original.length,4294);assert.equal(draws.length,4294);assert.equal(pools.length,2947);assert.equal(prizes.length,38029);
const srcByDate=new Map(draws.map(d=>[d.date,d]));
const canonId=new Map();
assert.equal(srcByDate.size,draws.length);
const rr=[['codice','data','concorso','n1','n2','n3','n4','n5','n6','jolly','superstar','fonte_numeri','id_fonte']];
const cross=[['data','codice','id_fonte','concorso_fonte','concorso_originale']];
const bad=[['data','codice','campo','valore_archivio_originario','valore_altra_fonte','risoluzione','fonte_risoluzione']];
const nMismatches=[];
for(const o of original){
 const d=srcByDate.get(o.data);assert(d,'Missing source date '+o.data);
 const code=o.data.slice(0,4)+'-'+o.concorso.padStart(3,'0');
 assert(!canonId.has(d.id),'Duplicate source ID '+d.id);
 canonId.set(d.id,{code,date:o.data});
 const a=Array.from({length:6},(_,i)=>o['n'+(i+1)]);
 const b=Array.from({length:6},(_,i)=>d['n'+(i+1)]);
 if(a.join(',')!==b.join(',')){
  nMismatches.push(o.data);
  assert.equal(o.data,'2004-12-27','Unexpected numeric mismatch requires manual reconciliation');
  bad.push([o.data,code,'n1',a[0],b[0],'preferito archivio originario e derivazione Lotto',
   'https://github.com/pandvan/lotto-archive/blob/main/data/lotto/2004.json']);
 }
 assert.equal(o.jolly,d.jolly,'Jolly differs '+o.data);
 assert.equal(o.superstar,d.superstar,'SuperStar differs '+o.data);
 if(o.concorso!==d.contest)cross.push([o.data,code,d.id,d.contest,o.concorso]);
 rr.push([code,o.data,o.concorso,...a,o.jolly,o.superstar,d.source,d.id]);
}
assert.deepEqual(nMismatches,['2004-12-27']);
assert.equal(cross.length,10,'Unexpected contest numbering changes');
const pp=[['codice','data','montepremi_concorso_eur','riporto_jackpot_eur','montepremi_totale_pubblicato_eur','id_fonte']];
for(const r of pools){const k=canonId.get(r.draw_id);assert(k,'Pool orphan '+r.draw_id);pp.push([k.code,k.date,r.pool_contest_eur,r.jackpot_carryover_eur,r.pool_total_eur,r.draw_id])}
const pr=[['codice','data','gioco','categoria','numero_vincite','importo_pubblicato_eur','natura_importo','id_fonte']];
for(const r of prizes){const k=canonId.get(r.draw_id);assert(k,'Prize orphan '+r.draw_id);
 pr.push([k.code,k.date,r.game,r.category,r.winners,r.amount_eur,r.game==='immediate'?'totale_categoria':'quota_unitaria',r.draw_id]);
}
writeOrCheck('estrazioni.csv',format(rr));
writeOrCheck('montepremi.csv',format(pp));
writeOrCheck('premi.csv',format(pr));
writeOrCheck('crosswalk_concorsi_difformi.csv',format(cross));
writeOrCheck('discrepanze_numeri.csv',format(bad));
const wheels=['bari','firenze','milano','napoli','palermo','roma'];
let simTotal=0,failed=0,lottoDates=0;
for(const range of ranges){
 const rows=parse(readFile(path.join(root,'lotto_ruote_'+range+'.csv')),';');
 const dates=new Map();
 for(const r of rows){
  let d=dates.get(r.lotto_data);
  if(!d){d={date:r.lotto_data,contest:r.lotto_concorso,wheels:{}};dates.set(r.lotto_data,d)}
  assert(!d.wheels[r.ruota],'Duplicated Lotto wheel '+r.lotto_data+'/'+r.ruota);
  d.wheels[r.ruota]=Array.from({length:5},(_,i)=>Number(r['estratto_'+(i+1)]));
 }
 const out=[['codice_simulazione','lotto_data','lotto_concorso','n1','n2','n3','n4','n5','n6','jolly','superstar','stato']];
 for(const d of dates.values()){
  if(d.date>='1997-12-03')continue;
  lottoDates++;
  const observed=new Set(),nums=[];let valid=true;
  for(const w of wheels){
   const arr=d.wheels[w];
   if(!arr){valid=false;break}
   const n=arr.find(x=>!observed.has(x));
   if(n===undefined){valid=false;break}
   observed.add(n);nums.push(n);
  }
  if(!valid||!d.wheels.venezia){failed++;continue}
  const j=d.wheels.venezia.find(n=>!observed.has(n));
  if(j===undefined){failed++;continue}
  nums.sort((a,b)=>a-b);
  out.push(['SIM-'+d.date,d.date,d.contest,...nums,j,
    d.wheels.nazionale?.[0]??'','ipotetica']);simTotal++;
 }
 writeOrCheck('superenalotto_ipotetico_'+range+'.csv',format(out));
}
assert.equal(lottoDates,3116);assert.equal(simTotal,3068);assert.equal(failed,48);
console.log(JSON.stringify({mode,draws:original.length,pools:pools.length,prizes:prizes.length,
 lottoDates,simulatedPre1997:simTotal,insufficientWheelDates:failed,contestSourceDifferences:cross.length-1,
 drawNumberDiscrepancies:bad.length-1}));
