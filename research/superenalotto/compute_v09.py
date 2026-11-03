#!/usr/bin/env python3
"""Diagnostica di epoca SuperEnalotto e dei record di ordine di uscita v09.
Input: estrazioni_con_ritardi.csv; output: CSV/JSON con verifiche e statistiche.
Nessun fetch di rete; l'ordine fisico qui usato è trascritto da pagine verificate.
"""
from pathlib import Path
from scipy import stats
import pandas as pd, numpy as np, hashlib, json
ROOT=Path('/mnt/data'); DATA=ROOT/'estrazioni_con_ritardi.csv'
df=pd.read_csv(DATA,sep=';',encoding='utf-8-sig')
df['data']=pd.to_datetime(df['data']); df['concorso']=df['concorso'].astype(int)
df=df.sort_values(['data','concorso']).reset_index(drop=True)
num_cols=[f'n{k}' for k in range(1,7)]
assert len(df)==4294
assert df[num_cols].notna().all().all()
# Trascrizione delle pagine citate, senza ipotizzare dati non osservati.
observed = {
 (2026,175):[78,20,18,46,4,33],
 (2026,174):[19,85,24,64,62,49],
 (2026,173):[41,13,77,60,20,85],
 (2026,172):[44,64,34,23,48,70],
 (2026,171):[50,32,80,73,17,11],
 (2026,170):[29,41,83,66,34,81],
 (2026,169):[62,3,18,82,14,13],
 (2026,168):[13,25,45,37,50,72],
 (2026,167):[23,25,86,37,55,77],
 (2026,166):[41,55,54,35,76,44],
 (2026,165):[80,49,77,16,46,24],
 (2026,147):[40,14,3,7,78,81],
 (2026,100):[1,17,27,84,66,12],
 (2026,79):[69,89,90,12,60,7],
 (2025,100):[63,36,23,64,2,32],
 (2024,180):[13,81,29,32,39,28],
 (2024,141):[69,32,29,5,89,4],
 (2024,208):[40,5,16,47,80,23],
 (2024,174):[3,61,43,77,27,19],
 (2024,190):[44,55,75,80,33,21],
}
# Esempi sospetti: sequenze identiche all'ordine crescente, riportate dal sito.
examples_suspect={(2009,2):[17,24,25,40,58,64],(2009,9):[19,35,49,52,75,79],
                  (2010,149):[3,17,48,76,77,90],(2015,15):[12,29,43,56,60,75],
                  (2015,19):[25,32,44,56,77,87]}
rows=[]
for (year,contest),numbers in list(observed.items())+list(examples_suspect.items()):
    match=df[(df.data.dt.year==year)&(df.concorso==contest)]
    if len(match)!=1:
        raise ValueError(f'chiave non univoca o assente {(year,contest)}: {len(match)}')
    row=match.iloc[0]; sorted_nums=list(map(int,row[num_cols]))
    assert sorted(numbers)==sorted_nums, ((year,contest),numbers,sorted_nums)
    questionable=(year,contest) in examples_suspect
    rows.append(dict(data=row.data.date().isoformat(),anno=year,concorso=contest,
        **{f'estratto_{k+1}':int(n) for k,n in enumerate(numbers)},
        sestina_crescente='-'.join(map(str,sorted_nums)),
        ordine_crescente=int(numbers==sorted_nums),
        stato='SOSPETTO_ORDINE_CRESCENTE' if questionable else 'CANDIDATO_ORDINE_FISICO',
        url=f'https://www.superenalottoitalia.com/estrazione-superenalotto-{contest}-{year}/'))
res=pd.DataFrame(rows).sort_values(['data','concorso']);
res.to_csv(ROOT/'superenalotto_ordini_fisici_campione_v09.csv',index=False)
# Esaminare separatamente epoca Lotto (<1 luglio 2009) e macchine autonome.
df['epoca']=np.where(df.data<pd.Timestamp('2009-07-01'),'lotto_pre_2009','autonomo_post_2009')
sums=df[num_cols].sum(axis=1).values
m0=(df['epoca']=='lotto_pre_2009').values
m1=~m0
older=sums[m0]; newer=sums[m1]
welch=stats.ttest_ind(older,newer,equal_var=False)
# H0 media 273 con SD teorica: Var(sum senza reinserimento) = n*(N-n)/(N-1)*Var_pop
N=90;n=6
var_pop=(N*N-1)/12
var_sum=n*(N-n)/(N-1)*var_pop
# chi-quadro di omogeneità tra numeri, con per-estrazione dipendenza intraseda
counts=np.empty((2,90),dtype=int)
for i,mask in enumerate((m0,m1)):
    counts[i]=np.bincount(df.loc[mask,num_cols].values.astype(int).ravel(), minlength=91)[1:]
cont=stats.chi2_contingency(counts,correction=False)
# permutazione delle etichette di epoca come blocchi di sestine, evita independenza delle 6 palline
onehot=np.zeros((len(df),90),dtype=np.int8)
ix=(df[num_cols].values.astype(int)-1)
onehot[np.arange(len(df))[:,None], ix]=1
obs_sq=float(cont.statistic)
# two-sample chi-square using existing pooled number totals
pool=counts.sum(axis=0)
exp0=pool*(m0.sum()/len(df)); exp1=pool*(m1.sum()/len(df))
rng=np.random.default_rng(20261102)
B=1500
ge=0
for _ in range(B):
    ids=rng.permutation(len(df))
    count0=onehot[ids[:m0.sum()]].sum(axis=0)
    count1=pool-count0
    chi=np.sum((count0-exp0)**2/exp0+(count1-exp1)**2/exp1)
    if chi>=obs_sq:ge+=1
mc_p=(ge+1)/(B+1)
# A bootstrap confidence interval for the pre-post difference in mean sum
Bboot=5000
boot=np.empty(Bboot)
for b in range(Bboot):
    boot[b]=rng.choice(older,len(older),replace=True).mean()-rng.choice(newer,len(newer),replace=True).mean()
ci=np.quantile(boot,[0.025,0.975])
metrics={
 'sample_size_total':len(df),'pre_count':int(m0.sum()),'post_count':int(m1.sum()),
 'pre_period':[df.loc[m0,'data'].min().date().isoformat(),df.loc[m0,'data'].max().date().isoformat()],
 'post_period':[df.loc[m1,'data'].min().date().isoformat(),df.loc[m1,'data'].max().date().isoformat()],
 'pre_sum_mean':float(older.mean()),'post_sum_mean':float(newer.mean()),
 'pre_post_diff':float(older.mean()-newer.mean()),'pre_post_diff_bootstrap_ci95':ci.tolist(),
 'pre_post_diff_welch_p':float(welch.pvalue),
 'sum_theory_mean':273,'sum_theory_sd':float(np.sqrt(var_sum)),
 'pre_mean_vs_theory_z':float((older.mean()-273)/np.sqrt(var_sum/len(older))),
 'post_mean_vs_theory_z':float((newer.mean()-273)/np.sqrt(var_sum/len(newer))),
 'number_dist_chi2':obs_sq,'number_dist_chi2_df':89,
 'number_dist_asymptotic_p':float(cont.pvalue),
 'number_dist_row_permutation_p':float(mc_p),'number_dist_mc_B':B,
 'physical_sample_size':len(observed),'ambiguous_placeholder_examples':len(examples_suspect),
 'physical_sample_date_min':str(res[res.stato=='CANDIDATO_ORDINE_FISICO'].data.min()),
 'physical_sample_date_max':str(res[res.stato=='CANDIDATO_ORDINE_FISICO'].data.max()),
 'csv_sha256':hashlib.sha256(DATA.read_bytes()).hexdigest(),
 'random_seed':20261102
}

# Un piccolo test permutazionale condizionato alle sestine: nessun modello addestrato.
physical=res[res.stato=='CANDIDATO_ORDINE_FISICO']
seq=physical[[f'estratto_{j}' for j in range(1,7)]].to_numpy(dtype=int)
ranks=np.argsort(np.argsort(seq,axis=1),axis=1)
rank_counts=np.stack([np.bincount(ranks[:,j],minlength=6) for j in range(6)])
stat_rank=float(np.sum((rank_counts-len(seq)/6)**2/(len(seq)/6)))
B_rank=20000
ge_rank=0
for _ in range(B_rank):
    fake=np.stack([rng.permutation(6) for _ in range(len(seq))])
    c=np.stack([np.bincount(fake[:,j],minlength=6) for j in range(6)])
    s=float(np.sum((c-len(seq)/6)**2/(len(seq)/6)))
    if s>=stat_rank:ge_rank+=1
metrics.update({
 'physical_rank_test_statistic':stat_rank,
 'physical_rank_test_mc_p':(ge_rank+1)/(B_rank+1),
 'physical_rank_mc_B':B_rank,
 'physical_rank_counts':rank_counts.tolist(),
 'physical_pos12_pearson_sample':float(np.corrcoef(seq[:,0],seq[:,1])[0,1]),
 'sorted_pos12_pearson_same_sample':float(np.corrcoef(np.sort(seq,axis=1)[:,0],np.sort(seq,axis=1)[:,1])[0,1]),
})

(ROOT/'superenalotto_metriche_v09.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(metrics,indent=2,ensure_ascii=False))
