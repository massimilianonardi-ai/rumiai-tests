#!/usr/bin/env python3
"""v15: ESN windows on post-2009 SuperEnalotto, expanding walk-forward validation/test.
Run: python /mnt/data/compute_v15.py
Dependencies: numpy scipy pandas scikit-learn torch matplotlib threadpoolctl
"""
import json, hashlib, math, time
from pathlib import Path
from scipy.special import expit
from scipy.stats import hypergeom, norm
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import torch
from sklearn.linear_model import Ridge
from threadpoolctl import threadpool_limits

P=Path('/mnt/data');SEED=20261102+15
np.random.seed(SEED); torch.manual_seed(SEED);torch.set_num_threads(2)
frame=pd.read_csv(P/'superenalotto_matrice_binaria_90_v13.csv', parse_dates=['data']).sort_values('data', kind='stable').reset_index(drop=True)
full=frame[frame['data']>=pd.Timestamp('2009-07-01')].reset_index(drop=True)
y=full[[f'n{i:02d}' for i in range(1,91)]].to_numpy(dtype=np.float32)
dates=full['data'].dt.strftime('%Y-%m-%d').to_numpy()
T=len(y);assert T==2869 and np.all(y.sum(axis=1)==6)
folds=[(900,1200),(1200,1500),(1500,1820)]
test_start=1820; test_step=150
windows=[10,30,100,200]; leaks=[.25,.65]; rhos=[.60,.95]; alphas=[1.,10.,100.]
R=64; base=6./90.; gen=np.random.default_rng(SEED)
Win=(gen.standard_normal((90,R))*.20).astype(np.float32)
Wbase=gen.standard_normal((R,R)).astype(np.float32)
spectral=max(abs(np.linalg.eigvals(Wbase.astype('float64'))));Wbase/=spectral
bias=(gen.standard_normal(R)*.02).astype(np.float32)
print('DATA',T,dates[0],dates[-1],'test',dates[test_start],flush=True)

# Every target's window uses ONLY observations strictly BEFORE target.
def esn_features(w,leak,rho):
    wi=torch.as_tensor(Win)
    wr=torch.as_tensor(Wbase*rho)
    pr=torch.as_tensor(y)@wi+torch.as_tensor(bias)
    ids=torch.arange(w,T)
    state=torch.zeros((len(ids),R),dtype=torch.float32)
    with torch.no_grad():
        for j in range(w):
            z=pr[ids-w+j]+state@wr
            state=(1-leak)*state+leak*torch.tanh(z)
    a=np.zeros((T,R),dtype=np.float32)
    a[w:]=state.numpy()
    return a

def calib(raw, scale):
    """Transform readout deviations from uniform into marginal probabilities summing to 6."""
    if scale==0:return np.full(raw.shape,base,dtype=np.float64)
    z=(raw-base)*scale
    lower=np.full((len(z),1),-25.);upper=np.full((len(z),1),25.)
    for _ in range(25):
        mid=(lower+upper)/2
        lo=(expit(z+mid).sum(axis=1,keepdims=True)<6.)
        lower=np.where(lo,mid,lower);upper=np.where(lo,upper,mid)
    return np.clip(expit(z+(lower+upper)/2),1.e-9,1-1.e-9)

def hits_of(raw,target):
    # Stable deterministic tie-break ascending numbers; ranking always uses raw values.
    top=np.argsort(-raw,axis=1,kind='stable')[:,:6]
    return np.take_along_axis(target,top,axis=1).sum(axis=1).astype(np.int16),top

def log_loss(p, target):
    return float(np.mean(-target*np.log(p)-(1-target)*np.log1p(-p)))

def brier(p,target):return float(np.mean((p-target)**2))

# Cache folds' model scores for validation, choice of best is based ONLY on validation.
entries=[]; selected_by_window=[];t0=time.monotonic()
all_configs={}
with threadpool_limits(limits=2):
 for w in windows:
  for leak in leaks:
   for rho in rhos:
    F=esn_features(w,leak,rho)
    for alpha in alphas:
     rawfolds=[];ground=[]; foldscore=[]
     for a,b in folds:
      model=Ridge(alpha=alpha).fit(F[w:a],y[w:a])
      prediction=model.predict(F[a:b]);rawfolds.append(prediction);ground.append(y[a:b])
      hs,_=hits_of(prediction,y[a:b]);foldscore.append(float(hs.mean()))
     raw=np.vstack(rawfolds);target=np.vstack(ground);hit,_=hits_of(raw,target)
     key=f'w{w}_leak{leak}_rho{rho}_alpha{alpha}'
     entry={'window':w,'leak':leak,'spectral_radius':rho,'alpha':alpha,
            'validation_hits':float(hit.mean()),'validation_hit_total':int(hit.sum()),
            'validation_fold_hits':foldscore}
     entries.append(entry);all_configs[key]={'entry':entry,'raw':raw,'target':target,'features':F}
    print('FEATURE',w,leak,rho,'seconds',round(time.monotonic()-t0,1),flush=True)
  group=[(key,rec) for key,rec in all_configs.items() if rec['entry']['window']==w]
  # First optimize mean hits on 920 out-of-sample validation targets; tie-break parsimoniously.
  k,rec=sorted(group,key=lambda x:(-x[1]['entry']['validation_hits'],x[1]['entry']['alpha'],x[1]['entry']['spectral_radius'],x[1]['entry']['leak']))[0]
  best=rec['entry'].copy();best['key']=k
  # Independently calibrate probabilities using only validation data. p==uniform is allowed.
  scale_grid=[0.,2.,4.,8.,16.,32.]
  scorelist=[(log_loss(calib(rec['raw'],s),rec['target']),s) for s in scale_grid]
  vll,s=min(scorelist,key=lambda x:(x[0],x[1]))
  best.update(validation_logloss=vll,calibration_scale=s,validation_logloss_uniform=log_loss(np.full(rec['target'].shape,base),rec['target']))
  selected_by_window.append(best)
  print('BEST WINDOW',json.dumps(best),flush=True)

# Final window chosen by best validation hit rate (without seeing test data).
winner=sorted(selected_by_window,key=lambda e:(-e['validation_hits'],e['window']))[0]
print('WINNER',winner['key'],flush=True)

# Historical-frequency baseline hyperparameter selected using same rolling folds.
prior_strengths=[0.,50.,200.,1000.]
freqloss=[]
for strength in prior_strengths:
 scored=[]
 for a,b in folds:
  # At each validation draw, frequencies through the previous draw only.
  cum=np.cumsum(y,axis=0)
  prev=cum[a-1:b-1] # at date t prior count up to t-1
  n=np.arange(a,b)[:,None]
  probs=(prev+strength*base)/(n+strength)
  scored.append((probs,y[a:b]))
 p=np.vstack([i[0] for i in scored]); v=np.vstack([i[1] for i in scored]);freqloss.append((log_loss(p,v),strength))
_,freq_strength=min(freqloss)
print('FREQUENCY prior strength',freq_strength, 'validation',freqloss,flush=True)

# Test: incremental refit every 150 dates, only observations already revealed.
# Thus the last-year models may train on earlier test draws, not on future draws.
test_raw={w:[] for w in windows};test_p={w:[] for w in windows}
test_top={w:[] for w in windows};test_hits={w:[] for w in windows}
freq_probs=[];freq_top=[];freq_hits=[];blocks=[]
with threadpool_limits(limits=2):
 for a in range(test_start,T,test_step):
  b=min(a+test_step,T)
  for sel in selected_by_window:
   w=sel['window'];F=all_configs[sel['key']]['features']
   model=Ridge(alpha=sel['alpha']).fit(F[w:a],y[w:a])
   raw=model.predict(F[a:b]);pr=calib(raw,sel['calibration_scale'])
   h,top=hits_of(raw,y[a:b]);test_raw[w].append(raw);test_p[w].append(pr);test_top[w].append(top);test_hits[w].append(h)
  # Dynamic baseline with no future information, including within-test revealed outcomes.
  counts=np.cumsum(y,axis=0)[a-1:b-1]
  num=np.arange(a,b)[:,None]
  pp=(counts+freq_strength*base)/(num+freq_strength)
  hh,tt=hits_of(pp,y[a:b]);freq_probs.append(pp);freq_hits.append(hh);freq_top.append(tt)
  blocks.append({'start':int(a),'end_exclusive':int(b),'date_start':dates[a],'date_end':dates[b-1],'n':b-a})
  print('TEST BLOCK',a,b,'end',dates[b-1],flush=True)

for w in windows:
 test_raw[w]=np.vstack(test_raw[w]);test_p[w]=np.vstack(test_p[w]);test_top[w]=np.vstack(test_top[w]);test_hits[w]=np.concatenate(test_hits[w])
freq_probs=np.vstack(freq_probs);freq_top=np.vstack(freq_top);freq_hits=np.concatenate(freq_hits)
y_test=y[test_start:];nd=len(y_test)
uniform=np.full(y_test.shape,base,dtype=np.float64)
# Independent seeded random baseline and analytic expectation.
rng=np.random.default_rng(SEED+5)
random_idx=np.argpartition(rng.random(y_test.shape),kth=5,axis=1)[:,:6]
random_hits=np.take_along_axis(y_test,random_idx,axis=1).sum(axis=1)

rng=np.random.default_rng(SEED+20);B=2500;block=25
starts=rng.integers(0,nd,size=(B,int(np.ceil(nd/block))))
bi=(starts[:,:,None]+np.arange(block)[None,None,:])%nd
bi=bi.reshape(B,-1)[:,:nd]

def detail_metrics(h,p):
    hm=h.mean(); ll=log_loss(p,y_test)
    rowll=np.mean(-y_test*np.log(p)-(1-y_test)*np.log1p(-p),axis=1)
    rowuniform=np.mean(-y_test*np.log(uniform)-(1-y_test)*np.log1p(-uniform),axis=1)
    return {'mean_hits':float(hm),'total_hits':int(h.sum()),'hit0':float(np.mean(h==0)),
       'hit1':float(np.mean(h==1)),'hit2plus':float(np.mean(h>=2)),
       'logloss':ll,'brier':brier(p,y_test),
       'hit_mean_block_bootstrap_CI95':[float(i) for i in np.quantile(h[bi].mean(axis=1),[.025,.975])],
       'logloss_minus_uniform_CI95':[float(i) for i in np.quantile((rowll-rowuniform)[bi].mean(axis=1),[.025,.975])],
       'hit_rate_minus_uniform_expected':float(hm-.4),
       'null_theoretical_two_sided_p_approx':float(min(1,2*norm.sf(abs(h.sum()-nd*.4)/math.sqrt(nd*hypergeom.var(90,6,6)))))
       }

metrics={'Uniforme (probabilità)':detail_metrics(random_hits,uniform), 'Frequenza cumulativa':detail_metrics(freq_hits,freq_probs)}
for w in windows:metrics[f'ESN_{w}']=detail_metrics(test_hits[w],test_p[w])
# Paired resampling vs frequency for each depth.
for w in windows:
 delta=test_hits[w].astype(float)-freq_hits
 metrics[f'ESN_{w}']['difference_hits_mean_vs_frequencies']=float(delta.mean())
 metrics[f'ESN_{w}']['difference_hits_mean_vs_frequencies_CI95']=[float(k) for k in np.quantile(delta[bi].mean(axis=1),[.025,.975])]

# Segment-wise performance and reliability, with only the selected global model emphasized.
annual=[]
years=pd.to_datetime(dates[test_start:]).year
for yr in np.unique(years):
 idx=np.where(years==yr)[0]
 annual.append({'year':int(yr),'n':len(idx), 'uniform_expected':.4,
                'frequency_hits':float(freq_hits[idx].mean()),
                **{f'esn_{w}_hits':float(test_hits[w][idx].mean()) for w in windows}})

out=pd.DataFrame({'data':dates[test_start:],
 'vincente':[' '.join(map(str,np.flatnonzero(v)+1)) for v in y_test],
 'hits_casuale':random_hits.astype(int),
 'hits_frequenze':freq_hits.astype(int),
 'pred_frequenze':[' '.join(map(str,sorted(k+1))) for k in freq_top]})
for w in windows:
 out[f'hits_ESN_{w}']=test_hits[w]
 out[f'pred_ESN_{w}']=[' '.join(map(str,sorted(k+1))) for k in test_top[w]]
out.to_csv(P/'superenalotto_previsioni_test_v15.csv',index=False)
valtable=pd.DataFrame(entries).sort_values(['window','validation_hits'],ascending=[True,False])
valtable.to_csv(P/'superenalotto_validazione_reservoir_v15.csv',index=False)

# Graphic test performance, 95% block confidence intervals.
fig,ax=plt.subplots(figsize=(10.6,5.3))
names=['Frequenza cumulativa']+[f'ESN_{w}' for w in windows]
ybar=np.array([metrics[n]['mean_hits'] for n in names]);lo=np.array([metrics[n]['hit_mean_block_bootstrap_CI95'][0] for n in names]);hi=np.array([metrics[n]['hit_mean_block_bootstrap_CI95'][1] for n in names])
labels=['Frequenze']+[f'ESN {w}' for w in windows]
ax.bar(labels,ybar);ax.errorbar(labels,ybar,yerr=np.vstack([ybar-lo,hi-ybar]),fmt='none',color='black',capsize=5)
ax.axhline(.4,color='gray',linestyle='--',label='Atteso casuale 0,4')
ax.set_ylabel('Numeri corretti medi tra 6 proposti');ax.set_title('ESN su estrazioni dal 2009 — test cronologico progressivo')
ax.grid(axis='y',alpha=.22);ax.legend();fig.tight_layout();fig.savefig(P/'superenalotto_reservoir_memorie_v15.png',dpi=170);plt.close(fig)
fig,ax=plt.subplots(figsize=(10.6,5.2))
ax.plot([s['window'] for s in selected_by_window],[s['validation_hits'] for s in selected_by_window],marker='o',label='Validazione (selezione)')
ax.plot(windows,[metrics[f'ESN_{w}']['mean_hits'] for w in windows],marker='o',label='Test (valutazione)')
ax.axhline(.4,color='gray',linestyle='--',label='Atteso casuale 0,4')
ax.set_xticks(windows);ax.set(xlabel='Profondità di memoria (estrazioni)',ylabel='Numeri corretti medi',title='Finestra temporale — validazione e test')
ax.legend();ax.grid(alpha=.22);fig.tight_layout();fig.savefig(P/'superenalotto_reservoir_validazione_test_v15.png',dpi=170);plt.close(fig)

summary={'experiment':'v15_post_2009_expanding_origin_reservoir','seed':SEED,'n_total_2009_onward':T,'source_dates':[dates[0],dates[-1]],
 'train_min_window':200,'folds':[{'train_target_from':w,'train_target_end_exclusive':a,'val_from':a,'val_end_exclusive':b,'val_start_date':dates[a],'val_end_date':dates[b-1],'val_n':b-a} for a,b in folds for w in [200]],
 'test_start_index':test_start,'test_dates':[dates[test_start],dates[-1]],'test_n':nd,'test_incremental_refit_step':test_step,'test_blocks':blocks,
 'esn_units':R,'esn_input_scaling':.20,'esn_bias_scale':.02,'reservoir_seed':SEED,
 'windows':windows,'leaks':leaks,'spectral_radii':rhos,'ridge_alphas':alphas,
 'selection_metric':'validation mean top-6 hits, pooled over 3 expanding folds; ties regularized by alpha then rho then leak; top window from same metric',
 'calibration_scales':[0,2,4,8,16,32],'calibration_metric':'validation logloss on 920 heldout targets; rank from raw model regardless of scale',
 'selected_by_window':selected_by_window,'globally_selected':winner,'frequencies_pseudocount_strength':freq_strength,
 'frequency_validation_logloss_grid':[{'strength':v,'logloss':a} for a,v in freqloss],
 'metrics':metrics,'annual':annual,'uniform_theory':{'p_number':base,'expected_hits':.4,'hit_variance_per_draw':float(hypergeom.var(90,6,6))},
 'uncertainty':{'bootstrap_replicates':B,'circular_block_size':block,'null_p_is_approx_normal_hypergeom':True},
 'source_sha256':hashlib.sha256((P/'superenalotto_matrice_binaria_90_v13.csv').read_bytes()).hexdigest(),
 'no_future':'features past only; expanding folds train before each validation segment; test refit uses only rows dated before each test block'}
(P/'superenalotto_metriche_v15.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf8')
print('RESULTS',json.dumps({'chosen':winner,'metrics':metrics,'freq_strength':freq_strength,'split':(T,test_start,nd),'annual':annual},ensure_ascii=False),flush=True)
