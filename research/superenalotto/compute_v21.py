#!/usr/bin/env python3
"""SuperEnalotto v21: repeat analysis of embedded 5-number subsets and F01 6..94.

Inputs: estrazioni_con_ritardi.csv, superenalotto_filtri_99_dettaglio_v20.csv,
        superenalotto_analisi_filtri_v20.md.
Outputs: cumulative v21 Markdown, detailed CSVs, summary JSON, plot.
Requirements: python, numpy, numba, matplotlib. No external data or web calls.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from itertools import combinations, combinations_with_replacement
from pathlib import Path
import csv, json, math
import numpy as np
from numba import njit

DIR=Path(__file__).resolve().parent
TOTAL=math.comb(90,6)
with (DIR/'estrazioni_con_ritardi.csv').open(encoding='utf-8-sig',newline='') as f:
    records=sorted(csv.DictReader(f,delimiter=';'), key=lambda r:(r['data'],int(r['concorso'])))
assert len(records)==4294
numbers=np.asarray([[int(r[f'n{i}']) for i in range(1,7)] for r in records],dtype=np.int16)
dates=[r['data'] for r in records]
assert all(len(set(s))==6 and tuple(s)==tuple(sorted(s)) for s in numbers)

# All six five-subsets of each sextuple. Count appearances (not number of times in one draw).
seen=Counter()
first={}
occurrences=defaultdict(list)
per_draw=[]
for i,s in enumerate(numbers):
    combos=list(combinations(map(int,s),5))
    repeat=[(v,seen[v]) for v in combos if seen[v]]
    row={"indice_cronologico":i+1, "data":dates[i],"concorso":records[i]['concorso'],
         "sestina":" ".join(map(str,s)),"cinquine_generate":6,
         "cinquine_gia_apparse":len(repeat),
         "apparizioni_precedenti_cinquine":sum(c for _,c in repeat),
         "cinquine_ripetute":"; ".join("-".join(map(str,v)) for v,_ in repeat)}
    per_draw.append(row)
    for comb5 in combos:
        seen[comb5]+=1
        occurrences[comb5].append(i)

repeats=sorted((c,indices) for c,indices in occurrences.items() if len(indices)>1)
assert len(repeats)==11
hist=Counter(seen.values())
assert hist=={1:25742,2:11}
assert sum(int(x['cinquine_gia_apparse']) for x in per_draw)==11

# Detail: expose all six five-subsets and their historical and whole-sample frequencies.
longrows=[]
for i,s in enumerate(numbers):
    for j,c in enumerate(combinations(map(int,s),5),start=1):
        cnt_before=occurrences[c].index(i)
        count_total=len(occurrences[c])
        per_draw[i][f'cinquina_{j}']=' '.join(map(str,c))
        per_draw[i][f'frequenza_prima_{j}']=cnt_before
        per_draw[i][f'frequenza_totale_{j}']=count_total
        longrows.append({'data':dates[i], 'concorso':records[i]['concorso'],
                         'posizione_cinquina':j, 'cinquina':' '.join(map(str,c)),
                         'frequenza_precedente':cnt_before,'frequenza_totale_archivio':count_total})
with (DIR/'superenalotto_cinquine_per_estrazione_v21.csv').open('w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=per_draw[0].keys());w.writeheader();w.writerows(per_draw)
with (DIR/'superenalotto_cinquine_frequenze_complete_v21.csv').open('w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=longrows[0].keys());w.writeheader();w.writerows(longrows)
with (DIR/'superenalotto_cinquine_ripetute_v21.csv').open('w',encoding='utf-8',newline='') as f:
    header=['cinquina','frequenza','prima_data','prima_concorso','prima_sestina','ultima_data','ultimo_concorso','ultima_sestina','distanza_estrazioni']
    w=csv.DictWriter(f,fieldnames=header);w.writeheader()
    for c,inds in repeats:
        a,b=inds
        w.writerow(dict(cinquina=' '.join(map(str,c)),frequenza=len(inds),prima_data=dates[a],prima_concorso=records[a]['concorso'],
                        prima_sestina=' '.join(map(str,numbers[a])),ultima_data=dates[b],ultimo_concorso=records[b]['concorso'],
                        ultima_sestina=' '.join(map(str,numbers[b])),distanza_estrazioni=b-a))

# Pre-draw delays. A row is assessable as soon as all 90 numbers have appeared.
last=np.full(91,-1,dtype=np.int32)
delays=np.zeros((len(records),91),dtype=np.int16)
valid=np.zeros(len(records),dtype=np.bool_)
for i,s in enumerate(numbers):
    if np.all(last[1:]>=0):
        valid[i]=True
        delays[i,1:]=i-last[1:]
    for z in s:last[z]=i
idxs=np.flatnonzero(valid)
assert len(idxs)==4226

with (DIR/'superenalotto_filtri_99_dettaglio_v20.csv').open(encoding='utf-8',newline='') as f:
    oldrows=list(csv.DictReader(f))
print('v20 columns',list(oldrows[0].keys()),flush=True)
assert len(oldrows)==len(idxs)
# Map names in v20 detail file to use as baseline.
print('v20 first record',oldrows[0],flush=True)

NUM_BOUNDS=np.asarray([[1,49],[2,64],[7,76],[16,84],[28,89],[46,90]],dtype=np.int16)
DEL_BOUNDS=np.asarray([[1,11],[1,18],[1,26],[2,35],[4,53],[6,94]],dtype=np.int16)
# F01=F14: minimum maximum delay 6, maximum 94.
cat_parts=[(1,1),(2,3),(4,5),(6,11),(12,18),(19,26),(27,35),(36,53),(54,94)]
cat=np.full(95,-1,dtype=np.int8)
for c,(lo,hi) in enumerate(cat_parts):cat[lo:hi+1]=c
assert np.all(cat[1:94]>=0)
states=[()]
starts=[0]
for k in range(1,7):
    starts.append(len(states))
    states.extend(combinations_with_replacement(range(9),k))
starts.append(len(states))
lookup={s:i for i,s in enumerate(states)}
trans=np.full((len(states),9),-1,dtype=np.int32)
for i,s in enumerate(states):
    if len(s)<6:
        for c in range(9):trans[i,c]=lookup[tuple(sorted((*s,c)))]
accepted=np.zeros(len(states),dtype=np.bool_)
for si in range(starts[6],starts[7]):
    c0,c1,c2,c3,c4,c5=states[si]
    accepted[si]=(c0<=3 and c1<=4 and c2<=5 and 1<=c3<=6 and 2<=c4<=7 and c5>=3)

@njit
def count_exact(num,dl,valid,cat,starts,trans,accepted,bounds):
    n=num.shape[0]
    counts=np.zeros(n,dtype=np.int64)
    excluded=np.zeros(n,dtype=np.int32)
    for i in range(n):
        if not valid[i]:continue
        dp=np.zeros(trans.shape[0],dtype=np.int64)
        dp[0]=1
        for x in range(1,91):
            delta=dl[i,x]
            if delta<1 or delta>94:continue
            c=cat[delta]
            for pos in range(5,-1,-1):
                if x<bounds[pos,0] or x>bounds[pos,1]:continue
                for si in range(starts[pos],starts[pos+1]):
                    cnt=dp[si]
                    if cnt:dp[trans[si,c]]+=cnt
        total=0
        for si in range(starts[6],starts[7]):
            if accepted[si]:total+=dp[si]
        # Subtract earlier drawn sextuples that satisfy the other filters (F02).
        blocked=0
        for prev in range(i):
            ok=True
            ds=np.empty(6,dtype=np.int16)
            for pos in range(6):
                z=num[prev,pos]
                if z<bounds[pos,0] or z>bounds[pos,1]:
                    ok=False
                    break
                ds[pos]=dl[i,z]
            if not ok:continue
            ds.sort()
            if ds[5]<6 or ds[5]>94:continue
            if ds[0]>11 or ds[1]>18 or ds[2]>26:continue
            if ds[3]<2 or ds[3]>35:continue
            if ds[4]<4 or ds[4]>53:continue
            blocked+=1
        counts[i]=total-blocked
        excluded[i]=blocked
    return counts,excluded

print('Counting F01=6..94 with all other filters 99% ...',flush=True)
counts,excluded=count_exact(numbers,delays,valid,cat,np.asarray(starts,dtype=np.int32),trans,accepted,NUM_BOUNDS)
old_count=np.array([int(r['new99_count']) for r in oldrows],dtype=np.int64)
old_hit=np.array([int(r['new99_hit']) for r in oldrows],dtype=np.int8)
assert all(dates[i]==row['date'] for i,row in zip(idxs,oldrows))
hits=np.zeros(len(records),dtype=np.int8)
for i in idxs:
    ds=np.sort(delays[i,numbers[i]])
    hits[i]=int(6<=ds[-1]<=94 and np.all((numbers[i]>=NUM_BOUNDS[:,0])&(numbers[i]<=NUM_BOUNDS[:,1]))
                and np.all((ds>=DEL_BOUNDS[:,0])&(ds<=DEL_BOUNDS[:,1])))
valid_counts=counts[idxs]
valid_hits=hits[idxs]
assert np.all(valid_counts>=old_count) and np.all(valid_hits>=old_hit)
assert np.all(valid_counts<=TOTAL)
assert np.all(valid_counts>=0)
assert len(idxs)==4226

outrows=[]
for z,i in enumerate(idxs):
    r=per_draw[i]
    outrows.append(dict(data=dates[i],concorso=records[i]['concorso'],
        num_cinquine_gia_uscite=r['cinquine_gia_apparse'],
        num_comb_residue_F01_8_81=int(old_count[z]),
        num_comb_residue_F01_6_94=int(valid_counts[z]),
        hit_F01_8_81=int(old_hit[z]),hit_F01_6_94=int(valid_hits[z]),
        combinazioni_recuperate=int(valid_counts[z]-old_count[z]),
        cinquina_precedentemente_uscita=r['cinquine_ripetute']))
with (DIR/'superenalotto_filtri_dettaglio_v21.csv').open('w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=outrows[0].keys());w.writeheader();w.writerows(outrows)

N=len(idxs)
def summary(arr,hit):
    return dict(estrazioni=len(arr),combinazioni_residue_medie=float(arr.mean()),riduzione_pct=100*(1-float(arr.mean())/TOTAL),
                copertura_pct=100*float(hit.mean()),sestine_vincenti_conservate=int(hit.sum()),
                sestine_vincenti_escluse=int(len(hit)-hit.sum()),
                quota_media_combinazioni_conservate_pct=100*float(arr.mean())/TOTAL,
                vincite_attese_sotto_nullo_uniforme=float(arr.sum())/TOTAL)
old_summary=summary(old_count,old_hit)
new_summary=summary(valid_counts,valid_hits)
test_sel=np.array([dates[i]>='2021-03-30' for i in idxs])
test_old=summary(old_count[test_sel],old_hit[test_sel]);test_new=summary(valid_counts[test_sel],valid_hits[test_sel])
repeat_indices=[i for i,r in enumerate(per_draw) if r['cinquine_gia_apparse']]
hit_repeats=int(hits[repeat_indices].sum())

# Expected number of independent draw pairs that share 5 or more numbers.
p_exact5=math.comb(6,5)*math.comb(84,1)/TOTAL
p_exact6=1/TOTAL
mu_pairs=math.comb(len(records),2)*(p_exact5+p_exact6)
# Poisson approx, as counts are sparse and weakly dependent.
p_ge11=float(1-sum(math.exp(-mu_pairs)*mu_pairs**k/math.factorial(k) for k in range(11)))
print('OLD',old_summary,flush=True)
print('NEW',new_summary,flush=True)
print('TEST',test_old,test_new,flush=True)
print('REPEATS',len(repeat_indices),'surviving among new',hit_repeats,'expected',mu_pairs,'p_approx',p_ge11,flush=True)

meta=dict(version=21,date_min=dates[0],date_max=dates[-1],n_draws=len(records),
    n_testable=N,all_five_subsets=len(records)*6,unique_fives=len(seen),
    five_subset_frequency_distribution={str(k):v for k,v in sorted(hist.items())},
    drawings_with_historical_five_repeat=len(repeat_indices),
    poisson_mean_expected_draw_pairs_sharing_at_least_five=mu_pairs,
    poisson_approx_p_at_least_11=p_ge11,
    five_repeat_draws_surviving_all_v21_filters=hit_repeats,
    f01_old='8..81',f01_new='6..94',
    f14_same_as_f01=True,
    bounds_numerical_99=NUM_BOUNDS.tolist(),bounds_delay_99=DEL_BOUNDS.tolist(),
    result_before=old_summary,result_after=new_summary,
    test2021_before=test_old,test2021_after=test_new,
    interpretations=['Cinquine sono 5-subset di ciascuna sestina, con duplicati permessi tra concorsi.',
        'F01/F14 deterministici applicati a ritardi PRE-estrazione.',
        'I limiti 99% sono stimati sull’intero campione: risultati retrospettivi, non validazione futura.',
        'P-value è approssimazione Poisson non un test esatto.',
        'Non attivato un filtro sulle cinquine ripetute.'])
(DIR/'superenalotto_metriche_v21.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Plot: cumulative repeats observed vs simple expected count based on independent draws.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
idx=np.arange(len(records))
obs=np.cumsum(np.asarray([int(bool(r['cinquine_gia_apparse'])) for r in per_draw]))
expected=(idx*(idx+1)/2)*(p_exact5+p_exact6)
fig,ax=plt.subplots(figsize=(11,5.8))
ax.step(idx+1,obs,where='post',label='Coppie osservate con almeno 5 numeri comuni')
ax.plot(idx+1,expected,label='Coppie attese con estrazioni indipendenti',linestyle='--')
ax.set(title='SuperEnalotto — ricomparsa di cinquine tra estrazioni',
       xlabel='Numero di estrazioni dall’inizio dello storico',ylabel='Coppie di estrazioni')
ax.grid(alpha=.25);ax.legend(loc='upper left');fig.tight_layout()
fig.savefig(DIR/'superenalotto_cinquine_frequenze_v21.png',dpi=160)
plt.close(fig)

# Write cumulative document: retain the complete previous version unchanged,
# append a new version section with full operational definitions.
previous=(DIR/'superenalotto_analisi_filtri_v20.md').read_text(encoding='utf-8')
def fmt(n):return f'{n:,.0f}'.replace(',','.')
def pct(x):return f'{x:.3f}%'.replace('.',',')
repeat_rows=[]
for subset, (ia,ib) in repeats:
    repeat_rows.append(f"| {' '.join(map(str,subset))} | {dates[ia]} | {dates[ib]} | {ib-ia} |")
report=f'''\n\n---\n\n## Esperimento 21 — Frequenza delle cinquine e F01 ripristinato a 6–94\n\n### Scopo e dati\n\n- Sono disponibili **{len(records):,}** estrazioni dal **{dates[0]}** al **{dates[-1]}**; i sei numeri di ciascuna sestina sono distinti.\n- Ogni sestina {{a,b,c,d,e,f}} contiene esattamente sei cinquine: le combinazioni di 5 numeri ottenute scegliendo 5 dei 6. Le cinquine sono **insiemi non ordinati**.\n- I conteggi sono cronologici: una ricomparsa si conta solo quando la cinquina era già apparsa **prima** del concorso target.\n- Modifica ai filtri: **F01 passa da 8 ≤ massimo ritardo ≤ 81 a 6 ≤ massimo ritardo ≤ 94.** F02–F14 restano invariati nella definizione della versione 20 (intervalli marginali 99% per F03–F14). **F01 e F14 ora coincidono**; quindi uno dei due è ridondante, pur restando entrambe le etichette nella numerazione per tracciabilità.\n\n### Frequenze di cinquine\n\n| Indicatore | Valore |\n|---|---:|\n| Estrazioni | {fmt(len(records))} |\n| Cinquine generate (6 per estrazione) | {fmt(6*len(records))} |\n| Cinquine possibili da 1 a 90 | {fmt(math.comb(90,5))} |\n| Cinquine uniche osservate | {fmt(len(seen))} |\n| Cinquine osservate una sola volta | {fmt(hist[1])} |\n| Cinquine osservate due volte | **{hist[2]}** |\n| Cinquine osservate tre o più volte | 0 |\n| Estrazioni con ≥1 cinquina già vista | **{len(repeat_indices)}** |\n\nElenco completo delle undici cinquine ripetute (una prima e una seconda uscita):\n\n| Cinquina | Prima uscita | Ricomparsa | Intervallo in estrazioni |\n|---|---|---|---:|\n{chr(10).join(repeat_rows)}\n\n#### Confronto con ipotesi casuale\n\nPer due sestine indipendenti ed equiprobabili, la probabilità che abbiano **almeno cinque numeri in comune** è\n\n`[C(6,5) C(84,1) + 1] / C(90,6) = {p_exact5+p_exact6:.10f}`.\n\nSulle `C({len(records)},2)` coppie cronologiche, il numero medio atteso di coppie con sovrapposizione ≥5 è **{mu_pairs:.3f}**; osservate **{len(repeat_indices)}**. Una approssimazione Poisson dà `P(X≥11) ≈ {p_ge11:.3f}`: lo scostamento non indica di per sé una dipendenza predittiva. Le coppie con sestina identica sono zero nello storico, perciò ciascuna ricomparsa di cinquina corrisponde a una coppia distinta di sestine con 5 numeri comuni.\n\n**Non è stato attivato alcun nuovo filtro che escluda le sestine contenenti cinquine già uscite.** Sarebbe un'ulteriore ipotesi da testare rispetto a una baseline di pari dimensione. In particolare non si deve interpretare la rarità di una ripetizione passata come una minore probabilità futura per una cinquina specifica.\n\n### Modifica F01 e impatto esatto sui 14 filtri\n\nF01 precedente `8 ≤ max(ritardi pre-estrazione) ≤ 81`; nuovo **`6 ≤ max(ritardi pre-estrazione) ≤ 94`**. F14 ha già esattamente `6–94`: le due condizioni sono logicamente identiche. Il filtro F02 continua a eliminare le sestine già uscite in precedenza.\n\nIl conteggio delle combinazioni ammesse è **esatto**, tramite programmazione dinamica sulle scelte crescenti di sei numeri e classi di ritardo (senza enumerare 622.614.630 sestine per concorso). Confronto su **{N}** estrazioni valutabili, tutte con ritardi pre-estrazione noti per i 90 numeri:\n\n| Indicatore | v20 (F01 8–81) | v21 (F01 6–94) |\n|---|---:|---:|\n| Sestine vincenti conservate | {fmt(old_summary['sestine_vincenti_conservate'])} | **{fmt(new_summary['sestine_vincenti_conservate'])}** |\n| Copertura storica | {pct(old_summary['copertura_pct'])} | **{pct(new_summary['copertura_pct'])}** |\n| Sestine vincenti escluse | {fmt(old_summary['sestine_vincenti_escluse'])} | {fmt(new_summary['sestine_vincenti_escluse'])} |\n| Combinazioni residue medie | {fmt(old_summary['combinazioni_residue_medie'])} | **{fmt(new_summary['combinazioni_residue_medie'])}** |\n| Riduzione media rispetto a C(90,6) | {pct(old_summary['riduzione_pct'])} | {pct(new_summary['riduzione_pct'])} |\n| Quota media di combinazioni conservate | {pct(old_summary['quota_media_combinazioni_conservate_pct'])} | {pct(new_summary['quota_media_combinazioni_conservate_pct'])} |\n| Copertura casuale equivalente attesa | {pct(old_summary['quota_media_combinazioni_conservate_pct'])} | {pct(new_summary['quota_media_combinazioni_conservate_pct'])} |\n\n**Delta v21 rispetto a v20:** recuperate **{fmt(new_summary['sestine_vincenti_conservate']-old_summary['sestine_vincenti_conservate'])}** sestine vincenti, con **{fmt(new_summary['combinazioni_residue_medie']-old_summary['combinazioni_residue_medie'])}** combinazioni in più ammesse mediamente per estrazione.\n\nNel periodo di test storico 2021–2026 (già esplorato negli esperimenti precedenti), copertura: **{test_old['sestine_vincenti_conservate']}/{test_old['estrazioni']}** nella v20, **{test_new['sestine_vincenti_conservate']}/{test_new['estrazioni']}** nella v21.\n\nDei {len(repeat_indices)} concorsi in cui una cinquina ricompare, **{hit_repeats}** soddisfano gli attuali 14 filtri: questo dato è descrittivo e non è un test di un filtro aggiuntivo sulle cinquine.\n\n### Interpretazione e limiti\n\n- La copertura delle cinquine è una **frequenza storica**; non prova alcun vantaggio predittivo. La casualità non è esclusa dal numero di ripetizioni.\n- F01/F14 sono vincoli deterministici di selezione, non leggi del processo estrazionale.\n- **Leakage storico:** F03–F14 al 99% furono scelti sull'intero dataset; anche la v21 è una simulazione retrospettiva, non una valutazione prospettica fuori campione.\n- Non è stato effettuato nuovo addestramento dei modelli ESN/GRU/autoregressivi.\n\n### Artefatti riproducibili v21\n\n- `compute_v21.py`: estrae tutte le cinquine, conta le ricomparse e ricalcola esattamente F01–F14.\n- `superenalotto_cinquine_per_estrazione_v21.csv`: una riga per estrazione con tutte le sei cinquine esplicitate e, per ognuna, frequenza precedente e frequenza complessiva; oltre al totale delle ripetizioni già osservate.
- `superenalotto_cinquine_frequenze_complete_v21.csv`: 25.764 righe (una per cinquina incorporata in un'estrazione), con data, concorso e le due frequenze.\n- `superenalotto_cinquine_ripetute_v21.csv`: elenco delle undici cinquine ripetute con concorsi e date.\n- `superenalotto_filtri_dettaglio_v21.csv`: raffronto per ognuna delle {N} estrazioni valutabili.\n- `superenalotto_metriche_v21.json`: riepilogo strutturato verificabile.\n- `superenalotto_cinquine_frequenze_v21.png`: numero cumulativo di coppie con cinquina comune, contro l'atteso nullo.\n\n### Registro delle versioni\n\n- **v21**: analisi delle cinquine incorporate in ogni estrazione; F01 portato a 6–94 (identico a F14); conteggio combinatorio esatto e confronto con v20.\n'''
# Retain title, label this version near the top, not only at the bottom.
newmd=previous.replace('# SuperEnalotto', '# SuperEnalotto',1)
newmd=newmd.replace('v20', 'v20',1)  # do not modify historical content
(DIR/'superenalotto_analisi_filtri_v21.md').write_text(newmd+report,encoding='utf-8')
print('REPORT',DIR/'superenalotto_analisi_filtri_v21.md')
