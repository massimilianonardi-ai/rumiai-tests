#!/usr/bin/env python3
"""Riproduzione v11: convergenza retrograda nearest neighbor; seed fisso."""
from pathlib import Path
import json, hashlib, time
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

P=Path(__file__).resolve().parent
f=P/'estrazioni_con_ritardi.csv'
df=pd.read_csv(f,sep=';',encoding='utf-8-sig')
D=df[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=np.int16)
N=len(D); H=120; B=500; seed=20261102
rng=np.random.default_rng(seed)
assert N==4294 and df.data.is_monotonic_decreasing and np.all(np.diff(D,axis=1)>0)
roots=np.arange(N-H,dtype=np.int32);M=len(roots)
steps=np.array([1,2,3,5,8,10,13,17,20,30,40,50,60,80])

def measure(draws):
    state=draws[roots].copy()
    result=np.zeros(M,dtype=np.int16)
    first=np.full(M,-1,dtype=np.int16)
    live=np.ones(M,dtype=bool)
    for k in range(1,H+1):
        ix=np.flatnonzero(live)
        if not len(ix):break
        old=draws[roots[ix]+k]
        near=np.abs(state[ix,:,None]-old[:,None,:]).argmin(axis=2)
        state[ix]=old[np.arange(len(ix))[:,None],near]
        distinct=(state[ix,1:]!=state[ix,:-1]).sum(axis=1)+1
        firstids=ix[(distinct<6)&(first[ix]<0)]
        first[firstids]=k
        finished=ix[distinct==1]
        result[finished]=k
        live[finished]=False
    return result,first,live

def fresh_random():
    # Draw 6 out of 90 without replacement per row, each draw independent.
    u=rng.random((N,90),dtype=np.float32)
    return np.sort(np.argpartition(u,5,axis=1)[:,:6]+1,axis=1).astype(np.int16)

def test_null(vals,actual):
    center=vals.mean()
    outlier=np.abs(vals-center)>=abs(actual-center)
    return {'real':float(actual),'simulated_mean':float(center),
            'simulated_sd':float(vals.std(ddof=1)),
            'simulated_95pc_interval':[float(v) for v in np.quantile(vals,[.025,.975])],
            'p_two_sided':float((outlier.sum()+1)/(len(vals)+1))}

print('Input',N,'eligible',M,'history',H,flush=True)
real,real_first,cens=measure(D)
assert not cens.any() and real[0]==17
post=(df.iloc[roots].data.to_numpy()>='2009-07-01')
pre=~post
real_diff=real[post].mean()-real[pre].mean()
res={}
now=time.monotonic()
for model in ['independent','time_shuffle']:
    means=np.empty(B);medians=np.empty(B)
    curves=np.empty((B,len(steps)));maxima=np.empty(B);deltas=np.empty(B);censor_counts=np.empty(B,dtype=int)
    for rep in range(B):
        fake=fresh_random() if model=='independent' else D[rng.permutation(N)]
        durations,_,c=measure(fake)
        # For very rare nonconvergences within H, use restricted time H.
        # This is identical to min(T,H) and is fair for real vs simulated data.
        censor_counts[rep]=int(c.sum())
        durations[c]=H
        means[rep]=durations.mean();medians[rep]=np.median(durations)
        maxima[rep]=durations.max()
        curves[rep]=(durations[:,None]>steps).mean(axis=0)
        deltas[rep]=durations[post].mean()-durations[pre].mean()
        if (rep+1)%250==0:
            print(model,rep+1,'/',B,'seconds',round(time.monotonic()-now,1),flush=True)
    res[model]={'mean':means,'median':medians,'curve':curves,'maximum':maxima,'delta':deltas,'censored':censor_counts}

surv=(real[:,None]>steps).mean(axis=0)
metrics={'experiment':'v11 retrograde nearest-neighbor convergence',
 'input_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),
 'n_draws':N,'roots_analyzed':M,'history_steps':H,'seed':seed,'replicas_each':B,
 'mean_definition':'restricted mean E[min(T,120)] in all models; uncensored for observed data',
 'real':{
  'mean':float(real.mean()),'median':float(np.median(real)),
  'min':int(real.min()),'max':int(real.max()),
  'q05':float(np.quantile(real,.05)),'q25':float(np.quantile(real,.25)),
  'q75':float(np.quantile(real,.75)),'q90':float(np.quantile(real,.90)),
  'q95':float(np.quantile(real,.95)),'q99':float(np.quantile(real,.99)),
  'latest':int(real[0]),'steps_le10':float(np.mean(real<=10)),
  'steps_le20':float(np.mean(real<=20)),'steps_le30':float(np.mean(real<=30)),
  'first_step_merge_fraction':float(np.mean(real_first==1)),
  'pre_start_count':int(pre.sum()),'post_start_count':int(post.sum()),
  'pre_mean':float(real[pre].mean()),'post_mean':float(real[post].mean()),
  'post_minus_pre':float(real_diff),
  'remaining_after_steps':{str(k):float(v) for k,v in zip(steps,surv)}},
 'nulls':{}}
checkpoints=(steps>=5)&(steps<=50)
for model,r in res.items():
    mu=r['curve'][:,checkpoints].mean(axis=0)
    sd=np.maximum(r['curve'][:,checkpoints].std(axis=0,ddof=1),1e-8)
    observed_max=np.max(np.abs((surv[checkpoints]-mu)/sd))
    simulated_max=np.max(np.abs((r['curve'][:,checkpoints]-mu)/sd),axis=1)
    metrics['nulls'][model]={
      'mean':test_null(r['mean'],real.mean()),
      'median':test_null(r['median'],np.median(real)),
      'epoch_difference':test_null(r['delta'],real_diff),
      'maximum_95pc':float(np.quantile(r['maximum'],.95)),
      'non_converged_within_horizon_count_total':int(r['censored'].sum()),
      'replicates_with_any_non_convergence':int(np.sum(r['censored']>0)),
      'global_survival':{
        'checkpoints':steps[checkpoints].tolist(),
        'observed_max_z':float(observed_max),
        'p_familywise':float((np.sum(simulated_max>=observed_max)+1)/(B+1))},
      'survival_average':{str(k):float(v) for k,v in zip(steps,r['curve'].mean(axis=0))}}

with (P/'superenalotto_metriche_v11.json').open('w') as o: json.dump(metrics,o,indent=2,ensure_ascii=False)
starts=df.iloc[roots][['data','concorso']].copy().rename(columns={'data':'data_partenza','concorso':'concorso_partenza'})
starts.insert(0,'indice_desc',roots)
starts['numeri_partenza']=[' '.join(map(str,x)) for x in D[roots]]
starts['passi_convergenza']=real
starts['passo_prima_fusione']=real_first
starts['data_convergenza']=df.data.to_numpy()[roots+real]
starts.to_csv(P/'superenalotto_convergenze_storiche_v11.csv',index=False)

simrows=[]
for model,r in res.items():
    for rep in range(B):
        simrows.append({'modello':model,'replica':rep+1,'passi_medi':r['mean'][rep],
            'passi_mediani':r['median'][rep],'passi_massimi':r['maximum'][rep],
            'differenza_post_pre':r['delta'][rep],
            'non_convergenti_entro_120':r['censored'][rep],
            **{f'sopravvivenza_passo_{k}':r['curve'][rep,j] for j,k in enumerate(steps)}})
pd.DataFrame(simrows).to_csv(P/'superenalotto_simulazioni_convergenza_v11.csv',index=False)
curve_rows=[]
for j,k in enumerate(steps):
    row={'passi':int(k),'reale_pct':float(100*surv[j])}
    for model,r in res.items():
        x=r['curve'][:,j]
        row[f'{model}_media_pct']=float(100*x.mean())
        row[f'{model}_q025_pct']=float(100*np.quantile(x,.025))
        row[f'{model}_q975_pct']=float(100*np.quantile(x,.975))
    curve_rows.append(row)
pd.DataFrame(curve_rows).to_csv(P/'superenalotto_curve_convergenza_v11.csv',index=False)

fig,ax=plt.subplots(figsize=(11,6))
ax.step(np.arange(H+1),[(real>k).mean()*100 for k in range(H+1)],where='post',label='Storico reale',linewidth=2.3)
for model,label in [('independent','Estrazioni casuali indipendenti'),('time_shuffle','Ordine dello storico rimescolato')]:
    mat=res[model]['curve']*100
    line,=ax.plot(steps,mat.mean(axis=0),marker='o',markersize=3,label=label,linewidth=1.7)
    ax.fill_between(steps,np.quantile(mat,.025,axis=0),np.quantile(mat,.975,axis=0),color=line.get_color(),alpha=.16)
ax.set(xlim=(0,80),ylim=(0,100),xlabel='Passaggi all’indietro',ylabel='Traiettorie non ancora convergenti (%)',title='Convergenza per vicinanza — storico e simulazioni')
ax.legend();ax.grid(alpha=.23);fig.tight_layout()
fig.savefig(P/'superenalotto_convergenza_confronto_v11.png',dpi=175)
plt.close(fig)

fig,ax=plt.subplots(figsize=(11,6))
ax.hist(real,bins=np.arange(.5,81.5,1),alpha=.8)
ax.axvline(real.mean(),ls='--',label=f'Media osservata: {real.mean():.2f}')
ax.axvline(res['independent']['mean'].mean(),ls=':',label=f'Media casuale: {res["independent"]["mean"].mean():.2f}')
ax.set(xlim=(0,80),xlabel='Numero di passaggi',ylabel='Frequenza delle partenze',title='Distribuzione dei tempi di convergenza delle 4.174 partenze')
ax.legend();ax.grid(axis='y',alpha=.25);fig.tight_layout()
fig.savefig(P/'superenalotto_convergenza_istogramma_v11.png',dpi=175)
plt.close(fig)
print('FINISHED',round(time.monotonic()-now,1),'sec',flush=True)
print(json.dumps(metrics,ensure_ascii=False,indent=2),flush=True)
