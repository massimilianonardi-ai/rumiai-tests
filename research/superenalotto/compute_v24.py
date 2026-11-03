#!/usr/bin/env python3
"""SuperEnalotto v24: F17 (historical frequency <=4 for every triple) and pairs.

Reproducible, no future data in candidate filters. Uses v23 date-level
estimates and raw historical draws, and regenerates same MC samples as v23.
Requires numpy, scipy, numba, matplotlib. Output files to /mnt/data.
"""
from __future__ import annotations
import csv, json, math, itertools, collections, pathlib, time
import numpy as np
from scipy.stats import binom
from numba import njit
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D=pathlib.Path('/mnt/data')
SEED=20261103
START=68
SAMPLES_PER_DATE=2500
PAIR_SIM_SEED=20261124
PAIR_SIMS=400
TOTAL=math.comb(90,6)

def rows_csv(name,sep=',',encoding='utf-8'):
    with (D/name).open('r',newline='',encoding=encoding) as f:
        return list(csv.DictReader(f,delimiter=sep))

def write_csv(name, data, fields=None):
    assert data
    with (D/name).open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=fields or list(data[0].keys()));w.writeheader();w.writerows(data)

src=sorted(rows_csv('estrazioni_con_ritardi.csv',';','utf-8-sig'),key=lambda r:(r['data'],int(r['concorso'])))
prior_v23=rows_csv('superenalotto_filtri_dettaglio_v23.csv')
N=len(src);T=len(prior_v23)
assert N==4294 and T==N-START
numbers=np.array([[int(z[f'n{j}']) for j in range(1,7)] for z in src],dtype=np.int16)
assert bool(np.all(np.diff(numbers,axis=1)>0))
assert all(src[START+i]['data']==z['data'] for i,z in enumerate(prior_v23))

choose=np.zeros((91,7),dtype=np.int64)
for n in range(91):
    for k in range(1,min(6,n)+1):choose[n,k]=math.comb(n,k)
first4=np.zeros(math.comb(90,4),dtype=np.uint16)
first5=np.zeros(math.comb(90,5),dtype=np.uint16)
cross5=np.zeros(math.comb(90,3),dtype=np.uint16)
pair_counts=np.zeros(math.comb(90,2),dtype=np.int32)
triple_counts=np.zeros(math.comb(90,3),dtype=np.uint8)
pair_occurrences=[]
pair_summary=[]
triple_summary=[]
# Cohens: combinadics for a sorted one-based set

def rank_c(c):
    return sum(int(choose[int(v)-1,j]) for j,v in enumerate(c,1))

for t,ss in enumerate(numbers):
    per_pair=[]
    prev_pair=[]
    for a,b in itertools.combinations(ss,2):
        idx=rank_c((a,b)); prev=int(pair_counts[idx]);prev_pair.append(prev)
        per_pair.append((int(a),int(b),idx,prev))
        pair_occurrences.append({'data':src[t]['data'],'concorso':src[t]['concorso'],
            'indice_cronologico':t+1,'coppia':f'{a} {b}','frequenza_precedente':prev})
    tri_ago=[];prev_triples=[]
    for tr in itertools.combinations(ss,3):
        idx=rank_c(tr);prev=int(triple_counts[idx]);prev_triples.append(prev);tri_ago.append(idx)
    pair_summary.append({'data':src[t]['data'],'concorso':src[t]['concorso'],
        'indice_cronologico':t+1,'coppie_gia_viste':sum(p>0 for p in prev_pair),
        'massima_frequenza_precedente_coppia':max(prev_pair),
        'somma_frequenze_precedenti_coppie':sum(prev_pair),
        'coppie_nuove':sum(p==0 for p in prev_pair)})
    triple_summary.append({'massima_frequenza_precedente_terzina':max(prev_triples),
        'terzine_gia_viste_cinque_o_piu_volte':sum(p>=5 for p in prev_triples),
        'tutte_terzine_con_frequenza_precedente_massima_quattro':int(max(prev_triples)<=4)})
    # Commit current draw to past state only after measuring current draw
    for a,b,idx,prev in per_pair:pair_counts[idx]+=1
    for idx in tri_ago:
        triple_counts[idx]+=1
        if triple_counts[idx]==5:cross5[idx]=t+1
    for c in itertools.combinations(ss,4):
        idx=rank_c(c)
        if first4[idx]==0:first4[idx]=t+1
    for c in itertools.combinations(ss,5):
        idx=rank_c(c)
        if first5[idx]==0:first5[idx]=t+1
assert int(pair_counts.sum())==N*15
assert int(triple_counts.sum())==N*20
assert int(np.count_nonzero(first4))==63586
assert int(np.count_nonzero(first5))==25753
assert int(np.count_nonzero(triple_counts))==60885

for z in pair_occurrences:
    a,b=(int(i) for i in z['coppia'].split())
    z['frequenza_totale']=int(pair_counts[rank_c((a,b))])
write_csv('superenalotto_coppie_per_estrazione_v24.csv',pair_occurrences)
write_csv('superenalotto_coppie_sintesi_per_estrazione_v24.csv',pair_summary)

old_hit=np.asarray([int(z['vincente_supera_F01_F16']) for z in prior_v23],dtype=bool)
new_hit=old_hit & np.asarray([z['tutte_terzine_con_frequenza_precedente_massima_quattro'] for z in triple_summary[START:]],dtype=bool)
assert int(old_hit.sum())==3812
h_old=int(old_hit.sum());h_new=int(new_hit.sum())

cat=np.zeros((N,91),dtype=np.uint8)
last=np.full(91,-1,dtype=np.int32)
for t,ss in enumerate(numbers):
    for v in range(1,91):
        if last[v]<0: z=9
        else:
            dt=t-int(last[v])
            if dt==1:z=0
            elif dt<=3:z=1
            elif dt<=5:z=2
            elif dt<=11:z=3
            elif dt<=18:z=4
            elif dt<=26:z=5
            elif dt<=35:z=6
            elif dt<=53:z=7
            elif dt<=94:z=8
            else:z=9
        cat[t,v]=z
    for v in ss:last[v]=t

@njit(cache=True)
def sample_dates(cat,first4,first5,cross5,choose,start,sample_each,seed):
    np.random.seed(seed)
    n_dates=cat.shape[0]-start
    summary=np.zeros((n_dates,4),dtype=np.int32)
    sorted_nums=np.empty(6,dtype=np.int64)
    sorted_cats=np.empty(6,dtype=np.int64)
    for t in range(start,cat.shape[0]):
        idxday=t-start
        for it in range(sample_each):
            for j in range(6):
                while True:
                    z=np.random.randint(1,91)
                    dup=False
                    for k in range(j):
                        if sorted_nums[k]==z:dup=True;break
                    if not dup:break
                sorted_nums[j]=z
            for j in range(1,6):
                z=sorted_nums[j];k=j-1
                while k>=0 and sorted_nums[k]>z:
                    sorted_nums[k+1]=sorted_nums[k];k-=1
                sorted_nums[k+1]=z
            if not (1<=sorted_nums[0]<=49 and 2<=sorted_nums[1]<=64 and
                    7<=sorted_nums[2]<=76 and 16<=sorted_nums[3]<=84 and
                    28<=sorted_nums[4]<=89 and 46<=sorted_nums[5]<=90):continue
            for j in range(6):sorted_cats[j]=cat[t,sorted_nums[j]]
            for j in range(1,6):
                z=sorted_cats[j];k=j-1
                while k>=0 and sorted_cats[k]>z:
                    sorted_cats[k+1]=sorted_cats[k];k-=1
                sorted_cats[k+1]=z
            if not (sorted_cats[0]<=3 and sorted_cats[1]<=4 and sorted_cats[2]<=5 and
                    1<=sorted_cats[3]<=6 and 2<=sorted_cats[4]<=7 and
                    3<=sorted_cats[5]<=8):continue
            summary[idxday,0]+=1
            # Check each 5-set first in history
            any_seen5=False
            for miss in range(6):
                rank=0;loc=0
                for j in range(6):
                    if j==miss:continue
                    rank+=choose[sorted_nums[j]-1,loc+1];loc+=1
                first=first5[rank]
                if first>0 and first<=t:
                    any_seen5=True;break
            if any_seen5: continue
            summary[idxday,1]+=1
            # Count distinct quartets previously seen; reject once >=2
            quartets=0
            for a in range(3):
                for b in range(a+1,4):
                    for c in range(b+1,5):
                        for d in range(c+1,6):
                            r=(choose[sorted_nums[a]-1,1]+choose[sorted_nums[b]-1,2]+
                               choose[sorted_nums[c]-1,3]+choose[sorted_nums[d]-1,4])
                            first=first4[r]
                            if first>0 and first<=t:
                                quartets+=1
                                if quartets>1:break
                        if quartets>1:break
                    if quartets>1:break
                if quartets>1:break
            if quartets<=1:summary[idxday,2]+=1
            else:continue
            # F17 excludes a sextuple if any constituent triple already appeared 5+ times
            forbidden=False
            for a in range(4):
                for b in range(a+1,5):
                    for c in range(b+1,6):
                        rank=(choose[sorted_nums[a]-1,1]+choose[sorted_nums[b]-1,2]+
                              choose[sorted_nums[c]-1,3])
                        first5th=cross5[rank]
                        if first5th>0 and first5th<=t:
                            forbidden=True;break
                    if forbidden:break
                if forbidden:break
            if not forbidden:summary[idxday,3]+=1
    return summary

starttime=time.time()
est=sample_dates(cat,first4,first5,cross5,choose,START,SAMPLES_PER_DATE,SEED)
print('F17 Monte Carlo elapsed',round(time.time()-starttime,1),'seconds',flush=True)
assert est.shape==(T,4)
assert all(np.array_equal(est[:,j],np.asarray([int(z[k]) for z in prior_v23],dtype=np.int32))
           for j,k in [(0,'campioni_passano_F01_F14'),(1,'campioni_passano_F01_F15'),(2,'campioni_passano_F01_F16')]), 'MC seed mismatch with v23'

old_exact15=np.asarray([int(z['residue_esatte_F01_F15']) for z in prior_v23],dtype=np.int64)
frac_extra16=(est[:,1]-est[:,2])/SAMPLES_PER_DATE
frac_extra17=(est[:,2]-est[:,3])/SAMPLES_PER_DATE
frac_extra_total=(est[:,1]-est[:,3])/SAMPLES_PER_DATE
# Control variate exact F15 count, paired MC on all F16+F17 removals
old_mean15=float(old_exact15.mean());extra16=float(frac_extra16.mean()*TOTAL)
extra17=float(frac_extra17.mean()*TOTAL)
new_mean=float(old_mean15-extra16-extra17)
assert abs((old_mean15-extra16)-561122486.8204743)<1e-5
# conditional Bernoulli variances using per-date uncentered p_t for independent samples
p=frac_extra_total
se=float(TOTAL*np.sqrt(np.sum(p*(1-p))/(T*T*SAMPLES_PER_DATE)))
lo,hi=new_mean-1.96*se,new_mean+1.96*se
print('F17 metrics', {'old_hits':h_old,'new_hits':h_new,'additional_removed':extra17,'new_mean':new_mean,'se':se},flush=True)

out=[]
for i,z in enumerate(prior_v23):
    pp=triple_summary[i+START]
    out.append({'data':z['data'],'concorso':z['concorso'],
        'terzina_frequenza_precedente_massima_vincente':pp['massima_frequenza_precedente_terzina'],
        'terzine_gia_viste_almeno_5_volte_nella_vincente':pp['terzine_gia_viste_cinque_o_piu_volte'],
        'vincente_supera_F01_F16':int(old_hit[i]),'vincente_supera_F01_F17':int(new_hit[i]),
        'residue_esatte_F01_F15':int(old_exact15[i]),'campioni_per_data':SAMPLES_PER_DATE,
        'campioni_passano_F01_F15':int(est[i,1]),
        'campioni_passano_F01_F16':int(est[i,2]),
        'campioni_passano_F01_F17':int(est[i,3]),
        'stima_residue_F01_F17':round(int(old_exact15[i])-int(est[i,1]-est[i,3])*TOTAL/SAMPLES_PER_DATE)})
write_csv('superenalotto_filtri_dettaglio_v24.csv',out)

# Pair population frequency and hypergeometric/binomial theoretical reference
M=math.comb(90,2)
pair_bincount=np.bincount(pair_counts,minlength=math.comb(90,2))
max_pair=int(pair_counts.max())
p_pair=math.comb(6,2)/M
freq_rows=[]
for k in range(0,max_pair+6):
    freq_rows.append({'frequenza':k,'coppie_storiche':int(pair_bincount[k]) if k<len(pair_bincount) else 0,
        'coppie_attese_uniformi':float(M*binom.pmf(k,N,p_pair))})
write_csv('superenalotto_coppie_frequenze_v24.csv',freq_rows)
rank_pairs=np.argsort(-pair_counts)
top=[]
for rank in rank_pairs[:50]:
    # inverse rank by search table 4005 entries
    a,b=next((a,b) for b in range(2,91) for a in range(1,b) if rank_c((a,b))==int(rank))
    top.append({'coppia':f'{a} {b}','frequenza':int(pair_counts[rank])})
write_csv('superenalotto_coppie_piu_frequenti_v24.csv',top)

# Independent uniform draw simulations: preserve 6-distinct-number draw structure
rng=np.random.default_rng(PAIR_SIM_SEED)
I,J=np.triu_indices(6,k=1)
observed_stats={'distinte':int(np.count_nonzero(pair_counts)),
                'collisioni':int(np.sum(pair_counts.astype(np.int64)*(pair_counts.astype(np.int64)-1)//2)),
                'massima_frequenza':max_pair,
                'estrazioni_con_coppie_pregresse':int(sum(z['coppie_gia_viste']>0 for z in pair_summary))}
sim_rows=[]
for k in range(PAIR_SIMS):
    ss=np.argpartition(rng.random((N,90),dtype=np.float32),5,axis=1)[:,:6]+1
    ss.sort(axis=1)
    pair_idx=(ss[:,J]-1)*(ss[:,J]-2)//2+(ss[:,I]-1)
    cnt=np.bincount(pair_idx.ravel(),minlength=M)
    first_seen=np.full(M,N+1,dtype=np.int32)
    np.minimum.at(first_seen,pair_idx.ravel(),np.repeat(np.arange(N,dtype=np.int32),15))
    prior_in_draw=np.any(first_seen[pair_idx]<np.arange(N,dtype=np.int32)[:,None],axis=1)
    sim_rows.append({'simulazione':k+1,'distinte':int(np.count_nonzero(cnt)),
       'collisioni':int((cnt*(cnt-1)//2).sum()),'massima_frequenza':int(cnt.max()),
       'estrazioni_con_coppie_pregresse':int(prior_in_draw.sum())})
write_csv('superenalotto_coppie_simulazioni_v24.csv',sim_rows)
pair_sim_summary={}
for key,obs in observed_stats.items():
    arr=np.array([z[key] for z in sim_rows],dtype=np.float64)
    dist=np.abs(arr-arr.mean());dif=abs(obs-arr.mean())
    pair_sim_summary[key]={'osservato':obs,'simulazione_media':float(arr.mean()),
       'intervallo_centrale_95_pct':list(map(float,np.percentile(arr,[2.5,97.5]))),
       'p_empirico_bilaterale':float((1+np.count_nonzero(dist>=dif))/(PAIR_SIMS+1))}
print('pair simulation',pair_sim_summary,flush=True)

# Pair frequency chart (not time series, grouped categorical frequencies)
fig,ax=plt.subplots(figsize=(12,6.6))
ks=np.array([z['frequenza'] for z in freq_rows]);obs=np.array([z['coppie_storiche'] for z in freq_rows]);theory=np.array([z['coppie_attese_uniformi'] for z in freq_rows]);
ax.bar(ks-0.18,obs,width=0.36,label='Osservate');ax.bar(ks+0.18,theory,width=0.36,label='Attese (estrazioni uniformi)')
ax.set_xlabel('Numero di estrazioni contenenti la coppia');ax.set_ylabel('Coppie distinte');ax.set_title('SuperEnalotto: frequenza delle 4.005 coppie (4.294 estrazioni)');ax.grid(axis='y',alpha=.18);ax.legend();ax.set_xticks(np.arange(0,max_pair+6,2));
fig.tight_layout();fig.savefig(D/'superenalotto_coppie_frequenze_v24.png',dpi=170);plt.close(fig)

# Metrics, document cumulative preserving all previously saved versions
metrics={'version':24,'active_filters':17,'F17':'per ogni terzina della sestina candidata, frequenza in estrazioni precedenti <= 4',
    'F17_interpretazione':'al massimo 4 precedenti apparizioni totali di ciascuna delle 20 terzine; 5+ apparizioni pregresse => sestina esclusa',
    'n_backtests':T,'hits_v23_F01_F16':h_old,'hits_v24_F01_F17':h_new,
    'additional_historical_winning_draws_removed':h_old-h_new,
    'coverage_v24_pct':100*h_new/T,'coverage_v23_pct':100*h_old/T,
    'combination_space':TOTAL,'prior_F01_F16_mean_estimated':old_mean15-extra16,
    'extra_eliminated_F17_mean_estimated':extra17,'new_F01_F17_mean_estimated':new_mean,
    'new_F01_F17_mean_95ci_mc':[lo,hi], 'mean_reduction_pct':100*(1-new_mean/TOTAL),
    'mean_accepted_pct':100*new_mean/TOTAL,'MC_method':'same 10,565,000 stratified draws and seed as v23; control variate exact F01-F15 counts; paired F16 and F17 counts',
    'samples_per_date':SAMPLES_PER_DATE,'simulation_seed':SEED,
    'historical_winning_max_prior_triple_freq':dict(sorted(collections.Counter(x['massima_frequenza_precedente_terzina'] for x in triple_summary[START:]).items())),
    'pairs':{'theoretical_possible':M,'total_pair_occurrences':N*15,'distinct':observed_stats['distinte'],
        'frequency_hist':{str(k):int(v) for k,v in enumerate(pair_bincount) if v>0},
        'maximum_frequency':max_pair,'pair_occurrence_collisions':observed_stats['collisioni'],
        'draws_with_any_previously_seen_pair':observed_stats['estrazioni_con_coppie_pregresse'],
        'mean_previously_seen_pairs_per_draw':float(np.mean([z['coppie_gia_viste'] for z in pair_summary])),
        'expected_collision_count':math.comb(N,2)*math.comb(6,2)**2/M,
        'expected_pairs_distinct':M*(1-(1-p_pair)**N),
        'top_pairs':top[:10],
        'simulation_n':PAIR_SIMS,'simulation_seed':PAIR_SIM_SEED,'simulation_comparisons':pair_sim_summary},
    'limitations':['F03–F14 historially calibrated on full archive; cannot treat 1998–2026 as independent test',
                  'F16 & F17 average accepted combination counts estimated from stratified Monte Carlo, not exhaustive',
                  'all frequency diagnostics are retrospective; no proof of enhanced forecast reliability']}
(D/'superenalotto_metriche_v24.json').write_text(json.dumps(metrics,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

v23text=(D/'superenalotto_analisi_filtri_v23.md').read_text(encoding='utf-8')
first,tail=v23text.split('\n',1)
first=first.replace('(v23)','(v24)')
pos=tail.find('\n\n## Obiettivo')
assert pos>=0
tail=tail[pos:]
status='''
> **STATO ATTUALE — VERSIONE 24.** Filtri F01–F17 attivi: F01 massimo ritardo [6,94], F02 vieta sestine pregresse (ridondante con F15), F03–F08 e F09–F14 intervalli al 99%, F15 esclude sestine con cinquine pregresse, F16 permette al massimo una quartina distinta pregressa, F17 permette **solo terzine apparse al massimo quattro volte prima dell'estrazione**. F01=F14. Tutte le precedenti versioni restano nel registro storico.
> **Copertura delle sestine vincenti esatta** su 4.226 valutazioni, **dimensione media dello spazio ammissibile stimata Monte Carlo** con campioni accoppiati alla versione 23. I limiti F03–F14 sono retrospettivi e non costituiscono parametri fissati in anticipo.
'''
fmt=lambda v:f'{v:,.0f}'.replace(',','.')
pct=lambda v:f'{v:.2f}'.replace('.',',')
distrows='\n'.join(f'| {k} | {fmt(int(v))} |' for k,v in enumerate(pair_bincount) if v>0)
pairsim='\n'.join(f"| {k.replace('_',' ')} | {fmt(z['osservato'])} | {fmt(z['simulazione_media'])} | {fmt(z['intervallo_centrale_95_pct'][0])}–{fmt(z['intervallo_centrale_95_pct'][1])} | {z['p_empirico_bilaterale']:.3f} |" for k,z in pair_sim_summary.items())
append=f'''

---

## Esperimento 24 — F17: frequenza massima delle terzine; studio completo delle coppie

### Nuovo filtro F17 (ATTIVO)

Per ogni estrazione da prevedere `t`, si considerano **soltanto le estrazioni anteriori**. Per ogni sestina candidata `S`, si enumerano le 20 terzine distinte `A ⊂ S`, `|A|=3` e si calcola `f_t(A)`, numero di estrazioni precedenti che contengono la terzina. La regola scelta è

`F17_t(S) = [ max_{{A ⊆ S, |A|=3}} f_t(A) ≤ 4 ]`.

In altri termini si esclude una candidata quando **almeno una sua terzina era già apparsa cinque volte o più**. La soglia quattro indica **quattro apparizioni pregresse complessive**, non quattro ripetizioni aggiuntive dopo la prima apparizione. Le frequenze si aggiornano dopo ogni estrazione. I filtri F01–F16 rimangono attivi.

### Effetto esatto sulla copertura storica

| Indicatore | F01–F16 (v23) | F01–F17 (v24) |
|---|---:|---:|
| Estrazioni valutabili | {fmt(T)} | {fmt(T)} |
| Sestine vincenti conservate | {fmt(h_old)} | **{fmt(h_new)}** |
| Vincitrici eliminate | {fmt(T-h_old)} | **{fmt(T-h_new)}** |
| Copertura storica | {pct(100*h_old/T)}% | **{pct(100*h_new/T)}%** |
| Ulteriori sestine vincenti escluse da F17 | — | **{h_old-h_new}** |

Nelle {fmt(N)} estrazioni complete, **{sum(x['massima_frequenza_precedente_terzina']>=5 for x in triple_summary)}** sestine vincenti contengono almeno una terzina che, prima dell'estrazione, era già stata osservata cinque o più volte; **{h_old-h_new}** erano passate attraverso F01–F16 e vengono ora eliminate da F17. L'esito per ogni estrazione è riportato nel CSV v24.

### Dimensione combinatoria (STIMA, non conteggio esaustivo)

Usiamo gli stessi {fmt(T*SAMPLES_PER_DATE)} campioni uniformi stratificati della versione 23 ({fmt(SAMPLES_PER_DATE)} per estrazione; seed {SEED}). La simulazione riproduce esattamente i conteggi campionari F01–F16 della versione 23 e aggiunge la verifica F17. Si parte dalla **media esatta F01–F15** e si sottraggono le perdite stimate F16 e F17 in modo accoppiato, per ottenere una stima più precisa.

| Indicatore | F01–F16 v23 | F01–F17 v24 |
|---|---:|---:|
| Combinazioni iniziali | {fmt(TOTAL)} | {fmt(TOTAL)} |
| Residue medie | ≈{fmt(old_mean15-extra16)} | **≈{fmt(new_mean)}** |
| Ulteriori combinazioni eliminate da F17, media | — | **≈{fmt(extra17)}** |
| Riduzione media complessiva | ≈{pct(100*(1-(old_mean15-extra16)/TOTAL))}% | **≈{pct(100*(1-new_mean/TOTAL))}%** |
| Quota media di combinazioni conservate | ≈{pct(100*(old_mean15-extra16)/TOTAL)}% | **≈{pct(100*new_mean/TOTAL)}%** |
| Copertura storica delle sestine vincenti | {pct(100*h_old/T)}% | **{pct(100*h_new/T)}%** |

IC nominale Monte Carlo al 95% sulla **media F01–F17**: {fmt(lo)}–{fmt(hi)} combinazioni. L'intervallo misura l'errore del campionamento, non il rischio che il filtro funzioni peggio su estrazioni future. Le cifre non rappresentano un conteggio combinatorio esatto data per data.

### Analisi delle coppie estratte

Ogni estrazione produce `C(6,2) = 15` coppie, dunque {fmt(N)} × 15 = **{fmt(15*N)}** occorrenze. Le coppie possibili da 90 numeri sono `C(90,2) = {fmt(M)}`. La frequenza di una coppia è il numero di estrazioni in cui entrambi i numeri compaiono, indipendentemente dalla posizione o dall'ordine.

| Indicatore | Valore |
|---|---:|
| Estrazioni analizzate | {fmt(N)} |
| Coppie generate | {fmt(15*N)} |
| Coppie possibili | {fmt(M)} |
| Coppie distinte storicamente osservate | {fmt(observed_stats['distinte'])} |
| Frequenza media per coppia | {15*N/M:.2f} |
| Minima frequenza osservata | {int(pair_counts.min())} |
| Massima frequenza osservata | **{max_pair}** |
| Estrazioni con almeno una coppia già vista in precedenza | **{fmt(observed_stats['estrazioni_con_coppie_pregresse'])}** ({pct(100*observed_stats['estrazioni_con_coppie_pregresse']/N)}%) |
| Coppie già viste per sestina vincente (media su 15) | **{np.mean([x['coppie_gia_viste'] for x in pair_summary]):.2f}** |

Distribuzione completa delle frequenze delle coppie:

| Frequenza storica | Numero di coppie |
|---:|---:|
{distrows}

Le dieci coppie più frequenti:

| Coppia | Frequenza |
|---|---:|
{chr(10).join(f"| {z['coppia']} | {z['frequenza']} |" for z in top[:10])}

**Attenzione:** le coppie ricorrenti sono normalissime sotto estrazione indipendente: con solo {fmt(M)} coppie teoricamente possibili e {fmt(15*N)} occorrenze, molte ripetizioni sono inevitabili. La presenza di una coppia già vista, da sola, non è un filtro selettivo ragionevole.

### Confronto con il modello casuale

Per un'estrazione uniforme indipendente di 6 numeri da 90, la probabilità che una specifica coppia sia presente è `C(6,2)/C(90,2) = 15/4005 = 1/267`. Il valore atteso di apparizioni della coppia in {N} estrazioni è `{N}/267 = {N/267:.4f}`; per ciascuna coppia, la frequenza marginale segue una binomiale `Bin({N},1/267)`, anche se le frequenze delle coppie diverse non sono indipendenti.

Le collisioni di occorrenze storiche delle coppie sono **{fmt(observed_stats['collisioni'])}**, contro {fmt(math.comb(N,2)*math.comb(6,2)**2/M)} attese per estrazioni uniformi e indipendenti. Per valutare gli scostamenti senza assumere indipendenza fra le 15 coppie di una stessa sestina, abbiamo simulato **{PAIR_SIMS} interi archivi casuali indipendenti** di {N} sestine ciascuno.

| Statistica | Osservato | Media simulata | Intervallo centrale 95% | p bilaterale empirico |
|---|---:|---:|---:|---:|
{pairsim}

I p-valori sono esplorativi, ottenuti confrontando la distanza assoluta dell'osservato dalla media delle simulazioni; includono correzione +1 al numeratore e denominatore. Non si usa una distribuzione normale per trattare artificialmente le 15 coppie di una sestina come indipendenti.

**Conclusione:** le coppie sono molto frequenti e diffusamente ripetute. L'analisi da sola non giustifica un filtro sulle coppie e non dimostra capacità predittiva delle frequenze storiche.

### File e riproducibilità

- `compute_v24.py`: codice riproducibile completo; seed Monte Carlo e simulazioni.
- `superenalotto_filtri_dettaglio_v24.csv`: applicazione esatta F17 alle vincenti; campionamento F01–F17 per data.
- `superenalotto_coppie_per_estrazione_v24.csv`: tutte le {fmt(15*N)} occorrenze delle coppie con frequenza pregressa e finale.
- `superenalotto_coppie_sintesi_per_estrazione_v24.csv`: riepilogo per concorso.
- `superenalotto_coppie_frequenze_v24.csv`: distribuzione completa osservata e teorica.
- `superenalotto_coppie_piu_frequenti_v24.csv`: prime 50 coppie.
- `superenalotto_coppie_simulazioni_v24.csv`: controlli casuali.
- `superenalotto_coppie_frequenze_v24.png`: visualizzazione.
- `superenalotto_metriche_v24.json`: metriche aggregate, IC, limitazioni.

**Registro versioni:** v24 attiva F17 e censisce le coppie. Non viene attivato alcun filtro sulle coppie. Restano attivi F01–F17; l'intera documentazione precedente è conservata nel medesimo file cumulativo.
'''
(D/'superenalotto_analisi_filtri_v24.md').write_text(first+'\n'+status+tail+append,encoding='utf-8')
print('All artifacts generated. Document',len((D/'superenalotto_analisi_filtri_v24.md').read_text(encoding='utf-8')), 'chars',flush=True)
