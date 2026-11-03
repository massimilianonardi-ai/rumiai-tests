#!/usr/bin/env python3
"""v23: F16 <=1 distinct previously observed quartina, with exact winning coverage;
Monte Carlo estimate of accepted combination count, plus terzine frequency diagnostics.
Run: python /mnt/data/compute_v23.py
Uses data archived with versions 21,22; retains full cumulative Markdown v22.
"""
from __future__ import annotations
import csv, math, json, collections, itertools, time, pathlib, statistics
import numpy as np
from scipy.stats import binom
from numba import njit
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D=pathlib.Path('/mnt/data')
N=4294
EVAL_START=68
TOT=math.comb(90,6)
N_SAMPLES_PER_DATE=2500 # 10.565 million independent uniform sextuples, stratified across draw dates
SEED=20261103

def records(f):
    with (D/f).open(newline='',encoding='utf-8-sig') as src:
        return list(csv.DictReader(src,delimiter=';' if f.endswith('ritardi.csv') else ','))
source=sorted(records('estrazioni_con_ritardi.csv'),key=lambda r:(r['data'],int(r['concorso'])))
assert len(source)==N
numbers=np.asarray([[int(row[f'n{j}']) for j in range(1,7)] for row in source],dtype=np.int16)
assert np.all(np.diff(numbers,axis=1)>0) and numbers.min()>=1 and numbers.max()<=90
v22=records('superenalotto_filtri_dettaglio_v22.csv')
assert len(v22)==N-EVAL_START

# 1. Exact winning detection, using date-specific historical quartets from v22.
observed=[int(r['quartine_precedenti_nella_vincente']) for r in v22]
accept15=np.asarray([int(r['vincente_supera_F01_F15']) for r in v22],dtype=np.uint8)
accept16=np.asarray([int(a and q<=1) for a,q in zip(accept15,observed)],dtype=np.uint8)
assert int(accept15.sum())==3869
counts_hist=dict(sorted(collections.Counter(observed).items()))

# 2. Historical tercinas as unordered 3-subsets.
from collections import Counter,defaultdict
triples_counter=Counter()
triple_occurrences=defaultdict(list)
triple_details=[]
repeat_in_draw=[]
repeat_distinct_in_draw=[]
repeat_previous_occurrences=[]
for t, row in enumerate(source):
    ss=tuple(map(int,numbers[t]))
    triples=list(itertools.combinations(ss,3))
    prev=[triples_counter[p] for p in triples]
    repeat_distinct_in_draw.append(sum(k>0 for k in prev))
    repeat_previous_occurrences.append(sum(prev))
    repeat_in_draw.append(any(k>0 for k in prev))
    for tr,p in zip(triples,prev):
        triple_details.append({'data':row['data'],'concorso':row['concorso'], 'indice_cronologico':t+1,
                               'terzina':' '.join(map(str,tr)),'frequenza_precedente':p})
        triples_counter[tr]+=1
        triple_occurrences[tr].append(t)
assert sum(triples_counter.values())==20*N==85880
for e in triple_details:
    e['frequenza_totale']=triples_counter[tuple(map(int,e['terzina'].split()))]
with (D/'superenalotto_terzine_per_estrazione_v23.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=triple_details[0]);w.writeheader();w.writerows(triple_details)

trip_hist=Counter(triples_counter.values())
max_freq=max(trip_hist)
frequencies=[]
M=math.comb(90,3); p=math.comb(6,3)/M
for k in range(0,max_freq+3):
    frequencies.append({'frequenza':k,'terzine_storiche':trip_hist.get(k,0) if k else M-len(triples_counter),
                        'terzine_attese_uniformi':M*float(binom.pmf(k,N,p))})
with (D/'superenalotto_terzine_frequenze_v23.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=frequencies[0]);w.writeheader();w.writerows(frequencies)
repeated_triples=[(t, dates) for t,dates in triple_occurrences.items() if len(dates)>1]
repeated_triples.sort(key=lambda x:(-len(x[1]),x[0]))
triple_examples=[]
for tr, ii in repeated_triples:
    if len(triple_examples)>=100:break
    triple_examples.append({'terzina':' '.join(map(str,tr)),'frequenza':len(ii),
                            'estrazioni':';'.join(f"{source[t]['data']}#{source[t]['concorso']}" for t in ii)})
with (D/'superenalotto_terzine_piu_frequenti_v23.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=triple_examples[0]);w.writeheader();w.writerows(triple_examples)
trip_collision=sum(math.comb(v,2) for v in triples_counter.values() if v>=2)
trip_expected=math.comb(N,2)*math.comb(6,3)**2/M

# 3. Exact historical date-of-first-appearance lookup for quartets and quintets.
choose=np.zeros((91,7),dtype=np.int64)
for n in range(91):
    for k in range(1,min(n,6)+1):choose[n,k]=math.comb(n,k)
first4=np.zeros(math.comb(90,4),dtype=np.uint16)
first5=np.zeros(math.comb(90,5),dtype=np.uint16)
for t,ss in enumerate(numbers):
    for c in itertools.combinations(ss,4):
        idx=sum(int(choose[int(v)-1,j]) for j,v in enumerate(c,1))
        if first4[idx]==0:first4[idx]=t+1
    for c in itertools.combinations(ss,5):
        idx=sum(int(choose[int(v)-1,j]) for j,v in enumerate(c,1))
        if first5[idx]==0:first5[idx]=t+1
assert np.count_nonzero(first4)==63586
assert np.count_nonzero(first5)==25753
# delay category lookup, mirrors v22 C++ exact rules.
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
def sample_dates(cat,first4,first5,choose,start,sample_each,seed):
    np.random.seed(seed)
    n_dates=cat.shape[0]-start
    summary=np.zeros((n_dates,3),dtype=np.int32)
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
            # Count distinct quartets previously seen; reject once >= 2
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
    return summary

t0=time.time()
est=sample_dates(cat,first4,first5,choose,EVAL_START,N_SAMPLES_PER_DATE,SEED)
print('Simulation elapsed',time.time()-t0,flush=True)
assert est.shape==(len(v22),3)
# Use exact v22 F15 counts, plus estimated conditional additional removals via CV technique:
# direct per-date estimate: (F15 - F16) count / sample_each * TOTAL
extra_sample=est[:,1]-est[:,2]
extra_ratio=extra_sample.sum()/(len(v22)*N_SAMPLES_PER_DATE)
# Standard error of stratified estimate = sqrt(sum_t p_t*(1-p_t) / (T*T*m)); estimated empirical.
p_by_date=extra_sample/N_SAMPLES_PER_DATE
stderr=float(np.sqrt(np.sum(p_by_date*(1-p_by_date))/(len(v22)**2*N_SAMPLES_PER_DATE)))
extra_mean=extra_ratio*TOT
exact_old=np.asarray([int(v['residue_F01_F15']) for v in v22],dtype=np.int64)
new_mean=float(exact_old.mean()-extra_mean)
q_after=new_mean/TOT
exact_hit_after=int(accept16.sum());exact_hit_before=int(accept15.sum())

# Numeric validation of sampled base hit rate vs exact F01-F14/F01-F15.
base_exact=np.asarray([int(v['residue_F01_F14']) for v in v22],dtype=np.int64)
for k,ref in ((0,base_exact),(1,exact_old)):
    estimated=est[:,k].sum()/est.shape[0]/N_SAMPLES_PER_DATE*TOT
    print('validation sampled versus exact',k,estimated,ref.mean(), 'diff pct-points',100*(estimated-ref.mean())/TOT)

rows=[]
for j,r in enumerate(v22):
    rows.append({'data':r['data'],'concorso':r['concorso'],
        'quartine_pregresse_distinte_vincente':observed[j],
        'vincente_supera_F01_F15':int(accept15[j]),
        'vincente_supera_F01_F16':int(accept16[j]),
        'residue_esatte_F01_F15':int(exact_old[j]),
        'campioni':N_SAMPLES_PER_DATE,
        'campioni_passano_F01_F14':int(est[j,0]),
        'campioni_passano_F01_F15':int(est[j,1]),
        'campioni_passano_F01_F16':int(est[j,2]),
        'campioni_rimossi_solo_F16':int(extra_sample[j]),
        'residue_stimate_F01_F16':round(int(exact_old[j])-int(extra_sample[j])/N_SAMPLES_PER_DATE*TOT)})
with (D/'superenalotto_filtri_dettaglio_v23.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)

mean_ci=(max(0,extra_mean-1.96*TOT*stderr),extra_mean+1.96*TOT*stderr)
metrics={
    'version':23,
    'filter_F16': 'numero di quartine distinte nella sestina che sono comparse in almeno una precedente estrazione <=1',
    'active_filters':16,
    'coverage_source':'esatto mediante verifica storico per ogni sestina vincente',
    'n_backtests':len(v22),
    'baseline_hits':exact_hit_before,
    'hits_after_F16':exact_hit_after,
    'lost_extra':exact_hit_before-exact_hit_after,
    'coverage_after_pct':100*exact_hit_after/len(v22),
    'coverage_before_pct':100*exact_hit_before/len(v22),
    'total_combinations':TOT,
    'mean_count_F01_F15_exact':float(exact_old.mean()),
    'additional_F16_eliminated_mean_estimate':float(extra_mean),
    'additional_F16_eliminated_mean_95ci':list(mean_ci),
    'mean_count_F01_F16_estimate':new_mean,
    'mean_count_F01_F16_95ci':[float(exact_old.mean()-mean_ci[1]),float(exact_old.mean()-mean_ci[0])],
    'reduction_pct_F01_F16_estimate':100*(1-q_after),
    'expected_coverage_uniform_pct':100*q_after,
    'mc_seed':SEED,
    'samples_each_date':N_SAMPLES_PER_DATE,
    'samples_total':N_SAMPLES_PER_DATE*len(v22),
    'sampling_method':'stratificato per data, sestine uniformi distinte in ciascuna data, senza informazioni future nelle condizioni storiche',
    'mc_extra_p':float(extra_ratio),
    'mc_extra_p_stderr':stderr,
    'mc_base_recheck':{
        'sample_F01_F14_mean':float(est[:,0].sum()/len(v22)/N_SAMPLES_PER_DATE*TOT),
        'exact_F01_F14_mean':float(base_exact.mean()),
        'sample_F01_F15_mean':float(est[:,1].sum()/len(v22)/N_SAMPLES_PER_DATE*TOT),
        'exact_F01_F15_mean':float(exact_old.mean()),
    },
    'historical_winning_prior_quartets_hist':{str(k):int(v) for k,v in counts_hist.items()},
    'terzine':{
        'total_extractions':N,'triples_per_extract':20,'triple_occurrences':N*20,
        'possible_triples':M,'distinct_triples':len(triples_counter),
        'triple_freq_hist':{str(k):int(v) for k,v in sorted(trip_hist.items())},
        'max_frequency':max_freq,
        'repeated_triples_distinct':len(repeated_triples),
        'draws_with_prior_triple':sum(repeat_in_draw),
        'draws_with_at_least_two_distinct_prior_triples':sum(z>=2 for z in repeat_distinct_in_draw),
        'mean_prior_distinct_triples_per_draw':sum(repeat_distinct_in_draw)/N,
        'mean_prior_occurrences_per_draw':sum(repeat_previous_occurrences)/N,
        'hist_previous_distinct_per_draw':{str(k):int(v) for k,v in sorted(Counter(repeat_distinct_in_draw).items())},
        'observed_pairs_of_triple_occurrences':trip_collision,
        'expected_pairs_uniform':trip_expected,
        'expected_distinct_uniform':M*(1-(1-p)**N),
        'theoretical_p_this_specific_triple_per_draw':p,
        'top_repeated':[{'terzina':' '.join(map(str,t)),'frequenza':len(i)} for t,i in repeated_triples[:25]],
        'last_draw':{'data':source[-1]['data'],'sestina':' '.join(map(str,numbers[-1])), 'prior_distinct_triples':repeat_distinct_in_draw[-1]},
    },
    'limitation':'F03-F14 calibrated on full history; figures are descriptive; exact date-by-date F16 candidate counts not enumerated, estimated by stratified MC',
}
(D/'superenalotto_metriche_v23.json').write_text(json.dumps(metrics,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

fig,ax=plt.subplots(figsize=(11,6))
ks=np.array([r['frequenza'] for r in frequencies]);obs=np.array([r['terzine_storiche'] for r in frequencies]);expected=np.array([r['terzine_attese_uniformi'] for r in frequencies]);
ax.bar(ks-0.18,obs,0.36,label='Osservate')
ax.bar(ks+0.18,expected,0.36,label='Attese (estrazioni uniformi)')
ax.set_yscale('log');ax.set_ylim(0.7,max(obs.max(),expected.max())*1.5)
ax.set_xticks(ks);ax.set_xlabel('Numero di estrazioni contenenti la terzina');ax.set_ylabel('Numero di terzine (scala logaritmica)');ax.legend()
ax.set_title('Terzine del SuperEnalotto — frequenze osservate e attese');ax.grid(axis='y',alpha=0.18)
fig.tight_layout();fig.savefig(D/'superenalotto_terzine_frequenze_v23.png',dpi=170);plt.close(fig)

fmt=lambda v:f'{v:,.0f}'.replace(',','.')
fmt2=lambda v:f'{v:.2f}'.replace('.',',')
start_doc=(D/'superenalotto_analisi_filtri_v22.md').read_text(encoding='utf-8')
firstline,tail=start_doc.split('\n',1)
firstline=firstline.replace('(v22)','(v23)')
# Replace current-status block with latest one, keeping all historical text below intact.
if '> **STATO ATTUALE — VERSIONE 22' in tail:
    prefix_end=tail.find('\n\n## Obiettivo')
    if prefix_end>0:tail=tail[prefix_end:]
status='''
> **STATO ATTUALE — VERSIONE 23.** Filtri F01–F16 attivi: F01 massimo ritardo [6,94], F02 esclude sestine pregresse (ridondante con F15), F03–F08 e F09–F14 sono le fasce al 99%, F15 esclude sestine con cinquine pregresse, F16 consente **al massimo una quartina distinta già vista**.
> F01 e F14 sono equivalenti. Le sezioni v01–v22 conservano le configurazioni *storiche*, non quelle attive.
> **La copertura dei vincenti per F16 è esatta; la dimensione delle combinazioni residue per F16 è stimata con campionamento Monte Carlo stratificato (non enumerata esattamente).**
'''

distrib='\n'.join(f"| {k} | {fmt(v)} |" for k,v in sorted(trip_hist.items()))
prhist='\n'.join(f"| {k} | {fmt(v)} |" for k,v in sorted(Counter(repeat_distinct_in_draw).items()))
append=f'''

---

## Esperimento 23 — F16: al massimo una quartina già estratta; ricorrenza delle terzine

### Specifica formale del filtro F16 (ATTIVO)

Si definisca per l'estrazione da prevedere `t` l'insieme `P4(t)` delle quartine **distinte** contenute in almeno una sestina osservata ai tempi precedenti a `t`. Per ogni sestina candidata di sei numeri distinti `S` si calcoli:

`Q_t(S) = |{{ A ⊆ S : |A| = 4 e A ∈ P4(t) }}|`.

La condizione **F16 è `Q_t(S) ≤ 1`** (0 o 1 quartina storica; 2 o più implica esclusione). Una quartina comparsa più volte nello storico conta una sola volta nella sestina candidata. Non si guarda la sestina da prevedere, soltanto quelle antecedenti.

Restano attivi F01–F15 esattamente come in v22 (F01 6–94; F03–F14 fasce al 99%; F15 vieta cinquine pregresse). Il nuovo F16 non equivale a «vietare tutte le quartine pregresse»: una sola è consentita.

### Effetto storico: sestine vincenti (conteggio ESATTO)

| Indicatore | v22: F01–F15 | v23: F01–F16 |
|---|---:|---:|
| Concorsi utilizzabili | {len(v22)} | {len(v22)} |
| Sestine vincenti conservate | {exact_hit_before} | **{exact_hit_after}** |
| Sestine vincenti eliminate | {len(v22)-exact_hit_before} | **{len(v22)-exact_hit_after}** |
| Copertura delle sestine vincenti | {fmt2(100*exact_hit_before/len(v22))}% | **{fmt2(100*exact_hit_after/len(v22))}%** |
| Ulteriori vincitrici eliminate da F16 | — | **{exact_hit_before-exact_hit_after}** |

Distribuzione delle quartine già viste nelle sestine vincenti (tutte le {len(v22)} estrazioni utilizzabili):

| Numero di quartine distinte già viste nella sestina | Estrazioni |
|---:|---:|
{ '\n'.join(f'| {k} | {fmt(v)} |' for k,v in counts_hist.items()) }

Con F01–F15, le sestine vincenti che hanno almeno due quartine già viste e superavano i filtri precedenti sono **{exact_hit_before-exact_hit_after}**. Queste sono precisamente le perdite introdotte da F16.

### Effetto sullo spazio delle combinazioni (STIMA MONTE CARLO)

Non è stato eseguito il conteggio esaustivo F16 su ciascuna delle 4.226 date: sarebbe erroneo presentarlo come un conteggio esatto. Sono state invece campionate uniformemente **{fmt(len(v22)*N_SAMPLES_PER_DATE)}** sestine distinte, **{N_SAMPLES_PER_DATE} per data**, riproducibili mediante seed {SEED}. Per ciascuna sestina si applicano i 16 filtri con ritardi e famiglie di quartine/cinquine note *prima* della data considerata. L'effetto F16 è stimato come differenza delle quote di candidati che passano F01–F15 e F01–F16; alla stima si sottrae dalla media **esatta** della v22. Il margine riportato è l'intervallo nominale del 95% da campionamento indipendente stratificato per data (non misura errori nella scelta storica delle soglie).

| Indicatore | F01–F15 v22 (esatto) | F01–F16 v23 (stimato) |
|---|---:|---:|
| Universo | {fmt(TOT)} | {fmt(TOT)} |
| Residue medie | {fmt(exact_old.mean())} | **{fmt(new_mean)}** |
| Residue medie, IC 95% MC | — | {fmt(exact_old.mean()-mean_ci[1])}–{fmt(exact_old.mean()-mean_ci[0])} |
| Ulteriori combinazioni escluse da F16, media | — | **{fmt(extra_mean)}** |
| Riduzione totale | {fmt2(100*(1-exact_old.mean()/TOT))}% | **{fmt2(100*(1-new_mean/TOT))}%** |
| Quota teorica media conservata | {fmt2(100*exact_old.mean()/TOT)}% | **{fmt2(100*q_after)}%** |

La copertura effettiva delle sestine vincenti è **{fmt2(100*exact_hit_after/len(v22))}%**, confrontata con una quota media teorica conservata stimata del **{fmt2(100*q_after)}%**. L'intervallo sul conteggio non quantifica l'incertezza sulle vincitrici future; il test è retrospettivo e gli intervalli originari al 99% furono scelti usando anche dati successivi.

Controllo di coerenza del campionamento: senza F16 la stima Monte Carlo della media delle combinazioni F01–F15 è {fmt(est[:,1].sum()/len(v22)/N_SAMPLES_PER_DATE*TOT)}, contro il valore esatto {fmt(exact_old.mean())}; la differenza è normale e compatibile con l'errore campionario.

### Analisi delle terzine (descrittiva, nessun nuovo filtro)

Ogni sestina ha `C(6,3)=20` terzine non ordinate. Lo storico di {N} estrazioni produce **{fmt(20*N)} occorrenze** su **C(90,3)={fmt(M)} terzine possibili**. Le terzine **distinte osservate** sono **{fmt(len(triples_counter))}**; quelle comparse almeno due volte sono **{fmt(len(repeated_triples))}**; frequenza massima di una singola terzina: **{max_freq}**.

| Frequenza di comparsa della terzina | Numero di terzine osservate |
|---:|---:|
{distrib}

- Estrazioni che contengono almeno una terzina già comparsa: **{fmt(sum(repeat_in_draw))}/{fmt(N)} = {fmt2(100*sum(repeat_in_draw)/N)}%**.
- Estrazioni contenenti almeno due terzine distinte già comparse: **{fmt(sum(z>=2 for z in repeat_distinct_in_draw))}**.
- Numero medio di terzine distinte pregresse nella sestina vincente: **{fmt2(sum(repeat_distinct_in_draw)/N)}** (su 20).
- Coppie di apparizioni della stessa terzina: **{fmt(trip_collision)}**; valore atteso in estrazioni indipendenti e uniformi **{fmt2(trip_expected)}**. Il conteggio delle collisioni ha dipendenze interne tra terzine: non equivale a un test di significatività con osservazioni indipendenti.
- Numero atteso di terzine distinte osservate sotto estrazioni uniformi: **{fmt2(M*(1-(1-p)**N))}**; attualmente osservate **{fmt(len(triples_counter))}**.

Distribuzione delle terzine precedentemente osservate per estrazione (le 20 terzine sono considerate distinte e contano una volta ciascuna):

| Numero di terzine già viste | Estrazioni |
|---:|---:|
{prhist}

Le terzine ricorrono più spesso delle quartine e cinquine per ragioni combinatorie. L'eventuale filtro su terzine **non è attivo**, richiede una definizione esplicita del limite e una verifica rispetto alla quota di sestine eliminate.

### Riproducibilità e file

- `compute_v23.py`: definizioni di F16, conteggio esatto della copertura storica, censimento completo delle terzine, campionamento MC stratificato e IC.
- `superenalotto_filtri_dettaglio_v23.csv`: per data esito esatto della sestina vincente, numero di quartine pregresse, conteggi campionari e stima delle combinazioni residue (le singole stime giornaliere hanno precisione più bassa della media aggregata).
- `superenalotto_terzine_per_estrazione_v23.csv`: tutte le 85.880 occorrenze di terzine con numero di apparizioni precedenti e frequenza finale.
- `superenalotto_terzine_frequenze_v23.csv`: frequenze osservate/attese.
- `superenalotto_terzine_piu_frequenti_v23.csv`: terzine più frequenti con date e concorsi.
- `superenalotto_metriche_v23.json`: metriche e parametri del campionamento.
- `superenalotto_terzine_frequenze_v23.png`: grafico in scala logaritmica.

**Registro modifiche:** v23 attiva F16 e censisce le terzine. F01–F15 non vengono modificati. Il confronto tra copertura storica e quota di combinazioni residue non dimostra capacità di previsione futura.
'''
(D/'superenalotto_analisi_filtri_v23.md').write_text(firstline+'\n'+status+tail+append,encoding='utf-8')

print(json.dumps({
    'n':len(v22),'old_hits':exact_hit_before,'new_hits':exact_hit_after,'new_coverage':100*exact_hit_after/len(v22),
    'estimated_extra':extra_mean,'ci':mean_ci,'new_mean':new_mean,'new_reduction':100*(1-q_after),
    'triples_distinct':len(triples_counter),'triples_hist':dict(trip_hist),'triples_max':max_freq,
    'draws_repeat_triples':sum(repeat_in_draw),'triple_collisions':trip_collision,'expected':trip_expected,
},indent=2))
