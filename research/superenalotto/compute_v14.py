#!/usr/bin/env python3
"""Deterministic v14 ESN/GRU experiment. 100 chronological draws to predict next multi-hot draw."""
from pathlib import Path
import os, json, hashlib, copy, time
import numpy as np, pandas as pd
from scipy.special import expit
from sklearn.linear_model import Ridge
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
P=Path('/mnt/data'); SEED=20261102
np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)
frame=pd.read_csv(P/'superenalotto_matrice_binaria_90_v13.csv',parse_dates=['data']).sort_values('data',kind='stable').reset_index(drop=True)
vals=frame[[f'n{i:02d}' for i in range(1,91)]].to_numpy(np.float32)
assert len(vals)==4294 and np.all(vals.sum(axis=1)==6)
w=100;n=len(vals)-w
X=np.stack([vals[t-w:t] for t in range(w,len(vals))]);Y=vals[w:]
dates=frame['data'].dt.strftime('%Y-%m-%d').to_numpy()[w:]
a=int(n*.60);b=int(n*.15);c=n-a-b
tr=slice(None,a);va=slice(a,a+b);te=slice(a+b,n)
print('SPLIT',n,a,b,c,dates[0],dates[a],dates[a+b],dates[-1],flush=True)

def six_prob(logits):
 z=np.asarray(logits,dtype=np.float64)
 lo=np.full((len(z),1),-40.);hi=np.full((len(z),1),40.)
 for _ in range(44):
  mid=(lo+hi)/2; less=expit(z+mid).sum(axis=1,keepdims=True)<6
  lo=np.where(less,mid,lo);hi=np.where(less,hi,mid)
 return expit(z+(lo+hi)/2)

def score(p,y):
 p=np.clip(p,1e-8,1-1e-8)
 idx=np.argsort(-p,axis=1,kind='stable')[:,:6]
 hits=np.take_along_axis(y,idx,axis=1).sum(axis=1)
 return dict(hits=float(hits.mean()),brier=float(np.mean((p-y)**2)),logloss=float(np.mean(-y*np.log(p)-(1-y)*np.log1p(-p))),hit0=float(np.mean(hits==0)),hit1=float(np.mean(hits==1)),hit2plus=float(np.mean(hits>=2))),hits,idx

unif=np.full((c,90),6/90)
random_gen=np.random.default_rng(SEED)
rand_idx=np.argpartition(random_gen.random((c,90)),6,axis=1)[:,:6]
rand_hits=np.take_along_axis(Y[te],rand_idx,axis=1).sum(axis=1)
# Baseline frequencies estimated only from training. shrink chosen only on validation.
freq=Y[tr].mean(axis=0);f=np.clip(freq,1e-6,1-1e-6)
logit_relative=np.log(f/(1-f))-np.log((6/90)/(1-6/90))
options=[]
for strength in [0,.2,.5,1,2]:
 probs=six_prob(np.tile(logit_relative*strength,(b,1)))
 options.append((score(probs,Y[va])[0]['logloss'],strength))
prior_scale=min(options)[1]
prior=six_prob(np.tile(logit_relative*prior_scale,(c,1)))
prior_metrics,prior_hits,prior_idx=score(prior,Y[te])
print('PRIOR selection',prior_scale,'test',prior_metrics,flush=True)
# Independent reset for every window: exact 100-draw ESN memory.
R=64;gen=np.random.default_rng(SEED+1)
W_in=(gen.normal(size=(90,R))*.18).astype('float32')
W_rec=gen.normal(size=(R,R)).astype('float32');W_rec*=.85/max(abs(np.linalg.eigvals(W_rec)))
Bias=(gen.normal(size=R)*.03).astype('float32')

def esn_feats(inputs):
 out=np.empty((len(inputs),R),dtype='float32')
 for i in range(0,len(inputs),500):
  inp=inputs[i:i+500];state=np.zeros((len(inp),R),dtype='float32')
  for t in range(w):
   state=.45*state+.55*np.tanh(inp[:,t]@W_in+state@W_rec+Bias)
  out[i:i+len(inp)]=state
 return out
print('ESN features',flush=True);t0=time.time();feat=esn_feats(X);print('ESN done',round(time.time()-t0,1),'s',flush=True)
choices=[]
for alpha in [1.,10.,100.,1000.]:
 model=Ridge(alpha=alpha).fit(feat[tr],Y[tr]);pred=model.predict(feat[va])
 for scale in [0,4,8,16,32,64,128]:
  p=six_prob((pred-6/90)*scale)
  choices.append((score(p,Y[va])[0]['logloss'],alpha,scale))
_,alpha,scale=min(choices)
esn=Ridge(alpha=alpha).fit(feat[tr],Y[tr]);esn_val=score(six_prob((esn.predict(feat[va])-6/90)*scale),Y[va])[0]
esn_raw=esn.predict(feat[te])
esn_prob=six_prob((esn_raw-6/90)*scale)
esn_metrics,_,_=score(esn_prob,Y[te])
# The validation-selected calibration may shrink all probabilities to uniform.
# In that case, *never* use arbitrary index tie breaks as a supposed neural prediction:
# rank using the raw ESN ridge scores, while scoring probability quality with calibrated p.
esn_idx=np.argsort(-esn_raw,axis=1,kind='stable')[:,:6]
esn_hits=np.take_along_axis(Y[te],esn_idx,axis=1).sum(axis=1)
esn_metrics['hits']=float(esn_hits.mean())
print('ESN selection',alpha,scale,'test',esn_metrics,flush=True)
class SmallGRU(nn.Module):
 def __init__(self):
  super().__init__();self.rnn=nn.GRU(90,32,batch_first=True);self.norm=nn.LayerNorm(32);self.head=nn.Linear(32,90)
 def forward(self,x):
  _,h=self.rnn(x);return self.head(self.norm(h[-1]))
net=SmallGRU();opt=torch.optim.AdamW(net.parameters(),lr=.002,weight_decay=.01);crit=nn.BCEWithLogitsLoss()
trainloader=DataLoader(TensorDataset(torch.tensor(X[tr]),torch.tensor(Y[tr])),batch_size=128,shuffle=True)
valloader=DataLoader(TensorDataset(torch.tensor(X[va]),torch.tensor(Y[va])),batch_size=256)
testloader=DataLoader(TensorDataset(torch.tensor(X[te]),torch.tensor(Y[te])),batch_size=256)

def predict(dl):
 net.eval();z=[]
 with torch.no_grad():
  for xx,_ in dl:z.append(net(xx).numpy())
 return six_prob(np.concatenate(z))

history=[];best=1e5;beststate=None;bestep=None;bad=0
for ep in range(1,26):
 net.train();tl=[]
 for xx,yy in trainloader:
  opt.zero_grad();loss=crit(net(xx),yy);loss.backward();nn.utils.clip_grad_norm_(net.parameters(),1);opt.step();tl.append(float(loss.item()))
 vp=predict(valloader);vm=score(vp,Y[va])[0]
 history.append(dict(epoch=ep,training_logloss=float(np.mean(tl)),validation_logloss=vm['logloss'],validation_hits=vm['hits']))
 print('GRU epoch',ep, 'train',round(float(np.mean(tl)),6),'val',round(vm['logloss'],6),'hits',round(vm['hits'],4),flush=True)
 if vm['logloss']<best-1e-7:best=vm['logloss'];beststate=copy.deepcopy(net.state_dict());bestep=ep;bad=0
 else:
  bad+=1
  if bad>=5:break
net.load_state_dict(beststate)
gru_val=score(predict(valloader),Y[va])[0]
gru_prob=predict(testloader);gru_metrics,gru_hits,gru_idx=score(gru_prob,Y[te])
print('GRU best epoch',bestep,'test',gru_metrics,flush=True)
# random baseline expected 0.4; 2000 Monte Carlo 6-number selections to provide reference fluctuation
rng=np.random.default_rng(SEED+10);mc=[]
for _ in range(2000):
 ids=np.argpartition(rng.random((c,90)),6,axis=1)[:,:6]
 mc.append(float(np.take_along_axis(Y[te],ids,axis=1).sum(axis=1).mean()))
mc=np.array(mc)
# Block bootstrap on per-draw test metrics, circular blocks of 25
rng=np.random.default_rng(SEED+12);B=2500;block=25
starts=rng.integers(0,c,size=(B,int(np.ceil(c/block))))
bi=(starts[:,:,None]+np.arange(block)[None,None,:])%c
bi=bi.reshape(B,-1)[:,:c]
metrics={}
for name,pred,hits,vmetric in [('Casuale',unif,rand_hits,None),('Frequenze storiche',prior,prior_hits,None),('Echo State Network',esn_prob,esn_hits,esn_val),('GRU',gru_prob,gru_hits,gru_val)]:
 m=score(pred,Y[te])[0];m['hits']=float(hits.mean());m['hit0']=float(np.mean(hits==0));m['hit1']=float(np.mean(hits==1));m['hit2plus']=float(np.mean(hits>=2))
 m['hit_ci_95']=[float(k) for k in np.quantile(hits[bi].mean(axis=1),[.025,.975])]
 m['hit_diff_from_0.4']=float(hits.mean()-.4)
 if vmetric is not None:m['val_logloss']=vmetric['logloss']
 metrics[name]=m
for name,p in [('Frequenze storiche',prior),('Echo State Network',esn_prob),('GRU',gru_prob)]:
 base=-(Y[te]*np.log(unif)+(1-Y[te])*np.log1p(-unif)).mean(axis=1)
 draw=-(Y[te]*np.log(p)+(1-Y[te])*np.log1p(-p)).mean(axis=1)
 metrics[name]['delta_logloss_uniform_ci_95']=[float(k) for k in np.quantile((draw-base)[bi].mean(axis=1),[.025,.975])]
 metrics[name]['empirical_p_hits_mc_two_sided']=float((1+np.sum(abs(mc-.4)>=abs(metrics[name]['hits']-.4)))/(len(mc)+1))

summary={
 'seed':SEED,'window':w,'n_draws':len(vals),'n_windows':n,
 'split':{'train':a,'validation':b,'test':c,'train_start':dates[0],'train_end':dates[a-1],'validation_start':dates[a],'validation_end':dates[a+b-1],'test_start':dates[a+b],'test_end':dates[-1]},
 'metrics':metrics,'esn':{'reservoir_units':R,'spectral_radius':.85,'leak':.55,'input_scaling':.18,'ridge_alpha':alpha,'score_scale':scale,'ranking_uses_raw_ridge_scores':True,'ridge_candidates':[1,10,100,1000],'scale_candidates':[0,4,8,16,32,64,128]},
 'gru':{'hidden_units':32,'learning_rate':.002,'weight_decay':.01,'batch_size':128,'max_epochs':25,'early_stopping_patience':5,'chosen_epoch':bestep,'learning_curve':history},
 'frequency_baseline':{'prior_strength':prior_scale},
 'uniform_reference':{'theoretical_hit_mean':.4,'theoretical_brier':6/90*(1-6/90),'mc_runs':len(mc),'mc_hit_mean_ci_95':[float(k) for k in np.quantile(mc,[.025,.975])]},
 'data_source_sha256':hashlib.sha256((P/'superenalotto_matrice_binaria_90_v13.csv').read_bytes()).hexdigest()
}
(P/'superenalotto_metriche_v14.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
det=pd.DataFrame({'data':dates[te],'vincente':[' '.join(map(str,np.flatnonzero(y)+1)) for y in Y[te]],'hits_casuale':rand_hits.astype(int),'hits_frequenze':prior_hits.astype(int),'hits_ESN':esn_hits.astype(int),'hits_GRU':gru_hits.astype(int),'pred_frequenze':[' '.join(map(str,k+1)) for k in prior_idx],'pred_ESN':[' '.join(map(str,k+1)) for k in esn_idx],'pred_GRU':[' '.join(map(str,k+1)) for k in gru_idx]})
det.to_csv(P/'superenalotto_previsioni_test_v14.csv',index=False)
fig,ax=plt.subplots(figsize=(10,5));names=list(metrics);ys=[metrics[k]['hits'] for k in names]
errs=np.array([[ys[i]-metrics[k]['hit_ci_95'][0] for i,k in enumerate(names)],[metrics[k]['hit_ci_95'][1]-ys[i] for i,k in enumerate(names)]])
ax.bar(names,ys);ax.errorbar(names,ys,yerr=errs,fmt='none',capsize=5,color='black');ax.axhline(.4,ls='--',color='gray',label='Casuale atteso: 0,4');ax.set(ylabel='Numero medio di vincenti tra i sei proposti',title='Test cronologico — previsione estrazione successiva');ax.grid(axis='y',alpha=.2);ax.legend();fig.tight_layout();fig.savefig(P/'superenalotto_confronto_reti_v14.png',dpi=170)
fig,ax=plt.subplots(figsize=(10,4));ax.plot([k['epoch'] for k in history],[k['training_logloss'] for k in history],label='Train');ax.plot([k['epoch'] for k in history],[k['validation_logloss'] for k in history],label='Validazione');ax.axvline(bestep,ls='--',color='gray');ax.set(xlabel='Epoca',ylabel='Log-loss',title='GRU — apprendimento');ax.grid(alpha=.2);ax.legend();fig.tight_layout();fig.savefig(P/'superenalotto_gru_apprendimento_v14.png',dpi=170)
print('RESULTS',json.dumps({'metrics':metrics,'split':summary['split'],'esn_alpha':alpha,'esn_scale':scale,'gru_best_epoch':bestep,'random_MC_CI':summary['uniform_reference']['mc_hit_mean_ci_95']},ensure_ascii=False),flush=True)
