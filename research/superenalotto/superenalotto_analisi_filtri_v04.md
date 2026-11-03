# SuperEnalotto — Analisi cumulativa dei filtri (v03)

## Obiettivo
Partire dalle 622,614,630 sestine possibili, applicare filtri usando esclusivamente informazioni disponibili prima di ciascuna estrazione, e verificare se la sestina vincente dell'estrazione successiva rimane tra le candidate. Confrontare la copertura con la quota di combinazioni conservate.

## Dati
Archivio `estrazioni_con_ritardi.csv`: 4.294 estrazioni; colonne `data`, `concorso`, `n1`–`n6`, `ritardo_1`–`ritardo_6` e altre. Le posizioni `n1`–`n6` sono considerate in ordine crescente.

## Filtri già attivi
- **F01:** massimo dei sei ritardi pre-estrazione compreso fra 8 e 81, inclusi.
- **F02:** escludere ogni sestina già uscita in una precedente estrazione.

### Risultati precedenti (simulazione storica)
- 4.226 estrazioni utilizzabili dopo inizializzazione della storia dei 90 numeri.
- F01: 4.119 vincitrici conservate (97,47%); 607.400.778 combinazioni residue medie (97,5565%).
- F01+F02: 4.119 vincitrici conservate (97,47%); 607.398.656 combinazioni residue medie (97,5561%).
- Per ogni data, il filtro usa solo estrazioni precedenti. I valori medi delle combinazioni residue non descrivono un singolo insieme fisso.

## Analisi nuova v03 — Intervalli per posizione al 95%
Per ogni posizione ordinata `n1`–`n6`, si cerca fra gli intervalli inclusivi di interi quello di minima ampiezza che contiene almeno `ceil(0.95 * 4294) = 4080` osservazioni. In caso di parità di ampiezza si sceglie il minimo inferiore più piccolo.

| Posizione | Min | Max | Valori interi | Copertura minima |
|---|---:|---:|---:|---:|
| n1 | 1 | 36 | 36 | 4080/4294 = 95,02% |
| n2 | 3 | 54 | 52 | 4080/4294 = 95,02% |
| n3 | 10 | 68 | 59 | 4080/4294 = 95,02% |
| n4 | 25 | 81 | 57 | 4080/4294 = 95,02% |
| n5 | 38 | 87 | 50 | 4080/4294 = 95,02% |
| n6 | 57 | 90 | 34 | 4080/4294 = 95,02% |

La copertura congiunta osservata, imponendo **tutti e sei** gli intervalli, è **3432/4294 = 79.93%**.

**Stato:** questa è un'analisi esplorativa, non un terzo filtro attivo. Gli intervalli sono calcolati sull'intero archivio, quindi non vanno usati retroattivamente per misurare capacità predittiva: sarebbe un uso di informazioni future. Per promuoverli a F03 occorre ricalcolarli in modalità walk-forward sulle sole estrazioni precedenti, oppure fissarli su un periodo di addestramento e testarli su un periodo successivo.

## Riproducibilità
1. Caricare il CSV con separatore `;`.
2. Ordinare cronologicamente per la simulazione; interpretare `n1`–`n6` come posizioni crescenti.
3. Per ciascuna posizione ordinare tutti i 4294 valori e trovare l'intervallo minimo che include almeno 4080 osservazioni.
4. Verificare la copertura congiunta contando le righe per cui tutti i valori rientrano nei rispettivi intervalli.
5. Per i test predittivi, calcolare i parametri soltanto su dati antecedenti all'estrazione valutata.

## Registro delle versioni
- v01: filtro sul ritardo massimo [8,81].
- v02: esclusione delle sestine già estratte.
- v03: studio degli intervalli per posizione con copertura marginale almeno 95%; filtro non ancora attivato.


## Versione 04 — Attivazione F03–F08 (sei filtri distinti)

I sei intervalli dell’analisi v03 diventano filtri attivi separati. Ogni sestina è ordinata in senso crescente. La verifica è *walk-forward* sui 4.226 concorsi utilizzabili: ritardi e sestine precedentemente estratte sono noti prima della nuova estrazione. **Attenzione:** gli estremi dei nuovi filtri sono stati scelti sull’intero archivio (incluso il periodo testato): questa è una verifica retrospettiva descrittiva, **non** una stima predittiva fuori campione. Per una valutazione senza leakage, fissare gli estremi su un training set precedente oppure ricalcolarli con solo dati passati.

| Filtro | Posizione | Min | Max |
|---|---:|---:|---:|
| F03 | 1 | 1 | 36 |
| F04 | 2 | 3 | 54 |
| F05 | 3 | 10 | 68 |
| F06 | 4 | 25 | 81 |
| F07 | 5 | 38 | 87 |
| F08 | 6 | 57 | 90 |

### Test separati (ciascun filtro con F01 + F02)

| Filtri attivi | Residue medie | Riduzione totale | Vincitrici conservate | Copertura |
|---|---:|---:|---:|---:|
| F01+F02 | 607,398,656 | 2.4439% | 4119 | 97.4681% |
| F01+F02+F03 | 582,137,384 | 6.5012% | 3915 | 92.6408% |
| F01+F02+F04 | 583,351,618 | 6.3061% | 3926 | 92.9011% |
| F01+F02+F05 | 581,945,469 | 6.5320% | 3935 | 93.1141% |
| F01+F02+F06 | 574,907,722 | 7.6623% | 3912 | 92.5698% |
| F01+F02+F07 | 576,005,740 | 7.4860% | 3922 | 92.8064% |
| F01+F02+F08 | 575,722,225 | 7.5315% | 3915 | 92.6408% |

### Tutti i filtri F01–F08 contemporaneamente

- Combinazioni iniziali: **622,614,630**.
- Combinazioni residue medie: **489,670,704**; riduzione **21.3525%**.
- Vincitrici conservate: **3288/4226 = 77.8041%**; eliminate: **938**.
- Quota media conservata: **78.6475%**; la copertura osservata è inferiore a quella di una selezione casuale di uguale dimensione.

### Regole di calcolo e riproducibilità

- Le sestine sono le colonne `n1`–`n6` in ordine crescente; universo `C(90,6)`.
- Alla data di ogni estrazione, il ritardo del numero `x` è il numero di concorsi trascorsi dall’ultima comparsa, calcolato esclusivamente su concorsi precedenti.
- F01: almeno un numero con ritardo ≥8 e tutti con ritardo ≤81; F02: nessuna sestina già apparsa prima.
- Per ogni filtro F03–F08, il numero in posizione `j` deve stare nell’intervallo corrispondente; la combinazione rispetta l’ordinamento crescente.
- Conteggio combinatorio: programmazione dinamica su numeri 1..90 e posizioni 1..6, con stato booleano «almeno un ritardo ≥8», escludendo numeri con ritardo >81; sottrazione delle sestine precedenti che supererebbero gli altri filtri.
- Per i test separati, F03–F08 sono valutati ciascuno con F01 e F02. Il test congiunto impone tutti i sei intervalli.
- Risultati per ogni concorso: `superenalotto_filtri_posizione_dettaglio_v04.csv`; `count_0`/`hit_0` sono congiunti, `count_1`–`count_6`/`hit_1`–`hit_6` sono i sei filtri separati.

### Registro aggiornamenti

- **v04:** attivazione dei sei filtri per posizione, test individuali e test congiunto; esplicitato il rischio di selezione retrospettiva degli estremi.
