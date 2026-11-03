#!/usr/bin/env python3
"""SuperEnalotto v18: autoregressive exact set likelihood (canonical increasing order), 100×90 context.
Reproducible, held-out chronological validation/test; result remains exploratory due to reuse of 2021–2026 test.
Run: OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v18.py
"""
from pathlib import Path
from math import comb, log
from datetime import datetime, timezone
import copy, hashlib, json, random, time, zipfile
import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

P=Path(__file__).resolve().parent
SEED=20261103+18
N=90; K=6; W=100; H=32; EMB=16; STEP_EMB=8; NSAMPLES=256
REWARD=np.array([0.,.001,.01,1.,20.,400.,10000.]); THEORY=np.array([comb(6,k)*comb(84,6-k)/comb(90,6) for k in range(7)])
REWARD_NULL=float(THEORY@REWARD)
random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)
raw=pd.read_csv(P/'superenalotto_matrice_binaria_90_v13.csv',parse_dates=['data'])
raw=raw.sort_values('data',kind='stable').reset_index(drop=True)
raw=raw.loc[raw.data>=pd.Timestamp('2009-07-01')].reset_index(drop=True)
y=raw[[f'n{i:02d}' for i in range(1,91)]].to_numpy(np.float32)
assert y.shape==(2869,90) and np.all(y.sum(1)==6)
ids=np.arange(W,len(y))
X=np.stack([y[t-W:t] for t in ids]).astype('float32')
win=y[ids]
Y=np.array([np.flatnonzero(v) for v in win],dtype=np.int64)
assert Y.shape==(len(ids),6) and np.all(np.diff(Y,axis=1)>0)
tr=ids<1500;va=(ids>=1500)&(ids<1820);te=ids>=1820
assert [int(tr.sum()),int(va.sum()),int(te.sum())]==[1400,320,1049]
print('data',len(raw),'training',tr.sum(),'valid',va.sum(),'test',te.sum(),flush=True)

# Each sequence is the increasing canonical encoding of an unordered six-element set.
# Under a truly uniform 6-of-90 distribution, at step s the conditional mass of j is
# C(89-j,5-s) for j>previous chosen and feasible. This offset avoids learning sorting artefacts.
base=np.full((K,N),-1e9,dtype=np.float32)
for s in range(K):
 for j in range(0,N):
  if 89-j>=K-1-s:base[s,j]=np.log(comb(89-j,K-1-s))
BASE=torch.tensor(base)
C0=log(comb(N,K))

def mask_logits(logits,prev,s):
 valid=(torch.arange(N,device=logits.device)[None,:]>prev[:,None]) & (torch.arange(N,device=logits.device)[None,:] <= 89-(K-1-s))
 return logits.masked_fill(~valid,-1e9)

class ARSetGRU(nn.Module):
 def __init__(self, history=True):
  super().__init__(); self.history=history
  self.rnn=nn.GRU(N,H,batch_first=True) if history else None
  self.token_emb=nn.Embedding(N,EMB)
  self.step_emb=nn.Embedding(K,STEP_EMB)
  self.head=nn.Sequential(nn.Linear(H+EMB+STEP_EMB,48),nn.Tanh(),nn.Linear(48,N))
  nn.init.normal_(self.head[-1].weight, std=0.004)
  nn.init.zeros_(self.head[-1].bias)
 def context(self,x):
  if self.history: return self.rnn(x)[1][-1]
  return torch.zeros(x.size(0),H,device=x.device,dtype=x.dtype)
 def conditional(self,ctx,prev_emb,prev_value,step):
  se=self.step_emb.weight[step].expand(len(ctx),-1)
  h=torch.cat((ctx,prev_emb,se),dim=1)
  # bounded residual, starting close to a known exact uniform conditional distribution
  residual=2.5*torch.tanh(self.head(h)/2.5)
  return mask_logits(BASE[step].to(ctx.device)[None,:]+residual,prev_value,step)
 def teacher_forcing(self,x,target):
  ctx=self.context(x)
  prefix=torch.cat([torch.zeros((len(target),1,EMB),dtype=x.dtype,device=x.device),
           torch.cumsum(self.token_emb(target),dim=1)[:,:-1,:]],dim=1)
  prev=torch.cat([torch.full((len(target),1),-1,dtype=torch.int64,device=x.device),target[:,:-1]],dim=1)
  loss=torch.zeros(len(target),dtype=x.dtype,device=x.device)
  for s in range(K):
   lg=self.conditional(ctx,prefix[:,s],prev[:,s],s)
   loss+=torch.logsumexp(lg,dim=1)-lg.gather(1,target[:,s:s+1]).squeeze(1)
  return loss,ctx

@torch.no_grad()
def evaluate(m,xx,yy,batch=128):
 m.eval();ans=[];latent=[]
 for a in range(0,len(xx),batch):
  loss,ctx=m.teacher_forcing(xx[a:a+batch],yy[a:a+batch]);ans.append(loss.numpy());latent.append(ctx.numpy())
 return np.concatenate(ans),np.concatenate(latent)

@torch.no_grad()
def sample_marginals(m,xx,seed,samples=NSAMPLES,batch_draws=32):
 """Sample exact sets from autoregressive distribution; return estimated inclusion probabilities.
 Predicted tickets chosen as top-six estimated inclusion probabilities, with stable ties.
 No actual next-draw outcomes enter the sampling procedure.
 """
 m.eval();rng=torch.Generator().manual_seed(seed)
 inclusion=[]; consistency=[]
 for a in range(0,len(xx),batch_draws):
  inp=xx[a:a+batch_draws]
  ctx=m.context(inp); repeat=ctx.repeat_interleave(samples,dim=0)
  bs=len(repeat); prefix=torch.zeros((bs,EMB));prev=torch.full((bs,),-1,dtype=torch.long)
  selected=[]
  for s in range(K):
   lg=m.conditional(repeat,prefix,prev,s)
   j=torch.multinomial(torch.softmax(lg,dim=1),1,generator=rng).squeeze(1)
   selected.append(j)
   prefix=prefix+m.token_emb(j);prev=j
  draws=torch.stack(selected,dim=1).reshape(len(inp),samples,K)
  counts=torch.zeros((len(inp),N),dtype=torch.float32)
  counts.scatter_add_(1,draws.reshape(len(inp),-1),torch.ones((len(inp),samples*K)))
  inclusion.append(counts.numpy()/samples)
 return np.vstack(inclusion)

def top6(probs):return np.argsort(-probs,axis=1,kind='stable')[:,:K]
def hit_counts(tickets, truth):return (tickets[:,:,None]==truth[:,None,:]).any(axis=2).sum(axis=1).astype(int)

def describe_model(name, nll, tickets, truth):
 hits=hit_counts(tickets,truth)
 c=np.bincount(hits,minlength=7)
 return {'nll_mean':float(nll.mean()),'nll_delta_vs_uniform':float(nll.mean()-C0),
         'hits_mean':float(hits.mean()),'hits_sum':int(hits.sum()),'hits_by_exact_count':c.tolist(),
         'three_or_more':int((hits>=3).sum()),'four_or_more':int((hits>=4).sum()),
         'utility_mean':float(REWARD[hits].mean()),'utility_ratio_vs_null':float(REWARD[hits].mean()/REWARD_NULL)},hits

def mean_ci(a,seed,iterations=3000):
 rng=np.random.default_rng(seed);a=np.asarray(a,dtype=float)
 idx=rng.integers(0,len(a),(iterations,len(a)))
 return np.quantile(a[idx].mean(1),[.025,.975]).tolist()

train_dl=DataLoader(TensorDataset(torch.tensor(X[tr]),torch.tensor(Y[tr])),batch_size=128,shuffle=True)
val_x=torch.tensor(X[va]);val_y=torch.tensor(Y[va]);test_x=torch.tensor(X[te]);test_y=torch.tensor(Y[te])
trained={};curves={};selection={}; validation_misc={}
for name,with_history in [('AR senza storia',False),('AR con storia',True)]:
 seed=SEED+(0 if with_history else 11)
 torch.manual_seed(seed); model=ARSetGRU(with_history)
 opt=torch.optim.AdamW(model.parameters(),lr=6e-4,weight_decay=.025)
 best=np.inf; best_state=None;best_ep=None;stale=0;curve=[]
 for ep in range(1,21):
  model.train();train_sum=0.;train_n=0
  for xb,yb in train_dl:
   opt.zero_grad(set_to_none=True)
   nll,_=model.teacher_forcing(xb,yb)
   loss=nll.mean();loss.backward()
   nn.utils.clip_grad_norm_(model.parameters(),1.)
   opt.step();train_sum+=float(loss)*len(xb);train_n+=len(xb)
  loss_val,lat_val=evaluate(model,val_x,val_y)
  v=float(loss_val.mean()); curve.append({'epoch':ep,'train_nll':train_sum/train_n,'val_nll':v})
  print('EPOCH',name,ep,'train',round(train_sum/train_n,6),'val',round(v,6),'baseline',round(C0,6),flush=True)
  if v<best-1e-6:
   best=v;best_state=copy.deepcopy(model.state_dict());best_ep=ep;stale=0
  else:
   stale+=1
   if stale>=5:break
 model.load_state_dict(best_state);model.eval()
 trained[name]=model;curves[name]=curve
 selection[name]={'epoch':best_ep,'validation_nll':best,'beats_uniform_validation':bool(best<C0)}
 torch.save({'state_dict':best_state,'window':W,'latent_hidden':H,'emb':EMB,'step_emb':STEP_EMB,'history':with_history,'seed':seed,'selected_epoch':best_ep},P/('superenalotto_ar_history_v18.pt' if with_history else 'superenalotto_ar_static_v18.pt'))
 # Test causal-vs-shuffled history, only for the trained history-aware network and validation.
 if with_history:
  orig,_=evaluate(model,val_x,val_y)
  rg=np.random.default_rng(SEED+3)
  xperm=val_x[rg.permutation(len(val_x))]
  shuffled,_=evaluate(model,xperm,val_y)
  validation_misc['history_shuffle']={'original_val_nll':float(orig.mean()),'shuffled_val_nll':float(shuffled.mean()),'shuffle_minus_original':float(shuffled.mean()-orig.mean())}

# Test only AFTER training & all hyperparameters fixed. All past test draws may be in the input
# of subsequent test predictions; that is normal chronological walk-forward forecasting.
old=pd.read_csv(P/'superenalotto_previsioni_test_v17.csv')
assert len(old)==te.sum() and np.all(old['data'].astype(str).values==raw.data.dt.strftime('%Y-%m-%d').to_numpy()[ids[te]])
results={};raw_hits={};preds={};nll_rows={}
for name,model in trained.items():
 nll,states=evaluate(model,test_x,test_y)
 probs=sample_marginals(model,test_x,seed=SEED+(301 if name == 'AR con storia' else 401))
 assert np.max(np.abs(probs.sum(1)-K))<1e-4
 proposal=top6(probs)
 met,hits=describe_model(name,nll,proposal,Y[te]);met['hits_mean_bootstrap_ci95']=mean_ci(hits,SEED+5)
 results[name]=met;raw_hits[name]=hits;preds[name]=proposal;nll_rows[name]=nll
 print('TEST',name,'mean hit',round(met['hits_mean'],6),'NLL',round(met['nll_mean'],6),'3+',met['three_or_more'],flush=True)
 if name=='AR con storia':
  # Distinguish geometry of overlapping windows from genuine predictiveness; don't overinterpret.
  unit=states/np.maximum(np.linalg.norm(states,axis=1,keepdims=True),1e-12)
  rg=np.random.default_rng(SEED+9);u2=unit[rg.permutation(len(unit))]
  validation_misc['latent']={'successive_cosine':float(np.mean(np.sum(unit[1:]*unit[:-1],axis=1))),
                           'permuted_pair_cosine':float(np.mean(np.sum(u2[1:]*u2[:-1],axis=1))),
                           'note':'Overlapping windows share 99 of 100 past draws; smoothness alone is not evidence of predictivity.'}

# Recompute v17 metrics from published per-draw predictions: compatible same test and targets.
for display,slug in [('Uniforme (campione)', 'uniform'),('Frequenze storiche','freq'),('Set-GRU v17 (likelihood)','gru_nll'),('Set-GRU v17 (reward)','gru_reward')]:
 tix=np.vstack([np.fromstring(x,sep=' ',dtype=int)-1 for x in old[f'{slug}_ticket'].astype(str)])
 assert np.all(np.diff(np.sort(tix,axis=1),axis=1)>0)
 nll=old[f'{slug}_exact_nll'].to_numpy(float)
 m,h=describe_model(display,nll,tix,Y[te])
 results[display]=m;raw_hits[display]=h;preds[display]=tix;nll_rows[display]=nll

# Paired tests compare same 1,049 future outcomes; repeated-use warning in report.
pairwise={}
for name in ['AR con storia','AR senza storia']:
 h=raw_hits[name];diff=h-raw_hits['Set-GRU v17 (likelihood)']
 pairwise[name]={'delta_mean_hits_vs_set_gru_v17':float(diff.mean()),'paired_bootstrap_ci95':mean_ci(diff,SEED+44),
                 'delta_mean_nll_vs_v17':float(nll_rows[name].mean()-nll_rows['Set-GRU v17 (likelihood)'].mean())}

# A fixed, target-independent sanity test on 6-of-90 constraints, plus exact uniform offset.
with torch.no_grad():
 sample_test=Y[te][:8];base_model=ARSetGRU(False)
 for p in base_model.head[-1].parameters():p.zero_()
 null_losses,_=base_model.teacher_forcing(torch.tensor(X[te][:8]),torch.tensor(sample_test))
 assert torch.allclose(null_losses,torch.full_like(null_losses,C0),atol=2e-4), (null_losses,C0)
 for name,tickets in preds.items():
  assert np.all((tickets>=0)&(tickets<N)) and np.all(np.diff(np.sort(tickets,axis=1),axis=1)>0),name

# Individual test predictions; not outputting sampled trial sets to avoid enormous files.
output=pd.DataFrame({'data':raw.data.dt.strftime('%Y-%m-%d').to_numpy()[ids[te]],
                     'concorso':raw.concorso.to_numpy()[ids[te]],
                     'estrazione_reale':[' '.join(map(str,z+1)) for z in Y[te]]})
map_name={'AR con storia':'ar_history','AR senza storia':'ar_static', 'Uniforme (campione)':'uniform',
          'Frequenze storiche':'frequency', 'Set-GRU v17 (likelihood)':'v17_set_gru','Set-GRU v17 (reward)':'v17_reward'}
for name in map_name:
 slug=map_name[name]
 output[f'{slug}_ticket']=[' '.join(map(str,np.sort(v+1))) for v in preds[name]]
 output[f'{slug}_hits']=raw_hits[name]
 output[f'{slug}_reward']=REWARD[raw_hits[name]]
 output[f'{slug}_nll']=nll_rows[name]
output.to_csv(P/'superenalotto_previsioni_test_v18.csv',index=False)

# Graph: v17 reference, AR ablation, and theoretical 0.4 marker.
fig,ax=plt.subplots(figsize=(10,5.3))
names=['Uniforme (campione)','Frequenze storiche','Set-GRU v17 (likelihood)','AR senza storia','AR con storia']
means=[results[k]['hits_mean'] for k in names]
intervals=np.array([mean_ci(raw_hits[k],SEED+133+j,iterations=1500) for j,k in enumerate(names)])
xx=np.arange(len(names)); ax.bar(xx,means)
ax.errorbar(xx,means,yerr=np.array([np.array(means)-intervals[:,0],intervals[:,1]-np.array(means)]),fmt='none',capsize=4,color='black')
ax.axhline(.4,ls='--',label='Valore atteso casuale 0,4',color='black')
ax.set_xticks(xx,labels=names,rotation=15,ha='right')
ax.set(xlabel='Metodo',ylabel='Numeri corretti medi (su 6)',title='Sestine proposte: 1.049 estrazioni cronologiche, 2021–2026')
ax.grid(axis='y',alpha=.2);ax.legend();fig.tight_layout()
fig.savefig(P/'superenalotto_autoregressivo_confronto_v18.png',dpi=175);plt.close(fig)

fig,ax=plt.subplots(figsize=(10,5))
for name,curve in curves.items():
 ax.plot([r['epoch'] for r in curve],[r['val_nll'] for r in curve],marker='o',label=name)
ax.axhline(C0,ls='--',color='black',label='Uniforme esatta')
ax.set(xlabel='Epoca',ylabel='NLL della sestina intera (minore = migliore)',title='Validazione: modello autoregressivo')
ax.grid(alpha=.2);ax.legend();fig.tight_layout()
fig.savefig(P/'superenalotto_autoregressivo_validazione_v18.png',dpi=175);plt.close(fig)

# Honest record of post-selection: test reused through v14-v17; never claim independent confirmation.
metadata={'experiment':'v18 autoregressive conditional 6-of-90 generation','utc_created':datetime.now(timezone.utc).isoformat(),
 'seed':SEED,'dataset_sha256':hashlib.sha256((P/'superenalotto_matrice_binaria_90_v13.csv').read_bytes()).hexdigest(),
 'target_space':comb(90,6),'window':100,'draws_after_2009':len(raw),
 'split':{'training':int(tr.sum()),'validation':int(va.sum()),'test':int(te.sum()),
          'validation_from':raw.data.iloc[ids[va][0]].date().isoformat(),
          'test_from':raw.data.iloc[ids[te][0]].date().isoformat(),'test_until':raw.data.iloc[ids[te][-1]].date().isoformat()},
 'architecture':{'encoder_history':'GRU(90,32), last state','autoregressive_set_order':'strict increasing indices (canonical, not physical draw order)',
                 'prefix':'sum of learned embeddings of numbers already chosen',
                 'head':'MLP(32+16+8 -> 48 -> 90) with tanh, residual to uniform exact combinatorial probability',
                 'base_conditional':'P(next=j | prefix)=C(89-j,5-step)/C(89-prev,6-step) over feasible next j',
                 'validity':'exactly 6 distinct numbers from 1..90 by construction',
                 'model_interactions':'prefix-dependent nonlinear conditional scores; same probability of a set independent of any physical draw order'},
 'training':{'optimizer':'AdamW','learning_rate':0.0006,'weight_decay':.025,'batch_size':128,'max_epochs':20,'patience':5,
             'selection':'minimum chronological validation set NLL only','train_subject':'negative log likelihood of exact 6-number set'},
 'ticket_decision':{'method':'sample autoregressive sets and choose six largest marginal inclusion probabilities',
                    'samples_per_test_case':NSAMPLES,'sampling_seeds':[SEED+301,SEED+401],
                    'note':'Approximates maximizing expected correct matches; does not exactly maximize the high-value utility R(k).'},
 'reward':{str(k):float(v) for k,v in enumerate(REWARD)},
 'null_theory':{'expected_hits':.4,'mean_nll':C0,'p_at_least_three':float(THEORY[3:].sum()),'expected_score':REWARD_NULL},
 'selection':selection,'validation_diagnostics':validation_misc,
 'curves':curves,'test_metrics':results,'paired_vs_v17':pairwise,
 'limitations':['2021–2026 period was previously examined in multiple model-selection conversations; this is exploratory rather than a fresh independent test.',
                'Insufficient data to infer actual physical state of ball extraction machine; correlations alone do not identify a generator.',
                'Monte Carlo top-six marginal decision has stochastic estimation error.',
                'Exact predictive likelihood of full set is a more reliable statistical score than rare jackpot utility.'],
 'data_reproduction':'Run python compute_v18.py in same directory as superenalotto_matrice_binaria_90_v13.csv and superenalotto_previsioni_test_v17.csv'}
(P/'superenalotto_metriche_v18.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')

# Copy v17 cumulative artifact verbatim except version identifier, append v18 with all claims from measured results.
prior=(P/'superenalotto_analisi_filtri_v17.md').read_text(encoding='utf8')
prior=prior.replace('(v17)','(v18)',1)
report='''

---

## Esperimento v18 — Generatore autoregressivo di sestine con interazioni condizionali

### Domanda e progettazione
Partendo dalle 100 estrazioni precedenti (90 variabili binarie per estrazione), la rete produce una **sestina non ordinata di sei numeri distinti**, modellandola tramite una rappresentazione **canonica crescente** per consentire una fattorizzazione autoregressiva della probabilità. Le posizioni crescenti sono una *codifica*, non la sequenza fisica delle sfere. A differenza di v17, ciascuna probabilità condizionale dipende anche dai numeri precedenti del set, quindi può esprimere dipendenze interne oltre ai semplici pesi marginali. Non occorre enumerare 622.614.630 sestine.

### Distribuzione e baseline matematica esatta
Siano `x1 < x2 < ... < x6` i sei numeri (indici da 0 a 89) e sia `h_t` lo stato latente della finestra precedente. Si fattorizza:

`P({x1,...,x6}|h_t) = ∏_{s=1}^6 P(x_s | x_1,...,x_(s-1),h_t)`.

Al passo `s` sono ammessi soltanto numeri maggiori del precedente e che lascino spazio a quelli successivi. La distribuzione **uniforme sulle sestine** non ha, in generale, probabilità condizionali uniformi sulle posizioni crescenti: il peso teorico del candidato (indice base zero) `j` al passo `s` (indice base zero) è `C(89−j,5−s)`. Il generatore aggiunge a `log C(89−j,5−s)` un correttivo neurale che dipende da storia e prefisso, poi normalizza sulle posizioni ammesse. Se tutti i correttivi sono zero, la probabilità di ciascuna sestina è *esattamente* `1 / C(90,6)`.

Il prefisso è la somma degli embedding dei numeri già scelti; lo stato storico deriva da una GRU di 32 dimensioni. Sono confrontate due reti: **AR senza storia**, che impara soltanto dipendenze interne alle sestine, e **AR con storia**, che può anche apprendere relazioni temporali. I 14 filtri esistenti non vengono inseriti nel generatore né modificati.

### Protocollo
- Archivio: 2.869 estrazioni dal 02/07/2009 al 31/10/2026; matrice binaria 90 colonne.
- Finestra: 100 estrazioni anteriori al bersaglio.
- Addestramento: 1.400 esempi; validazione cronologica: 320; test cronologico: 1.049 (dal 30/03/2021 al 31/10/2026); stessi confini di v17.
- AdamW, learning rate `0,0006`, weight decay `0,025`, batch `128`, massimo 20 epoche, stop dopo 5 senza miglioramento; selezione **solo** mediante NLL della sestina sulla validazione.
- La previsione concreta è formata dai 6 numeri con maggiore **probabilità marginale di inclusione stimata** tramite 256 sestine campionate dal generatore (seed fissato a priori). Questa è una decisione approssimata per il numero atteso di corrispondenze e **non ottimizza esattamente** il punteggio non lineare R(k).
- La funzione di valutazione parziale è quella definita in v17: `R=[0,0.001,0.01,1,20,400,10000]`. Registriamo frequenze di 0,1,2,3,4,5,6 e utility media; la NLL è il controllo probabilistico principale.

### Validazione e test

| Modello | Epoca selezionata | NLL validazione | Migliora la NLL uniforme? |
|---|---:|---:|---|
'''
for name,s in selection.items():
 report+=f"| {name} | {s['epoch']} | {s['validation_nll']:.6f} | {'Sì' if s['beats_uniform_validation'] else 'No'} |\n"
report+=f'\nBaseline uniforme: NLL = **{C0:.6f}**.\n\n'
report+='| Modello | NLL test ↓ | Numeri corretti medi ↑ | Totale corretti | 3+ | 4+ | 5+ | 6 | Punteggio medio R ↑ |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n'
for name in ['Uniforme (campione)','Frequenze storiche','Set-GRU v17 (likelihood)','Set-GRU v17 (reward)','AR senza storia','AR con storia']:
 m=results[name];c=m['hits_by_exact_count']
 report+=f"| {name} | {m['nll_mean']:.6f} | {m['hits_mean']:.4f} | {m['hits_sum']} | {sum(c[3:])} | {sum(c[4:])} | {sum(c[5:])} | {c[6]} | {m['utility_mean']:.6f} |\n"
report+=f'\nRiferimento casuale teorico: **0,4000** numeri corretti medi; NLL **{C0:.6f}**; in 1049 estrazioni sono attesi circa **{THEORY[3:].sum()*1049:.2f}** risultati con almeno tre numeri corretti; punteggio R teorico **{REWARD_NULL:.6f}** a estrazione. I casi 4, 5, 6 sono estremamente rari.\n'
report+='\n### Confronto abbinato e interpretazione\n'
for name,pair in pairwise.items():
 report+=f"- **{name} rispetto al Set-GRU v17**: Δ numeri corretti medi = {pair['delta_mean_hits_vs_set_gru_v17']:+.4f}, IC bootstrap appaiato 95% [{pair['paired_bootstrap_ci95'][0]:+.4f}, {pair['paired_bootstrap_ci95'][1]:+.4f}]; Δ NLL = {pair['delta_mean_nll_vs_v17']:+.6f} (negativo sarebbe migliore).\n"
if 'history_shuffle' in validation_misc:
 z=validation_misc['history_shuffle'];report+=f"- In validazione, permutando le finestre storiche di input senza permutare i bersagli, la NLL del modello con storia cambia da {z['original_val_nll']:.6f} a {z['shuffled_val_nll']:.6f} (Δ={z['shuffle_minus_original']:+.6f}). Questa è una diagnostica di condizionamento, non un test definitivo del processo fisico.\n"
if 'latent' in validation_misc:
 z=validation_misc['latent'];report+=f"- Similarità coseno degli stati latenti vicini: {z['successive_cosine']:.4f}; coppie in ordine casuale: {z['permuted_pair_cosine']:.4f}. Le finestre consecutive condividono il 99% degli input: una similarità elevata **non** dimostra prevedibilità.\n"
report+='''

### Validità, limiti e registrazione
- Gli esempi, le proposte generate e le estrazioni confrontate sono registrati nel CSV v18; i test automatici verificano ordine strettamente crescente, unicità dei numeri e ritorno esatto alla NLL uniforme quando i correttivi neurali sono nulli.
- Le NLL delle baseline precedenti provengono da `superenalotto_previsioni_test_v17.csv` sulle stesse date e sono confrontate sugli stessi risultati effettivi, non da una nuova ricerca degli iperparametri sul test.
- **Attenzione: il periodo 2021–2026 è già stato consultato nei progetti v14–v17.** I risultati v18 sono esplorativi e non costituiscono convalida indipendente di una strategia di gioco. Un eventuale successo andrebbe verificato con previsioni fissate prima di estrazioni future.
- L'ordine canonico non deve essere confuso con l'ordine fisico di uscita. Lo stato meccanico non è identificabile automaticamente da un archivio di sestine.

### Artefatti v18
- `compute_v18.py` — addestramento e valutazione riproducibili, con seed e vincolo combinatorio.
- `superenalotto_metriche_v18.json` — parametri, NLL per epoca, metriche, diagnostiche, controlli e avvertenze.
- `superenalotto_previsioni_test_v18.csv` — una riga per ciascuna delle 1.049 estrazioni, sestina vera, proposta, match, premio sperimentale e NLL.
- `superenalotto_ar_history_v18.pt`, `superenalotto_ar_static_v18.pt` — pesi salvati.
- `superenalotto_autoregressivo_confronto_v18.png`, `superenalotto_autoregressivo_validazione_v18.png` — grafici.
- **F01–F14 invariati**, nessuna selezione di combinazioni sulla base del test futuro.

### Registro delle versioni
- **v18:** primo generatore autoregressivo di sestine non ordinate con dipendenze dal prefisso e dalla storia; confronto con modello senza storia, baseline e Set-GRU v17; punteggi parziali e controlli di validità.
'''
(P/'superenalotto_analisi_filtri_v18.md').write_text(prior+report,encoding='utf8')

(P/'README_superenalotto_v18.txt').write_text('Esperimento 18 — modello autoregressivo SuperEnalotto\n\nRequisiti: Python 3.10+, numpy, pandas, torch, matplotlib.\n\nDa questa cartella eseguire:\n  OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v18.py\n\nInput inclusi nel pacchetto:\n  superenalotto_matrice_binaria_90_v13.csv (4.294 estrazioni)\n  superenalotto_previsioni_test_v17.csv (baseline sul medesimo test)\n\nIl test è già stato consultato nei precedenti esperimenti e non costituisce validazione indipendente.\n',encoding='utf8')

bundle=['superenalotto_matrice_binaria_90_v13.csv','superenalotto_previsioni_test_v17.csv','README_superenalotto_v18.txt','superenalotto_analisi_filtri_v18.md','compute_v18.py','superenalotto_metriche_v18.json',
        'superenalotto_previsioni_test_v18.csv','superenalotto_autoregressivo_confronto_v18.png',
        'superenalotto_autoregressivo_validazione_v18.png','superenalotto_ar_history_v18.pt',
        'superenalotto_ar_static_v18.pt']
with zipfile.ZipFile(P/'superenalotto_esperimento_v18_bundle.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
 for n in bundle:z.write(P/n,arcname=n)
print('FINISHED',len(report),'bytes appendix',flush=True)
