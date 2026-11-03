#!/usr/bin/env python3
"""SuperEnalotto v22 — F15 exact historical exclusion, quartine recurrence.

Usage: python compute_v22.py
Needs (in same directory): estrazioni_con_ritardi.csv,
  superenalotto_filtri_dettaglio_v21.csv, superenalotto_analisi_filtri_v21.md,
  count_f15_v22.cpp, compute_v22_quartines.py.
Requires Python 3, numpy, matplotlib, and g++ with OpenMP. No network.
All rows in the F15 counts use pre-draw delays; no future knowledge for past-cinquina membership.
"""
from __future__ import annotations
import csv,json,runpy,subprocess,os,math,statistics
from pathlib import Path
from collections import Counter
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D=Path(__file__).resolve().parent
TOTAL=math.comb(90,6)
runpy.run_path(str(D/'compute_v22_quartines.py'),run_name='__main__')
with (D/'estrazioni_con_ritardi.csv').open(encoding='utf-8-sig',newline='') as f:
    source=sorted(csv.DictReader(f,delimiter=';'),key=lambda r:(r['data'],int(r['concorso'])))
nums=np.asarray([[int(r[f'n{i}']) for i in range(1,7)] for r in source],dtype=np.uint8)
assert len(nums)==4294 and np.all((nums>0)&(nums<=90)) and np.all(np.diff(nums,axis=1)>0)
nums.tofile(D/'superenalotto_numeri_v22.bin')
bin_exe=D/'count_f15_v22'
subprocess.run(['g++','-O3','-fopenmp','-std=c++17',str(D/'count_f15_v22.cpp'),'-o',str(bin_exe)],check=True)
env=os.environ.copy();env['OMP_NUM_THREADS']='4'
subprocess.run([str(bin_exe),str(D/'superenalotto_numeri_v22.bin'),str(D/'superenalotto_f15_conteggio_v22.csv')],check=True,env=env)

def csvrows(name):
    with (D/name).open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
v21=csvrows('superenalotto_filtri_dettaglio_v21.csv')
f15=csvrows('superenalotto_f15_conteggio_v22.csv')
quartine=csvrows('superenalotto_quartine_per_estrazione_v22.csv')
qrep=csvrows('superenalotto_quartine_ripetute_v22.csv')
qmetrics=json.loads((D/'superenalotto_quartine_metriche_v22.json').read_text(encoding='utf-8'))
assert len(v21)==len(f15)==4226 and len(quartine)==len(source)==4294

records=[]
for old,con in zip(v21,f15):
    ix=int(con['chronological_index']); current=source[ix]; qr=quartine[ix]
    assert old['data']==current['data']==qr['data']
    old_n=int(old['num_comb_residue_F01_6_94']);base_hit=int(old['hit_F01_6_94'])
    removed=int(con['aggiuntive_F15_rimosse'])
    seen_before=int(old['num_cinquine_gia_uscite'])
    new=old_n-removed
    assert 0<=new<=old_n<=TOTAL
    assert removed==int(con['forbidden_sestine_passanti_F01_F03_F14'])-int(con['ex_F02_passanti'])
    records.append({
        'data':current['data'],'concorso':current['concorso'],
        'residue_F01_F14':old_n,
        'escluse_extra_F15':removed,
        'residue_F01_F15':new,
        'quota_F01_F15':f'{new/TOTAL:.12f}',
        'vincente_supera_F01_F14':base_hit,
        'cinquine_precedenti_nella_vincente':seen_before,
        'vincente_supera_F01_F15':int(base_hit and seen_before==0),
        'quartine_precedenti_nella_vincente':int(qr['quartine_distinte_prima']),
        'numero_precedenti_sestine_ammissibili':int(con['ex_F02_passanti']),
        'candidate_F15_vietate_totali':int(con['forbidden_uniche_totali_note']),
    })
with (D/'superenalotto_filtri_dettaglio_v22.csv').open('w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=records[0]);w.writeheader();w.writerows(records)

# Independently verify the exact union count on two manageable historical dates
# by constructing each forbidden combination only once and checking dynamic delay bounds.
number_bounds=[(1,49),(2,64),(7,76),(16,84),(28,89),(46,90)]
delay_bounds=[(1,11),(1,18),(1,26),(2,35),(4,53),(6,94)]
from itertools import combinations
from collections import defaultdict

def brute_check(ix):
    seen=set()
    for ss in nums[:ix]:
        for c in combinations((int(z) for z in ss),5):
            for z in range(1,91):
                if z not in c:
                    cand=tuple(sorted((*c,z)))
                    if all(lo<=a<=hi for a,(lo,hi) in zip(cand,number_bounds)):
                        seen.add(cand)
    last={}
    for t,ss in enumerate(nums[:ix]):
        for z in ss:last[int(z)]=t
    assert len(last)==90
    allowed=0
    for c in seen:
        d=sorted(ix-last[z] for z in c)
        allowed+=int(all(lo<=a<=hi for a,(lo,hi) in zip(d,delay_bounds)))
    baseline=0
    for c in nums[:ix]:
        if all(lo<=int(a)<=hi for a,(lo,hi) in zip(c,number_bounds)):
            d=sorted(ix-last[int(z)] for z in c)
            baseline+=int(all(lo<=a<=hi for a,(lo,hi) in zip(d,delay_bounds)))
    ref=f15[ix-68]
    assert allowed==int(ref['forbidden_sestine_passanti_F01_F03_F14']), (ix,allowed,ref)
    assert baseline==int(ref['ex_F02_passanti']),(ix,baseline,ref)
    return {'indice_cronologico':ix,'proibite_e_compatibili':allowed,'sestine_passate_compatibili':baseline}
verification=[brute_check(68),brute_check(120)]

def summ(part):
    n=len(part); cnt=np.asarray([int(r['residue_F01_F15']) for r in part],dtype=np.int64)
    old=np.asarray([int(r['residue_F01_F14']) for r in part],dtype=np.int64)
    hits=np.asarray([int(r['vincente_supera_F01_F15']) for r in part],dtype=np.int64)
    oldhits=np.asarray([int(r['vincente_supera_F01_F14']) for r in part],dtype=np.int64)
    return dict(n=n,
      hits_before=int(oldhits.sum()),hits_after=int(hits.sum()),hits_lost=int(oldhits.sum()-hits.sum()),
      coverage_before_pct=float(100*oldhits.mean()),coverage_after_pct=float(100*hits.mean()),
      mean_before=float(old.mean()),mean_after=float(cnt.mean()),mean_extra_excluded=float((old-cnt).mean()),
      total_removed_pct=float(100*(1-cnt.mean()/TOTAL)),
      quota_retained_pct=float(100*cnt.mean()/TOTAL),
      null_hits_expected=float(cnt.sum()/TOTAL),
      quartine_repeat_winners_allowed_before=int(sum(int(r['quartine_precedenti_nella_vincente'])>0 and int(r['vincente_supera_F01_F14']) for r in part)),
      quartine_repeat_winners_allowed_after=int(sum(int(r['quartine_precedenti_nella_vincente'])>0 and int(r['vincente_supera_F01_F15']) for r in part))
    )
full=summ(records);test=summ([r for r in records if r['data']>='2021-03-30'])
assert full['hits_after']==full['hits_before']-9
assert full['n']==4226 and full['hits_before']==3878
assert test['n']==1049
assert qmetrics['quartine_distinte']==63586
# Empirical histogram for the number of previously seen quartine subsets per historical draw.
quartine_prior_hist=dict(sorted(Counter(int(r['quartine_distinte_prima']) for r in quartine).items()))
triple=[r for r in qrep if int(r['frequenza_totale'])==3]
assert len(triple)==6
metrics={'versione':22,'f01':'6-94','f02':'ridondante rispetto a F15',
  'f03_f14':'99% v20, invariati',
  'f15':'nessuna delle sei cinquine della sestina candidata deve essere apparsa prima della previsione',
  'n_estrazioni_totali':len(source),'n_estrazioni_valutabili':len(records),
  'universo_sestine':TOTAL,'f15_completo':full,'f15_2021_2026':test,
  'quartine':qmetrics,'quartine_precedenti_per_estrazione_hist':{str(k):v for k,v in quartine_prior_hist.items()},
  'quartine_comparse_tre_volte':[{'quartina':r['quartina'],'date_concorsi':r['concorsi']} for r in triple],
  'verifica_conta_bruteforce':verification,
  'nota_leakage':'gli intervalli storici F03-F14 al 99% erano stati scelti sullo storico completo. Il confronto è retrospettivo.',
  'filtro_quartine':'non attivo',
  'nota_confronto_casuale':'sotto estrazioni indipendenti uniformi, la copertura attesa per F01-F15 è la quota media di sestine ammesse',
}
(D/'superenalotto_metriche_v22.json').write_text(json.dumps(metrics,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

fig,ax=plt.subplots(figsize=(10.2,5.1))
xs=[1,2,3]; ys=[qmetrics['frequenze_istoriche'][str(k)] for k in xs]
rects=ax.bar([str(v) for v in xs],ys)
ax.set_yscale('log');ax.set_ylim(1,150000)
ax.set_xlabel('Numero di apparizioni della stessa quartina');ax.set_ylabel('Numero di quartine distinte (scala logaritmica)')
ax.set_title('SuperEnalotto — frequenza storica delle quartine, 4.294 estrazioni')
for rect,v in zip(rects,ys):ax.text(rect.get_x()+rect.get_width()/2,v*1.12,f'{v:,}'.replace(',','.'),ha='center',va='bottom')
ax.grid(alpha=.2,axis='y');fig.tight_layout()
fig.savefig(D/'superenalotto_quartine_frequenze_v22.png',dpi=160)
plt.close(fig)

def fmt(x):return f'{x:,.0f}'.replace(',','.')
def pc(x):return f'{x:.3f}%'.replace('.',',')
prior=(D/'superenalotto_analisi_filtri_v21.md').read_text(encoding='utf-8')
header='''\n> **STATO ATTUALE — VERSIONE 22 (prevale sulle formulazioni storiche successive).**\n> Sono attivi F01–F15: F01=[6,94]; F02 (nessuna sestina precedente) è ridondante per F15;\n> F03–F08 sono gli intervalli numerici al 99%; F09–F14 gli intervalli dei ritardi ordinati al 99%;\n> F15 esclude ogni sestina contenente almeno una delle cinquine già comparse nello storico precedente.\n> F01 e F14 sono equivalenti, entrambi impongono massimo ritardo 6–94.\n> Le analisi v01–v21 sono conservate integralmente come *cronologia* e non rappresentano sempre i filtri attuali.\n\n'''
lines=prior.split('\n',1)
prior=lines[0].replace('(v19)','(v22)')+'\n'+header+lines[1]
triple_rows='\n'.join(f"| {r['quartina']} | {r['concorsi'].replace(';',' · ')} |" for r in triple)
report=f'''

---

## Esperimento 22 — F15 esclude le cinquine pregresse; analisi delle quartine

### Requisiti e definizioni

Per ogni concorso da prevedere `t`, sia `H_t` l'insieme delle sestine uscite nei concorsi `0, ..., t-1`; si definisce la famiglia `P5_t` di tutte le cinquine non ordinate contenute in almeno una sestina di `H_t`.

**F15 (attivo)**: una candidata `S` di 6 numeri distinti è ammissibile se e solo se

`∀ C ⊆ S, |C|=5: C ∉ P5_t`.

Equivalentemente, nessuna sestina precedente deve condividere **5 o 6** numeri con `S`. Il filtro non consulta la sestina futura. F02 è ora **logicamente ridondante**, perché qualsiasi sestina pregressa fallisce F15; F01 e F14 sono già equivalenti.

**F01–F14:** manteniamo esattamente le definizioni della v21: F01 massimo ritardo pre-estrazione 6–94, F03–F08 fasce numeriche al 99%, F09–F14 fasce dei ritardi ordinati al 99%.

### Risultato esatto del filtro F15 (4.226 concorsi valutabili)

| Indicatore | Versione 21: F01–F14 | Versione 22: F01–F15 |
|---|---:|---:|
| Combinazioni iniziali | {fmt(TOTAL)} | {fmt(TOTAL)} |
| Combinazioni residue medie | {fmt(full['mean_before'])} | **{fmt(full['mean_after'])}** |
| Combinazioni eliminate mediamente | {fmt(TOTAL-full['mean_before'])} | **{fmt(TOTAL-full['mean_after'])}** |
| Riduzione complessiva | {pc(100*(1-full['mean_before']/TOTAL))} | **{pc(full['total_removed_pct'])}** |
| Vincitrici storiche accettate | {fmt(full['hits_before'])} | **{fmt(full['hits_after'])}** |
| Vincitrici storiche eliminate | {fmt(full['n']-full['hits_before'])} | **{fmt(full['n']-full['hits_after'])}** |
| Copertura storica | {pc(full['coverage_before_pct'])} | **{pc(full['coverage_after_pct'])}** |
| Quota media delle candidate ammesse | {pc(100*full['mean_before']/TOTAL)} | **{pc(full['quota_retained_pct'])}** |

Il nuovo F15 esclude in media **{fmt(full['mean_extra_excluded'])}** sestine aggiuntive rispetto a F01–F14, e fa perdere **{full['hits_lost']}** vincenti storiche ulteriori. Il valore atteso sotto selezione uniforme della stessa quota è **{full['null_hits_expected']:.2f}** vincitrici ammesse; il numero effettivo è **{full['hits_after']}**. Non si osserva un vantaggio predittivo.

Sul periodo 2021–2026, già impiegato negli esperimenti v14–v20, la copertura passa da **{test['hits_before']}/{test['n']}** a **{test['hits_after']}/{test['n']}** e le combinazioni residue medie da **{fmt(test['mean_before'])}** a **{fmt(test['mean_after'])}**. Anche questo confronto rimane esplorativo.

### Calcolo combinatorio rigoroso

1. Dal CSV originario si ricostruiscono, per ogni estrazione, i 90 ritardi prima dell'uscita.
2. Si generano per ciascuna sestina storica le sei cinquine; per ognuna, tutte le 85 possibili estensioni a sestina (senza duplicati).
3. Si conserva la **prima data** in cui una sestina candidata diventa vietata e si uniscono i risultati, per evitare sovraconti (una candidata può contenere più cinquine storiche).
4. Prima del conteggio si escludono le candidate incompatibili con i limiti statici di F03–F08. A ciascuna data si applicano i vincoli dinamici di ritardo F01 e F09–F14.
5. Il conteggio F01–F15 si ottiene sottraendo al totale F01–F14 soltanto le sestine *ulteriormente* escluse da F15, cioè il totale di candidate incompatibili con F15 meno le sestine già escluse da F02.
6. Il calcolo è **esatto**, non un campionamento; controlli indipendenti di enumerazione sulle estrazioni con indice 68 e 120 confermano i conteggi {verification[0]['proibite_e_compatibili']:,} e {verification[1]['proibite_e_compatibili']:,} (prima di sottrarre le sestine già estratte).

Le soglie F03–F14 furono ricavate dall'intero archivio; anche questo esercizio conserva **leakage retrospettivo nella selezione delle soglie**, benché il controllo F15 utilizzi soltanto le cinquine precedenti.

### Quartine: analisi delle frequenze

Ogni sestina contiene `C(6,4)=15` quartine non ordinate. Le 4.294 estrazioni originano **{fmt(qmetrics['quartine_generate'])}** occorrenze di quartine, appartenenti a **{fmt(qmetrics['quartine_distinte'])}** quartine diverse, su `C(90,4)={fmt(qmetrics['quartine_possibili'])}` quartine teoriche.

| Frequenza storica della quartina | Numero di quartine distinte |
|---:|---:|
| Una sola apparizione | {fmt(int(qmetrics['frequenze_istoriche']['1']))} |
| Due apparizioni | **{fmt(int(qmetrics['frequenze_istoriche']['2']))}** |
| Tre apparizioni | **{fmt(int(qmetrics['frequenze_istoriche']['3']))}** |
| Quattro o più | 0 |

- Quartine già osservate almeno una volta: **{fmt(qmetrics['quartine_ripetute_distinte'])}** diverse.
- Estrazioni contenenti almeno una quartina già vista: **{fmt(qmetrics['estrazioni_con_quartine_gia_viste'])}/{fmt(len(source))} = {pc(100*qmetrics['quota_estrazioni_con_quartine_gia_viste'])}**.
- Estrazioni con almeno due quartine pregresse: **{qmetrics['estrazioni_con_piudiuna_quartina_ripetuta']}**.
- Coppie di occorrenze della stessa quartina: **{qmetrics['collisioni_coppie_quartine_osservate']}** osservate e **{qmetrics['collisioni_coppie_quartine_attese_uniformi']:.2f}** attese per estrazioni indipendenti uniformi. Attenzione: una singola coppia di sestine con cinque numeri in comune contribuisce a cinque coppie di quartine; le collisioni non sono prove indipendenti.

**Distribuzione del numero di quartine già uscite dentro la sestina vincente** (prima del relativo concorso):

| Quartine precedentemente comparse nella sestina | Numero di estrazioni |
|---:|---:|
{chr(10).join(f'| {k} | {fmt(v)} |' for k,v in quartine_prior_hist.items())}

Le sei quartine osservate **tre volte**:

| Quartina | Estrazioni in cui ricompare |
|---|---|
{triple_rows}

### Ipotesi di un futuro filtro sulle quartine (NON attivo)

Se in aggiunta all'attuale F15 imponessimo l'esclusione di ogni sestina contenente una quartina già uscita, perderemmo **{full['quartine_repeat_winners_allowed_after']}** ulteriori sestine vincenti tra quelle attualmente ammesse. La copertura scenderebbe da **{full['hits_after']}/{full['n']}** a **{full['hits_after']-full['quartine_repeat_winners_allowed_after']}/{full['n']} = {pc(100*(full['hits_after']-full['quartine_repeat_winners_allowed_after'])/full['n'])}**. Questo **non** è un filtro attivato né una valutazione esatta del numero di candidate eliminate (che richiederebbe un conteggio combinatorio analogo più ampio).

La maggiore frequenza delle quartine rispetto alle cinquine è prevista dal fatto che ogni sestina contiene 15 quartine e che ciascuna quartina appartiene a `C(86,2)=3655` sestine possibili. Non è una prova di distorsione nel processo di estrazione.

### Riproducibilità e artefatti

- `superenalotto_filtri_dettaglio_v22.csv`: impatto esatto di F15 e verifica della sestina vincente, concorso per concorso.
- `superenalotto_quartine_per_estrazione_v22.csv`: tutte le 15 quartine per concorso, con precedenti apparizioni e frequenza totale.
- `superenalotto_quartine_frequenze_complete_v22.csv`: tutte le 64.410 occorrenze delle quartine con frequenza precedente e globale.
- `superenalotto_quartine_ripetute_v22.csv`: le 818 quartine ricorrenti, con elenco dei concorsi.
- `superenalotto_quartine_frequenze_v22.png`: grafico delle frequenze delle quartine.
- `superenalotto_metriche_v22.json`: risultati strutturati e controlli.
- `compute_v22.py`, `compute_v22_quartines.py` e `count_f15_v22.cpp`: algoritmi riproducibili, con compilazione C++ per il conteggio efficiente.

### Registro delle versioni

- **v22**: F15 attivo (no cinquine già uscite nelle sestine candidate); conteggio esatto addizionale sui 14 filtri precedenti; analisi descrittiva delle quartine, senza attivazione del filtro sulle quartine.
'''
(D/'superenalotto_analisi_filtri_v22.md').write_text(prior+report,encoding='utf-8')
print('V22 METRICS',json.dumps({'full':full,'test':test,'quartine_hist':qmetrics['frequenze_istoriche'],'validation':verification},ensure_ascii=False,indent=2))
