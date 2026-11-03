"""SuperEnalotto v07: exploratory temporal/chaos/pseudorandom diagnostics and honest holdout tests.
Usage: python compute_v07.py; reads estrazioni_con_ritardi.csv; writes CSVs + JSON metrics.
"""
from pathlib import Path
import json
from math import comb
import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.multitest import multipletests
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import log_loss

ROOT=Path('/mnt/data')
df=pd.read_csv(ROOT/'estrazioni_con_ritardi.csv',sep=';',encoding='utf-8-sig')
df['data']=pd.to_datetime(df['data'])
df=df.sort_values(['data','concorso']).reset_index(drop=True)
numcols=[f'n{i}' for i in range(1,7)]
delaycols=[f'ritardo_{i}' for i in range(1,7)]
nums=df[numcols].to_numpy(dtype=np.int16)
assert len(df)==4294
assert np.all(nums[:,1:]>nums[:,:-1])
N=len(nums); RNG=np.random.default_rng(20261102)
START=150; LAGS=30; B=400
last=np.full(91,-1,dtype=np.int32)
ages=np.zeros((N,90),dtype=np.int16)
calc=np.full((N,6),np.nan)
for t,draw in enumerate(nums):
    ages[t]=t-last[1:]
    if np.all(last[1:]>=0):calc[t]=np.sort(ages[t,draw-1])
    last[draw]=t
record=df[delaycols].to_numpy(dtype=float)
valid=~np.isnan(record).any(axis=1)
validreconstructed=np.isfinite(calc).all(axis=1)
assert np.array_equal(calc[validreconstructed],record[validreconstructed])
assert np.all(validreconstructed<=valid)
X=np.column_stack((nums,calc))[START:].astype(float)
colnames=numcols+delaycols

def features(x, n_lags=LAGS):
    x=x.astype(np.float64)
    z=x-x.mean()
    n=len(x)
    ft=np.fft.rfft(z,n=1<<(2*n-1).bit_length())
    acov=np.fft.irfft(ft*np.conj(ft))[:n_lags+1]
    acf=acov[1:]/acov[0]
    # Normalize periodogram by its mean, omitting dc and sub-1/(N/500) frequencies
    pow=np.abs(np.fft.rfft(z))**2
    start=max(1,int(np.floor(n/500)))
    pf=pow[start:-1]
    k=np.argmax(pf)+start
    spec=float(pow[k]/pf.mean())
    period=float(n/k)
    return float(acf[0]),float(np.max(np.abs(acf))),int(np.argmax(np.abs(acf))+1),spec,period

observed=np.array([features(X[:,j]) for j in range(12)])
# Cross-correlation (sorting necessarily creates strong same-draw correlations).
cor=np.corrcoef(X,rowvar=False)
# Control simulations: 6 distinct uniformly sampled numbers / draw (via smallest 6 of iid uniform noise)
null_acf=np.zeros((B,12)); null_maxacf=np.zeros((B,12)); null_spec=np.zeros((B,12))
null_cor=np.empty((B,12,12),dtype=np.float32)
null_overlap=np.empty(B)
for b in range(B):
    rand=RNG.random((N,90),dtype=np.float32)
    picked=np.sort(np.argpartition(rand,6,axis=1)[:,:6]+1,axis=1).astype(np.int16)
    last0=np.full(91,-1,dtype=np.int32)
    delays0=np.empty((N-START,6),dtype=np.int16)
    for t,draw in enumerate(picked):
        if t>=START:
            delays0[t-START]=np.sort(t-last0[draw])
        last0[draw]=t
    Y=np.column_stack([picked[START:],delays0])
    f=np.array([features(Y[:,j]) for j in range(12)])
    null_acf[b]=f[:,0];null_maxacf[b]=f[:,1];null_spec[b]=f[:,3]
    null_cor[b]=np.corrcoef(Y,rowvar=False)
    null_overlap[b]=np.isin(picked[1:],picked[:-1]).sum()/(N-1) if False else sum(len(set(picked[t]).intersection(picked[t-1])) for t in range(1,N))/(N-1)

pmax=(1+np.sum(null_maxacf>=observed[:,1],axis=0))/(B+1)
pspec=(1+np.sum(null_spec>=observed[:,3],axis=0))/(B+1)
pacf=(1+np.sum(np.abs(null_acf)>=np.abs(observed[:,0]),axis=0))/(B+1)
qglobal=multipletests(np.r_[pmax,pspec],method='fdr_bh')[1]
summary=pd.DataFrame({
    'colonna':colnames,
    'media':X.mean(axis=0),'dev_standard':X.std(axis=0,ddof=1),
    'min':X.min(axis=0).astype(int),'max':X.max(axis=0).astype(int),
    'acf_lag1':observed[:,0],'p_acf_lag1_null':pacf,
    'massimo_abs_acf_lags1_30':observed[:,1], 'lag_picco_acf':observed[:,2].astype(int),
    'p_massimo_acf_null':pmax,'q_massimo_acf_BH_24':qglobal[:12],
    'periodo_spettrale_picco_in_estrazioni':observed[:,4],
    'potenza_picco_normalizzata':observed[:,3],
    'p_periodicita_null':pspec,'q_periodicita_BH_24':qglobal[12:]
})
summary.to_csv(ROOT/'superenalotto_diagnostica_colonne_v07.csv',index=False,float_format='%.7g')

# Correlations of any pair across columns, calibrated under null (not under naive independent uniform slots)
pairrows=[]
for i in range(12):
 for j in range(i+1,12):
    a=cor[i,j]
    s=null_cor[:,i,j].astype(float)
    p=(1+np.sum(np.abs(s-np.mean(s))>=np.abs(a-np.mean(s))))/(B+1)
    pairrows.append((colnames[i],colnames[j],a,np.mean(s),np.std(s,ddof=1),p))
pairs=pd.DataFrame(pairrows,columns=['colonna_a','colonna_b','corr_osservata','corr_media_null','sd_null','p_due_code'])
pairs['q_BH_66']=multipletests(pairs['p_due_code'],method='fdr_bh')[1]
pairs.to_csv(ROOT/'superenalotto_correlazioni_v07.csv',index=False,float_format='%.7g')

# Theoretical overlap distribution of consecutive draws
ov=np.array([len(set(nums[t]).intersection(nums[t-1])) for t in range(1,N)])
theo=np.array([comb(6,k)*comb(84,6-k)/comb(90,6) for k in range(7)])
overlap={'osservato_medio':float(ov.mean()),'atteso_medio':0.4,'null_p_due_code':float((1+np.sum(abs(null_overlap-0.4)>=abs(ov.mean()-0.4)))/(B+1)),
         'distribuzione_osservata':np.bincount(ov,minlength=7).tolist(),'probabilita_teoriche':theo.tolist()}

# out-of-sample forecast each of the 12 columns from 1..3 past rows all 12 values:
# one fixed chronological split, models fit once to training set, evaluated on untouched end.
split=int(0.70*N)
lagidx=np.arange(START+3,N)
full=np.column_stack([nums,calc]).astype(float)
lag_feats=np.column_stack([full[lagidx-l] for l in [1,2,3]])
train=lagidx<split;test=lagidx>=split
forecast_rows=[]
for j,c in enumerate(colnames):
    target=full[lagidx,j]
    model=HistGradientBoostingRegressor(max_iter=70,max_leaf_nodes=9,max_depth=3,
                                        learning_rate=0.05,l2_regularization=30,
                                        min_samples_leaf=50,random_state=20261102)
    model.fit(lag_feats[train],target[train])
    y=target[test]
    baseline=np.full(len(y),target[train].mean())
    pred=model.predict(lag_feats[test])
    baseline_mae=float(np.mean(np.abs(y-baseline)))
    model_mae=float(np.mean(np.abs(y-pred)))
    baseline_mse=float(np.mean((y-baseline)**2))
    model_mse=float(np.mean((y-pred)**2))
    forecast_rows.append({'colonna':c,'MAE_baseline':baseline_mae,'MAE_modello':model_mae,
                          'miglioramento_MAE_percento':100*(baseline_mae-model_mae)/baseline_mae,
                          'MSE_baseline':baseline_mse,'MSE_modello':model_mse,
                          'skill_MSE':1-model_mse/baseline_mse})
forecasts=pd.DataFrame(forecast_rows)
forecasts.to_csv(ROOT/'superenalotto_previsione_colonne_v07.csv',index=False,float_format='%.7g')

# More meaningful holdout: predict per-number presence by pre-draw age & recent frequency.
occ=np.zeros((N,90),dtype=np.uint8)
for t,draw in enumerate(nums):occ[t,draw-1]=1
cum=np.vstack((np.zeros((1,90),dtype=np.int32),occ.cumsum(axis=0)))
recent30=np.zeros((N,90),dtype=np.float32)
recent100=np.zeros((N,90),dtype=np.float32)
for t in range(START,N):
    recent30[t]=cum[t]-cum[max(0,t-30)]
    recent100[t]=cum[t]-cum[max(0,t-100)]
numval=np.tile(np.arange(1,91,dtype=np.float32),(N,1))
feat=np.stack((np.log1p(ages),np.minimum(ages,120),recent30,recent100,
              np.vstack([np.zeros((1,90)),occ[:-1]]),numval/90),axis=2)[START:]
Y=occ[START:]; indx=np.arange(START,N); tr=indx<split; te=~tr
scale=StandardScaler().fit(feat[tr].reshape(-1,6))
mod=LogisticRegression(C=0.1, max_iter=200,random_state=20261102)
mod.fit(scale.transform(feat[tr].reshape(-1,6)),Y[tr].ravel())
prob=mod.predict_proba(scale.transform(feat[te].reshape(-1,6)))[:,1].reshape(-1,90)
y=Y[te]
base_prob=6/90
neg_log=lambda p:float(-np.mean(y*np.log(p)+(1-y)*np.log1p(-p)))
base_loss=float(-np.mean(y*np.log(base_prob)+(1-y)*np.log(1-base_prob)))
base_brier=float(np.mean((y-base_prob)**2))
model_brier=float(np.mean((y-prob)**2))
# selected 6 with highest modeled odds, average number of actual wins contained per draw
pick=np.argpartition(prob,-6,axis=1)[:,-6:]
correct=y[np.arange(len(y))[:,None],pick].sum(axis=1)
# Null mean expected hits fixed 6 numbers: .4, distribution hypergeometric. Calculate conservative SE via per-row sample var / sqrt(n).
se_hits=float(correct.std(ddof=1)/np.sqrt(len(correct)))
modelout={'train_estrazioni':int(np.sum(tr)),'test_estrazioni':int(np.sum(te)),
          'date_test_inizio':str(df.loc[indx[te][0],'data'].date()),'date_test_fine':str(df.loc[indx[te][-1],'data'].date()),
          'logloss_casuale':base_loss,'logloss_logistica':neg_log(prob),
          'brier_casuale':base_brier,'brier_logistica':model_brier,
          'media_numeri_vincenti_in_top6':float(correct.mean()),'baseline_media_top6':0.4,
          'errore_standard_empirico_top6':se_hits,
          'distribuzione_hit_top6':np.bincount(correct.astype(int),minlength=7).tolist(),
          'regression_coefficients':mod.coef_[0].tolist()}

# Frequency by number, global uniformity and stability (descriptive only)
freq=occ.sum(axis=0)
expected=N*6/90
chi=float(np.sum((freq-expected)**2/expected))
null_chi=[]
for b in range(300):
   sim=np.argpartition(RNG.random((N,90),dtype=np.float32),6,axis=1)[:,:6]
   f=np.bincount(sim.ravel(),minlength=90)
   null_chi.append(np.sum((f-expected)**2/expected))
pchi=(1+sum(v>=chi for v in null_chi))/(len(null_chi)+1)
frequency={'chi2_frequenze_90':chi,'p_chi2_null':pchi,'min_frequenza':int(freq.min()),
           'max_frequenza':int(freq.max()),'media_frequenza':float(freq.mean())}

info={'n_estrazioni':N,'n_serie_diagnostica':len(X),'data_inizio_diagnostica':str(df.loc[START,'data'].date()),
      'data_fine':str(df.loc[N-1,'data'].date()),'n_simulazioni_null':B,'inizio_validita_ritardi':int(np.flatnonzero(validreconstructed)[0]),
      'n_ritardi_completi_csv':int(valid.sum()),'n_ritardi_ricostruiti':int(validreconstructed.sum()),
      'cut_train_end':str(df.loc[split-1,'data'].date()),'cut_test_start':str(df.loc[split,'data'].date()),
      'n_test':int(N-split),'n_acf_significativi_BH_24':int(sum(qglobal[:12]<.05)),
      'n_periodici_significativi_BH_24':int(sum(qglobal[12:]<.05)),
      'n_crosscorr_significativi_BH_66':int(sum(pairs.q_BH_66<.05)),
      'overlap':overlap,'number_predictor':modelout,'frequency':frequency,
      'forecast_improve_MAE':int((forecasts.miglioramento_MAE_percento>0).sum()),
      'forecast_improve_MSE':int((forecasts.skill_MSE>0).sum())}
(ROOT/'superenalotto_metriche_v07.json').write_text(json.dumps(info,indent=2,ensure_ascii=False))
print('SUMMARY\n',summary.to_string(index=False,float_format=lambda x:f'{x:.3f}'))
print('PAIR significant:',pairs.query('q_BH_66 < .05').to_string(index=False))
print('FORECAST\n',forecasts.to_string(index=False,float_format=lambda x:f'{x:.3f}'))
print('RESULT\n',json.dumps(info,ensure_ascii=False,indent=2))
