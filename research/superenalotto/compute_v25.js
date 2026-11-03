#usr/bin/env node
/* SuperEnalotto v25. Run: node compute_v25.js estrazioni_con_ritardi.csv [metrics.json] */

function analyze(csv) {
 const TOTAL=622614630,START=68,R=750,seedMC=20261125,seedSim=20261126,seedShuffle=20261127;
 const ABS=[12,14,16,18,20,22,24,26,28,30,32],DYN=[1.5,2,2.5,3,3.5],SN=300,SH=250;
 const rows=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(x=>{
  const f=x.split(';'); return {date:f[0],concorso:+f[1],n:[+f[2],+f[3],+f[4],+f[5],+f[6],+f[7]]};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.concorso-b.concorso);
 if(rows.length!==4294)throw Error("CSV rows "+rows.length);
 const N=rows.length,T=N-START;
 const pairId=(a,b)=>((b-1)*(b-2)/2+a-1);
 const tripleId=(a,b,c)=>((a<<14)|(b<<7)|c);
 const quartId=(a,b,c,d)=>((a<<21)|(b<<14)|(c<<7)|d);
 const quintId=(a,b,c,d,e)=>((((a*91+b)*91+c)*91+d)*91+e);
 function RNG(seed){let s=seed>>>0;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0}}
 function uniformDraw(rng) {
  const a=[];while(a.length<6){let x=rng();if(x>=4294967280)continue;const n=1+x%90;
   if(!a.includes(n))a.push(n)}a.sort((x,y)=>x-y);return a;
 }
 const pairKeyLists=Array.from({length:90},()=>null);
 function maxpair(a,cnt) {let mx=0;for(let i=0;i<5;i++)for(let j=i+1;j<6;j++){let c=cnt[pairId(a[i],a[j])];if(c>mx)mx=c}return mx}
 function updatePair(a,cnt){for(let i=0;i<5;i++)for(let j=i+1;j<6;j++)cnt[pairId(a[i],a[j])]++}
 function describe(a) {let z=a.slice().sort((x,y)=>x-y),sum=a.reduce((x,y)=>x+y,0);return {n:a.length,mean:sum/a.length,p50:z[Math.floor(z.length*.5)],p90:z[Math.floor(z.length*.9)],p95:z[Math.floor(z.length*.95)],p99:z[Math.floor(z.length*.99)],max:z.at(-1),over24:a.filter(x=>x>24).length/a.length,over26:a.filter(x=>x>26).length/a.length};}
 const last=new Int32Array(91);last.fill(-1);
 const pairs=new Uint16Array(4005),tri=new Uint8Array(91*128*128),quart=new Set(),quint=new Set();
 const actual=[],actualBase=[],actualBasemask=[],perDate=[],MC=RNG(seedMC);
 const baseH=new Map(), allH=new Map();
 const sumsAbs=ABS.map(()=>0),sumsDyn=DYN.map(()=>0),hitsAbs=ABS.map(()=>0),hitsDyn=DYN.map(()=>0);
 const lostAbsHits=ABS.map(()=>0), lostDynHits=DYN.map(()=>0);
 let baseMCsum=0,baseHits=0;
 function category(dt){if(dt===1)return 0;if(dt<=3)return 1;if(dt<=5)return 2;if(dt<=11)return 3;if(dt<=18)return 4;if(dt<=26)return 5;if(dt<=35)return 6;if(dt<=53)return 7;if(dt<=94)return 8;return 9}
 function passes(a,t){
  if(!(1<=a[0]&&a[0]<=49&&2<=a[1]&&a[1]<=64&&7<=a[2]&&a[2]<=76&&16<=a[3]&&a[3]<=84&&28<=a[4]&&a[4]<=89&&46<=a[5]&&a[5]<=90))return false;
  const c=a.map(n=>last[n]<0?9:category(t-last[n])).sort((x,y)=>x-y);
  if(!(c[0]<=3&&c[1]<=4&&c[2]<=5&&c[3]>=1&&c[3]<=6&&c[4]>=2&&c[4]<=7&&c[5]>=3&&c[5]<=8))return false;
  // F15: every five-number subset must be new
  for(let skip=0;skip<6;skip++){let k=0;for(let i=0;i<6;i++)if(i!==skip)k=k*91+a[i];if(quint.has(k))return false;}
  // F16: at most one distinct previously observed quartet
  let seen4=0;
  for(let i=0;i<3;i++)for(let j=i+1;j<4;j++)for(let k=j+1;k<5;k++)for(let l=k+1;l<6;l++)
    if(quart.has(quartId(a[i],a[j],a[k],a[l]))&&++seen4>1)return false;
  // F17: maximum prior triple frequency <= 4
  for(let i=0;i<4;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<6;k++)if(tri[tripleId(a[i],a[j],a[k])]>=5)return false;
  return true;
 }
 for(let t=0;t<N;t++){
  const a=rows[t].n,m=maxpair(a,pairs),ok=t>=START?passes(a,t):null;
  if(t>=START){
   actual.push(m);actualBasemask.push(ok?1:0); allH.set(m,(allH.get(m)||0)+1);
   if(ok){actualBase.push(m);baseH.set(m,(baseH.get(m)||0)+1);baseHits++}
   const rr={date:rows[t].date,concorso:rows[t].concorso,index:t+1,max_prior_pair:m,v24_hit:ok?1:0,
               mc_base:0,mc_abs:ABS.map(()=>0),mc_dyn:DYN.map(()=>0), mc_hist:[]};
   const mu=t/267,sd=Math.sqrt(t/267*(266/267));
   for(let k=0;k<R;k++){
    const ss=uniformDraw(MC);
    if(!passes(ss,t))continue;
    rr.mc_base++;const mm=maxpair(ss,pairs);rr.mc_hist[mm]=(rr.mc_hist[mm]||0)+1;
    for(let j=0;j<ABS.length;j++)if(mm>ABS[j])rr.mc_abs[j]++;
    for(let j=0;j<DYN.length;j++)if((mm-mu)/sd>DYN[j])rr.mc_dyn[j]++;
   }
   if(rr.mc_base===0)throw Error("zero samples date "+t);
   baseMCsum+=rr.mc_base;
   for(let j=0;j<ABS.length;j++)sumsAbs[j]+=rr.mc_abs[j];
   for(let j=0;j<DYN.length;j++)sumsDyn[j]+=rr.mc_dyn[j];
   for(let j=0;j<ABS.length;j++)if(ok && m>ABS[j])lostAbsHits[j]++;
   for(let j=0;j<DYN.length;j++)if(ok && (m-mu)/sd>DYN[j])lostDynHits[j]++;
   perDate.push(rr);
  }
  updatePair(a,pairs);
  for(let i=0;i<4;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<6;k++)tri[tripleId(a[i],a[j],a[k])]++;
  for(let i=0;i<3;i++)for(let j=i+1;j<4;j++)for(let k=j+1;k<5;k++)for(let l=k+1;l<6;l++)quart.add(quartId(a[i],a[j],a[k],a[l]));
  for(let skip=0;skip<6;skip++){let z=0;for(let i=0;i<6;i++)if(i!==skip)z=z*91+a[i];quint.add(z)}
  for(let i=0;i<6;i++)last[a[i]]=t;
 }
 if(baseHits!==3804)throw Error('F01-F17 actual mismatch '+baseHits);
 const ob=describe(actual),obBase=describe(actualBase);
 function nullStats(draws){const ct=new Uint16Array(4005),m=[];for(let t=0;t<draws.length;t++){const ss=draws[t],v=maxpair(ss,ct);if(t>=START)m.push(v);updatePair(ss,ct)}return describe(m)}
 const rs=RNG(seedSim),sim=[]; for(let s=0;s<SN;s++){const draw=[];for(let t=0;t<N;t++)draw.push(uniformDraw(rs));sim.push(nullStats(draw));}
 const shR=RNG(seedShuffle),shuf=[];for(let s=0;s<SH;s++){
  const perm=Array.from({length:N},(_,i)=>i);
  for(let j=N-1;j>0;j--){const k=shR()%(j+1),v=perm[j];perm[j]=perm[k];perm[k]=v}
  shuf.push(nullStats(perm.map(i=>rows[i].n)));
 }
 function simCompare(obs,dist){
  const vars=['mean','p90','p95','p99','over24','over26'];
  const out={n:dist.length};
  for(const k of vars){const x=dist.map(z=>z[k]),mean=x.reduce((a,b)=>a+b,0)/x.length;
   const sorted=x.slice().sort((a,b)=>a-b);
   const p=(1+x.filter(v=>Math.abs(v-mean)>=Math.abs(obs[k]-mean)-1e-12).length)/(x.length+1);
   out[k]={observed:obs[k],mean,lo:sorted[Math.floor((x.length-1)*.025)],hi:sorted[Math.floor((x.length-1)*.975)],p_two_sided:p};
  }
  return out;
 }
 const oldMean=559465442,oldCI=[559415199,559515685],oldSE=(oldCI[1]-oldCI[0])/3.92;
 function summarizeThreshold(type,ths,losses,hits){
  const rowsOut=[];
  for(let j=0;j<ths.length;j++){
   const add=losses[j]/(T*R),meanExtra=TOTAL*add;
   let v=0,ec=0,vc=0;
   for(let k=0;k<T;k++){
    const rr=perDate[k],lost=type==='abs'?rr.mc_abs[j]:rr.mc_dyn[j];
    const pp=lost/R;v+=pp*(1-pp);
    if(rr.v24_hit){const q=lost/rr.mc_base;ec+=q;vc+=q*(1-q)}
   }
   const se=TOTAL*Math.sqrt(v/(T*T*R)),newMean=oldMean-meanExtra;
   const out={threshold:ths[j],observed_lost:hits[j],observed_hits:baseHits-hits[j],
     observed_coverage:(baseHits-hits[j])/T,old_coverage:baseHits/T,
     predicted_lost_conditional:ec,conditional_sd:Math.sqrt(vc),
     z:vc?((hits[j]-ec)/Math.sqrt(vc)):0,
     extra_reduction_space_fraction:add,extra_eliminated_mean:meanExtra,
     new_remaining_mean:newMean, new_remaining_fraction:newMean/TOTAL,
     extra_mc_se:se, combined_mc_se:Math.hypot(oldSE,se),
     relative_candidate_loss:meanExtra/oldMean, relative_winner_loss:hits[j]/baseHits};
   rowsOut.push(out);
  }
  return rowsOut;
 }
 const absOut=summarizeThreshold('abs',ABS,sumsAbs,lostAbsHits),dynOut=summarizeThreshold('dyn',DYN,sumsDyn,lostDynHits);
 const histogram=(m)=>Object.fromEntries([...m.entries()].sort((a,b)=>a[0]-b[0]));
 const result={meta:{repoHead:"d4e17362d8a5a43e07bd1b2fe805c4cc6ec77222",N,T,R,seedMC,SN,SH,seedSim,seedShuffle,
  baselineOldMean:oldMean,baseMC:baseMCsum/(T*R),baseMC_estimate:TOTAL*baseMCsum/(T*R),baseHits,dates:[rows[START].date,rows.at(-1).date]},
  observed:{all:ob,base:obBase,hist_all:histogram(allH),hist_base:histogram(baseH)},
  nulls:{uniform:simCompare(ob,sim),shuffle:simCompare(ob,shuf)},
  thresholds:{absolute:absOut,dynamic:dynOut},
  notes:"F18 inactive; F03-F14 post hoc; 2021-2026 not untouched; MC exact historical base hit count, sample counts estimates; null replications exploratory"};
 return result;
}

const fs=require('node:fs');
const path=require('node:path');
const data=fs.readFileSync(process.argv[2]||path.join(__dirname,'estrazioni_con_ritardi.csv'),'utf8');
const metrics=analyze(data);
const out=process.argv[3]||path.join(__dirname,'superenalotto_metriche_v25.json');
fs.writeFileSync(out,JSON.stringify(metrics,null,2)+'\n','utf8');
console.log(JSON.stringify({meta:metrics.meta,observed:metrics.observed.all,metrics_file:out},null,2));
