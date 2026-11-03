#!/usr/bin/env python3
"""SuperEnalotto v17: constrained 6-of-90 set generator with causal GRU latent state.
Run: OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v17.py
This is a research experiment, NOT evidence of increased lottery-winning chances.
"""
from pathlib import Path
from math import comb
import os, time, copy, random, json, hashlib
import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

P=Path(__file__).resolve().parent
SEED=20261103
np.random.seed(SEED); random.seed(SEED); torch.manual_seed(SEED); torch.set_num_threads(2)
N=90; K=6; W=100; H=24
REWARD=np.array([0,.001,.01,1,20,400,10000.], dtype=np.float64)
THEORY=np.array([comb(6,k)*comb(84,6-k)/comb(90,6) for k in range(7)])
REWARD_NULL=float(REWARD @ THEORY)
frame=pd.read_csv(P/'superenalotto_matrice_binaria_90_v13.csv',parse_dates=['data']).sort_values('data',kind='stable').reset_index(drop=True)
frame=frame.loc[frame.data>=pd.Timestamp('2009-07-01')].reset_index(drop=True)
y=frame[[f'n{i:02d}' for i in range(1,91)]].to_numpy(np.float32)
assert len(y)==2869 and np.all(y.sum(axis=1)==6)
ids=np.arange(W,len(y))
X=np.stack([y[t-W:t] for t in ids]).astype('float32');Y=y[ids]
tr=ids<1500;va=(ids>=1500)&(ids<1820);te=ids>=1820
assert [int(tr.sum()),int(va.sum()),int(te.sum())]==[1400,320,1049]
dates=frame.data.dt.strftime('%Y-%m-%d').to_numpy()
print('DATA',len(y),'train',sum(tr),'val',sum(va),'test',sum(te),flush=True)
train_dl=DataLoader(TensorDataset(torch.from_numpy(X[tr]),torch.from_numpy(Y[tr])), batch_size=128,shuffle=True)
val_x=torch.tensor(X[va]);val_y=torch.tensor(Y[va]);test_x=torch.tensor(X[te]);test_y=torch.tensor(Y[te])

class ConstrainedSetGRU(nn.Module):
 def __init__(self,hidden=H):
  super().__init__()
  self.rnn=nn.GRU(90,hidden,batch_first=True)
  self.head=nn.Linear(hidden,90)
  nn.init.normal_(self.head.weight,std=0.015)
  nn.init.zeros_(self.head.bias)
 def forward(self,x,return_state=False):
  h=self.rnn(x)[1][-1]
  logits=3*torch.tanh(self.head(h)/3)
  logits=logits-logits.mean(dim=1,keepdim=True)
  if return_state:return logits,h
  return logits

def poly6(weights):
 """Batched elementary symmetric coefficients e_0..e_6 of 90 or 6 weights.
 This DP implements the exact 6-distinct-unordered lottery measure."""
 b=weights.size(0)
 c=torch.cat((torch.ones((b,1),dtype=weights.dtype,device=weights.device),
              torch.zeros((b,K),dtype=weights.dtype,device=weights.device)),dim=1)
 for i in range(weights.size(1)):
  c=c+torch.cat((torch.zeros_like(c[:,:1]),weights[:,i:i+1]*c[:,:-1]),dim=1)
 return c

def set_metrics(logits,target,reward_strength):
 w=torch.exp(logits)
 # Gather the six actual winning numbers; zeros elsewhere cannot contribute to target polynomial
 ix=torch.topk(target, K,dim=1).indices
 positive=torch.gather(w,1,ix)
 negative=w*(1-target)
 ep=poly6(positive);en=poly6(negative)
 composition=ep*torch.flip(en,dims=(1,))  # k in target, K-k in complement
 z=composition.sum(1)
 nll=(torch.log(z)-torch.gather(logits,1,ix).sum(1)).mean()
 observed_reward=(composition * torch.as_tensor(REWARD,dtype=torch.float32,device=z.device).view(1,-1)).sum(1)/z
 aux=-reward_strength * (observed_reward/REWARD_NULL).mean()
 return nll,aux,observed_reward.mean()

@torch.no_grad()
def predict(m,xx,yy,bs=64):
 m.eval(); ll=[];risk=[];score=[];states=[]
 for a in range(0,len(xx),bs):
  xxpart=xx[a:a+bs];yypart=yy[a:a+bs]
  lg,h=m(xxpart,return_state=True)
  nll,_,exr=set_metrics(lg,yypart,0.)
  # Exact score per-row via numpy elementary symmetric polynomial, retaining full precision.
  log_np=lg.numpy().astype('float64'); tar_np=yypart.numpy().astype('float64')
  for log_row,trow in zip(log_np,tar_np):
   weights=np.exp(log_row)
   pos=weights[trow==1];neg=weights[trow==0]
   def pcoeff(v):
    c=np.r_[1.,np.zeros(K)]
    for wi in v:
     for k in range(K,0,-1):c[k]+=wi*c[k-1]
    return c
   ep=pcoeff(pos); en=pcoeff(neg)
   piece=ep*en[::-1]; Z=piece.sum()
   ll.append(np.log(Z)-log_row[trow==1].sum())
   risk.append((piece@REWARD)/Z)
  score.append(log_np)
  states.append(h.numpy())
 return np.vstack(score),np.array(ll),np.array(risk),np.vstack(states)

def sample_weighted_set(logits,rng):
 """Exact sample from P(S)=prod_{i in S} w_i / e_6(w), not sequential softmax."""
 w=np.exp(logits-np.max(logits));suffix=np.zeros((N+1,K+1),dtype=np.float64);suffix[N,0]=1.
 for i in range(N-1,-1,-1):
  suffix[i]=suffix[i+1]
  suffix[i,1:]+=w[i]*suffix[i+1,:-1]
 picked=[];need=K
 for i in range(N):
  if need==0:break
  if N-i==need:p=1.
  else:p=w[i]*suffix[i+1,need-1]/suffix[i,need]
  if rng.random()<p:picked.append(i);need-=1
 assert len(picked)==K
 return np.array(picked,dtype=int)

def empirical_eval(logits,target):
 top=np.argsort(-logits,axis=1,kind='stable')[:,:6]
 hits=np.take_along_axis(target,top,axis=1).sum(axis=1).astype('int64')
 return top,hits

models={};histories={};chosen={}
for name, lam in [('Set-GRU (likelihood)',0.),('Set-GRU (reward-aware)',.05)]:
 torch.manual_seed(SEED+(0 if lam==0 else 41))
 net=ConstrainedSetGRU();opt=torch.optim.AdamW(net.parameters(),lr=.001,weight_decay=.015)
 best_nll=np.inf;best_sd=None;best_ep=None;stale=0;hist=[]
 for ep in range(1,19):
  net.train();losses=[]
  for xx,yy in train_dl:
   opt.zero_grad(set_to_none=True)
   nll,aux,rr=set_metrics(net(xx),yy,lam)
   loss=nll+aux
   loss.backward();nn.utils.clip_grad_norm_(net.parameters(),1.)
   opt.step();losses.append(float(loss))
  va_score,va_nll,va_risk,va_latent=predict(net,val_x,val_y)
  row={'epoch':ep,'train_total_objective':float(np.mean(losses)),'validation_nll':float(va_nll.mean()),'validation_expected_reward_ratio':float(va_risk.mean()/REWARD_NULL)}
  hist.append(row)
  print('EPOCH',name,ep,'train',round(row['train_total_objective'],5),'valnll',round(row['validation_nll'],6),'riskratio',round(row['validation_expected_reward_ratio'],4),flush=True)
  if row['validation_nll']<best_nll-1e-6:
   best_nll=row['validation_nll'];best_sd=copy.deepcopy(net.state_dict());best_ep=ep;stale=0
  else:
   stale+=1
   if stale>=4:break
 net.load_state_dict(best_sd)
 models[name]=net; histories[name]=hist;chosen[name]={'best_epoch':best_ep,'val_nll':float(best_nll),'reward_strength':lam}
 torch.save({'state_dict':best_sd,'seed':SEED,'hidden_size':H,'window':W,'reward_strength':lam,'best_epoch':best_ep},P/('superenalotto_set_gru_reward_v17.pt' if lam else 'superenalotto_set_gru_likelihood_v17.pt'))

# Frequency baseline: weights conditioned on all draws strictly before target. alpha chosen on validation NLL.
def frequency_logits(indices, strength):
 out=[]
 prefix=np.vstack((np.zeros((1,N)),np.cumsum(y,dtype='float64',axis=0)))
 for t in indices:
  # Laplace prior of pseudo count 50 draws / number
  freq=(prefix[t]+50*(6/90))/(t+50)
  lg=strength*(np.log(freq)-np.log(6/90));lg=lg-np.mean(lg)
  out.append(lg)
 return np.asarray(out)

def reference_eval_np(lg,target):
 nll=[];risk=[]
 for log_row,trow in zip(lg,target):
  w=np.exp(log_row-np.max(log_row))
  c=np.r_[1.,np.zeros(6)]
  for wi in w:
   for i in range(6,0,-1):c[i]+=wi*c[i-1]
  nll.append(np.log(c[6])-np.sum((log_row-np.max(log_row))*trow))
  # positive e0..e6 and negative e0..e6
  a=np.r_[1.,np.zeros(6)];b=np.r_[1.,np.zeros(6)]
  for wi,z in zip(w,trow):
   v=a if z else b
   for i in range(6,0,-1):v[i]+=wi*v[i-1]
  rr=a*b[::-1]
  risk.append(rr@REWARD/rr.sum())
 return np.array(nll),np.array(risk)

val_rows=ids[va];test_rows=ids[te]
frequency_search=[]
for strength in [0.,.25,.5,1.,2.,4.]:
 lg=frequency_logits(val_rows,strength)
 nll,_=reference_eval_np(lg,Y[va])
 frequency_search.append({'strength':strength,'validation_nll':float(nll.mean())})
strength=min(frequency_search,key=lambda z:z['validation_nll'])['strength']
print('FREQUENCY baseline strength',strength,'scan',frequency_search,flush=True)

all_scores={};all_nll={};all_exp_reward={};all_latent={}
all_scores['Uniforme']=np.zeros((te.sum(),N))
all_nll['Uniforme']=np.full(te.sum(),np.log(comb(90,6)))
all_exp_reward['Uniforme']=np.full(te.sum(),REWARD_NULL)
all_scores['Frequenze storiche']=frequency_logits(test_rows,strength)
all_nll['Frequenze storiche'],all_exp_reward['Frequenze storiche']=reference_eval_np(all_scores['Frequenze storiche'],Y[te])
for name,net in models.items():
 sc,nll,risk,lat=predict(net,test_x,test_y)
 all_scores[name]=sc;all_nll[name]=nll;all_exp_reward[name]=risk;all_latent[name]=lat

# Baseline random predictions are a single predetermined fixed-seed stream; uniform log probability is exact.
rng=np.random.default_rng(SEED)
random_tickets=np.stack([rng.choice(N,K,replace=False) for _ in range(te.sum())])
metrics={}; tickets={}; hits_all={}; test_rows_out={}
for name,score in all_scores.items():
 if name=='Uniforme':
  top=random_tickets
 elif name=='Frequenze storiche':
  # Rank by raw historic frequencies even if validation calibrates likelihood to uniform.
  # Probability assessment and rank decision are intentionally reported separately.
  top,_=empirical_eval(frequency_logits(test_rows,1.),Y[te])
 else:
  top,_=empirical_eval(score,Y[te])
 assert np.all(np.diff(np.sort(top,axis=1),axis=1)>0)
 hits=np.take_along_axis(Y[te],top,axis=1).sum(axis=1).astype('int')
 tickets[name]=top; hits_all[name]=hits
 counts=np.bincount(hits,minlength=7)
 utility=float(np.mean(REWARD[hits]))
 metrics[name]={'hits_mean':float(np.mean(hits)),'hits_sum':int(hits.sum()),
                'counts_by_hits':counts.tolist(),'p_at_least_3':float(np.mean(hits>=3)),
                'utility_mean':utility,'utility_over_random_expectation':utility/REWARD_NULL,
                'exact_set_nll_mean':float(np.mean(all_nll[name])),
                'prob_of_true_set_geometric_mean':float(np.exp(-np.mean(all_nll[name]))),
                'expected_reward_under_model_mean':float(np.mean(all_exp_reward[name])),
                'expected_reward_ratio_to_uniform':float(np.mean(all_exp_reward[name])/REWARD_NULL)}
 print('TEST',name,json.dumps(metrics[name],ensure_ascii=False),flush=True)

# Latent diagnostic: temporal-neighbor cosine similarity (mainly due to 99/100 overlapping inputs);
# and linear correlation between latent dimensions and next-draw sets compared to zero-state baseline.
latent_checks={}
for name,states in all_latent.items():
 unit=states/np.maximum(np.linalg.norm(states,axis=1,keepdims=True),1e-12)
 mean_neighbor=float((unit[1:]*unit[:-1]).sum(1).mean())
 # Permute alignments to create an internal reference, not a prospective prediction test.
 perm=np.random.default_rng(SEED+333).permutation(len(unit))
 perm_neighbor=float((unit[perm[1:]]*unit[perm[:-1]]).sum(1).mean())
 latent_checks[name]={'neighbor_cosine':mean_neighbor,'random_pair_cosine':perm_neighbor,
                      'warning':'Neighbor similarity is inflated by overlapping history windows; it is not evidence of forecast skill.'}

# Exact baseline / significance flags; no claims of prospective validation from reused test.
output=pd.DataFrame({'data':dates[test_rows], 'concorso':frame.concorso.to_numpy()[test_rows]})
for name in all_scores:
 slug={'Uniforme':'uniform','Frequenze storiche':'freq','Set-GRU (likelihood)':'gru_nll','Set-GRU (reward-aware)':'gru_reward'}[name]
 output[f'{slug}_ticket']=' '.join([]) if False else [' '.join(map(str,np.sort(t+1))) for t in tickets[name]]
 output[f'{slug}_hits']=hits_all[name]
 output[f'{slug}_reward']=REWARD[hits_all[name]]
 output[f'{slug}_exact_nll']=all_nll[name]
 output[f'{slug}_expected_utility']=all_exp_reward[name]
output.to_csv(P/'superenalotto_previsioni_test_v17.csv',index=False)

results={'seed':SEED,'dataset_sha256':hashlib.sha256((P/'superenalotto_matrice_binaria_90_v13.csv').read_bytes()).hexdigest(),
         'dataset':{'draws_after_2009':len(y),'context_window':W,'train_examples':int(tr.sum()),'val_examples':int(va.sum()),'test_examples':int(te.sum()),'validation_start':dates[1500], 'test_start':dates[1820],'test_end':dates[-1]},
         'architecture':{'generator':'conditional product-of-weights on 6-element subsets, exact e6 partition','encoder':'causal GRU 90 -> 24 latent -> 90 logits','nll':'log e6(exp(logits))-sum logits on six winning numbers','validity':'Six unique numbers by construction; set is unordered'},
         'reward':{str(i):float(REWARD[i]) for i in range(7)},
         'random_reference':{'combination_count':comb(90,6),'hit_probabilities':THEORY.tolist(),'p_ge3':float(THEORY[3:].sum()),'expected_rewards_per_draw':REWARD_NULL},
         'valid_selection':{'frequency_scan':frequency_search,'selected_frequency_strength':strength,'gru':chosen},
         'train_curves':histories,'test':metrics,'latent_diagnostics':latent_checks,
         'disclaimer':'Test 2021-2026 already reused in previous experiments; results are exploratory, not statistically independent validation.',
         'ranking_note':'Frequency baseline always ranks on causal historic counts; validation-chosen temperature calibrates joint probabilities separately (may be zero).'}
(P/'superenalotto_metriche_v17.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')

# Graph: absolute counts and theoretical expected overlap counts for reference.
fig,ax=plt.subplots(figsize=(10,5.8))
x=np.arange(7);wid=.18
for j,(name,met) in enumerate(metrics.items()):
 ax.bar(x+(j-1.5)*wid,met['counts_by_hits'],width=wid,label=name)
ax.plot(x,THEORY*te.sum(),marker='o',ls='--',color='black',label='Casuale: valore atteso')
ax.set_yscale('symlog',linthresh=1);ax.set_xticks(x);ax.set_xlabel('Numeri corretti nella sestina proposta')
ax.set_ylabel('Estrazioni (scala simmetrica logaritmica)')
ax.set_title('Distribuzione dei risultati parziali — test 2021–2026')
ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8);fig.tight_layout()
fig.savefig(P/'superenalotto_punteggi_parziali_v17.png',dpi=160);plt.close(fig)

fig,ax=plt.subplots(figsize=(9,4.8))
for name,hist in histories.items():
 ax.plot([r['epoch'] for r in hist],[r['validation_nll'] for r in hist],label=name,marker='o')
ax.axhline(np.log(comb(90,6)),color='black',linestyle='--',label='Uniforme: log C(90,6)')
ax.set(xlabel='Epoca',ylabel='NLL della sestina intera (minore = migliore)',title='Validazione cronologica del generatore di sestine')
ax.grid(alpha=.25);ax.legend();fig.tight_layout()
fig.savefig(P/'superenalotto_set_generator_validazione_v17.png',dpi=160);plt.close(fig)

# cumulative Markdown from v16, preserving old text byte-for-byte besides title and appending v17
old=(P/'superenalotto_analisi_filtri_v16.md').read_text(encoding='utf-8')
old=old.replace('(v16)','(v17)',1)
new='''

---

## Esperimento v17 — Generatore vincolato di sestine e punteggi parziali

### Obiettivo e distinzione delle metriche
Il nuovo obiettivo primario è **predire la sestina intera**. Per non ridurre il monitoraggio a un successo praticamente mai osservabile, registriamo separatamente quanti numeri vengono indovinati (0–6), la quota di 3+, il punteggio parziale ponderato e la **negative log-likelihood dell'intera sestina** (criterio probabilistico proprio). Non si ottimizzano i parametri usando il test finale.

La funzione di utilità, **convenzione sperimentale non equivalente ai premi monetari**, è: `R(0)=0`, `R(1)=0,001`, `R(2)=0,01`, `R(3)=1`, `R(4)=20`, `R(5)=400`, `R(6)=10.000`.
Il salto da 2 a 3 è di 100×; da 3 in poi i pesi crescono in modo marcato. La categoria **2** del SuperEnalotto dà comunque diritto a un premio, secondo il sito ufficiale: https://www.superenalotto.it/quanto-si-vince . La tabella qui misura priorità di ricerca, non importi di vincita.

### Probabilità teoriche dei risultati parziali
Con una sestina proposta indipendente e uniforme e una sestina vincente uniforme,
`P(K=k)=C(6,k) C(84,6-k) / C(90,6)`. Questo è il riferimento corretto anche quando valorizziamo 3, 4, 5 e 6 successi.

| K corrette | Probabilità | Valore atteso su 1.049 test | Punteggio R(K) |
|---:|---:|---:|---:|
'''
for k in range(7):
 new+=f'| {k} | {THEORY[k]:.10g} | {THEORY[k]*1049:.5f} | {REWARD[k]:g} |\n'
new+=f'\n- P(K>=3) teorica = **{THEORY[3:].sum()*100:.5f}%**, circa **{THEORY[3:].sum()*1049:.2f}** eventi in 1049 estrazioni.\n'
new+=f'- Utilità media teorica con scelta casuale = **{REWARD_NULL:.8f}** punti/estrazione.\n'
new+='''- Eventi con 4+ sono troppo rari per stimarne con precisione la frequenza su ~1000 test. Perciò un aumento isolato di 3+ non dimostra un modello del generatore.

### Distribuzione generativa realmente vincolata
Si codificano **100 estrazioni precedenti** come vettori binari di lunghezza 90. Una **GRU causale** produce uno stato latente di 24 dimensioni e 90 logits `a_i`. La rete descrive direttamente **una distribuzione su tutte le 622.614.630 sestine non ordinate e senza ripetizioni**:

`P(S | storia) = exp(sum_{i in S} a_i) / e_6(exp(a_1), ..., exp(a_90))`, per `|S|=6`, dove `e_6` è il sesto polinomio simmetrico elementare calcolato esattamente con programmazione dinamica (O(90·6) operazioni per esempio).

Con logits tutti uguali, il modello torna esattamente alla distribuzione uniforme su 6 numeri distinti. Il set più probabile è formato dai sei pesi maggiori, ma il codice include anche un **campionatore esatto** dalla distribuzione, tramite DP sui coefficienti di suffisso. Le dipendenze fra inclusioni sono imposte dal vincolo 6/90; il modello di prodotto di pesi **non** rappresenta interazioni arbitrarie fra coppie o gruppi di numeri: servirà un modello più espressivo solo se questa baseline presenta evidenza positiva.

È possibile calcolare anche **l'utilità attesa esatta** della distribuzione, dato il risultato reale, senza campionare milioni di sestine: si separano i sei pesi relativi ai numeri vincenti dagli altri 84 e si combina `e_k(6 vincenti) · e_(6-k)(84 non vincenti)`; il peso di ogni k è diviso per `e_6(90 numeri)`.

### Addestramento, controlli e limiti
- Dati: solo estrazioni dal luglio 2009; finestra di 100 estrazioni. Training 1.400 esempi, validazione 320, test 1.049 (2021-03-30 — 2026-10-31); medesima suddivisione della versione 16 per confronto.
- **Set-GRU (likelihood)**: si minimizza la NLL esatta del set osservato.
- **Set-GRU (reward-aware)**: NLL + termine ausiliario che massimizza l'utilità attesa normalizzata rispetto al riferimento casuale, con peso prefissato `0,05`. Non si tratta di assegnare il premio reale durante l'addestramento.
- AdamW lr=0,001, weight decay=0,015, batch=128, massimo 18 epoche, stop dopo 4 senza miglioramento. Selezione della singola epoca **solo tramite NLL di validazione**. Il peso reward-aware è prefissato prima di consultare il test.
- Baseline uniforme e baseline di frequenze storiche causali (smoothing 50 estrazioni). Per la **baseline frequenze**, la sestina proposta deriva sempre dai sei numeri più frequenti dello storico disponibile; la temperatura probabilistica per la NLL è invece selezionata in validazione e può essere zero. La distinzione fra *ranking* e *calibrazione* evita di trasformare una temperatura zero nella previsione fittizia dei numeri 1–6. La sestina uniforme del confronto empirico è campionata con seed fisso, non scelta retroattivamente.
- **Riserva essenziale**: le estrazioni del 2021–2026 sono state utilizzate nei precedenti studi v14–v16. Non si tratta quindi di un nuovo test esterno mai esplorato; sono indispensabili previsioni su estrazioni future per convalidare un eventuale vantaggio.

### Risultati sul test cronologico (1.049 estrazioni)

| Modello | Media corrette | Corrette totali | 3+ | 4+ | 5+ | 6 | Utilità R media | NLL set (minore meglio) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
'''
for name,m in metrics.items():
 cs=m['counts_by_hits'];new+=f"| {name} | {m['hits_mean']:.4f} | {m['hits_sum']} | {sum(cs[3:])} | {sum(cs[4:])} | {sum(cs[5:])} | {cs[6]} | {m['utility_mean']:.6f} | {m['exact_set_nll_mean']:.6f} |\n"
new+=f'\nUniforme teorico: **0,4** numeri indovinati in media, **{REWARD_NULL:.6f}** punti/estrazione e NLL esatta **{np.log(comb(90,6)):.6f}**. La baseline casuale empirica usa una sequenza campionata indipendentemente (non deve necessariamente realizzare esattamente 0,4).\n'
new+='\n### Esito della validazione e stato latente\n\n'
for name,ch in chosen.items():
 new+=f"- {name}: epoca selezionata **{ch['best_epoch']}**, NLL validazione **{ch['val_nll']:.6f}**.\n"
new+=f'- Frequenze storiche: intensità selezionata **{strength}** sulla validazione.\n'
for name,c in latent_checks.items():
 new+=f"- {name}: similarità coseno fra stati latenti successivi **{c['neighbor_cosine']:.4f}** vs coppie permutate **{c['random_pair_cosine']:.4f}**. La grande somiglianza fra finestre consecutive deriva anche dalle 99/100 estrazioni condivise: non è, da sola, una struttura predittiva.\n"
new+='''
### Artefatti e riproducibilità
- `compute_v17.py`: codice completo, loss normalizzata esatta, utility-aware, campionatore vincolato, metriche, addestramento e verifica.
- `superenalotto_previsioni_test_v17.csv`: una riga per estrazione, sestine proposte, numero di successi, utilità e NLL esatta per ciascun metodo.
- `superenalotto_metriche_v17.json`: impostazioni, curva di validazione, distribuzioni, stato latente, valori teorici, checksum e scelte degli iperparametri.
- `superenalotto_set_gru_likelihood_v17.pt` e `superenalotto_set_gru_reward_v17.pt`: pesi dei due modelli con seed.
- `superenalotto_punteggi_parziali_v17.png`: istogramma degli esiti da 0 a 6; `superenalotto_set_generator_validazione_v17.png`: NLL di validazione per epoca.
- **F01–F14 invariati.** Nessun nuovo filtro aggiunto; si tratta di un nuovo esperimento di generazione e valutazione.

### Registro aggiornamenti
- **v17:** modello generativo vincolato e non ordinato delle sestine 6/90 con normalizzazione esatta; NLL e funzione di utilità che premia 3–6 corrispondenze, confronto con baseline uniforme e frequenze storiche e diagnostica dello stato latente.
'''
# Summary after running, no requirement to claim superiority if not found.
(P/'superenalotto_analisi_filtri_v17.md').write_text(old+new,encoding='utf-8')
print('COMPLETE',P/'superenalotto_analisi_filtri_v17.md',flush=True)
