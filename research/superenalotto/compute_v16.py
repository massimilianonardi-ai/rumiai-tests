#!/usr/bin/env python3
"""SuperEnalotto v16: masked denoising pretraining -> frozen latent readout and fine tuning.
Run with: OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 OMP_NUM_THREADS=2 python /mnt/data/compute_v16.py
Dependencies: torch, numpy, scipy, pandas, sklearn, matplotlib.
"""
from pathlib import Path
import os,json,copy,hashlib,time,random,math
import numpy as np, pandas as pd
import torch
from torch import nn
from torch.utils.data import TensorDataset, DataLoader
from sklearn.linear_model import Ridge
from scipy.special import expit
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
P=Path(__file__).resolve().parent; SEED=20261118
random.seed(SEED); np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)
H=32;W=100;base=6/90
frame=pd.read_csv(P/'superenalotto_matrice_binaria_90_v13.csv',parse_dates=['data']).sort_values('data',kind='stable').reset_index(drop=True)
frame=frame[frame.data>=pd.Timestamp('2009-07-01')].reset_index(drop=True)
y=frame[[f'n{i:02d}' for i in range(1,91)]].to_numpy(np.float32)
dates=frame.data.dt.strftime('%Y-%m-%d').to_numpy()
assert len(y)==2869 and np.all(y.sum(axis=1)==6)
ids=np.arange(W,len(y),dtype=int)
X=np.stack([y[t-W:t] for t in ids]).astype(np.float32);Y=y[ids]
tr=ids<1500;va=(ids>=1500)&(ids<1820);te=ids>=1820
print('DATA',len(y),'splits',tr.sum(),va.sum(),te.sum(),'train',dates[W],dates[1499], 'val',dates[1500],dates[1819], 'test',dates[1820],dates[-1],flush=True)
tr_dl=DataLoader(TensorDataset(torch.from_numpy(X[tr]),torch.from_numpy(Y[tr])),batch_size=128,shuffle=True)
val_dl=DataLoader(TensorDataset(torch.from_numpy(X[va]),torch.from_numpy(Y[va])),batch_size=256,shuffle=False)
test_dl=DataLoader(TensorDataset(torch.from_numpy(X[te]),torch.from_numpy(Y[te])),batch_size=256,shuffle=False)

def six_prob(z,scale=1):
 z=np.asarray(z,dtype=np.float64)*scale
 if scale==0: return np.full(z.shape,base)
 lo=np.full((len(z),1),-30.);hi=np.full((len(z),1),30.)
 for i in range(32):
  mid=(lo+hi)/2;flag=expit(z+mid).sum(axis=1,keepdims=True)<6
  lo=np.where(flag,mid,lo);hi=np.where(flag,hi,mid)
 return np.clip(expit(z+(lo+hi)/2),1e-9,1-1e-9)

def summarize(prob,target,rank=None):
 pp=np.clip(np.asarray(prob),1e-9,1-1e-9)
 if rank is None:rank=pp
 idx=np.argsort(-rank,axis=1,kind='stable')[:,:6]
 hits=np.take_along_axis(target,idx,axis=1).sum(axis=1).astype('int16')
 perrowll=np.mean(-(target*np.log(pp)+(1-target)*np.log1p(-pp)),axis=1)
 return {'mean_hits':float(hits.mean()),'total_hits':int(hits.sum()),'logloss':float(perrowll.mean()),'brier':float(np.mean((pp-target)**2)),'p0':float(np.mean(hits==0)),'p1':float(np.mean(hits==1)),'p2plus':float(np.mean(hits>=2))},hits,idx,perrowll

class MaskedEncoder(nn.Module):
 def __init__(self):
  super().__init__();self.rnn=nn.GRU(90,H,batch_first=True,bidirectional=True)
  self.recon=nn.Linear(H*2,90)
  nn.init.constant_(self.recon.bias,math.log(base/(1-base)))
 def encode(self,x):
  _,h=self.rnn(x)
  return torch.cat([h[-2],h[-1]],dim=1)
 def forward(self,x):
  out,_=self.rnn(x)
  return self.recon(out)

# Mask entire draw-vectors, never only individual zeros; validation masks are fixed.
mask_rng=np.random.default_rng(SEED+17)
# Validate masked reconstruction only on windows whose entire 100-draw context
# belongs to the held-out validation period, not on overlapping train history.
preval=(ids[va]>=1600)
X_preval=X[va][preval]
mask_val=(mask_rng.random((len(X_preval),W))<.20)
# Guarantee at least one masked row in each validation window
mask_val[:,0]=True
x_va=torch.as_tensor(X_preval);mask_va=torch.tensor(mask_val)
x_va_mask=x_va.clone();x_va_mask[mask_va]=-1.
net=MaskedEncoder(); opt=torch.optim.AdamW(net.parameters(),lr=.001,weight_decay=.01)
crit=nn.BCEWithLogitsLoss(reduction='none')
pretrain_history=[];pretrain_best=float('inf');pretrain_sd=None;pretrain_epoch=None;bad=0
for epoch in range(1,16):
 net.train();losses=[]
 for xx,_ in tr_dl:
  mask=torch.rand(xx.shape[:2])<.20;mask[:,0]=True
  corrupted=xx.clone();corrupted[mask]=-1.
  opt.zero_grad(set_to_none=True)
  res=net(corrupted)
  loss=crit(res,xx)[mask].mean()
  loss.backward();nn.utils.clip_grad_norm_(net.parameters(),1.);opt.step();losses.append(loss.item())
 net.eval()
 with torch.no_grad():
  pp=[]
  for i in range(0,len(x_va),128):pp.append(net(x_va_mask[i:i+128]).numpy())
  pred=np.concatenate(pp)
  target=X_preval[mask_val];pi=expit(pred[mask_val])
  val_ll=float(np.mean(-(target*np.log(np.maximum(pi,1e-9))+(1-target)*np.log(np.maximum(1-pi,1e-9)))))
 pretrain_history.append({'epoch':epoch,'train_masked_logloss':float(np.mean(losses)),'validation_masked_logloss':val_ll})
 print('PRETRAIN',epoch,'train',round(np.mean(losses),6),'val',round(val_ll,6),flush=True)
 if val_ll<pretrain_best-1e-6:
  pretrain_best=val_ll;pretrain_epoch=epoch;pretrain_sd=copy.deepcopy(net.state_dict());bad=0
 else:
  bad+=1
  if bad>=4:break
net.load_state_dict(pretrain_sd)
torch.save({'encoder':net.state_dict(),'epoch':pretrain_epoch,'seed':SEED},P/'superenalotto_encoder_mascherato_v16.pt')
print('PRETRAIN BEST',pretrain_epoch,pretrain_best,flush=True)

class ForecastNet(nn.Module):
 def __init__(self):
  super().__init__();self.encoder=MaskedEncoder().rnn;self.head=nn.Linear(H*2,90)
  nn.init.constant_(self.head.bias,math.log(base/(1-base)))
 def forward(self,x):
  _,h=self.encoder(x)
  return self.head(torch.cat([h[-2],h[-1]],dim=1))

# Constant encoder probes: random and pretrained. The Ridge is trained only on historical targets.
def encode_features(encoder,inp):
 encoder.eval();feat=[]
 with torch.no_grad():
  for i in range(0,len(inp),128):
   _,h=encoder(torch.tensor(inp[i:i+128]))
   feat.append(torch.cat([h[-2],h[-1]],dim=1).numpy())
 return np.vstack(feat)

randnet=ForecastNet();rand_enc=randnet.encoder
features={'Random frozen encoder':encode_features(rand_enc,X),'Masked frozen encoder':encode_features(net.rnn,X)}
raw_scores={};probabilities={};valid_metrics={};test_metrics={};test_hits={};test_idx={};test_loss_rows={};configs={}
for name,feat in features.items():
 options=[]
 for alpha in [1.,10.,100.,1000.]:
  m=Ridge(alpha=alpha).fit(feat[tr],Y[tr]); raw_val=m.predict(feat[va]);
  for scale in [0.,1.,2.,4.,8.,16.]:
   pv=six_prob(raw_val-base,scale)
   met=summarize(pv,Y[va],rank=raw_val)[0]
   options.append((met['logloss'],alpha,scale,met['mean_hits']))
 _,alpha,scale,val_hits=sorted(options,key=lambda z:(z[0],z[1],z[2]))[0]
 model=Ridge(alpha=alpha).fit(feat[tr],Y[tr])
 rv=model.predict(feat[va]);rt=model.predict(feat[te]);pt=six_prob(rt-base,scale)
 raw_scores[name]=rt;probabilities[name]=pt
 valid_metrics[name]=summarize(six_prob(rv-base,scale),Y[va],rv)[0]
 test_metrics[name],test_hits[name],test_idx[name],test_loss_rows[name]=summarize(pt,Y[te],rt)
 configs[name]={'alpha':alpha,'probability_scale':scale,'validation_top6_hits':val_hits}
 print('PROBE',name,configs[name],'test',test_metrics[name],flush=True)

# Linear probe of remembered last input draw; measures representation retention, not next-step forecast.
memory_metrics={}
for name,feat in features.items():
 model=Ridge(alpha=10.).fit(feat[tr],X[tr,-1,:])
 rr=model.predict(feat[te]); p=six_prob(rr-base,8.)
 memory_metrics[name]=summarize(p,X[te,-1,:],rr)[0]
 print('MEMORY',name,memory_metrics[name],flush=True)

# Train direct forecast and pretrained-then-fine-tuned forecast; select epoch by validation log-loss.
def fit_forecast(name,use_pretrained):
 torch.manual_seed(SEED+(30 if use_pretrained else 31))
 m=ForecastNet()
 if use_pretrained:m.encoder.load_state_dict(net.rnn.state_dict())
 opt=torch.optim.AdamW(m.parameters(),lr=.001,weight_decay=.01)
 bestll=1e9;bestepoch=None;state=None;stale=0;history=[]
 for ep in range(1,21):
  m.train();losses=[]
  for xx,yy in tr_dl:
   opt.zero_grad(set_to_none=True)
   loss=nn.functional.binary_cross_entropy_with_logits(m(xx),yy)
   loss.backward();nn.utils.clip_grad_norm_(m.parameters(),1.);opt.step();losses.append(loss.item())
  m.eval();logits=[]
  with torch.no_grad():
   for xx,yy in val_dl:logits.append(m(xx).numpy())
  va_logits=np.vstack(logits); va_prob=six_prob(va_logits)
  vmet=summarize(va_prob,Y[va],va_logits)[0]
  history.append({'epoch':ep,'train_BCE':float(np.mean(losses)),'validation_logloss':vmet['logloss'],'validation_mean_hits':vmet['mean_hits']})
  print(name,'epoch',ep,'train',round(np.mean(losses),6),'val',round(vmet['logloss'],6),'hits',round(vmet['mean_hits'],4),flush=True)
  if vmet['logloss']<bestll-1e-7:
   bestll=vmet['logloss'];bestepoch=ep;state=copy.deepcopy(m.state_dict());stale=0
  else:
   stale+=1
   if stale>=5:break
 m.load_state_dict(state);m.eval();
 def pred(dl):
  out=[]
  with torch.no_grad():
   for xx,yy in dl:out.append(m(xx).numpy())
  return np.vstack(out)
 v=pred(val_dl);t=pred(test_dl)
 valid_metrics[name]=summarize(six_prob(v),Y[va],v)[0]
 probabilities[name]=six_prob(t);raw_scores[name]=t
 test_metrics[name],test_hits[name],test_idx[name],test_loss_rows[name]=summarize(probabilities[name],Y[te],t)
 configs[name]={'best_epoch':bestepoch,'validation_logloss':bestll,'curve':history,'pretrained':use_pretrained}
 torch.save({'state_dict':m.state_dict(),'seed':SEED,'best_epoch':bestepoch,'pretrained':use_pretrained},P/('superenalotto_pretrained_finetuned_v16.pt' if use_pretrained else 'superenalotto_direct_gru_v16.pt'))
 print('FORECAST COMPLETE',name,configs[name]['best_epoch'],test_metrics[name],flush=True)
fit_forecast('Direct GRU',False)
fit_forecast('Masked pretrained + fine-tune',True)

uniform=np.full_like(Y[te],base,dtype=np.float64)
test_metrics['Uniforme (teorica)'],_,_,_=summarize(uniform,Y[te])
# For uniform top-six ranks are arbitrary: do not report these rank hits.
test_metrics['Uniforme (teorica)']['mean_hits']=.4
test_metrics['Uniforme (teorica)']['total_hits']=None

# Expanding frequency baseline: historical draws strictly prior to target, smoothing selected on validation only.
def freq_preds(id_array,k):
 output=[];raw=[]
 for t in id_array:
  cnt=y[:t].sum(axis=0).astype('float64')
  f=(cnt+k*base)/(t+k) if k>0 else cnt/t
  # The average of all p over numbers is 6/90, already satisfying sum 6.
  output.append(np.clip(f,1e-9,1-1e-9));raw.append(cnt/t)
 return np.asarray(output),np.asarray(raw)
freq_options=[]
for k in [0,100,500,1000,5000,20000,100000]:
 p,r=freq_preds(ids[va],k)
 freq_options.append((summarize(p,Y[va],rank=r)[0]['logloss'],k))
k=sorted(freq_options,key=lambda x:(x[0],x[1]))[0][1]
p,r=freq_preds(ids[te],k)
probabilities['Historical frequency']=p;raw_scores['Historical frequency']=r
val_freq_p,val_freq_raw=freq_preds(ids[va],k)
valid_metrics['Historical frequency']=summarize(val_freq_p,Y[va],val_freq_raw)[0]
test_metrics['Historical frequency'],test_hits['Historical frequency'],test_idx['Historical frequency'],test_loss_rows['Historical frequency']=summarize(p,Y[te],r)
configs['Historical frequency']={'smoothing':k,'validation_options':freq_options}
print('HISTFREQ',configs['Historical frequency'],test_metrics['Historical frequency'],flush=True)

# Null distribution and paired block bootstrap to account for serial test structure.
rng=np.random.default_rng(SEED+100);N=len(Y[te]);B=3000;block=25
s=rng.integers(0,N,(B,int(np.ceil(N/block))))
boot=((s[:,:,None]+np.arange(block)[None,None,:])%N).reshape(B,-1)[:,:N]
base_llrow=np.mean(-(Y[te]*np.log(base)+(1-Y[te])*np.log1p(-base)),axis=1)
for name in test_hits:
 vals=test_hits[name];ll=test_loss_rows[name];delta=ll-base_llrow
 test_metrics[name]['mean_hits_bootstrap_ci95']=[float(v) for v in np.quantile(vals[boot].mean(axis=1),[.025,.975])]
 test_metrics[name]['delta_logloss_vs_uniform']=float(delta.mean())
 test_metrics[name]['delta_logloss_vs_uniform_ci95']=[float(v) for v in np.quantile(delta[boot].mean(axis=1),[.025,.975])]
 # Under uniform random sampling without replacement, overlap follows Hypergeom(90,6,6).
 test_metrics[name]['expected_hits_null']=.4

# Pairwise downstream compare against direct GRU
for name in test_hits:
 if name=='Direct GRU':continue
 diff=test_hits[name]-test_hits['Direct GRU']
 test_metrics[name]['delta_hits_vs_direct_gru']=float(diff.mean())
 test_metrics[name]['delta_hits_vs_direct_gru_ci95']=[float(v) for v in np.quantile(diff[boot].mean(axis=1),[.025,.975])]

# Test per-draw traces
out=pd.DataFrame({'data':dates[ids[te]],'concorso':frame.loc[ids[te],'concorso'].to_numpy(),
                  'actual': [' '.join(map(str, np.flatnonzero(v)+1)) for v in Y[te]]})
for name in ['Historical frequency','Random frozen encoder','Masked frozen encoder','Direct GRU','Masked pretrained + fine-tune']:
 key=name.lower().replace(' ','_').replace('+','plus')
 out[key+'_numbers']=[' '.join(map(str, sorted(idx+1))) for idx in test_idx[name]]
 out[key+'_hits']=test_hits[name]
 out[key+'_logloss']=test_loss_rows[name]
out.to_csv(P/'superenalotto_previsioni_test_v16.csv',index=False)

# Summary readable and chart
metrics={ 'experiment':'v16_masked_denoising_pretraining_generating_future_multihot', 'seed':SEED,
 'source':'superenalotto_matrice_binaria_90_v13.csv','source_sha256':hashlib.sha256((P/'superenalotto_matrice_binaria_90_v13.csv').read_bytes()).hexdigest(),
 'input_window':W,'n_numbers':90,'n_hits_per_draw':6,'n_post2009':len(y),
 'chronological_split':{'train_n':int(tr.sum()),'val_n':int(va.sum()),'test_n':int(te.sum()),'train_dates':[dates[W],dates[1499]],'validation_dates':[dates[1500],dates[1819]],'test_dates':[dates[1820],dates[-1]],'target_t_index_ranges':[[W,1499],[1500,1819],[1820,2868]]},
 'masked_pretraining':{'fraction_masked_draws':.20,'validation_masked_full_history_windows':int(preval.sum()),'validation_masked_period':[dates[1600],dates[1819]],'mask_unit':'whole 90-bit draw vector','mask_value':-1,'encoder':'bidirectional GRU','hidden_per_direction':H,'pretraining_best_epoch':pretrain_epoch,'validation_masked_logloss':pretrain_best,'uniform_masked_logloss':float(-(base*np.log(base)+(1-base)*np.log1p(-base))),'pretraining_curve':pretrain_history},
 'latent_memory_probe':memory_metrics,
 'models':configs,'validation_metrics':valid_metrics,'test_metrics':test_metrics,
 'bootstrap':{'n':B,'block_size':block,'method':'circular moving-block bootstrap on per-draw test results'},
 'limitations':['One train/validation/test chronological split, no prospective holdout after November 2026.','Pretraining on masked historical draws tests encoding context, not future forecasting by itself.','Hyperparameter and epoch choice entirely on validation; test only scored once at end.','Repeated experimentation on same 2021-2026 holdout across v14/v15/v16 reduces the strength of claims of test independence across the research program.','Marginal probabilities normalized to have expected sum of six; exact six-number samples require sampling without replacement.']}
(P/'superenalotto_metriche_v16.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
# Chart: valid means vs test means, only test point for uniform
names=['Historical frequency','Random frozen encoder','Masked frozen encoder','Direct GRU','Masked pretrained + fine-tune']
fig,ax=plt.subplots(figsize=(12,5.5));yy=np.arange(len(names));
for j,name in enumerate(names):
 ci=test_metrics[name]['mean_hits_bootstrap_ci95'];mean=test_metrics[name]['mean_hits'];
 ax.errorbar(mean,j,xerr=[[mean-ci[0]],[ci[1]-mean]],fmt='o',capsize=4,label='Test' if j==0 else None)
 ax.plot(valid_metrics[name]['mean_hits'],j,marker='x',markersize=8,label='Validazione' if j==0 else None)
ax.axvline(.4,ls='--',lw=1,label='Casuale teorica: 0,4')
ax.set_yticks(yy,names);ax.invert_yaxis();ax.set_xlabel('Numeri indovinati per estrazione (top 6)');ax.set_title('SuperEnalotto v16 — qualità delle previsioni (1.049 estrazioni test)');ax.legend(loc='lower right');ax.grid(axis='x',alpha=.2);fig.tight_layout();fig.savefig(P/'superenalotto_modelli_generativi_v16.png',dpi=170);plt.close(fig)
fig,ax=plt.subplots(figsize=(10,4.5));ax.plot([x['epoch'] for x in pretrain_history],[x['validation_masked_logloss'] for x in pretrain_history],marker='o',label='Validazione: estrazioni mascherate')
ax.axhline(metrics['masked_pretraining']['uniform_masked_logloss'],ls='--',label='Probabilità uniforme 6/90');ax.set_xlabel('Epoca');ax.set_ylabel('Log-loss');ax.set_title('Pretraining auto-supervisionato — ricostruzione delle estrazioni mascherate');ax.legend();ax.grid(alpha=.2);fig.tight_layout();fig.savefig(P/'superenalotto_pretraining_mascherato_v16.png',dpi=160);plt.close(fig)
print('RESULTS SUMMARY',json.dumps({x:test_metrics[x] for x in names},indent=2),flush=True)
print('COMPLETE',flush=True)
