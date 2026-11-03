#!/usr/bin/env node
/*
SuperEnalotto v26 — full vector of 15 prior pair frequencies.
F18 active iff max pair history frequency <= 30. All counts are pre-draw.
No third-party dependencies. Reproduce:
  node compute_v26.js estrazioni_con_ritardi.csv superenalotto_metriche_v26.json superenalotto_coppie_vettori_v26.csv
Data frozen at 2026-10-31. Historical thresholds F03-F14 were fitted retrospectively.
*/
function analyze(csv, config={}) {
 'use strict';
 const START=68, TOTAL=622614630, MC_R=config.samples||750, NULL_B=config.nullReplicas||320;
 const MC_SEED=2026112601, NULL_SEED=2026112602;
 const names=['somma','mediana','deviazione_standard','intervallo_interquartile','minimo','massimo','n_coppie_sopra_2sigma','gini',
   ...Array.from({length:15},(_,i)=>'coppia_ordinata_'+String(i+1).padStart(2,'0'))];
 const N_FEATURES=names.length;
 const src=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(line=>{
  const f=line.split(';');return {date:f[0],contest:+f[1],nums:[+f[2],+f[3],+f[4],+f[5],+f[6],+f[7]]};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.contest-b.contest);
 if(src.length!==4294)throw Error('Expected 4294, got '+src.length);
 const N=src.length,T=N-START;
 const pairId=(a,b)=>(b-1)*(b-2)/2+a-1;
 const triId=(a,b,c)=>(a<<14)|(b<<7)|c;
 const quaId=(a,b,c,d)=>(a<<21)|(b<<14)|(c<<7)|d;
 const pairCnt=new Uint16Array(4005),tripleCnt=new Uint8Array(91*128*128),quart=new Set(),quint=new Set(),last=new Int32Array(91);last.fill(-1);
 function rng(seed){let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0}}
 const MC=rng(MC_SEED),NR=rng(NULL_SEED);
 function uniform6() {
  const v=[];
  while(v.length<6) {
   const x=MC();
   if(x>=4294967280)continue;
   const n=1+(x%90);if(!v.includes(n))v.push(n);
  }
  return v.sort((a,b)=>a-b);
 }
 function cat(d){if(d===1)return 0;if(d<=3)return 1;if(d<=5)return 2;if(d<=11)return 3;if(d<=18)return 4;if(d<=26)return 5;if(d<=35)return 6;if(d<=53)return 7;if(d<=94)return 8;return 9}
 function passes17(a,t) {
  if(!(1<=a[0]&&a[0]<=49&&2<=a[1]&&a[1]<=64&&7<=a[2]&&a[2]<=76&&16<=a[3]&&a[3]<=84&&28<=a[4]&&a[4]<=89&&46<=a[5]&&a[5]<=90))return false;
  const c=a.map(n=>last[n]<0?9:cat(t-last[n])).sort((x,y)=>x-y);
  if(!(c[0]<=3&&c[1]<=4&&c[2]<=5&&c[3]>=1&&c[3]<=6&&c[4]>=2&&c[4]<=7&&c[5]>=3&&c[5]<=8))return false;
  // F15 implies F02. Quintuple rank injective in base 91.
  for(let drop=0;drop<6;drop++){
   let key=0;for(let i=0;i<6;i++)if(i!==drop)key=key*91+a[i];
   if(quint.has(key))return false;
  }
  // F16: two or more distinct previously observed four-number subsets are disallowed.
  let count4=0;
  for(let i=0;i<3;i++)for(let j=i+1;j<4;j++)for(let k=j+1;k<5;k++)for(let l=k+1;l<6;l++)
   if(quart.has(quaId(a[i],a[j],a[k],a[l]))&&++count4>1)return false;
  // F17: every triple appeared at most four times before now.
  for(let i=0;i<4;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<6;k++)
   if(tripleCnt[triId(a[i],a[j],a[k])]>=5)return false;
  return true;
 }
 function pairVector(a) {
  const v=[];
  for(let i=0;i<5;i++)for(let j=i+1;j<6;j++)v.push(pairCnt[pairId(a[i],a[j])]);
  return v.sort((a,b)=>a-b);
 }
 function features(v,t) {
  let sum=0,sumSq=0,weighted=0;
  for(let j=0;j<15;j++){const q=v[j];sum+=q;sumSq+=q*q;weighted+=(j+1)*q;}
  const mu=t/267,sd=Math.sqrt((t/267)*(266/267));
  let high=0;
  for(let j=0;j<15;j++)if(v[j]>mu+2*sd)high++;
  const gini=sum?(2*weighted/(15*sum)-16/15):0;
  return [sum,v[7],Math.sqrt(Math.max(0,sumSq/15-(sum/15)*(sum/15))),v[11]-v[3],v[0],v[14],high,gini,...v];
 }
 function advance(a,t) {
  for(let i=0;i<5;i++)for(let j=i+1;j<6;j++)pairCnt[pairId(a[i],a[j])]++;
  for(let i=0;i<4;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<6;k++)tripleCnt[triId(a[i],a[j],a[k])]++;
  for(let i=0;i<3;i++)for(let j=i+1;j<4;j++)for(let k=j+1;k<5;k++)for(let l=k+1;l<6;l++)quart.add(quaId(a[i],a[j],a[k],a[l]));
  for(let drop=0;drop<6;drop++){let key=0;for(let i=0;i<6;i++)if(i!==drop)key=key*91+a[i];quint.add(key);}
  for(let i=0;i<6;i++)last[a[i]]=t;
 }
 function lower(a,x){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m]<x)lo=m+1;else hi=m;}return lo}
 function upper(a,x){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m]<=x)lo=m+1;else hi=m;}return lo}
 const perDate=[],obsSum=new Float64Array(N_FEATURES),expSum=new Float64Array(N_FEATURES),
    rankSum=new Float64Array(N_FEATURES),nullRankSum=new Float64Array(NULL_B*N_FEATURES),
    nullNsum=new Float64Array(NULL_B*N_FEATURES);
 let count17=0,count18=0,winLoss=[],rejectedMC=0,accepted17MC=0,accepted18MC=0,sePart=0,eligible=0;
 const freqHist=new Map();
 for(let t=0;t<N;t++){
  const a=src[t].nums, vec=pairVector(a), feat=features(vec,t);
  const pass17=t>=START?passes17(a,t):false,pass18=pass17&&vec[14]<=30;
  if(t>=START){
   if(pass17)count17++;
   if(pass18)count18++;
   if(pass17&&!pass18)winLoss.push({data:src[t].date,concorso:src[t].contest,sestina:a.join(' '),massima_frequenza:vec[14]});
   freqHist.set(vec[14],(freqHist.get(vec[14])||0)+1);
   const entry={data:src[t].date,concorso:src[t].contest,indice:t+1,esito_F01_F17:+pass17,esito_F01_F18:+pass18,frequenze_coppie_ordinate:vec,
                statistiche:Object.fromEntries(names.slice(0,8).map((k,j)=>[k,feat[j]])),mc_passano_F01_F17:0,mc_passano_F01_F18:0,
                percentili_condizionati:null};
   const pool=[];
   for(let k=0;k<MC_R;k++){
    const cand=uniform6();
    if(!passes17(cand,t))continue;
    entry.mc_passano_F01_F17++;
    const cv=pairVector(cand);
    if(cv[14]>30)continue;
    entry.mc_passano_F01_F18++;
    if(pass18)pool.push(features(cv,t));
   }
   accepted17MC+=entry.mc_passano_F01_F17;
   accepted18MC+=entry.mc_passano_F01_F18;
   const pt=(entry.mc_passano_F01_F17-entry.mc_passano_F01_F18)/MC_R;
   rejectedMC+=pt;
   sePart+=pt*(1-pt);
   if(pass18){
    if(!pool.length)throw Error('No MC candidates at index '+t);
    eligible++;
    const nullPick=new Uint16Array(NULL_B);
    for(let b=0;b<NULL_B;b++)nullPick[b]=NR()%pool.length;
    entry.percentili_condizionati=[];
    for(let j=0;j<N_FEATURES;j++){
     let mean=0;const vals=[];
     for(let i=0;i<pool.length;i++){const z=pool[i][j];mean+=z;vals.push(z)}
     mean/=pool.length; vals.sort((a,b)=>a-b);
     expSum[j]+=mean;obsSum[j]+=feat[j];
     const realP=(lower(vals,feat[j])+upper(vals,feat[j]))/(2*vals.length);
     entry.percentili_condizionati.push(realP);rankSum[j]+=realP;
     for(let b=0;b<NULL_B;b++){
      const x=pool[nullPick[b]][j],p=(lower(vals,x)+upper(vals,x))/(2*vals.length);
      nullRankSum[b*N_FEATURES+j]+=p;
      nullNsum[b*N_FEATURES+j]+=x;
     }
    }
   }
   perDate.push(entry);
  }
  advance(a,t);
 }
 if(count17!==3804||count18!==3801||winLoss.length!==3)throw Error('Incorrect validation: '+JSON.stringify({count17,count18,winLoss}));
 if(eligible!==count18)throw Error('Eligible mismatch');
 const summary=[];
 const means=new Float64Array(N_FEATURES),sds=new Float64Array(N_FEATURES);
 for(let j=0;j<N_FEATURES;j++){
  const nx=Array.from({length:NULL_B},(_,b)=>nullRankSum[b*N_FEATURES+j]/eligible);
  const mn=nx.reduce((a,b)=>a+b,0)/NULL_B;
  const std=Math.sqrt(nx.reduce((a,b)=>a+(b-mn)*(b-mn),0)/(NULL_B-1));
  means[j]=mn;sds[j]=std;
 }
 const maxNull=new Float64Array(NULL_B);
 for(let b=0;b<NULL_B;b++){
  let best=0;
  for(let j=0;j<N_FEATURES;j++){
   const tstat=Math.abs(nullRankSum[b*N_FEATURES+j]/eligible-means[j])/(sds[j]||1);
   if(tstat>best)best=tstat;
  }
  maxNull[b]=best;
 }
 for(let j=0;j<N_FEATURES;j++){
  const realP=rankSum[j]/eligible,dev=Math.abs(realP-means[j]);
  const tstat=dev/(sds[j]||1);
  const nullP=Array.from({length:NULL_B},(_,b)=>nullRankSum[b*N_FEATURES+j]/eligible);
  const p=(1+nullP.filter(q=>Math.abs(q-means[j])>=dev-1e-15).length)/(NULL_B+1);
  const padj=(1+Array.from(maxNull).filter(q=>q>=tstat-1e-12).length)/(NULL_B+1);
  const sorted=nullP.slice().sort((a,b)=>a-b);
  summary.push({feature:names[j],actual_mean:obsSum[j]/eligible,control_mean:expSum[j]/eligible,
      actual_mean_percentile:realP,null_mean_percentile:means[j],
      null_interval_95:[sorted[Math.floor(NULL_B*.025)],sorted[Math.floor(NULL_B*.975)]],
      z_exploratory:(realP-means[j])/(sds[j]||1),p_empirical:p,p_fwer_maxT:padj});
 }
 const mcExtra=TOTAL*rejectedMC/T;
 const mcSeExtra=TOTAL*Math.sqrt(sePart/(T*T*MC_R));
 const baselineMean=559465442,baselineSE=(559515685-559415199)/3.92;
 const newMean=baselineMean-mcExtra;
 const result={version:26,source_head:config.sourceHead||null,active_filters:18,
  F18:{status:'ACTIVE',definition:'max prior frequency of 15 constituent pairs <= 30',NOT_pair_delay:true,
       frequency_cutoff_inclusive:30,historical_excluded_winners:winLoss},
  data:{draws:N,evaluable:T,start_date:src[START].date,end_date:src[N-1].date,possible_combinations:TOTAL},
  exact:{hits_F01_F17:count17,hits_F01_F18:count18,coverage_F01_F18:count18/T,
    removed_additional_winners:count17-count18,max_prior_pair_histogram:Object.fromEntries([...freqHist.entries()].sort((a,b)=>a[0]-b[0]))},
  monte_carlo:{samples_per_date:MC_R,seed:MC_SEED,total_samples:MC_R*T,
    mean_mc_F01_F17:T?TOTAL*accepted17MC/(MC_R*T):null,
    mean_mc_F01_F18_raw:TOTAL*accepted18MC/(MC_R*T),
    extra_eliminated_F18_mean:mcExtra,extra_eliminated_F18_mc_se:mcSeExtra,
    previous_v24_mean_MC:baselineMean,
    new_mean_control_variate: newMean,
    new_mean_95pct_mc_approx:[newMean-1.96*Math.hypot(baselineSE,mcSeExtra),newMean+1.96*Math.hypot(baselineSE,mcSeExtra)],
    proportion_accepted:newMean/TOTAL,
    historical_coverage_minus_random_share:(count18/T-newMean/TOTAL)},
  conditional_test:{eligible_real_winners:eligible,
    reference:'uniform random six-number draws CONDITIONAL on F01-F18, per-date history fixed',
    method:'within-date randomized midrank percentile (ties corrected); one pseudo-winning accepted draw per date and replicate; all 23 features jointly recomputed',
    null_seed:NULL_SEED,null_replicas:NULL_B,feature_count:N_FEATURES,
    statistics:summary},
  caveats:['F03-F14 were calibrated retrospectively using complete archive; no independent holdout',
   '2021-2026 reused during model development; not independent out-of-sample',
   'conditional synthetic pseudo-outcomes use actual fixed draw history, not a fresh full causal process simulation',
   'mean residual space is Monte Carlo, not exact; v24 anchor and v26 incremental MC errors combined approximately',
   '23 outcomes examined jointly; report FWER maxT empirical p values; no new threshold/filter selected from these outcomes',
   'terminology: historical pair frequency is not pair delay since previous occurrence']
 };
 return {metrics:result,perDate};
}
if(typeof module!=='undefined'&&require.main===module) {
 const fs=require('node:fs'),path=require('node:path');
 const file=process.argv[2]||path.join(__dirname,'estrazioni_con_ritardi.csv');
 const a=analyze(fs.readFileSync(file,'utf8'));
 const outM=process.argv[3]||path.join(__dirname,'superenalotto_metriche_v26.json');
 const outC=process.argv[4]||path.join(__dirname,'superenalotto_coppie_vettori_v26.csv');
 const columns=['data','concorso','indice','esito_F01_F17','esito_F01_F18',
  ...Array.from({length:15},(_,i)=>'frequenza_coppia_ordinata_'+String(i+1).padStart(2,'0')),
  ...Object.keys(a.perDate[0].statistiche),'mc_passano_F01_F17','mc_passano_F01_F18'];
 const cs=[columns.join(';')];
 for(const e of a.perDate)cs.push([e.data,e.concorso,e.indice,e.esito_F01_F17,e.esito_F01_F18,
  ...e.frequenze_coppie_ordinate,...Object.values(e.statistiche),e.mc_passano_F01_F17,e.mc_passano_F01_F18].join(';'));
 fs.writeFileSync(outM,JSON.stringify(a.metrics,null,2)+'\n');
 fs.writeFileSync(outC,cs.join('\n')+'\n');
 process.stdout.write(JSON.stringify({exact:a.metrics.exact,mc:a.metrics.monte_carlo})+'\n');
}
