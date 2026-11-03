from pathlib import Path
from collections import Counter,defaultdict
from itertools import combinations
from math import comb
import csv,json
D=Path('/mnt/data')
with (D/'estrazioni_con_ritardi.csv').open(encoding='utf-8-sig',newline='') as f:
    rows=sorted(csv.DictReader(f,delimiter=';'),key=lambda r:(r['data'],int(r['concorso'])))
ns=[tuple(int(r[f'n{i}']) for i in range(1,7)) for r in rows]
assert len(rows)==4294
allseen=Counter(); occ=defaultdict(list); details=[]; perdraw=[]
for i,(row,ss) in enumerate(zip(rows,ns)):
    qs=list(combinations(ss,4))
    prior_counts=[allseen[q] for q in qs]
    rec={'indice_cronologico':i+1,'data':row['data'],'concorso':row['concorso'],
         'sestina':' '.join(map(str,ss)),'quartine_generate':15,
         'quartine_distinte_prima':sum(z>0 for z in prior_counts),
         'apparizioni_precedenti_quartine':sum(prior_counts),
         'massima_frequenza_precedente':max(prior_counts),
         'quartine_gia_estratte':'; '.join('-'.join(map(str,q)) for q,c in zip(qs,prior_counts) if c)}
    for j,(q,p) in enumerate(zip(qs,prior_counts),1):
        rec[f'quartina_{j}']=' '.join(map(str,q))
        rec[f'frequenza_prima_{j}']=p
        details.append({'indice_cronologico':i+1,'data':row['data'],'concorso':row['concorso'],
                        'posizione_quartina':j,'quartina':' '.join(map(str,q)),
                        'frequenza_precedente':p})
        occ[q].append(i)
        allseen[q]+=1
    perdraw.append(rec)
for t in details:
    t['frequenza_totale_archivio']=allseen[tuple(map(int,t['quartina'].split()))]
files=[('superenalotto_quartine_per_estrazione_v22.csv',perdraw),('superenalotto_quartine_frequenze_complete_v22.csv',details)]
for fn,ls in files:
    with (D/fn).open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=ls[0]);w.writeheader();w.writerows(ls)
rep=[(q,idx) for q,idx in occ.items() if len(idx)>1]
rep.sort(key=lambda t:(-len(t[1]),t[0]))
rep_rows=[]
for q,idxs in rep:
    rep_rows.append({'quartina':' '.join(map(str,q)),'frequenza_totale':len(idxs),
        'prime_date':rows[idxs[0]]['data'],'ultima_data':rows[idxs[-1]]['data'],
        'concorsi':';'.join(f"{rows[i]['data']}#{rows[i]['concorso']}" for i in idxs),
        'indici_cronologici':';'.join(map(str,(j+1 for j in idxs)))})
with (D/'superenalotto_quartine_ripetute_v22.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=rep_rows[0]);w.writeheader();w.writerows(rep_rows)
hist=dict(sorted(Counter(allseen.values()).items()))
# Pair of independent draws with >=4 shared numbers (equals quartine overlap in 5+, but multiple quartines per overlapping draw pair)
T=comb(90,6)
q4=comb(6,4)*comb(84,2)/T
q5=comb(6,5)*comb(84,1)/T
q6=1/T
mu_pair_ge4=comb(len(rows),2)*(q4+q5+q6)
# The number of *pairwise shared quartine occurrences*, with multiplicity C(shared_size,4) is expected (15**2/C(90,4)) per unordered pair of draws.
mu_quartine_pair_collisions=comb(len(rows),2)*15*15/comb(90,4)
observed_collisions=sum(comb(c,2) for c in allseen.values() if c>=2)
summary={
'estrazioni':len(rows),'quartine_generate':15*len(rows),'quartine_possibili':comb(90,4),
'quartine_distinte':len(allseen), 'frequenze_istoriche':{str(k):v for k,v in hist.items()},
'quartine_ripetute_distinte':len(rep), 'quartine_comparse_almeno_3':sum(v for k,v in hist.items() if k>=3),
'estrazioni_con_quartine_gia_viste':sum(r['quartine_distinte_prima']>0 for r in perdraw),
'estrazioni_con_piudiuna_quartina_ripetuta':sum(r['quartine_distinte_prima']>1 for r in perdraw),
'quartine_gia_viste_per_estrazione_media':sum(r['quartine_distinte_prima'] for r in perdraw)/len(rows),
'appars_precedenti_quartine_totale':sum(r['apparizioni_precedenti_quartine'] for r in perdraw),
'collisioni_coppie_quartine_osservate':observed_collisions,
'collisioni_coppie_quartine_attese_uniformi':mu_quartine_pair_collisions,
'coppie_estrazioni_con_almeno_4_numeri_attese':mu_pair_ge4,
'quota_estrazioni_con_quartine_gia_viste':sum(r['quartine_distinte_prima']>0 for r in perdraw)/len(rows),
'ultima_estrazione':{'data':rows[-1]['data'],'sestina':' '.join(map(str,ns[-1])),'quartine_gia_viste':perdraw[-1]['quartine_distinte_prima']},
}
(D/'superenalotto_quartine_metriche_v22.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(summary,indent=2,ensure_ascii=False))
