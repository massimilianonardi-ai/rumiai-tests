#!/usr/bin/env python3
"""SuperEnalotto v19 — integration of F01–F14 with v18 autoregressive GRU.

The v18 neural weights are FROZEN; M2's 14 soft penalty coefficients are
learned on chronological validation ONLY. Evaluation is retrospective/exploratory:
fixed v03/v05 thresholds were chosen using the entire historical archive and
2021–2026 was inspected in previous experiments. A train-only fitted-threshold
sensitivity analysis is reported separately.

Run in same directory as its input files:
  OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v19.py
"""
from __future__ import annotations
from pathlib import Path
from math import comb, log
from datetime import datetime, timezone
import json, hashlib, zipfile, os, copy
import numpy as np
import pandas as pd
import torch
from torch import nn
from scipy.optimize import minimize
from scipy.special import logsumexp
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parent
SEED=20261122; N=90; K=6; W=100
REWARD=np.array([0.0,0.001,0.01,1.0,20.0,400.0,10000.0])
THEORY=np.array([comb(6,k)*comb(84,6-k)/comb(90,6) for k in range(7)])
NULL_LOGLOSS=log(comb(90,6))
FIXED_NUM=np.array([[1,36],[3,54],[10,68],[25,81],[38,87],[57,90]],dtype=int)
FIXED_DEL=np.array([[1,7],[1,13],[2,19],[4,28],[5,40],[7,69]],dtype=int)
NAMES=['F01','F02']+[f'F{x:02d}' for x in range(3,15)]
np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)

matrix=pd.read_csv(ROOT/'superenalotto_matrice_binaria_90_v13.csv',parse_dates=['data'])
matrix=matrix.sort_values(['data','concorso'],kind='stable').reset_index(drop=True)
full=pd.read_csv(ROOT/'estrazioni_con_ritardi.csv',sep=';',encoding='utf-8-sig',parse_dates=['data'])
full=full.sort_values(['data','concorso'],kind='stable').reset_index(drop=True)
assert np.array_equal(matrix.data.values,full.data.values)
full_sets=full[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=int)
assert len(full)==4294 and np.all(np.diff(full_sets,axis=1)>0)
mask_post=matrix.data>=pd.Timestamp('2009-07-01')
post=matrix.loc[mask_post].reset_index(drop=True)
post_full=full.loc[mask_post].reset_index(drop=True)
assert len(post)==2869
Y_binary=post[[f'n{i:02d}' for i in range(1,91)]].to_numpy('float32')
assert np.all(Y_binary.sum(axis=1)==6)
all_targets=np.array([np.flatnonzero(r) for r in Y_binary],dtype=np.int16)
indices=np.arange(W,len(post))
tr=indices[indices<1500]; val=indices[(indices>=1500)&(indices<1820)]; tst=indices[indices>=1820]
assert (len(tr),len(val),len(tst))==(1400,320,1049)
assert np.array_equal(all_targets+1,post_full[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=int))

# Historical pre-draw delays built using ALL available earlier records, never target or future.
last=np.full(91,-1,dtype=np.int32);pre_delays=np.full((len(full),91),9999,dtype=np.int32)
prior_sets=[];historical_set=set()
for i,s in enumerate(full_sets):
 for n in range(1,91):
  if last[n]>=0: pre_delays[i,n]=i-last[n]
 prior_sets.append(historical_set.copy()) if False else None
 for n in s:last[n]=i
post_to_full=np.flatnonzero(mask_post.to_numpy())
assert len(post_to_full)==len(post)

def interval95(v):
 x=np.sort(np.asarray(v,dtype=int));k=int(np.ceil(.95*len(x)))
 w=x[k-1:]-x[:len(x)-k+1];j=int(np.argmin(w))
 return [int(x[j]),int(x[j+k-1])]
# Calibrated BEFORE the first validation target (2019-01-31); no future-value leaks.
fit_num=np.array([interval95(post_full.loc[:1499,f'n{c}'].values) for c in range(1,7)])
fit_del=np.array([interval95(post_full.loc[:1499,f'ritardo_{c}'].dropna().values) for c in range(1,7)])
THRESHOLDS={'fissi_v06':(FIXED_NUM,FIXED_DEL),'prevalidazione':(fit_num,fit_del)}

# Autoregressive model architecture copied from v18 to LOAD the exact trained checkpoint.
H=32;EMB=16;STEP_EMB=8
base=np.full((K,N),-1e9,dtype=np.float32)
for step in range(K):
 for j in range(N):
  if 89-j>=K-1-step:base[step,j]=np.log(comb(89-j,K-1-step))
BASE=torch.tensor(base)
class ARSetGRU(nn.Module):
 def __init__(self,history=True):
  super().__init__();self.history=history
  self.rnn=nn.GRU(N,H,batch_first=True) if history else None
  self.token_emb=nn.Embedding(N,EMB)
  self.step_emb=nn.Embedding(K,STEP_EMB)
  self.head=nn.Sequential(nn.Linear(H+EMB+STEP_EMB,48),nn.Tanh(),nn.Linear(48,N))
 def context(self,x):
  return self.rnn(x)[1][-1] if self.history else torch.zeros(x.size(0),H,device=x.device,dtype=x.dtype)
 def conditional(self,ctx,previous_embedding,previous_value,step):
  se=self.step_emb.weight[step].expand(len(ctx),-1)
  correction=2.5*torch.tanh(self.head(torch.cat((ctx,previous_embedding,se),1))/2.5)
  logits=BASE[step].to(ctx.device)[None,:]+correction
  available=(torch.arange(N,device=ctx.device)[None,:]>previous_value[:,None]) & (torch.arange(N,device=ctx.device)[None,:]<=89-(K-1-step))
  return logits.masked_fill(~available,-1e9)

checkpoint=torch.load(ROOT/'superenalotto_ar_history_v18.pt',map_location='cpu',weights_only=False)
assert checkpoint['window']==100 and checkpoint['history'] is True
model=ARSetGRU(True);model.load_state_dict(checkpoint['state_dict']);model.eval()

@torch.no_grad()
def propose(target_indices,seed,n_per_case=512,batch_size=24):
 """Generate exactly n_per_case valid unordered six-number sets from v18 autoregressive P."""
 rng=torch.Generator().manual_seed(seed)
 out=np.empty((len(target_indices),n_per_case,6),dtype=np.int16)
 for ia in range(0,len(target_indices),batch_size):
  t=target_indices[ia:ia+batch_size]
  # Inputs contain ONLY t-100,...,t-1, even when evaluating test observations.
  window=np.stack([Y_binary[x-W:x] for x in t],axis=0)
  ctx=model.context(torch.from_numpy(window))
  repeated=ctx.repeat_interleave(n_per_case,0)
  B=len(repeated);prefix=torch.zeros((B,EMB));prev=torch.full((B,),-1,dtype=torch.long)
  chosen=[]
  for step in range(K):
   lg=model.conditional(repeated,prefix,prev,step)
   j=torch.multinomial(torch.softmax(lg,dim=1),num_samples=1,generator=rng).squeeze(1)
   chosen.append(j);prefix+=model.token_emb(j);prev=j
  sets=torch.stack(chosen,axis=1).reshape(len(t),n_per_case,K).numpy().astype(np.int16)
  assert np.all((sets>=0)&(sets<90)) and np.all(np.diff(sets,axis=2)>0)
  out[ia:ia+len(t)]=sets
  if ia and ia%(batch_size*8)==0:print('sampled',min(ia+batch_size,len(target_indices)),'/',len(target_indices),flush=True)
 return out

# For historical membership, create snapshot of previous sets only at validation/test points.
historical_sets=[]
prevset=set()
target_global=np.concatenate((val,tst))
points=sorted(set(post_to_full[target_global].tolist()))
pointset=set(points);prior_map={}
for row,s in enumerate(full_sets):
 if row in pointset:prior_map[row]=prevset.copy()
 prevset.add(tuple(int(v) for v in s))
assert len(prior_map)==len(points)

def filter_pass(sets,t,num_bounds,del_bounds,include_repeats=True):
 """Full 14-filter truth vector on candidates of shape (m,6) (1-based comparisons)."""
 sets=np.asarray(sets,dtype=np.int16)
 assert sets.ndim==2 and sets.shape[1]==6
 row=post_to_full[t]
 ns=sets+1
 ds=pre_delays[row,ns]
 sorted_ds=np.sort(ds,axis=1)
 f=np.ones((len(sets),14),dtype=np.bool_)
 maximum=ds.max(axis=1)
 f[:,0]=(8<=maximum)&(maximum<=81)
 if include_repeats:
  prev=prior_map.get(row)
  if prev is None:
   # applicable only to validation/test rows (else build per-row history here).
   prev={tuple(x) for x in full_sets[:row]}
  f[:,1]=[tuple(int(z) for z in s) not in prev for s in ns]
 for i in range(6):
  f[:,2+i]=(num_bounds[i,0]<=ns[:,i])&(ns[:,i]<=num_bounds[i,1])
  f[:,8+i]=(del_bounds[i,0]<=sorted_ds[:,i])&(sorted_ds[:,i]<=del_bounds[i,1])
 return f

# Fixed thresholds vs exact old v06 backtest validate filter interpretation.
previous_backtest=pd.read_csv(ROOT/'superenalotto_filtri_ritardi_dettaglio_v06.csv')
backtest_index=previous_backtest.set_index('date')
for t in np.concatenate([val[:6],tst[:6]]):
 nums=all_targets[t][None,:]
 got=bool(filter_pass(nums,int(t),FIXED_NUM,FIXED_DEL).all())
 date=post.loc[t,'data'].strftime('%Y-%m-%d')
 assert got==bool(backtest_index.loc[date,'cumulative_F14_hit']),(date,got)

# Generate once, reuse identical base-model proposals for all 3 strategies, both threshold systems.
print('Sampling 512 proposals per 320 validation examples ...',flush=True)
val_proposals=propose(val,SEED+1,512)
print('Sampling 512 proposals per 1049 test examples ...',flush=True)
tst_proposals=propose(tst,SEED+2,512)


def prepare_flags(rows,sets,num_bounds,del_bounds):
 flags=np.zeros((len(rows),sets.shape[1],14),dtype=np.bool_)
 target=np.zeros((len(rows),14),dtype=np.bool_)
 for i,t in enumerate(rows):
  flags[i]=filter_pass(sets[i],int(t),num_bounds,del_bounds)
  target[i]=filter_pass(all_targets[t][None,:],int(t),num_bounds,del_bounds)[0]
 return ~flags,~target

def fit_penalties(vi,yt,regularizer=.02):
 """Calibrate nonnegative 14 penalties through MC likelihood, validation-only.
 Conditional Q_lambda(S) = P_v18(S) exp(-lambda·fail(S)) / E_P[exp(-lambda·fail)].
 Base neural parameters are unchanged; 14 regularized calibration parameters fitted.
 """
 x=vi.astype(np.float64);true=yt.astype(np.float64)
 def objective(lam):
  score=-np.einsum('nsi,i->ns',x,lam)
  log_norm=logsumexp(score,axis=1)-np.log(score.shape[1])
  posterior=np.exp(score-logsumexp(score,axis=1)[:,None])
  expected=np.einsum('ns,nsi->ni',posterior,x)
  gain=float((true@lam+log_norm).mean()+regularizer*np.dot(lam,lam))
  grad=(true-expected).mean(axis=0)+2*regularizer*lam
  return gain,grad
 res=minimize(objective,np.zeros(14),method='L-BFGS-B',jac=True,bounds=[(0.,4.)]*14,
             options={'maxiter':150,'ftol':1e-12,'gtol':1e-9})
 lam=np.clip(res.x,0,4)
 return lam,{'success':bool(res.success),'message':res.message,'validation_objective':float(res.fun),
             'iterations':int(res.nit),'regularization':regularizer,
             'validation_nll_delta_vs_AR_MC':float(np.mean(true@lam+logsumexp(-np.einsum('nsi,i->ns',x,lam),axis=1)-np.log(x.shape[1])))}

def select_tickets(rows,sets,fails,coeff,seed):
 """M0: top6 AR marginal; M1: maximize marginal-match score over feasible proposals;
 M2: top6 soft-tilted marginal. A sample is from v18 P; rejection gives exact
 draws from P conditioned on all deterministic constraints.
 """
 rng=np.random.default_rng(seed)
 n,s,_=sets.shape
 mout=np.zeros((n,6),np.int16); soft=np.zeros((n,6),np.int16);base=np.zeros((n,6),np.int16)
 random_uniform=np.zeros((n,6),np.int16)
 valid_proposal_rate=[];lognorm=[];valid_tickets=[]
 for i,t in enumerate(rows):
  candidates=sets[i];v=~fails[i].any(axis=1)
  valid_proposal_rate.append(float(v.mean()))
  # When zero accepted samples, draw more from P with a reproducible seed rather than break constraints.
  if not np.any(v):
   raise RuntimeError(f'No feasible AR sample at date={post.loc[t,"data"]}; increase MC pool.')
  bare=np.bincount(candidates.ravel(),minlength=N)/s
  base[i]=np.argsort(-bare,kind='stable')[:6]
  weights=np.exp(-(fails[i]@coeff))
  lognorm.append(float(np.log(weights.mean())))
  wt=weights/weights.sum()
  soft_marg=np.bincount(candidates.ravel(),weights=np.repeat(wt,6),minlength=N)
  soft[i]=np.argsort(-soft_marg,kind='stable')[:6]
  hard_marg=np.bincount(candidates[v].ravel(),minlength=N)/int(v.sum())
  eligible_candidates=candidates[v]
  scores=hard_marg[eligible_candidates].sum(axis=1)
  best=np.flatnonzero(np.isclose(scores,scores.max(),atol=1e-12))
  mout[i]=eligible_candidates[int(rng.choice(best))]
  # Baseline uniform on allowed sets, via genuine uniform 6-of-90 rejection sampling.
  nb,db=current_thresholds
  for _ in range(20000):
   proposed=np.sort(rng.choice(90,6,replace=False).astype(np.int16))
   if filter_pass(proposed[None,:],int(t),nb,db).all():
    random_uniform[i]=proposed
    break
  else:raise RuntimeError('Uniform constrained rejection did not terminate')
  assert filter_pass(mout[i][None,:],int(t),nb,db).all()
  assert filter_pass(random_uniform[i][None,:],int(t),nb,db).all()
 return {'M0_ricalcolato':base,'M1_rigido':mout,'M2_soft':soft,'Casuale_vincolato':random_uniform},np.array(valid_proposal_rate),np.array(lognorm)

def hitcount(pred,actual):
 return (pred[:,:,None]==actual[:,None,:]).any(axis=2).sum(axis=1)
def statistic(pred,actual):
 hits=hitcount(pred,actual)
 c=np.bincount(hits,minlength=7)
 return {'mean_hits':float(hits.mean()),'total_hits':int(hits.sum()),
         'hist_hits':c.tolist(),'at_least_three':int((hits>=3).sum()),
         'at_least_four':int((hits>=4).sum()),'at_least_five':int((hits>=5).sum()),
         'six':int(c[6]),'mean_score':float(REWARD[hits].mean())},hits

def ci_paired(v,seed,niter=2000):
 rng=np.random.default_rng(seed);ix=rng.integers(0,len(v),(niter,len(v)))
 return np.quantile(np.asarray(v)[ix].mean(axis=1),[.025,.975]).tolist()

results={};all_predictions={};individual_stats=[]
for name,(nb,db) in THRESHOLDS.items():
 print('Evaluate filter regime',name,flush=True)
 vf,vy=prepare_flags(val,val_proposals,nb,db)
 tf,ty=prepare_flags(tst,tst_proposals,nb,db)
 coeff,fitinfo=fit_penalties(vf,vy,regularizer=.02)
 current_thresholds=(nb,db)
 tickets,accept,lognorm=select_tickets(tst,tst_proposals,tf,coeff,SEED+(30 if name=='fissi_v06' else 40))
 # Conditional hard model assigns zero likelihood to invalid targets -> mean NLL infinite.
 # M2 uses MC log-normalizer; nll for full data = AR nll + lambda·violation + log Z.
 old=pd.read_csv(ROOT/'superenalotto_previsioni_test_v18.csv')
 assert np.array_equal(old.data.to_numpy(),post.loc[tst,'data'].dt.strftime('%Y-%m-%d').to_numpy())
 original_nll=old['ar_history_nll'].to_numpy(float)
 soft_nll=original_nll+ty@coeff+lognorm
 valid_actual=~ty.any(axis=1)
 v06_valid=previous_backtest.set_index('date').loc[old.data,'cumulative_F14_hit'].to_numpy(bool)
 if name=='fissi_v06':assert np.array_equal(valid_actual,v06_valid)
 per_model={};per_hit={}
 for label,pred in tickets.items():
  m,h=statistic(pred,all_targets[tst]);per_model[label]=m;per_hit[label]=h
 # compare exact source v18 M0 predictions
 previous_m0=old['ar_history_hits'].to_numpy(int)
 exactshare=backtest_index.loc[old.data,'cumulative_F14_count'].to_numpy(float)/comb(90,6)
 results[name]={'num_ranges':nb.tolist(),'delay_ranges':db.tolist(),
      'validation':{'size':int(len(val)),'true_eligibility':float((~vy.any(1)).mean()),
                    'model_eligible_proposal_share':float((~vf.any(2)).mean()),
                    'fitted_penalties':dict(zip(NAMES,np.round(coeff,8).tolist())),**fitinfo},
      'test':{'size':int(len(tst)),'true_eligible_count':int(valid_actual.sum()),'true_eligibility':float(valid_actual.mean()),
              'neural_proposal_acceptance_mean':float(accept.mean()),
              'neural_proposal_acceptance_min':float(accept.min()),
              'soft_nll_mc_mean':float(soft_nll.mean()),
              'soft_delta_nll_mc_minus_v18':float((soft_nll-original_nll).mean()),
              'm1_hard_mean_nll':None,'m1_hard_mean_nll_explanation':'Infinite due to excluded actual winners; conditional probability zero.',
              'uniform_eligibility_exact_from_v06_mean':float(exactshare.mean()) if name=='fissi_v06' else None,
              'models':per_model,
              'm0_reference_v18':{'mean_hits':float(previous_m0.mean()),'sum_hits':int(previous_m0.sum())},
              'paired_bootstrap_M1_minus_M0':ci_paired(per_hit['M1_rigido']-previous_m0,SEED+61),
              'paired_bootstrap_M2_minus_M0':ci_paired(per_hit['M2_soft']-previous_m0,SEED+62),
             }}
 # vectorized all filter failure rates on REAL winning sets, per test and pre-valid validation
 for j,k in enumerate(NAMES):
  individual_stats.append({'regime':name,'filtro':k,
                           'coefficient_lambda_nonnegative':coeff[j],
                           'valid_pass_rate':float(1-vy[:,j].mean()),
                           'test_pass_rate':float(1-ty[:,j].mean()),
                           'proposals_test_pass_rate':float(1-tf[:,:,j].mean())})
 for label,arr in tickets.items():
  assert np.all(np.diff(np.sort(arr,axis=1),axis=1)>0)
 all_predictions[name]=(tickets,per_hit,accept,soft_nll,valid_actual)
 print('done',name,'eligibility',int(valid_actual.sum()),'/',len(tst),'penalties',np.round(coeff,3),flush=True)
 print('models',[(k,round(v['mean_hits'],4),v['at_least_three']) for k,v in per_model.items()],flush=True)

fout=pd.DataFrame({'data':post.loc[tst,'data'].dt.strftime('%Y-%m-%d').to_numpy(),
                   'concorso':post.loc[tst,'concorso'].to_numpy(),
                   'vincente':[' '.join(map(str,s+1)) for s in all_targets[tst]],
                   'M0_v18_ticket':old.ar_history_ticket.to_numpy(),
                   'M0_v18_hits':old.ar_history_hits.to_numpy(int),
                   'M0_v18_nll':old.ar_history_nll.to_numpy(float)})
for name,(tickets,hits,accept,nll,eligible) in all_predictions.items():
 tag='fissi' if name=='fissi_v06' else 'preval'
 fout[f'{tag}_vincente_ammessa']=eligible.astype(int)
 fout[f'{tag}_accettazione_neurale']=accept
 fout[f'{tag}_M2_nll_MC']=nll
 for label,t in tickets.items():
  slug={'M0_ricalcolato':'M0','M1_rigido':'M1','M2_soft':'M2','Casuale_vincolato':'CasualeConFiltri'}[label]
  fout[f'{tag}_{slug}_ticket']=[' '.join(map(str,np.sort(s+1))) for s in t]
  fout[f'{tag}_{slug}_hits']=hits[label]
  fout[f'{tag}_{slug}_score']=REWARD[hits[label]]
fout.to_csv(ROOT/'superenalotto_previsioni_test_v19.csv',index=False)
pd.DataFrame(individual_stats).to_csv(ROOT/'superenalotto_calibrazione_filtri_v19.csv',index=False)

# Comparisons. The explicit v18 baseline is primary M0 reference and M1/M2 share same neural source.
fig,ax=plt.subplots(figsize=(11.6,5.5))
labels=['M0 v18','Casuale con F','M1 vincolato','M2 soft']
colors=['#64748b','#94a3b8','#2563eb','#d97706']
ref=old.ar_history_hits.to_numpy(int)
for i,lab in enumerate(labels):
 if i==0:h=ref
 else:
  h=all_predictions['fissi_v06'][1][{'Casuale con F':'Casuale_vincolato','M1 vincolato':'M1_rigido','M2 soft':'M2_soft'}[lab]]
 center=float(h.mean());bounds=ci_paired(h,SEED+110+i,1500)
 ax.bar(i,center,color=colors[i],width=.63,label=lab)
 ax.errorbar(i,center,yerr=[[center-bounds[0]],[bounds[1]-center]],fmt='none',color='#0f172a',capsize=4)
ax.axhline(.4,color='#dc2626',ls='--',lw=1.5,label='Uniforme teorico (0,4)')
ax.set_xticks(range(len(labels)),labels);ax.set_ylabel('Numeri corretti in media per sestina')
ax.set_title('Esperimento v19: modelli e filtri originali F01–F14')
ax.set_ylim(0,.56);ax.grid(axis='y',alpha=.2);ax.legend(loc='upper right');fig.tight_layout()
fig.savefig(ROOT/'superenalotto_confronto_ibrido_v19.png',dpi=160);plt.close(fig)

out={'experiment':'v19 — Hybrid v18 AR distribution + exact hard constraints or validation-trained penalties',
     'created_utc':datetime.now(timezone.utc).isoformat(),
     'code_seed':SEED,'data_sha256':hashlib.sha256((ROOT/'estrazioni_con_ritardi.csv').read_bytes()).hexdigest(),
     'baseline_weights_sha256':hashlib.sha256((ROOT/'superenalotto_ar_history_v18.pt').read_bytes()).hexdigest(),
     'sampled_candidates_validation':512,'sampled_candidates_test':512,
     'dataset':{'total_draws':4294,'post_2009_draws':2869,'history_window':100,
                'train_examples':1400,'validation_examples':320,'test_examples':1049,
                'train_last':post.loc[1499,'data'].strftime('%Y-%m-%d'),
                'validation_first':post.loc[1500,'data'].strftime('%Y-%m-%d'),
                'test_first':post.loc[1820,'data'].strftime('%Y-%m-%d'),
                'test_last':post.loc[tst[-1],'data'].strftime('%Y-%m-%d')},
     'reward':REWARD.tolist(),
     'theory':{'combinations':comb(90,6),'random_avg_hits':0.4,'expected_3plus_per_1049':float(THEORY[3:].sum()*1049),
               'uniform_nll':NULL_LOGLOSS,'random_expected_score':float(THEORY@REWARD)},
     'method':{'M0':'Frozen v18 autoregressive model. Published v18 top-6 marginal decision is the primary M0 reference.',
               'M1':'Rejection sampling from frozen v18 P; accepted draws are an exact sample from P conditioned on F01–F14. Ticket maximizing estimated sum of constrained inclusion probabilities among feasible sampled candidates.',
               'M2':'P_lambda(S) ∝ P_v18(S)*exp(-sum_j lambda_j*1[fails_j]); each lambda fitted >=0 on validation set penalized conditional log-likelihood; normalizer estimated via Monte Carlo.',
               'random_constrained':'Uniform sample of 6 distinct numbers, rejected until all filters pass.',
               'thresholds_fixed':'Original v03/v05 thresholds, selected retrospectively using ALL 4294 historical draws; contaminated for 2021–2026 evaluation.',
               'thresholds_prevalidation':'95% shortest integer intervals fitted to first 1,500 post-2009 draws ending 2019-01-29; frozen for validation and test.',
               'candidate_sampling':'512 Monte Carlo sets each date for validation/test; no gradients or neural retraining. 14 soft coefficients only are trained using validation.',
               'utility':'Recorded ex post and NOT tuned on test; 3+ are rare so cannot rely on reward alone.'},
     'regimes':results,
     'warnings':['Historical F03–F14 fixed thresholds contain information from 2021–2026; results with them are descriptive, not leak-free.',
                 'The neural checkpoint v18 and prior model choices were informed by repeated inspection of the 2021–2026 test. This test is not fresh.',
                 'NLL normalization for soft model is a finite-Monte-Carlo estimate, not exact. Averaged differences near MC error should not be interpreted.',
                 'Hard conditioning assigns zero probability to targets failing any filter, making full-sequence proper NLL infinite.',
                 'Model candidate ticket maximizes expected overlap approximately, not the rare-prize reward R(k) exactly.',
                 'Without a precommitted, future test there is no evidence of improvement at lottery prediction.']}
(ROOT/'superenalotto_metriche_v19.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')

# CUMULATIVE Markdown: append to v18, preserving all previous version bodies without summaries omitted.
prior=(ROOT/'superenalotto_analisi_filtri_v18.md').read_text(encoding='utf8')
prior=prior.replace('(v18)','(v19)',1)
report='''\n\n---\n\n## Esperimento v19 — Generatore autoregressivo con 14 filtri deterministici (rigidi e morbidi)\n\n### Obiettivo e principio di confronto\nIntegrare F01–F14 nella distribuzione autoregressiva v18 sulle **sestine non ordinate di sei numeri distinti**. La rete GRU con contesto 100×90 è recuperata senza ulteriore addestramento dal checkpoint `superenalotto_ar_history_v18.pt`. Il confronto comprende:\n\n- **M0**: generatore v18 libero, proposta pubblicata in v18 (sei probabilità marginali di inclusione più alte). Per diagnostica si ricalcolano anche proposte M0 da un nuovo campione Monte Carlo condiviso con M1/M2.\n- **M1**: generatore vincolato duro. Si estraggono sestine dalla distribuzione esatta v18, rifiutando quelle che violano almeno un filtro; un campione così accettato proviene **esattamente** da `P_v18(S | F01...F14)`. Tra i candidati validi campionati si sceglie quello con la maggior somma delle probabilità marginali condizionate stimate dai campioni. Ogni proposta M1 rispetta necessariamente tutti i filtri. **Non è stato implementato un mascheramento a ogni token con controllo completo della fattibilità: si usa rigetto di sestine complete, equivalente come distribuzione condizionata ma non come algoritmo operativo.**\n- **M2**: generatore ibrido non vincolato, con 14 penalità apprese. `Q_lambda(S)=P_v18(S) exp[-Σ_{j=1}^{14} λ_j 1(F_j fallisce)] / Z_t(λ)`, con `λ_j≥0`. I 14 coefficienti sono calibrati **solo sulla validazione cronologica**, minimizzando la log-loss con regolarizzazione `0,02 Σ λ_j²` e normalizzazione Monte Carlo. La proposta M2 è la sestina dei sei maggiori margini d'inclusione stimati dalla distribuzione ripesata.\n- **Casuale vincolato**: sestina uniforme casuale 6-su-90 ottenuta con rigetto dei candidati che non passano F01–F14. È il riferimento appropriato per M1.\n\n**Non** è stato riaddestrato l'encoder sulla funzione di premio: i punteggi `R=[0, 0.001, 0.01, 1, 20, 400, 10000]` vengono valutati a posteriori. È intenzionale: la log-loss della sestina è una metrica propria, mentre il punteggio rarefatto per 4–6 corretti può essere sfruttato solo con enormi campioni o una valutazione fuori campione lunga.\n\n### Campione, fonti dei vincoli, rischio di leakage\nLa divisione temporale è **identica a v18**: 1.400 esempi per l'addestramento del generatore (già compiuto), 320 per calibrazione delle penalità e 1.049 per confronto; finestra 100. La calibrazione è separata dal test, ma **il test 2021–2026 è già stato ripetutamente usato per progettare gli esperimenti precedenti**, dunque l'intera analisi è *esplorativa*. I ritardi di ciascun numero e l'insieme delle sestine già estratte sono calcolati **prima** della sestina target, sulla storia completa disponibile fino a quel momento.\n\nConsideriamo **due regimi paralleli**:\n\n1. **Filtri fissi originali** — F01–F14 esattamente con gli intervalli delle versioni v03/v05/v06. Tuttavia F03–F14 sono stati stimati sull'intero archivio storico, **incluso il periodo di test**: perciò questo confronto non è una verifica priva di leakage.\n2. **Filtri ricalibrati prima della validazione** — stesso significato dei 14 vincoli, ma gli intervalli minimi al 95% delle sei posizioni numeriche e dei sei ritardi ordinati sono stimati solo sulle **1.500 estrazioni post-2009 anteriori al 31/01/2019**, poi congelati per validazione e test. È una sensibilità più corretta rispetto alla stima retrospettiva dei limiti, pur rimanendo l'intera indagine esplorativa per la riutilizzazione del test e del modello v18.\n\n| Filtro | Intervalli originali | Intervalli ricalibrati prima della validazione |\n|---|---|---|\n'''
for j in range(14):
 if j==0: oldrange='8–81 (massimo ritardo)';new=oldrange
 elif j==1:oldrange='Sestina non già uscita';new=oldrange
 elif 2<=j<8:
  k=j-2; oldrange=f'{FIXED_NUM[k,0]}–{FIXED_NUM[k,1]}';new=f'{fit_num[k,0]}–{fit_num[k,1]}'
 else:
  k=j-8;oldrange=f'{FIXED_DEL[k,0]}–{FIXED_DEL[k,1]}';new=f'{fit_del[k,0]}–{fit_del[k,1]}'
 report+=f'| {NAMES[j]} | {oldrange} | {new} |\n'
report+='''\n\n### Protocollo numerico\n- Ciascuna estrazione di test produce **512 campioni autoregressivi** con seed fisso; anche la validazione usa 512 campioni per estrazione. Il campione base è condiviso tra le varianti; nella baseline vincolata si usa invece un campionamento uniforme 6-su-90 con rigetto.\n- Per la M1 la normalizzazione esatta del modello condizionato **non** viene enumerata; l'accettazione della distribuzione per rigetto è matematicamente esatta, mentre le marginali usate per decidere la sestina sono approssimate da Monte Carlo.\n- Per la M2 la normalizzazione `Z_t` e la NLL sono **stime Monte Carlo**. Errori della normalizzazione di piccola entità sono possibili.\n- M1 attribuisce probabilità **zero** a una vincente che violi uno qualsiasi dei filtri, quindi la NLL media sui bersagli completi è **infinita** quando vi siano violazioni. Non si deve presentare soltanto la NLL condizionata alle vincitrici ammesse: sarebbe una selezione a posteriori.\n- Si registrano numeri corretti medi, frequenza dei casi 3+, punteggio ponderato e proporzioni ammesse. La distribuzione casuale teorica prevede 0,4 numeri corretti medi per un biglietto casuale e circa 3,30 casi 3+ in 1.049 estrazioni.\n\n### Risultati sul test cronologico (1.049 estrazioni; confronto esplorativo)\n'''
for regime,data in results.items():
 t=data['test'];v=data['validation'];comp= 'Originali F01–F14' if regime=='fissi_v06' else 'Ricalibrati pre-validazione'
 report+=f'\n#### {comp}\n'
 report+=f"- Vincenti che rispettano tutti i filtri: **{t['true_eligible_count']}/1049 ({100*t['true_eligibility']:.2f}%)**.\n"
 report+=f"- Frazione dei campioni v18 ammessi dai filtri: **{100*t['neural_proposal_acceptance_mean']:.2f}%** in media; minima **{100*t['neural_proposal_acceptance_min']:.2f}%**.\n"
 if t['uniform_eligibility_exact_from_v06_mean'] is not None:
  report+=f"- Quota media esatta di tutte le 622.614.630 sestine ammesse, dal contatore combinatorio v06: **{100*t['uniform_eligibility_exact_from_v06_mean']:.2f}%**.\n"
 report+=f"- Penalità non nulle dopo validazione: **{sum(x>1e-6 for x in v['fitted_penalties'].values())}** su 14; differenza media di NLL M2−M0 (approssimata): **{t['soft_delta_nll_mc_minus_v18']:+.6f}**.\n\n"
 report+='| Modello | Numeri corretti medi | Totale | Casi 3+ | Casi 4+ | Punteggio medio R |\n|---|---:|---:|---:|---:|---:|\n'
 m=t['m0_reference_v18'];report+=f"| **M0 v18 (riferimento)** | {m['mean_hits']:.4f} | {m['sum_hits']} | {int((old['ar_history_hits']>=3).sum())} | {int((old['ar_history_hits']>=4).sum())} | {old['ar_history_reward'].mean():.6f} |\n"
 for label in ['M0_ricalcolato','Casuale_vincolato','M1_rigido','M2_soft']:
  m=t['models'][label];report+=f"| {label} | {m['mean_hits']:.4f} | {m['total_hits']} | {m['at_least_three']} | {m['at_least_four']} | {m['mean_score']:.6f} |\n"
 a=t['paired_bootstrap_M1_minus_M0'];b=t['paired_bootstrap_M2_minus_M0']
 report+=f'\nIC bootstrap appaiato 95% sulla differenza dei numeri corretti medi vs M0 v18: M1 **[{a[0]:+.4f}, {a[1]:+.4f}]**, M2 **[{b[0]:+.4f}, {b[1]:+.4f}]**.\n'
 report+='\nCoefficienti appresi con la sola validazione (zero = nessuna penalizzazione):\n\n'
 report+='| Filtro | λ | Tasso passaggio vincente, validazione | Tasso passaggio vincente, test |\n|---|---:|---:|---:|\n'
 for row in individual_stats:
  if row['regime']==regime:
   report+=f"| {row['filtro']} | {row['coefficient_lambda_nonnegative']:.5f} | {100*row['valid_pass_rate']:.2f}% | {100*row['test_pass_rate']:.2f}% |\n"
 report+='\n'
report+='''\n### Interpretazione e limiti\n- Una regola deterministica di selezione non è una legge del generatore. Vincolare duramente ai 14 filtri esclude a priori una parte reale delle sestine vincenti. Il confronto prioritario di M1 è con una baseline casuale assoggettata agli stessi vincoli.\n- Se le λ della M2 tendono a zero, la validazione **non** giustifica di penalizzare quei filtri: si tratta di un risultato scientificamente utile, non di un difetto del modello.\n- I risultati da una singola griglia di 1.049 sestine non certificano miglioramenti nei rarissimi eventi 4, 5 e 6. Anche le differenze nei casi 3+ sono estremamente rumorose.\n- Due limiti distinti: (1) intervalli originali F03–F14 stimati retrospettivamente usando il futuro; (2) periodo 2021–2026 già più volte ispezionato durante lo sviluppo dei modelli. Il regime pre-validazione corregge (1) soltanto, non (2). Per un test realmente nuovo, fissare modello e iperparametri prima di nuove estrazioni.\n- Il modello fisico di estrazione non è identificato da questi risultati: le reti descrivono distribuzioni di sestine, non lo stato delle sfere o della macchina.\n\n### Riproducibilità e artefatti v19\n- `compute_v19.py`: carica il checkpoint v18, campiona e verifica la validità delle sestine, ottimizza 14 λ su sola validazione, genera le tabelle/grafici; seed fissati.\n- `superenalotto_previsioni_test_v19.csv`: una riga per estrazione con target, tutte le proposte, hit, score, accettazione e NLL stimata.\n- `superenalotto_calibrazione_filtri_v19.csv`: penalità, frequenze di passaggio delle singole regole, confronto validazione/test.\n- `superenalotto_metriche_v19.json`: limiti, impostazioni, numeri e avvertenze in formato strutturato.\n- `superenalotto_confronto_ibrido_v19.png`: confronto visivo M0, M1, M2 e baseline vincolata.\n- `superenalotto_esperimento_v19_bundle.zip`: archivio autonomo con input, checkpoint congelato, codice, documentazione e risultati.\n\n### Registro delle versioni\n- **v19**: integrazione dei filtri deterministici F01–F14 nel generatore autoregressivo v18 con condizionamento rigido e 14 penalità morbide regolarizzate; confronto su filtri originali e limiti preregistrati prima della validazione; distinzione fra descrizione retrospettiva e test indipendente.\n'''
(ROOT/'superenalotto_analisi_filtri_v19.md').write_text(prior+report,encoding='utf8')
(ROOT/'README_superenalotto_v19.txt').write_text('''Esperimento 19 — filtri deterministici 14 nel generatore autoregressivo\nRequisiti: Python 3.10+, numpy, pandas, scipy, torch, matplotlib.\nEsecuzione: OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v19.py\nInput necessari: estrazioni_con_ritardi.csv, superenalotto_matrice_binaria_90_v13.csv, superenalotto_ar_history_v18.pt, superenalotto_previsioni_test_v18.csv, superenalotto_filtri_ritardi_dettaglio_v06.csv, superenalotto_analisi_filtri_v18.md.\nI test 2021-2026 sono esplorativi; i filtri originari contengono leakage perché i range furono stimati sull'archivio completo.\n''',encoding='utf8')
files=['README_superenalotto_v19.txt','compute_v19.py','estrazioni_con_ritardi.csv','superenalotto_matrice_binaria_90_v13.csv',
       'superenalotto_ar_history_v18.pt','superenalotto_previsioni_test_v18.csv','superenalotto_filtri_ritardi_dettaglio_v06.csv',
       'superenalotto_analisi_filtri_v18.md','superenalotto_analisi_filtri_v19.md',
       'superenalotto_previsioni_test_v19.csv','superenalotto_calibrazione_filtri_v19.csv',
       'superenalotto_metriche_v19.json','superenalotto_confronto_ibrido_v19.png']
with zipfile.ZipFile(ROOT/'superenalotto_esperimento_v19_bundle.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
 for f in files:z.write(ROOT/f,arcname=f)
print('FINISHED all artifacts saved. Report appended',len(report),'chars',flush=True)
