#!/usr/bin/env python3
"""SuperEnalotto v20 - espansione intervalli F03-F14 da 95% a 99%.

La simulazione retrospettiva usa gli intervalli minimi 99% sull'intero archivio
(esattamente come quelli al 95% delle versioni 03/05) e non e' un test predittivo
fuori campione. F01 (8<=max ritardo<=81) e F02 (sestina inedita) invariati.

Prerequisiti: csv originale, v06 detail, v19 Markdown, numpy, numba.
Eseguire: python compute_v20.py
"""
from __future__ import annotations
from pathlib import Path
import csv, json, math, itertools
import numpy as np
from numba import njit

ROOT=Path(__file__).resolve().parent
ORIG=ROOT/'estrazioni_con_ritardi.csv'
D06=ROOT/'superenalotto_filtri_ritardi_dettaglio_v06.csv'
PREV_MD=ROOT/'superenalotto_analisi_filtri_v19.md'
TOTAL=math.comb(90,6)
OLD_NUM=np.array([[1,36],[3,54],[10,68],[25,81],[38,87],[57,90]],dtype=np.int16)
OLD_DEL=np.array([[1,7],[1,13],[2,19],[4,28],[5,40],[7,69]],dtype=np.int16)

with ORIG.open(encoding='utf-8-sig',newline='') as f:
    rows=list(csv.DictReader(f,delimiter=';'))
rows.sort(key=lambda z:(z['data'],int(z['concorso'])))
dates=[x['data'] for x in rows]
nums=np.array([[int(x[f'n{i}']) for i in range(1,7)] for x in rows],dtype=np.int16)
rawdel=np.array([[int(x[f'ritardo_{i}']) if x[f'ritardo_{i}'] else -1 for i in range(1,7)] for x in rows],dtype=np.int16)
assert len(rows)==4294 and np.all(np.diff(nums,axis=1)>0)
assert len({tuple(int(v) for v in a) for a in nums})==len(nums), 'F02 needs deduplicated history'
complete=rawdel[np.all(rawdel>=0,axis=1)]
assert len(complete)==4258

# min-width closed range; for ties choose the lowest lower end, while
# requiring a SUPERSET of the prior 95% bounds (as the user requested expansion).
def interval99(vec, previous):
    a=np.sort(np.asarray(vec,dtype=np.int32))
    required=math.ceil(0.99*len(a))
    lo0,hi0=(int(z) for z in previous)
    # Exhaustive search on integer bounds, not just the k-th neighbor window.
    # This also guarantees that the old range remains included.
    best=None
    for lo in range(max(0,int(a.min())),lo0+1):
        for hi in range(hi0,max(hi0,int(a.max()))+1):
            cov=int(np.searchsorted(a,hi,side='right')-np.searchsorted(a,lo,side='left'))
            if cov>=required:
                candidate=(hi-lo,lo,hi,cov)
                if best is None or candidate<best:best=candidate
                break
    assert best is not None
    return (best[1],best[2]),best[3],required

def interval99_unconstrained(vec):
    a=np.sort(np.asarray(vec,dtype=np.int32))
    required=math.ceil(.99*len(a))
    differences=a[required-1:]-a[:len(a)-required+1]
    j=int(np.argmin(differences))
    return [int(a[j]),int(a[j+required-1])]

new_num=[];new_del=[];count_num=[];count_del=[]
for j in range(6):
    rr,count,needed=interval99(nums[:,j],OLD_NUM[j]);new_num.append(rr);count_num.append(count)
    rr,count,needed_d=interval99(complete[:,j],OLD_DEL[j]);new_del.append(rr);count_del.append(count)
new_num=np.array(new_num,dtype=np.int16)
new_del=np.array(new_del,dtype=np.int16)
assert new_num.tolist()==[[1,49],[2,64],[7,76],[16,84],[28,89],[46,90]]
assert new_del.tolist()==[[1,11],[1,18],[1,26],[2,35],[4,53],[6,94]]
# No extra width or shifts were needed to preserve the former bounds.
assert new_num.tolist()==[interval99_unconstrained(nums[:,j]) for j in range(6)]
assert new_del.tolist()==[interval99_unconstrained(complete[:,j]) for j in range(6)]
assert np.all(new_num[:,0]<=OLD_NUM[:,0]) and np.all(new_num[:,1]>=OLD_NUM[:,1])
assert np.all(new_del[:,0]<=OLD_DEL[:,0]) and np.all(new_del[:,1]>=OLD_DEL[:,1])

# Pre-draw delays from chronological history. All 90 numbers need a known appearance.
last=np.full(91,-1,dtype=np.int32)
delays=np.zeros((len(nums),91),dtype=np.int16)
valid=np.zeros(len(nums),dtype=np.bool_)
for i,s in enumerate(nums):
    if np.all(last[1:]>=0):
        valid[i]=True
        delays[i,1:]=i-last[1:]
    for n in s:last[n]=i
assert int(valid.sum())==4226
valid_indices=np.flatnonzero(valid)
old_rows=list(csv.DictReader(D06.open(encoding='utf-8',newline='')))
assert len(old_rows)==len(valid_indices)
assert all(dates[idx]==r['date'] for idx,r in zip(valid_indices,old_rows))
old_count=np.array([int(row['cumulative_F14_count']) for row in old_rows],dtype=np.int64)
old_hit=np.array([int(row['cumulative_F14_hit']) for row in old_rows],dtype=np.int8)
assert old_count.sum()==round(407827083*len(valid_indices),-0) or abs(old_count.mean()-407827083)<1.0

# Delay category partition of [1..81]; all 99% bounds that are not implied by
# F01 are unions of these integer intervals.
cat_limits=[(1,1),(2,3),(4,7),(8,11),(12,18),(19,26),(27,35),(36,53),(54,81)]
C=len(cat_limits)
cat=np.full(82,-1,dtype=np.int8)
for k,(lo,hi) in enumerate(cat_limits):cat[lo:hi+1]=k
assert np.all(cat[1:]>-1)
states=[()]
starts=[0]
for k in range(1,7):
    starts.append(len(states))
    states+=list(itertools.combinations_with_replacement(range(C),k))
starts.append(len(states))
lookup={s:i for i,s in enumerate(states)}
trans=np.full((len(states),C),-1,dtype=np.int32)
for i,s in enumerate(states):
    if len(s)<6:
        for c in range(C):trans[i,c]=lookup[tuple(sorted((*s,c)))]
accepted=np.zeros(len(states),dtype=np.bool_)
for i in range(starts[6],starts[7]):
    c0,c1,c2,c3,c4,c5=states[i]
    accepted[i]=(c0<=3 and c1<=4 and c2<=5 and 1<=c3<=6 and 2<=c4<=7 and c5>=3)
assert len(states)==5005

@njit
# F01+F03..F14: count all distinct sorted sextuples; then subtract F02.
def count_exact(num,dl,valid,cat,starts,trans,accepted,num_intervals):
    n=len(num)
    result=np.zeros(n,dtype=np.int64)
    exclude_repeat=np.zeros(n,dtype=np.int32)
    n_states=trans.shape[0]
    for i in range(n):
        if not valid[i]:continue
        dp=np.zeros(n_states,dtype=np.int64)
        dp[0]=1
        for x in range(1,91):
            delta=dl[i,x]
            if delta<1 or delta>81:continue
            c=cat[delta]
            for pos in range(5,-1,-1):
                if x < num_intervals[pos,0] or x>num_intervals[pos,1]:continue
                for si in range(starts[pos],starts[pos+1]):
                    count=dp[si]
                    if count:
                        dp[trans[si,c]]+=count
        total=0
        for si in range(starts[6],starts[7]):
            if accepted[si]:total+=dp[si]
        # All earlier combinations are distinct: exclude previously drawn valid sets.
        blocked=0
        for old in range(i):
            number_valid=True
            dsort=np.empty(6,dtype=np.int16)
            for pos in range(6):
                z=num[old,pos]
                if z<num_intervals[pos,0] or z>num_intervals[pos,1]:
                    number_valid=False
                    break
                dsort[pos]=dl[i,z]
            if not number_valid:continue
            dsort.sort()
            if dsort[5]<8 or dsort[5]>81:continue
            if dsort[0]>11 or dsort[1]>18 or dsort[2]>26:continue
            if dsort[3]<2 or dsort[3]>35:continue
            if dsort[4]<4 or dsort[4]>53:continue
            # F14 is redundant because F01 already implies 8<=max<=81.
            blocked+=1
        result[i]=total-blocked
        exclude_repeat[i]=blocked
    return result,exclude_repeat

# Check actual winners as independent direct calculation.
w99=np.zeros(len(nums),dtype=np.int8)
w95=np.zeros(len(nums),dtype=np.int8)
for i in valid_indices:
    ds=np.sort(delays[i,nums[i]])
    if not (8<=ds[-1]<=81):continue
    if np.all((nums[i]>=new_num[:,0]) & (nums[i]<=new_num[:,1])) and np.all((ds>=new_del[:,0])&(ds<=new_del[:,1])): w99[i]=1
    if np.all((nums[i]>=OLD_NUM[:,0]) & (nums[i]<=OLD_NUM[:,1])) and np.all((ds>=OLD_DEL[:,0])&(ds<=OLD_DEL[:,1])): w95[i]=1
assert np.array_equal(w95[valid_indices],old_hit)

print('Running exact 99% combinatorial count ...',flush=True)
new_count,removed= count_exact(nums,delays,valid,cat,np.asarray(starts,dtype=np.int32),trans,accepted,new_num)
print('Completed exact count.',flush=True)
new_hit=w99[valid_indices]
new_count_valid=new_count[valid_indices]
assert np.all(new_count_valid>=old_count)
assert np.all(new_hit>=old_hit)
assert new_hit.sum()==3827 and old_hit.sum()==2739
assert np.all(new_count_valid<=TOTAL)

# Summary by full valid backtest and the previously used 1049 test period.
def summary(sel):
    old_c=old_count[sel]; new_c=new_count_valid[sel]
    old_h=old_hit[sel]; new_h=new_hit[sel]
    n=int(len(old_c))
    prob_new=np.asarray(new_c,dtype=np.float64)/TOTAL
    prob_old=np.asarray(old_c,dtype=np.float64)/TOTAL
    e_new=float(prob_new.sum()); e_old=float(prob_old.sum())
    v_new=float(np.sum(prob_new*(1-prob_new)))
    v_old=float(np.sum(prob_old*(1-prob_old)))
    return dict(n=n,
                expected_new_hits_random=e_new,expected_old_hits_random=e_old,
                new_minus_random_coverage_pp=float(100*(new_h.sum()-e_new)/n),
                old_minus_random_coverage_pp=float(100*(old_h.sum()-e_old)/n),
                new_null_z=float((new_h.sum()-e_new)/np.sqrt(v_new)),
                old_null_z=float((old_h.sum()-e_old)/np.sqrt(v_old)),
                old_count_mean=float(old_c.mean()),new_count_mean=float(new_c.mean()),
                old_fraction_mean=float(old_c.mean()/TOTAL),new_fraction_mean=float(new_c.mean()/TOTAL),
                old_reduction_pct=float(100*(1-old_c.mean()/TOTAL)),new_reduction_pct=float(100*(1-new_c.mean()/TOTAL)),
                old_hits=int(old_h.sum()),new_hits=int(new_h.sum()),
                old_coverage_pct=float(100*old_h.mean()),new_coverage_pct=float(100*new_h.mean()),
                restored_hits=int((new_h-old_h).sum()),
                count_gain_mean=float((new_c-old_c).mean()))
allsummary=summary(np.ones(len(valid_indices),dtype=bool))
test_sel=np.array([dates[i]>='2021-03-30' for i in valid_indices],dtype=bool)
assert int(test_sel.sum())==1049
test_summary=summary(test_sel)

# 99% bounds from 1500 training-only draws of the post-2009 era (v19 protocol).
post=np.array([i for i,d in enumerate(dates) if d>='2009-07-01'],dtype=np.int32)
assert len(post)==2869
pre=post[:1500]
train_num=np.array([interval99_unconstrained(nums[pre,j]) for j in range(6)],dtype=np.int16)
train_del=np.array([interval99_unconstrained(rawdel[pre,j]) for j in range(6)],dtype=np.int16)
# These are fitted INDEPENDENTLY from historical limits: zero dependence
# on the future-informed old95 bounds. They happen to enclose old95 anyway.
train_set=np.zeros(len(nums),dtype=np.int8)
for i in valid_indices:
    if dates[i]<'2019-01-31':continue
    ds=np.sort(delays[i,nums[i]])
    if 8<=ds[-1]<=81 and np.all((nums[i]>=train_num[:,0])&(nums[i]<=train_num[:,1])) and np.all((ds>=train_del[:,0])&(ds<=train_del[:,1])):
        train_set[i]=1
preval_test_hits=int(train_set[valid_indices][test_sel].sum())

# Comparison per-row (exact): saved without any candidate enumeration.
outcsv=ROOT/'superenalotto_filtri_99_dettaglio_v20.csv'
with outcsv.open('w',newline='',encoding='utf-8') as fh:
    writer=csv.writer(fh)
    writer.writerow(['date','old95_count','new99_count','old95_hit','new99_hit','new99_f02_excluded','old95_fraction','new99_fraction'])
    for ix,oldc,newc,oldh,newh in zip(valid_indices,old_count,new_count_valid,old_hit,new_hit):
        writer.writerow([dates[ix],int(oldc),int(newc),int(oldh),int(newh),int(removed[ix]),f'{oldc/TOTAL:.10f}',f'{newc/TOTAL:.10f}'])

meta={'experiment':'v20', 'data':str(ORIG.name),'n_draws':int(len(nums)),
      'num_fitted_on_draws':int(len(nums)),'delay_fitted_on_complete_draws':int(len(complete)),
      'eligible_backtest_draws':int(len(valid_indices)), 'total_combinations':TOTAL,
      'old_num':OLD_NUM.tolist(),'new_num':new_num.tolist(),
      'old_del':OLD_DEL.tolist(),'new_del':new_del.tolist(),
      'num_min_required':math.ceil(.99*len(nums)),'delay_min_required':math.ceil(.99*len(complete)),
      'num_frequencies':count_num,'delay_frequencies':count_del,
      'all_historical':allsummary,'test_2021_2026':test_summary,
      'prevalidation_expanded_99_num':train_num.tolist(),
      'prevalidation_expanded_99_del':train_del.tolist(),
      'prevalidation_test99_hits':preval_test_hits,
      'prevalidation_test99_coverage_pct':preval_test_hits/1049*100,
      'F14_redundant_after_expansion':True,
      'caveats':['Full-history intervals calculated using future test observations; historical results retrospective only.',
                 'Test 2021-2026 already used in v14-v19; not an independent holdout.',
                 'Prevalidation sensitivity recalculates intervals from scratch before Jan 31 2019, without using earlier retrospective limits.',
                 'F01 and F02 unchanged; no neural retraining in v20.']}
(ROOT/'superenalotto_metriche_v20.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

# Build cumulative document by appending only the new experiment to v19 text.
base=PREV_MD.read_text(encoding='utf-8')
if 'Esperimento 20' in base:raise RuntimeError('Unexpected v20 text already in v19')
num_rows=[];del_rows=[]
for j in range(6):
    a,b=OLD_NUM[j],new_num[j];num_rows.append(f'| F{j+3:02} | n{j+1} | {a[0]}–{a[1]} | **{b[0]}–{b[1]}** | {count_num[j]}/{len(nums)} ({count_num[j]/len(nums)*100:.2f}%) |')
    a,b=OLD_DEL[j],new_del[j];del_rows.append(f'| F{j+9:02} | d{j+1} | {a[0]}–{a[1]} | **{b[0]}–{b[1]}** | {count_del[j]}/{len(complete)} ({count_del[j]/len(complete)*100:.2f}%) |')

md=f"""

---

## Esperimento 20 — Ampliamento al 99% dei filtri F03–F14

**Modifica:** i dodici intervalli F03–F14 passano da copertura marginale ≥95% a ≥99%. **F01** rimane `8 ≤ ritardo massimo ≤ 81`; **F02** continua a escludere le sestine già estratte. Il numero dei filtri rimane **14**. La rete autoregressiva e le penalizzazioni della v19 **non sono state riaddestrate** in questa versione: questo capitolo misura gli effetti dei nuovi vincoli.

### Dati e definizione delle fasce

- Numeri ordinati: **4.294** estrazioni, soglia 99% almeno **{math.ceil(.99*len(nums))}** osservazioni in ciascuna colonna.
- Ritardi ordinati: **4.258** righe con sei ritardi completi, soglia 99% almeno **{math.ceil(.99*len(complete))}** osservazioni in ciascuna colonna.
- Regola: intervallo **intero inclusivo di ampiezza minima**, con copertura osservata almeno 99%, che contenga interamente l'intervallo preesistente al 95%; a parità di ampiezza scegliamo l'estremo inferiore più basso. In questi dati le soluzioni coincidono con gli intervalli minimi anche senza obbligo di contenimento.
- I ritardi per le simulazioni sono ricostruiti **prima** della sestina target dai soli concorsi precedenti; tutti i 90 numeri devono avere un precedente noto (4.226 estrazioni valutabili).

**Intervalli dei numeri ordinati**

| Filtro | Posizione | Vecchio 95% | Nuovo 99% | Copertura marginale empirica |
|---|---|---|---|---|
"""+'\n'.join(num_rows)+f"""

**Intervalli dei ritardi ordinati**

| Filtro | Posizione | Vecchio 95% | Nuovo 99% | Copertura marginale empirica |
|---|---|---|---|---|
"""+'\n'.join(del_rows)+f"""

### Impatto dei 14 filtri, simulazione retrospettiva (4.226 concorsi)

| Metricas | Vecchi intervalli 95% | Nuovi intervalli 99% |
|---|---:|---:|
| Sestine vincenti conservate | **{allsummary['old_hits']:,}** | **{allsummary['new_hits']:,}** |
| Copertura storica | **{allsummary['old_coverage_pct']:.2f}%** | **{allsummary['new_coverage_pct']:.2f}%** |
| Sestine vincenti escluse | {allsummary['n']-allsummary['old_hits']:,} | {allsummary['n']-allsummary['new_hits']:,} |
| Combinazioni ammesse in media | {allsummary['old_count_mean']:,.0f} | {allsummary['new_count_mean']:,.0f} |
| Quota di combinazioni conservate | {100*allsummary['old_fraction_mean']:.2f}% | {100*allsummary['new_fraction_mean']:.2f}% |
| **Riduzione media** | **{allsummary['old_reduction_pct']:.2f}%** | **{allsummary['new_reduction_pct']:.2f}%** |

I nuovi intervalli recuperano **{allsummary['restored_hits']}** sestine vincenti e ammettono in media **{allsummary['count_gain_mean']:,.0f}** combinazioni in più per concorso. La differenza copertura − quota combinazioni conservate è **{allsummary['new_minus_random_coverage_pp']:+.3f} punti percentuali** (scostamento standardizzato rispetto al nullo uniforme: z = **{allsummary['new_null_z']:+.3f}**). La copertura attesa da una scelta casuale uniforme sottoposta agli stessi vincoli è **{100*allsummary['new_fraction_mean']:.2f}%**; lo scostamento non indica vantaggi predittivi.

**F14 ora è matematicamente ridondante**: il sesto ritardo è il massimo, e il suo nuovo limite 6–94 è automaticamente soddisfatto da qualunque sestina che rispetti F01, 8–81.

### Periodo 2021–2026 (già usato nei test v14–v19)

Nelle **1.049** estrazioni tra 2021-03-30 e 2026-10-31 i nuovi limiti ricavati dall'intero archivio conservano **{test_summary['new_hits']}/1049** vincenti (**{test_summary['new_coverage_pct']:.2f}%**), contro **{test_summary['old_hits']}/1049** (**{test_summary['old_coverage_pct']:.2f}%**) dei limiti al 95%. Il conteggio medio di combinazioni ammesse è **{test_summary['new_count_mean']:,.0f}** ({100*test_summary['new_fraction_mean']:.2f}% dell'universo) con i limiti al 99%.

**Controllo per leakage dei limiti:** stimando intervalli al 99% solo sulle 1.500 estrazioni post-2009 antecedenti alla validazione (2009-07-02–2019-01-29), congelandoli senza imporre alcun legame con gli intervalli vecchi calcolati sull'intero archivio, otteniamo:

- Numeri ordinati: **{train_num.tolist()}**.
- Ritardi ordinati: **{train_del.tolist()}**.
- Copertura delle sestine vincenti nel 2021–2026: **{preval_test_hits}/1049 = {preval_test_hits/1049*100:.2f}%**.

Questo controllo elimina l'uso futuro **nella scelta dei nuovi limiti**, ma il periodo 2021–2026 è stato già consultato nei precedenti esperimenti e quindi rimane esplorativo.

### Algoritmo per il conteggio esatto delle combinazioni residue

Per ogni concorso valutabile si esaminano in **programmazione dinamica** le scelte ordinate di 6 numeri fra 1 e 90, con vincoli di posizione, classi dei ritardi precedenti e F01. Si contano le sestine che superano tutti i limiti, poi si sottraggono le sestine **già uscite in passato** che supererebbero gli altri filtri (F02). Nessuna enumerazione esplicita di 622.614.630 combinazioni: il conteggio è **esatto**, non Monte Carlo.

Il nuovo conteggio e il nuovo esito del test sono verificati riga per riga come **superset** dei dati v06: non può diminuire il numero di sestine conservate né perdere una vincente precedentemente accettata.

### Limiti e interpretazione

- Ogni singolo intervallo copre **almeno** il 99% sul campione usato per determinarlo, **non** il 99% delle sestine quando si applicano dodici filtri congiuntamente.
- La vecchia selezione al 95% e la nuova selezione al 99% sono stimate retrospettivamente sullo storico completo. La copertura storica non prova capacità predittiva.
- Aumentare la copertura ammette necessariamente più combinazioni. Il confronto corretto è con una selezione casuale che conserva la **stessa quota media** di combinazioni.
- F01 è ora il principale vincolo che continua ad escludere parte della coda dei ritardi massimi, anche quando il filtro F14 nominale ammette fino a 94.
- Non è stata effettuata in v20 alcuna nuova ottimizzazione dei pesi del generatore neurale; la v19 rimane il riferimento per le sue prestazioni.

### Artefatti e riproducibilità v20

- `compute_v20.py`: acquisizione CSV, calcolo degli intervalli, backtest con ritardi antecedenti ed esatto conteggio combinatorio.
- `superenalotto_filtri_99_dettaglio_v20.csv`: per ciascuna delle 4.226 estrazioni, il numero esatto di sestine residue e l'esito del controllo, al 95% e al 99%.
- `superenalotto_metriche_v20.json`: metriche aggregate, intervalli, conteggi e limiti di interpretazione.
- `superenalotto_analisi_filtri_v20.md`: documento cumulativo v01–v20.

### Registro delle versioni
- **v20**: estensione F03–F14 al 99%, lasciando F01–F02 invariati; misura del compromesso copertura/riduzione, controllo delle soglie pre-validazione, verifiche di non regressione sulle 4.226 estrazioni.
"""
# Fix typo for polished artifact.
md=md.replace('| Metricas |','| Indicatore |')
outfile=ROOT/'superenalotto_analisi_filtri_v20.md'
outfile.write_text(base.rstrip()+'\n'+md,encoding='utf-8')

print('=== SUMMARY 4,226 ===')
print(json.dumps(allsummary,indent=2,ensure_ascii=False))
print('=== TEST 1049 ===')
print(json.dumps(test_summary,indent=2,ensure_ascii=False))
print('=== PRE-VALIDATION 99 ===')
print(train_num.tolist(),train_del.tolist(),preval_test_hits)
print('OUTPUT',outfile)
