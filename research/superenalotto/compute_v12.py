#!/usr/bin/env python3
"""v12: recursive sorted nearest-distance series for SuperEnalotto.

Rule: D[0] = last (most recent) increasing sextuple E[0].
For each older draw E[k], D[k] = sort([min(abs(a-b) for b in D[k-1]) for a in E[k]]).
Duplicate distances and zero are allowed; sorting the output is essential.
Comparison with 200 independent uniform sequences and 200 historical shuffles
is descriptive only, not a predictor for next draw.
"""
from pathlib import Path
import hashlib, json, time
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parent
INPUT=ROOT/'estrazioni_con_ritardi.csv'
DATA_CSV=ROOT/'superenalotto_serie_differenze_minime_v12.csv'
CHART=ROOT/'superenalotto_differenze_minime_v12.png'
ACF_CHART=ROOT/'superenalotto_differenze_autocorrelazione_v12.png'
SIM_CSV=ROOT/'superenalotto_differenze_simulazioni_v12.csv'
SUMMARY_JSON=ROOT/'superenalotto_metriche_v12.json'
MD=ROOT/'superenalotto_analisi_filtri_v12.md'
PRIOR=ROOT/'superenalotto_analisi_filtri_v11.md'
SEED=20261102
B=200

def series(draws):
    """Treat rows as reverse chronological, starting with latest real sextuple."""
    transformed=np.empty_like(draws, dtype=np.int16)
    transformed[0]=draws[0]
    for i in range(1,len(draws)):
        transformed[i]=np.sort(np.abs(draws[i,:,None]-transformed[i-1,None,:]).min(axis=1))
    return transformed

def cor_at_lag(x,lag):
    a=np.asarray(x,dtype=float)
    return float(np.corrcoef(a[:-lag],a[lag:])[0,1])

def diagnostics(transformed):
    maximum=transformed[:,-1].astype(float)
    mean=transformed.mean(axis=1)
    return {
        'acf_max_1': cor_at_lag(maximum,1),
        'acf_max_2': cor_at_lag(maximum,2),
        'acf_max_3': cor_at_lag(maximum,3),
        'acf_mean_1': cor_at_lag(mean,1),
        'acf_mean_2': cor_at_lag(mean,2),
        'mean_max': float(maximum.mean()),
        'mean_of_six':float(mean.mean()),
        'zero_rows':int(np.sum((transformed==0).any(axis=1))),
        'rows_all_equal':int(np.sum((transformed==transformed[:,0:1]).all(axis=1))),
        'unique_rows':int(np.unique(transformed,axis=0).shape[0]),
    }

def simulate_uniform(rng,n):
    # Efficient independent six-without-replacement uniforms per draw:
    # each row of random priorities is a permutation of 1..90, first 6 numbers.
    priorities=rng.random((n,90))
    return np.sort(np.argpartition(priorities, kth=5,axis=1)[:,:6]+1, axis=1).astype(np.int16)

def two_sided_empirical(obs, ref):
    center=np.mean(ref)
    return float((1+np.sum(np.abs(ref-center)>=abs(obs-center)))/(len(ref)+1))

def main():
    df=pd.read_csv(INPUT,sep=';',encoding='utf-8-sig')
    assert len(df)==4294 and df['data'].is_monotonic_decreasing
    draws=df[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=np.int16)
    assert np.all(np.diff(draws,axis=1)>0)
    assert draws.min()>=1 and draws.max()<=90
    transformed=series(draws)
    # Verify first manual examples independent of the recursive routine
    assert transformed[:4].tolist()==[[4,18,20,33,46,78],[1,3,4,7,14,16],
                                      [1,4,25,44,61,69],[0,1,2,3,4,9]]
    out=pd.DataFrame({'passo':np.arange(len(df)),
                      'data':df['data'], 'concorso':df['concorso']})
    for i in range(6):
        out[f'estratto_{i+1}']=draws[:,i]
    for i in range(6):
        out[f'differenza_{i+1}']=transformed[:,i]
    out['minimo']=transformed[:,0]
    out['massimo']=transformed[:,-1]
    out['media']=transformed.mean(axis=1)
    out['zeri']=np.sum(transformed==0,axis=1)
    out['valori_distinti']=[len(np.unique(r)) for r in transformed]
    out.to_csv(DATA_CSV,index=False,float_format='%.6f')

    observed=diagnostics(transformed)
    rng=np.random.default_rng(SEED)
    sim=[]
    start=time.monotonic()
    for kind in ['uniforme_indipendente','cronologia_rimescolata']:
        for idx in range(B):
            if kind=='uniforme_indipendente':
                sample=simulate_uniform(rng,len(df))
            else:
                sample=draws[rng.permutation(len(df))]
            row=diagnostics(series(sample))
            row.update(modello=kind,replica=idx+1)
            sim.append(row)
        print(kind,'elapsed seconds',round(time.monotonic()-start,1),flush=True)
    simulation=pd.DataFrame(sim)
    simulation.to_csv(SIM_CSV,index=False)

    keys=['acf_max_1','acf_max_2','acf_max_3','acf_mean_1','acf_mean_2','mean_max','mean_of_six','zero_rows','rows_all_equal','unique_rows']
    controls={}
    for kind,group in simulation.groupby('modello',sort=False):
        controls[kind]={}
        for key in keys:
            vals=group[key].to_numpy()
            controls[kind][key]={'mean':float(vals.mean()),
                                  'p025':float(np.percentile(vals,2.5)),
                                  'p975':float(np.percentile(vals,97.5)),
                                  'p_two_sided':two_sided_empirical(observed[key],vals)}
    summary={
        'input':str(INPUT.name),
        'sha256':hashlib.sha256(INPUT.read_bytes()).hexdigest(),
        'rows':len(df),
        'first_date':str(df['data'].iloc[0]),
        'last_date':str(df['data'].iloc[-1]),
        'seed':SEED,'replications_per_control':B,
        'definition':'D[0]=E[0], D[k]=sort(min_{b in D[k-1]} |a-b| for a in E[k]); chronological order most recent to oldest',
        'observed':observed,'controls':controls,
        'first_20':out.head(20).to_dict(orient='records'),
    }
    SUMMARY_JSON.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')

    # Chart: first 60 steps, discrete positions and their maximum.
    fig,ax=plt.subplots(figsize=(12,6.2))
    p=85
    for j in range(6):
        ax.plot(np.arange(p),transformed[:p,j],linewidth=1.15,alpha=.72,label=f'D{j+1}')
    ax.set(title='Differenze minime ricorsive — prime 85 estrazioni retrograde',
           xlabel='Passaggi a ritroso dal 31/10/2026',ylabel='Differenza minima')
    ax.set_xlim(0,p-1)
    ax.set_ylim(bottom=0)
    ax.grid(alpha=.25)
    ax.legend(ncol=6,loc='upper right')
    fig.tight_layout()
    fig.savefig(CHART,dpi=170)
    plt.close(fig)

    lags=range(1,21)
    real=[cor_at_lag(transformed[:,-1],k) for k in lags]
    fig,ax=plt.subplots(figsize=(11,5.5))
    ax.bar(list(lags),real)
    ax.axhline(0,color='gray',linewidth=1)
    ax.set(title='Autocorrelazione del massimo delle sei differenze',
           xlabel='Ritardo in passi (lag)',ylabel='Autocorrelazione')
    ax.set_xticks(list(lags))
    ax.grid(axis='y',alpha=.24)
    fig.tight_layout()
    fig.savefig(ACF_CHART,dpi=170)
    plt.close(fig)

    prior=PRIOR.read_text(encoding='utf-8')
    pairs=[('ACF massimo lag 1','acf_max_1'),('ACF massimo lag 2','acf_max_2'),
           ('ACF massimo lag 3','acf_max_3'),('ACF media lag 1','acf_mean_1'),
           ('ACF media lag 2','acf_mean_2'),('Media del massimo','mean_max'),
           ('Righe con almeno uno zero','zero_rows'),('Righe con sei valori uguali','rows_all_equal')]
    tbl=['| Statistica | Reale | Uniforme: media [2,5%–97,5%] | Rimescolato: media [2,5%–97,5%] |',
         '|---|---:|---:|---:|']
    for label,key in pairs:
        v=observed[key]
        def fmt(val):return f'{val:.4f}' if 'acf' in key else f'{val:.2f}'
        def compare(kind):
            c=controls[kind][key]
            return f"{fmt(c['mean'])} [{fmt(c['p025'])}–{fmt(c['p975'])}]"
        tbl.append(f"| {label} | {fmt(v)} | {compare('uniforme_indipendente')} | {compare('cronologia_rimescolata')} |")

    md_append=f'''\n\n---\n\n## Versione 12 — Serie ricorsiva di differenze minime (2 novembre 2026)\n\n**Stato:** nuova trasformazione, non un filtro predittivo; i filtri F01–F14 rimangono invariati.\n\n### Definizione operativa\n\nIl file sorgente è in ordine cronologico inverso. Si chiama `E[k]` la sestina realmente estratta alla riga `k`, già ordinata crescente, e `D[k]` la sestina derivata, anch'essa ordinata crescente.\n\n- **Inizializzazione:** `D[0] = E[0] = [4, 18, 20, 33, 46, 78]` (31 ottobre 2026).\n- **Passaggio ricorsivo:** per ogni numero `a` della sestina reale **precedente** `E[k]`, con `k >= 1`, si calcola `min(abs(a-b) per b in D[k-1])`, dove `D[k-1]` contiene i sei valori già trasformati al passo più recente. Poi si ordinano i sei valori ottenuti.\n- **Formula:** `D[k] = sort([ min_(b in D[k-1]) |a-b|  per ogni a in E[k] ])`.\n- **Distanze:** sono ammessi zeri e duplicati; non si cerca un assegnamento biunivoco, e **ogni** numero reale può scegliere lo stesso elemento di `D[k-1]`. L'equidistanza non necessita spareggio perché si conserva **solo la distanza**.\n- La serie viene calcolata fino all'ultima estrazione disponibile dell'archivio (03/12/1997), per **{len(df):,}** righe e **{len(df)-1:,}** trasformazioni.\n\n**Controllo manuale:**\n\n| Passo | Data | Sestina reale E[k] | Sestina derivata D[k] |\n|---:|---|---|---|\n| 0 | 31/10/2026 | 4 18 20 33 46 78 | 4 18 20 33 46 78 |\n| 1 | 30/10/2026 | 19 24 49 62 64 85 | 1 3 4 7 14 16 |\n| 2 | 29/10/2026 | 13 20 41 60 77 85 | 1 4 25 44 61 69 |\n| 3 | 27/10/2026 | 23 34 44 48 64 70 | 0 1 2 3 4 9 |\n| 4 | 24/10/2026 | 11 17 32 50 73 80 | 2 8 23 41 64 71 |\n\n**Esempio passo 1:** ogni valore in `[19,24,49,62,64,85]` prende la distanza minima da `[4,18,20,33,46,78]`. Si ottengono, nell'ordine originale, `[1,4,3,16,14,7]`, che ordinati diventano `[1,3,4,7,14,16]`.\n\n### Caratteristiche empiriche della serie completa\n\n- Il massimo delle sei differenze ha media **{observed['mean_max']:.3f}**, e la media di tutti i 25.764 valori trasformati è **{observed['mean_of_six']:.3f}**.\n- Il massimo presenta autocorrelazioni ai lag 1/2/3 di **{observed['acf_max_1']:+.3f} / {observed['acf_max_2']:+.3f} / {observed['acf_max_3']:+.3f}**. L'alternanza forte dei segni può segnalare una dinamica oscillatoria **della trasformazione**: valori piccoli di `D[k-1]` possono produrre grandi distanze al passo seguente, e viceversa.\n- Ci sono **{observed['zero_rows']}** righe con almeno uno zero, **{observed['rows_all_equal']}** righe con tutti i sei valori uguali e **{observed['unique_rows']}** sestine trasformate differenti.\n- A differenza di v10, qui **le colonne possono separarsi dopo avere coinciso**: ciascun nuovo output è calcolato dai sei *nuovi* numeri reali e dai sei valori di `D` del passo precedente. Non si conserva alcun abbinamento fisso tra colonne. La convergenza permanente della versione 10 non è una proprietà di questa nuova trasformazione.\n\n### Verifica dell'alternanza con modelli di controllo\n\nPer distinguere una proprietà delle estrazioni da una proprietà della trasformazione, sono state generate **{B} repliche indipendenti uniformi** di 4.294 sestine (6 numeri distinti da 1 a 90, campionati senza rimpiazzo) e **{B} repliche con la cronologia delle sestine storiche rimescolata**. Per ogni replica si avvia la trasformazione dalla sestina più recente della sequenza simulata e si applica identica regola retrograda. `seed={SEED}`. Gli intervalli della tabella rappresentano il 2,5° e 97,5° percentile delle **statistiche delle repliche**, non intervalli di confidenza sui dati reali.\n\n{chr(10).join(tbl)}\n\n**Interpretazione:** se autocorrelazioni molto negative a lag dispari e positive a lag pari si ripetono nei due controlli, sono generate dalla regola matematica anche in assenza di struttura temporale reale. I valori `p` Monte Carlo sono nel JSON delle metriche; con {B} repliche la minima risoluzione è 1/{B+1}, e i confronti restano esplorativi in presenza di metriche multiple. Non trarre conclusioni predittive da queste autocorrelazioni senza un confronto fuori campione con estrazioni future.\n\n### File generati e riproducibilità\n\n- `superenalotto_serie_differenze_minime_v12.csv`: 4.294 righe con passo, data, concorso, sestina vera, sei differenze ordinate, minimo, massimo, media, numero di zeri e valori distinti.\n- `superenalotto_differenze_minime_v12.png`: prime 85 righe delle sei traiettorie.\n- `superenalotto_differenze_autocorrelazione_v12.png`: correlazione temporale del massimo ai lag 1–20.\n- `superenalotto_differenze_simulazioni_v12.csv`: 400 risultati delle due famiglie di simulazioni.\n- `superenalotto_metriche_v12.json`: tutte le misure e le statistiche di confronto.\n- `compute_v12.py`: codice che riproduce serie, verifiche, simulazioni, grafici e appendice Markdown partendo da `estrazioni_con_ritardi.csv` e dal documento `superenalotto_analisi_filtri_v11.md`.\n- SHA-256 del file sorgente: `{summary['sha256']}`.\n\n**Nota:** queste trasformazioni usano volontariamente l'intera storia *all'indietro*, quindi non sono un algoritmo predittivo per la prossima estrazione. Per verificarne la capacità predittiva sarà necessario definire una caratteristica computabile usando solo l'informazione disponibile prima del concorso previsto, addestrare su un periodo iniziale e valutare su concorsi successivi senza riottimizzare sui risultati del test.\n\n### Registro aggiornamenti\n\n- **v12:** introdotta e calcolata la serie ricorsiva delle sei differenze minime ordinate su tutto il CSV, distinta dalla serie dei numeri più vicini di v10; analizzata l'alternanza osservata e confrontata con sequenze casuali e sequenze storiche rimescolate; F01–F14 invariati.\n'''
    MD.write_text(prior.rstrip()+md_append,encoding='utf-8')
    print(json.dumps({'observed':observed,'controls':controls},ensure_ascii=False,indent=2))
    print('Saved:',DATA_CSV,CHART,ACF_CHART,SIM_CSV,SUMMARY_JSON,MD,sep='\n')

if __name__=='__main__':main()
