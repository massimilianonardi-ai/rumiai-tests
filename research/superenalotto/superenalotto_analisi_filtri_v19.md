# SuperEnalotto — Registro cumulativo di filtri e reverse engineering (v19)

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

---

## Versione 05 — Studio dei sei ritardi ordinati (intervalli marginali al 95%)

**Stato: analisi esplorativa; nessun nuovo filtro attivato.** Restano attivi F01–F08, senza modifiche.

### Significato delle colonne e dati utilizzati

- Sono state esaminate le colonne `ritardo_1`–`ritardo_6` del CSV, non le colonne `n1`–`n6`.
- Le sei colonne di ritardo risultano **già ordinate in senso crescente in tutte le righe complete**: il primo ritardo è il più piccolo, il sesto il più grande. Non si deve assumere che `ritardo_j` sia associato a `n{j}`: sono due ordinamenti distinti.
- Archivio: **4.294 estrazioni**, di cui **4.258 con tutti e sei i ritardi presenti** e **36 con uno o più ritardi mancanti**, escluse soltanto da questo studio.
- Intervallo di date delle osservazioni complete: **1998-01-21 – 2026-10-31**.

### Metodo

Per ciascuna delle sei posizioni: ordinare i 4,258 ritardi validi e cercare l’intervallo inclusivo `[a,b]` di **ampiezza minima** che contenga almeno `ceil(0,95 × 4258) = 4046` osservazioni. In caso di pari ampiezza, scegliere l’intervallo con limite inferiore più piccolo. Tutte le occorrenze dei valori ai bordi vengono contate, quindi la copertura effettiva può superare il 95%.

### Intervalli risultanti

| Posizione del ritardo ordinato | Minimo incluso | Massimo incluso | Valori interi nell’intervallo | Osservazioni coperte | Copertura |
|---|---:|---:|---:|---:|---:|
| 1ª | 1 | 7 | 7 | 4050/4258 | 95.1151% |
| 2ª | 1 | 13 | 13 | 4078/4258 | 95.7727% |
| 3ª | 2 | 19 | 18 | 4058/4258 | 95.3030% |
| 4ª | 4 | 28 | 25 | 4058/4258 | 95.3030% |
| 5ª | 5 | 40 | 36 | 4050/4258 | 95.1151% |
| 6ª | 7 | 69 | 63 | 4051/4258 | 95.1386% |

### Copertura simultanea delle sei condizioni

- Righe complete che rispettano **tutti** gli intervalli: **3,477/4,258 = 81.6581%**.
- Righe complete che violano almeno un intervallo: **781/4,258 = 18.3419%**.
- Sulle **4.226** estrazioni utilizzabili per il precedente test storico F01–F08 (dal 1998-07-29), la copertura congiunta dei soli nuovi intervalli, fissati sull’intero archivio, è **3.447/4.226 = 81,57%**. Questa cifra serve soltanto per confronto di numerosità, **non** è una prova di capacità predittiva.

### Interpretazione e precauzioni

- Il 95% è una copertura **marginale per posizione**, non una garanzia del 95% di copertura simultanea.
- Gli intervalli sono stati determinati usando anche le estrazioni che verrebbero valutate: la copertura misurata è **in-sample**. Per un test predittivo valido, calcolare le fasce su dati anteriori a ogni concorso (walk-forward), oppure fissarle su un periodo di addestramento e verificarle soltanto su estrazioni successive.
- Questi intervalli non sono stati applicati alle 622.614.630 combinazioni possibili e non sono stati combinati con F01–F08. Non è quindi disponibile una stima della riduzione dell’universo delle sestine o della copertura dei filtri cumulati.
- Il limite massimo del sesto ritardo (69) sarebbe più restrittivo di F01 (massimo 81) se venisse adottato come filtro, ma per ora non viene attivato.

### Riproduzione

1. Leggere `estrazioni_con_ritardi.csv` con separatore `;` e codifica `utf-8-sig`.
2. Selezionare le sole righe con tutte le colonne `ritardo_1`–`ritardo_6` valorizzate.
3. Verificare per ogni riga `ritardo_1 <= ... <= ritardo_6`.
4. Per ogni colonna ordinare i valori; per tutte le finestre consecutive di 4.046 osservazioni scegliere quella con `max - min` minimo (a parità scegliere `min` più piccolo).
5. Ricontare tutte le righe con `min <= ritardo_j <= max` per la copertura marginale, e quelle che soddisfano tutti e sei i vincoli per la copertura congiunta.

### Registro aggiornamenti

- **v05:** analisi dei ritardi ordinati e ricerca delle fasce minime al 95%; nessuna modifica ai filtri F01–F08.


---

## Versione 06 — Attivazione dei sei filtri sui ritardi ordinati (F09–F14)

**Stato: attivi F01–F14, tutti contemporaneamente.** I sei filtri dei ritardi sono valutati *separatamente* (ciascuno aggiunto a F01–F08) e *cumulativamente* nell’ordine F09 → F14. Non vengono disattivati i filtri precedenti.

### Definizioni e significato

Per una sestina candidata `c=(n1<...<n6)` e per una data estrazione `t`, calcolare il ritardo pre-estrazione `d_t(n)=t−ultima_estrazione_precedente(n)` di ciascun numero. Ordinare i **sei ritardi** crescentemente in `r1<=r2<=...<=r6`. I ritardi ordinati **non** sono associati alle sei posizioni dei numeri ordinati.

| Filtro | Ritardo ordinato | Intervallo inclusivo |
|---|---|---|
| F09 | r1 | 1–7 |
| F10 | r2 | 1–13 |
| F11 | r3 | 2–19 |
| F12 | r4 | 4–28 |
| F13 | r5 | 5–40 |
| F14 | r6 | 7–69 |

Questi estremi sono stati ricavati nell'analisi v05 sull'intero archivio, comprese estrazioni posteriori a molte date di test. Sono parametri **fissi** per questa simulazione retrospettiva, non una stima senza leakage. F14 restringe il massimo ritardo a 69, rendendo ridondante il limite superiore 81 di F01; F01 continua a richiedere un massimo almeno pari a 8.

### Verifica e campione

- Universo di riferimento: `C(90,6) = 622.614.630` sestine, uguale per ogni estrazione.
- Archivio: 4.294 estrazioni, ordinate cronologicamente.
- Simulazione: 4.226 estrazioni dal 29/07/1998 al 31/10/2026, quando tutti i 90 numeri avevano già una precedente uscita.
- Per ogni concorso, i ritardi e l'elenco delle sestine già uscite sono calcolati **esclusivamente con le estrazioni precedenti**; le fasce e i range per posizione, invece, sono quelli fissi stimati sull'intero archivio.
- I conteggi di riferimento F01–F08 sono stati ricalcolati e risultano **identici per tutte le 4.226 date** ai valori `count_0` e `hit_0` del dettaglio v04.

### Risultati: ogni filtro aggiunto singolarmente a F01–F08

| Configurazione | Residue medie | Riduzione totale | Vincitrici conservate | Copertura |
|---|---:|---:|---:|---:|
| F01–F08 | 489.670.704 | 21,3525% | 3.288/4.226 | 77,8041% |
| F01–F08 + F09 | 465.487.694 | 25,2366% | 3.123/4.226 | 73,8997% |
| F01–F08 + F10 | 470.300.927 | 24,4636% | 3.150/4.226 | 74,5386% |
| F01–F08 + F11 | 466.780.507 | 25,0290% | 3.125/4.226 | 73,9470% |
| F01–F08 + F12 | 465.889.513 | 25,1721% | 3.135/4.226 | 74,1836% |
| F01–F08 + F13 | 466.720.008 | 25,0387% | 3.140/4.226 | 74,3019% |
| F01–F08 + F14 | 475.923.724 | 23,5605% | 3.207/4.226 | 75,8874% |

### Risultati: aggiunta progressiva dei sei filtri

| Configurazione cumulativa | Residue medie | Riduzione totale | Vincitrici conservate | Copertura |
|---|---:|---:|---:|---:|
| F01–F08 | 489.670.704 | 21,3525% | 3.288/4.226 | 77,8041% |
| F01–F09 | 465.487.694 | 25,2366% | 3.123/4.226 | 73,8997% |
| F01–F10 | 454.017.018 | 27,0790% | 3.035/4.226 | 71,8173% |
| F01–F11 | 441.521.054 | 29,0860% | 2.944/4.226 | 69,6640% |
| F01–F12 | 428.125.985 | 31,2374% | 2.862/4.226 | 67,7236% |
| F01–F13 | 416.327.229 | 33,1324% | 2.784/4.226 | 65,8779% |
| F01–F14 | 407.827.083 | 34,4977% | 2.739/4.226 | 64,8131% |

### Bilancio dei 14 filtri attivi

- Combinazioni residue medie: **407.827.083** su **622.614.630**, cioè **65,5023%** conservate e **34,4977%** eliminate.
- Rispetto a F01–F08: **81.843.622** combinazioni eliminate in più, in media per estrazione.
- Sestine vincenti che superano tutti i filtri: **2.739/4.226 = 64,8131%**. Sestine vincenti escluse: **1.487**.
- Rispetto a F01–F08: **549** ulteriori sestine vincenti storiche escluse.
- Se si conservasse casualmente, a ogni estrazione, lo stesso numero di combinazioni, la copertura media attesa sarebbe **65,5023%** (circa **2768.1** vincitrici su 4.226), contro **64,8131%** osservata. Lo scarto osservato è **-0,6893 punti percentuali**. Questa è una descrizione comparativa, non un test predittivo fuori campione.
- Ultima estrazione disponibile (31/10/2026): **402.863.980** combinazioni residue con F01–F14. Questo è il numero di candidate calcolate *prima* dell'estrazione del 31/10, **non** un conteggio per la prossima estrazione.

### Algoritmo esatto di conteggio

Per evitare di enumerare materialmente tutte le 622 milioni di sestine a ogni data:

1. Per ogni numero `n=1..90` costruire il suo ritardo pre-estrazione e classificarlo in fasce determinate dalle soglie dei sei filtri: `1`, `2–3`, `4`, `5–6`, `7`, `8–13`, `14–19`, `20–28`, `29–40`, `41–69`, `70–81` (oltre 81 esclusi da F01).
2. Percorrere i numeri in ordine crescente. Una programmazione dinamica conta le sottosequenze di sei numeri che rispettano gli intervalli F03–F08, memorizzando il multinsieme ordinato delle fasce dei ritardi selezionati.
3. Tenere soltanto gli stati con massimo ritardo compreso fra 8 e 81 (F01).
4. Classificare ogni stato finale secondo una maschera a sei bit che indica quali filtri F09–F14 supera; aggregare le frequenze per i test singoli e cumulativi.
5. Per F02 sottrarre, dalla rispettiva classe, ogni sestina già estratta in precedenza che supererebbe tutti gli altri filtri.
6. Per la sestina realmente uscita, valutare i medesimi criteri con i ritardi pre-estrazione, ottenendo gli indicatori di copertura.
7. Ripetere sulle 4.226 date e calcolare la media delle combinazioni residue e la frazione delle sestine vincenti conservate.

Il file `superenalotto_filtri_ritardi_dettaglio_v06.csv` contiene, per ogni estrazione, `baseline_count`, `baseline_hit` e, per ciascun F09–F14, `individual_Fxx_count`, `individual_Fxx_hit`, `cumulative_Fxx_count`, `cumulative_Fxx_hit`. Il codice di calcolo è in `compute_v06.py`. Il CSV sorgente è `estrazioni_con_ritardi.csv`, SHA-256 `b7e3e27741cb62c0896a7ff23734b117d2d1f3e580acdc5322241b8005bbd8b4`.

### Limiti metodologici

- **Informazioni future nella scelta delle soglie:** le fasce F03–F14 sono state stimate usando anche le estrazioni su cui si verifica la copertura; i test sono quindi descrittivi e ottimisticamente selezionati, non validazioni predittive.
- **Probabilità delle sestine:** in un'estrazione equa ogni sestina resta equiprobabile, indipendentemente da ritardi, posizione ordinata o precedenti apparizioni. I filtri non modificano la probabilità intrinseca di ciascuna combinazione.
- **Passo successivo raccomandato:** fissare le soglie su un periodo di addestramento precedente e valutarle senza modificarle su un periodo successivo, oppure ricalcolarle progressivamente usando soltanto la storia disponibile.

### Registro aggiornamenti

- **v06:** attivati F09–F14, verificati individualmente e cumulativamente; conteggi esatti delle combinazioni residue e confronto con la copertura storica; aggiunti dettaglio CSV e script riproducibile.


---

## Versione 07 — Ricerca di strutture caotiche, pseudocasuali e prevedibilità nelle 12 colonne

**Stato:** studio esplorativo; restano attivi **F01–F14**, senza aggiunte o variazioni. Nessuna nuova combinazione di filtri è stata testata. Il confronto corretto con la scelta casuale rimane quello di v06. L'obiettivo di v07 è verificare se la successione delle estrazioni contiene informazione predittiva aggiuntiva e se le correlazioni osservate eccedono quanto previsto dal sorteggio equo.

### Sorgente, semantica e validazione

- CSV sorgente: `estrazioni_con_ritardi.csv` SHA-256 `b7e3e27741cb62c0896a7ff23734b117d2d1f3e580acdc5322241b8005bbd8b4`. 4.294 estrazioni dal 03/12/1997 al 31/10/2026, ordinate per data e concorso; nessuna sestina duplicata nel campione.
- `n1`–`n6`: sei numeri della sestina in ordine crescente. `ritardo_1`–`ritardo_6`: ritardi **in ordine crescente**, non appaiati uno a uno ai `n1`–`n6`.
- Ogni ritardo del numero estratto è `indice_estrazione - indice_ultima_uscita_precedente` (numero di concorsi, non di giorni). Le sei età vengono ordinate. I valori ricostruiti **coincidono esattamente** con quelli del file nelle 4.226 estrazioni a storia completa dei 90 numeri.
- Per confronti omogenei sulle dodici serie si usano le ultime **4.144 estrazioni** dal **12/05/1999 al 31/10/2026**, scartando le prime 150 per l'inizializzazione delle età. Questo taglio vale **solo** per i test delle serie, non modifica i 4.226 casi dei filtri F01–F14.
- Poiché i ritardi sono ricavabili dalle uscite, non sono una fonte indipendente di entropia: eventuali regolarità devono essere confrontate con ritardi calcolati su estrazioni simulate, non con rumore bianco indipendente.

### Modello teorico di confronto

A ogni concorso si estraggono uniformemente sei numeri *distinti* tra 1 e 90. Per la posizione ordinata `j` la media teorica è:

`E[n_j] = 91 × j / 7` per `j=1,…,6`, cioè **13, 26, 39, 52, 65, 78**. Le posizioni hanno distribuzioni differenti e risultano correlate *anche quando le sestine sono totalmente casuali*. Le colonne dei ritardi sono a loro volta correlate per ordinamento, oltre che per la dinamica deterministica dello storico.

Sono state generate **400 sequenze di controllo** indipendenti, ognuna di 4.294 sestine uniformemente estratte senza ripetizioni interne, dalle quali vengono ricalcolati tutti i ritardi. Seed riproducibile `20261102`. L'appartenenza al null viene valutata confrontando la statistica osservata con quelle simulate. Valori p Monte Carlo calcolati come `(1 + numero simulazioni almeno altrettanto estreme) / 401`. Sulle 24 verifiche *autocorrelazione massima + picco spettrale* è applicata la correzione Benjamini–Hochberg (FDR 5%). Sulle 66 correlazioni tra colonne la correzione BH è applicata a parte.

### Statistiche delle 12 colonne

- **ACF1**: correlazione con il valore del concorso precedente.
- **Max|ACF|**: massimo valore assoluto di autocorrelazione nei lag 1–30; fra parentesi il lag in cui appare. La `p` associata confronta **il massimo fra tutti i 30 lag**, non un lag scelto successivamente.
- **Periodo**: periodo in concorsi del picco di potenza Fourier (trascurate frequenze inferiori a 1/500 concorsi). La `p` è calibrata sul **picco massimo**, non sul periodo osservato; un valore basso da solo non implica un ciclo predittivo.
- **Skill MSE**: `100 × (1 − MSE_modello / MSE_media_training)` nel periodo finale 06/08/2019–31/10/2026. Positivo significa migliore della media storica, negativo peggiore. Modello regressivo non lineare basato sulle **tre estrazioni precedenti delle dodici colonne**.

| Colonna | Media reale | Media teorica numeri | ACF1 | Max\|ACF\| (lag) | p ACF | Periodo Fourier | p spettro | Skill MSE fuori campione |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `n1` | 13.36 | 13.0 | +0.022 | 0.043 (20) | 0.117 | 4.1 | 0.913 | -0.14% |
| `n2` | 26.40 | 26.0 | +0.008 | 0.031 (11) | 0.711 | 2.6 | 0.840 | -0.78% |
| `n3` | 39.61 | 39.0 | -0.006 | 0.029 (16) | 0.870 | 19.2 | 0.052 | -0.37% |
| `n4` | 52.69 | 52.0 | -0.016 | 0.031 (16) | 0.743 | 19.2 | 0.484 | -0.86% |
| `n5` | 65.65 | 65.0 | -0.009 | 0.034 (26) | 0.576 | 5.6 | 0.312 | -1.11% |
| `n6` | 78.54 | 78.0 | -0.005 | 0.041 (17) | 0.237 | 96.4 | 0.289 | -0.85% |
| `ritardo_1` | 2.91 | — | -0.015 | 0.036 (21) | 0.594 | 4.2 | 0.778 | -0.56% |
| `ritardo_2` | 5.80 | — | -0.017 | 0.041 (2) | 0.713 | 4.1 | 0.875 | -0.46% |
| `ritardo_3` | 9.45 | — | -0.038 | 0.047 (2) | 0.569 | 2.3 | 0.576 | -1.19% |
| `ritardo_4` | 14.24 | — | -0.027 | 0.064 (2) | 0.057 | 2.8 | 0.466 | -1.01% |
| `ritardo_5` | 21.60 | — | -0.011 | 0.051 (2) | 0.292 | 10.0 | 0.524 | +0.01% |
| `ritardo_6` | 36.02 | — | +0.003 | 0.039 (8) | 0.579 | 5.8 | 0.409 | -0.51% |

**Risultati principali:** **0/12** serie con anomalie di autocorrelazione dopo correzione; **0/12** serie con periodicità statisticamente anomale dopo correzione. Il candidato Fourier più evidente è `n3` con periodo circa 19,2 concorsi e `p ≈ 0,052` **prima della correzione**: non supera la soglia e non è una periodicità accertata (q ≈ 0,688).

### Correlazioni tra colonne: dipendenze apparenti e reali

Sono valutate tutte le **66 coppie** di colonne. Nessuna eccede in modo significativo la distribuzione delle estrazioni simulate dopo correzione BH: **0/66**. Alcuni esempi:

| Coppia | Correlazione osservata | Media delle simulazioni | Interpretazione |
|---|---:|---:|---|
| `n3`–`n4` | +0.756 | +0.750 | Prodotta dall’ordinamento |
| `n4`–`n5` | +0.734 | +0.730 | Prodotta dall’ordinamento |
| `ritardo_3`–`ritardo_4` | +0.717 | +0.730 | Prodotta dall’ordinamento |
| `ritardo_5`–`ritardo_6` | +0.575 | +0.569 | Prodotta dall’ordinamento |
| `n2`–`ritardo_5` | -0.028 | -0.001 | Piccola dipendenza non significativa |


Le correlazioni forti fra posizioni vicine sono normalmente **vincoli combinatori**, non equazioni che generano i numeri successivi. La matrice completa con valori p e q è nel file `superenalotto_correlazioni_v07.csv`.

### Sequenze pseudocasuali: uniformità e ripetizioni parziali

- Numero medio di occorrenze per numero fra 1 e 90: **286.27**, intervallo delle frequenze osservate **244–333**. Statistica globale chi-quadro modificata/calibrata mediante 300 simulazioni uniformi: **92.78**, `p ≈ 0.249`. Non emerge uno scostamento globale statisticamente netto dalle frequenze attese.
- Fra due estrazioni consecutive la media dei numeri ripetuti è **0.3911**, contro **0,4000** attesi da due sestine casuali indipendenti (`p` simulato ≈ **0.304**). Distribuzione degli overlap `0,1,2,3,4,5,6`: **2845, 1231, 203, 14, 0, 0, 0**.
- L'assenza di anomalie in questi test **non prova** che un sistema sia fisicamente casuale, né permette di identificare con certezza un algoritmo pseudorandom: numerose famiglie di PRNG superano normali test statistici.

### Anomalia esplorativa: numeri storicamente un po' più alti

La somma teorica media di una sestina casuale è `6 × 45,5 = 273`. Nell'intero archivio la somma media osservata è **276.443** (`p ≈ 0.00026` per un test mirato alla media, *senza* correggere la molteplicità delle analisi esplorative). Questo è un **segnale descrittivo da indagare**, non una regola di predizione. Inoltre:

| Periodo | Estrazioni | Somma media | p vs atteso 273 |
|---|---:|---:|---:|
| Archivio fino al 03/08/2019 (training) | 3,005 | 277.599 | 0.00005 |
| 06/08/2019–31/10/2026 (holdout) | 1,289 | 273.749 | 0.664 |

La tendenza lineare esplorativa della somma è di **-1.996 punti ogni 1.000 concorsi** (`p ≈ 0.009` *non corretto* per ricerca multipla). Ma nel periodo di test più recente la somma media è molto vicina al valore teorico: la deviazione vista complessivamente **non si conferma come vantaggio stabile per prevedere i prossimi concorsi**. Sarebbe necessario un ulteriore campione futuro, predefinendo in anticipo l'ipotesi di studio, per valutare un eventuale cambiamento sistematico.

Grafico: `superenalotto_somma_annuale_v07.png` (medie annuali; anni con numerosità differenti).

### Test predittivo fuori campione sulle dodici serie

Taglio cronologico **fisso**: dati precedenti al 06/08/2019 per il training (2.855 concorsi dopo la finestra iniziale); **1.289 concorsi finali** per test, non usati nell'addestramento. Modello: `HistGradientBoostingRegressor` con 36 caratteristiche (3 ritardi temporali delle 12 serie), profondità 3, 70 iterazioni, regolarizzazione. Si predice una posizione per volta. Riferimento: la semplice **media della stessa colonna nel training**.

- Miglioramento dell'errore quadratico medio (MSE) in appena **1/12** colonne, e in quel caso pressoché nullo; **11/12** peggiorano rispetto alla media storica.
- Miglioramento dell'errore assoluto medio (MAE) in **4/12**, sempre modesto. Le prime sei colonne (`n1`–`n6`) **peggiorano tutte** in MAE e MSE.
- Dettaglio riproducibile di MAE e MSE in `superenalotto_previsione_colonne_v07.csv`.

### Test predittivo direttamente sui numeri della prossima estrazione

Un secondo modello logistico usa, **per ciascuno dei 90 numeri prima del prossimo concorso**, le sole caratteristiche storiche disponibili: ritardo pre-estrazione, log-ritardo, numero di uscite negli ultimi 30 e 100 concorsi, presenza nell'ultima estrazione e valore numerico. È allenato solo sulle estrazioni antecedenti al 06/08/2019, poi valutato sui **1.289 concorsi successivi** senza riaddestramento.

| Metrica fuori campione | Probabilità equa (6/90 per numero) | Modello storico |
|---|---:|---:|
| Log-loss binaria media | 0.24493003 | 0.24495167 |
| Brier score medio (più basso = migliore) | 0.06222222 | 0.06222494 |
| Numeri vincenti fra i 6 candidati prioritari / estrazione | 0.4000 (atteso) | 0.4011 (osservato) |

Differenza osservata sulla top-6: **+0.0011 numeri per concorso**, contro un errore standard empirico di circa **0.0168**. Il log-loss e il Brier score sono entrambi leggermente **peggiori** rispetto alla probabilità uniforme. Non è stato rilevato un miglioramento della probabilità di indovinare numeri rispetto al caso.

Il modello sul singolo numero e i modelli sulle colonne testano ipotesi diverse; nessuno dei due equivale a ricostruire esattamente una sestina su 622.614.630 possibilità. Dall'archivio da solo non è possibile dimostrare né escludere in assoluto la presenza di un algoritmo deterministico, né determinare un esponente di Lyapunov fisicamente sensato: ordinamento, discrezione, numero limitato di osservazioni e memoria costruita dai ritardi possono produrre falsi indizi di caos.

### Conclusioni operative

1. **Non aggiungere filtri F15+ basati su cicli, ACF, correlazioni o modelli predittivi**: nei test qui effettuati non emerge un miglioramento verificato fuori campione.
2. L'ipotesi sui numeri mediamente più alti nel periodo storico è da trattare come **ipotesi esplorativa**, non come nuovo filtro: il segnale non si conferma nel holdout recente.
3. Se si vogliono sperimentare famiglie specifiche di mappe caotiche, congruenze modulari, sequenze a stati finiti o trasformazioni dei ritardi, occorre **preregistrare** formule, parametri e criteri su un training e verificarli senza modificarli su concorsi non usati, meglio ancora futuri.
4. I filtri F01–F14 rimangono descrittivi: gli intervalli sono stati selezionati usando l'intero archivio e il precedente test di copertura non è una validazione fuori campione delle soglie.

### File e riproducibilità v07

- `compute_v07.py`: ricostruzione ritardi, 400 simulazioni null, autocorrelazioni, periodogrammi, correlazioni, test non lineare delle colonne, test logistico sui numeri e statistiche globali.
- `superenalotto_diagnostica_colonne_v07.csv`: tabella di autocorrelazioni, periodogrammi, p e q per tutte le dodici serie.
- `superenalotto_correlazioni_v07.csv`: 66 correlazioni osservate e simulate, p e q.
- `superenalotto_previsione_colonne_v07.csv`: 12 risultati del test non lineare fuori campione.
- `superenalotto_metriche_v07.json`: tutte le metriche aggregate e parametri dello split.
- `superenalotto_somma_annuale_v07.png`: grafico esplorativo sulle medie annuali della somma dei sei numeri.

**Registro:** v07 = analisi di struttura temporale e prevedibilità delle 12 colonne, confronto Monte Carlo con il sorteggio equo, valutazioni cronologiche fuori campione, **nessun cambiamento ai 14 filtri attivi**.


---

## Versione 08 — Nuovo obiettivo: reverse engineering del sistema estrazionale (2 novembre 2026)

### Decisione metodologica
L'obiettivo si estende dalla selezione di combinazioni attraverso filtri alla **identificazione del sistema generatore**. Si cercano modelli e segnali con capacità predittiva verificabile, anche in assenza di correlazione lineare o periodicità: analisi di sistemi dinamici, modelli di stato nascosto, reservoir computing, reti neurali temporali, modelli fisico-statistici e, solo dove il processo reale lo giustifichi, generatori pseudocasuali software.

### Verifica della premessa tecnica: SuperEnalotto
Secondo Sisal, dal **1 luglio 2009** il SuperEnalotto ha un sistema estrazionale autonomo, che funziona tramite due macchine a mescolamento pneumatico, una per sestina/Jolly e una per SuperStar. La documentazione di regolamento SuperEnalotto del 2021 descrive urne elettromeccaniche e sfere fisiche con identificazione elettronica. **Non abbiamo evidenza che le sestine SuperEnalotto vengano prodotte da un algoritmo PRNG software.**

Il Decreto MEF 3 dicembre 2025, n. 214, art. 11 (in vigore dal 27 gennaio 2026), ammette in generale due tipi di sistemi per i giochi numerici: urne elettroniche con sfere, oppure RNG; questo non significa che lo specifico SuperEnalotto usi un RNG software. La distinzione emerge anche dall'art. 33 del regolamento.

Fonti:
- Sisal, "SuperEnalotto – tutte le informazioni sull'estrazione": https://www.sisal.com/offerta/giochi/lotterie/superenalotto/estrazione
- Regolamentazione SuperEnalotto 2021 (sezione sistema estrazionale): https://www.superenalotto.it/content/dam/gntn/superenalotto/documenti/REGOLAMENTO_SE_2021.pdf
- MEF, decreto 214/2025, art. 11: https://def.giustiziatributaria.gov.it/DocTribFrontend/executePrintArticolo.do?articolo=Articolo+11&codiceOrdinamento=0000000000000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000&id=%7B0C9D9598-8EF4-49D5-82E9-7F72EA91F8C4%7D

### Conseguenze per la ricerca
1. **Segmentazione per regime:** trattare separatamente le estrazioni precedenti al 1 luglio 2009 (sistema collegato al Lotto) e successive (macchine autonome); evitare di interpretare l'intero arco storico come un solo generatore stazionario. Considerare ulteriori eventuali cambiamenti di macchina, set sfere e procedura soltanto quando documentati.
2. **Informazione perduta:** le colonne n1–n6 sono ordinate per valore, non per successione fisica di estrazione; i ritardi ordinati sono statistiche derivate. Ricercare, se pubblici, i sei numeri nell'**ordine fisico di uscita**, oltre a dati su macchina utilizzata, eventuale set sfere, tempi, condizioni e interventi.
3. **Modelli concorrenti:** riferimento uniforme senza memoria; modelli temporali lineari; frequenze e ritardi; modelli di Markov e stati latenti; modelli caotici e ricostruzione dello spazio degli stati; Echo State Networks/reservoir; reti ricorrenti/Transformer; modelli con cambi di regime e variabili strumentali.
4. **Identificabilità:** esistenza di leggi fisiche deterministiche non implica prevedibilità della sestina da sole uscite storiche. Per sistemi caotici sono essenziali misure dello stato iniziale; un PRNG crittograficamente robusto con seed segreto può essere computazionalmente non prevedibile dai soli output.
5. **Validazione:** cronologia rigorosa (training, validazione e test fuori campione), nessun leakage nella selezione di iperparametri o soglie, ablation e baselines casuali; misurare probabilità calibrate dei 90 numeri e sestine con vincolo di non ripetizione interna; confrontare log-loss/Brier, media dei numeri indovinati e rapporto copertura/quote di sestine trattenute, con intervalli di confidenza e correzione per tentativi multipli.
6. **Prova falsificabile:** un segnale è utilizzabile soltanto se riproducibile su estrazioni non usate per costruire né scegliere il modello. La complessità della rete non costituisce di per sé evidenza che il generatore sia stato ricostruito.

### Stato dei filtri e degli esperimenti
Rimangono attivi F01–F14, senza variazioni di parametri o di risultati attribuibili a questa versione. I risultati descrittivi e i test precedenti sono conservati nella sezione v07. **Questa versione non aggiunge un filtro né dichiara capacità predittiva nuova.**

### Registro delle modifiche
- **v08:** verifica del meccanismo estrazionale e nuova linea di ricerca di reverse engineering, con prerequisiti sui dati e protocollo di validazione.


---

## Versione 09 — Ordine fisico di estrazione, controllo dei dati e separazione dei regimi (2 novembre 2026)

**Stato:** attività di acquisizione dati e studio esplorativo; **F01–F14 non modificati**. La validazione predittiva effettuata fino alla v07 non cambia. Nessun nuovo modello o filtro è stato promosso.

### Scopo
Verificare l'accessibilità dei sei numeri nell'ordine di **uscita delle sfere**, anziché nel solo ordine crescente, e definire una base dati capace di distinguere e confrontare i due regimi estrazionali. L'ordine delle sfere non modifica il risultato della giocata, ma può contenere informazioni sulla dinamica fisica che la sestina ordinata distrugge.

### Fonti e affidabilità

1. **Sisal, funzionamento delle estrazioni:** dal 1° luglio 2009 il SuperEnalotto è autonomo rispetto alle ruote Lotto e utilizza macchine pneumatiche (sestina e Jolly su una macchina, SuperStar su un'altra). [Fonte](https://www.sisal.com/offerta/giochi/lotterie/superenalotto/estrazione).
2. **ADM, pagina SuperEnalotto:** pubblica almeno in alcuni risultati la 'combinazione vincente' in ordine non crescente; es. concorso 147/2026: `40,14,3,7,78,81`. [Fonte](https://www.adm.gov.it/portale/monopoli/giochi/giochi_num_total/superenalotto). La pagina può aggiornarsi e non costituisce un archivio statico completo.
3. **SuperenalottoItalia (portale indipendente):** per molti concorsi pubblica separatamente la sestina ordinata e la dicitura `Ordine di estrazione pubblicato da ADM:` con sei numeri in sequenza. Es. [175/2026](https://www.superenalottoitalia.com/estrazione-superenalotto-175-2026/), [147/2026](https://www.superenalottoitalia.com/estrazione-superenalotto-147-2026/), [180/2024](https://www.superenalottoitalia.com/estrazione-superenalotto-180-2024/). L'attribuzione ad ADM è del **sito indipendente** e richiede, se possibile, una controverifica ufficiale per le sequenze utilizzate in analisi definitive.
4. **Archivio ufficiale Sisal dei bollettini:** [bollettini](https://www.superenalotto.it/archivio-estrazioni/bollettini). È stato identificato, ma **non è stata ancora confermata l'estraibilità automatica dell'ordine fisico dai bollettini**.

**Avvertimento sostanziale:** pagine di anni precedenti mostrano la dicitura 'ordine di estrazione' ma riportano numeri già crescenti. In particolare gli esempi [2/2009](https://superenalottoitalia.com/estrazione-superenalotto-2-2009/), [149/2010](https://superenalottoitalia.com/estrazione-superenalotto-149-2010/), [15/2015](https://www.superenalottoitalia.com/estrazione-superenalotto-15-2015/) riportano sequenze crescenti. Una sequenza crescente è teoricamente possibile nell'ordine fisico (probabilità 1/720 condizionata a una sestina equa), ma la ricorrenza in esempi più vecchi suggerisce che la colonna possa essere una **copia della sestina ordinata o un valore sostitutivo**. Non sono stati equiparati questi esempi a un ordine fisico dimostrato. È possibile che esistano differenze di disponibilità a seconda dell'epoca.

### Confronto delle due epoche usando le sestine complete

Si separa la storia alla data amministrativa del **1° luglio 2009**, senza miscelare i due meccanismi:

| Metrica | Prima del 1 luglio 2009 | Dal 1 luglio 2009 |
|---|---:|---:|
| Estrazioni | 1,425 | 2,869 |
| Prima–ultima data | 1997-12-03 – 2009-06-30 | 2009-07-02 – 2026-10-31 |
| Somma media dei sei numeri | 278.795 | 275.275 |

La somma media teorica uniforme per sestina è 273. La differenza di somma media pre–post è 3.520, con test Welch a due code **p=0.0845** e intervallo bootstrap percentile al 95% **[-0.48, 7.63]**. Il test non supera il livello 5%; la differenza in media non è evidenza convincente di comportamento differenti.

Sulle frequenze dei 90 numeri è stato eseguito un test globale 2×90 di omogeneità (chi-quadro 83.79), ricalibrato mediante **1,500 permutazioni delle etichette di epoca a livello di sestina intera**, per preservare le dipendenze intraconcorso. **p Monte Carlo = 0.4850**. Non emerge uno spostamento globale significativo della distribuzione marginale dei numeri tra le epoche. Nessuno di questi risultati garantisce che i processi siano identici, indipendenti o fisicamente caotici.

### Primo campione delle uscite fisiche

È stato creato `superenalotto_ordini_fisici_campione_v09.csv` contenente **20 casi 2024–2026** con ordine fisico candidato, raccolti da pagine individuali e confrontati con le sestine del CSV, più **5 casi storici** etichettati `SOSPETTO_ORDINE_CRESCENTE`. Questo **non è un corpus completo né un campione casuale di tutta l'epoca**; i 20 casi sono un primo campione di validazione dell'acquisizione.

| Concorso | Sestina crescente | Ordine pubblicato |
|---|---|---|
| 147/2026 (12-09) | 3,7,14,40,78,81 | 40,14,3,7,78,81 |
| 175/2026 (31-10) | 4,18,20,33,46,78 | 78,20,18,46,4,33 |
| 180/2024 (12-11) | 13,28,29,32,39,81 | 13,81,29,32,39,28 |

**Verifiche per tutti i 25 record salvati:** anno + numero concorso identificano una riga del CSV, esattamente sei valori interi distinti 1–90, insieme ordinato uguale alla sestina ufficialmente riportata per quella data. I cinque casi sospetti non partecipano al test statistico dell'ordine fisico.

### Test illustrativo sulle 20 sequenze candidate

- Correlazione di Pearson fra colonne **crescente** 1ª–2ª, calcolata sullo stesso campione di sestine: **+0.863**.
- Correlazione delle due prime posizioni **fisiche**: **-0.111**.
- Per ciascuna uscita fisica si calcola il rango 1–6 del numero dentro la sua sestina; si forma una tabella 6×6 di frequenze posizione fisica × rango. In un campione da 20 estrazioni la frequenza attesa per cella è 3.33.
- Si confronta la distanza della tabella dall'uniformità con **20,000 simulazioni di permutazione uniformemente casuale dei ranghi all'interno di ciascuna delle 20 sestine**. Risultato: statistica 18.60, **p Monte Carlo ≈ 0.942**.

Questo test non evidenzia una distorsione delle posizioni fisiche nel piccolo campione. Non ha potenza sufficiente per rigettare dinamiche sottili, determinismo fisico o dipendenze temporali. **La differenza fra correlazioni ordinata/fisica dimostra l'importanza di non confonderle.**

### Strumenti e riproducibilità

- `compute_v09.py`: separazione delle epoche, medie, test Welch, bootstrap, permutazioni delle etichette di epoca, creazione del campione degli ordini riportati, verifica di ogni sestina, test illustrativo dei ranghi, JSON diagnostico. Seed casuale 20261102.
- `superenalotto_metriche_v09.json`: tutte le statistiche principali, numeri, intervalli e metadati del calcolo.
- `superenalotto_ordini_fisici_campione_v09.csv`: sequenze fisiche candidate e sospette con URL e stato. **Non considerare i casi sospetti sequenze fisiche.**
- `collect_superenalotto_order_v09.py`: script progettato per acquisire ulteriori pagine dello storico, quando eseguito in un ambiente con rete e nel rispetto di `robots.txt` e dei limiti del sito. Verifica la corrispondenza delle sestine e segnala le sequenze crescenti come **da verificare**. **Non è stato eseguito per scaricare l'intero archivio**: l'ambiente di calcolo non ha accesso diretto alla rete, e i record attuali sono stati consultati uno per uno tramite ricerca web. Non attribuire a questo script una raccolta storica già compiuta.

### Prossima fase sperimentale vincolata dai dati

1. Estendere la raccolta delle sequenze **fisiche realmente verificate** al periodo autonomo, registrando disponibilità, mancanti e campi di fonte. Confrontare campioni casuali di record con ADM/bollettini e, quando possibile, video. Stabilire da quale anno la fonte indipendente conserva un vero ordine fisico.
2. Calcolare *su sole sequenze fisiche confermate* test di uniformità posizione × numero, transizioni condizionate, lag temporali, ricorrenze e surrogate data; correggere per confronti multipli e cambi di regime documentati.
3. Solo con una serie sufficientemente lunga, studiare modelli di stato latente, ESN/reservoir e dinamiche caotiche; usare training/validazione/test cronologici e confronto con baseline indipendente senza reinserimento. Transformer soltanto se dati e segnali giustificano la complessità.
4. Non trattare i valori di ritardo o le sestine ordinate come osservazioni indipendenti dello stato fisico; raccogliere, se disponibile, metadati su macchina, sfere, cambi di set e tempi operativi.

### Registro aggiornamenti

- **v09:** identificate e confrontate fonti di ordine fisico, costruito campione controllato 20+5, verificato il rischio di record storici con 'ordine' già crescente, segmentati i 4.294 concorsi al 1/7/2009, testate somma media e distribuzione marginale con metodi riproducibili. Filtri F01–F14 invariati.


---

## Versione 10 — Serie retrograda mediante numero più vicino (2 novembre 2026)

### Richiesta e interpretazione della trasformazione

Partendo dalla **sestina ordinata dell'ultima estrazione** (31/10/2026: `4 18 20 33 46 78`), per ciascuna delle sei posizioni si sceglie il numero **più vicino per valore assoluto** fra i sei della vera estrazione immediatamente precedente. La selezione avviene **indipendentemente per ciascuna colonna**: uno stesso numero storico può essere scelto più volte e alcuni numeri di quella sestina non essere scelti. **La riga generata diventa l'input del passaggio successivo**.

Questa serie è una trasformazione dei dati, non un elenco delle sestine realmente estratte dopo il passo zero. Il risultato conferma esattamente la seconda riga richiesta: `19 19 19 24 49 85`, dalla sestina precedente `19 24 49 62 64 85`.

Formalmente, ponendo `S_0` uguale all'ultima sestina e `E_k` uguale all'estrazione storica del passo `k` (con `E_0 = S_0`), si calcola per `k >= 1`:

```text
S_k[j] = argmin_(x in E_k) (abs(x - S_(k-1)[j]), x), per j = 1,...,6
```

Il criterio `argmin` ordina prima per **distanza assoluta** e, in caso di parità, per **numero più piccolo**. La regola di spareggio è una scelta esplicita e riproducibile, non specificata nell'esempio originale. Le sei colonne mantengono la posizione di partenza (non vengono riordinate di nuovo).

### Prime 18 righe

| Passo | Data | s1 | s2 | s3 | s4 | s5 | s6 | Distinti |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 2026-10-31 | 4 | 18 | 20 | 33 | 46 | 78 | 6 |
| 1 | 2026-10-30 | 19 | 19 | 19 | 24 | 49 | 85 | 4 |
| 2 | 2026-10-29 | 20 | 20 | 20 | 20 | 41 | 85 | 3 |
| 3 | 2026-10-27 | 23 | 23 | 23 | 23 | 44 | 70 | 3 |
| 4 | 2026-10-24 | 17 | 17 | 17 | 17 | 50 | 73 | 3 |
| 5 | 2026-10-23 | 29 | 29 | 29 | 29 | 41 | 66 | 3 |
| 6 | 2026-10-22 | 18 | 18 | 18 | 18 | 62 | 62 | 2 |
| 7 | 2026-10-20 | 13 | 13 | 13 | 13 | 72 | 72 | 2 |
| 8 | 2026-10-17 | 23 | 23 | 23 | 23 | 77 | 77 | 2 |
| 9 | 2026-10-16 | 35 | 35 | 35 | 35 | 76 | 76 | 2 |
| 10 | 2026-10-15 | 24 | 24 | 24 | 24 | 77 | 77 | 2 |
| 11 | 2026-10-13 | 21 | 21 | 21 | 21 | 78 | 78 | 2 |
| 12 | 2026-10-10 | 26 | 26 | 26 | 26 | 79 | 79 | 2 |
| 13 | 2026-10-09 | 18 | 18 | 18 | 18 | 76 | 76 | 2 |
| 14 | 2026-10-08 | 29 | 29 | 29 | 29 | 72 | 72 | 2 |
| 15 | 2026-10-06 | 32 | 32 | 32 | 32 | 70 | 70 | 2 |
| 16 | 2026-10-03 | 28 | 28 | 28 | 28 | 42 | 42 | 2 |
| 17 | 2026-10-02 | 31 | 31 | 31 | 31 | 31 | 31 | 1 |

### Risultati sull'intera serie

- Estrazioni del CSV attraversate: **4.294** (passi 0–4.293, dal 31/10/2026 al 03/12/1997).
- Da **6** valori distinti alla partenza a **4** già al passo 1.
- Da **4** a **3** al passo 2, a **2** al passo 6 e a **1** al passo **17** (02/10/2026), con sestina trasformata `31 31 31 31 31 31`.
- Una volta raggiunto un solo valore distinto, tutte le sei colonne restano uguali sino alla fine dell'archivio; il valore comune può comunque cambiare di estrazione in estrazione.
- Nella serie completa si osservano **4.277 righe con un solo valore distinto** (incluso il passo 17), 11 con due, 4 con tre, 1 con quattro e 1 con sei.
- Il numero di valori distinti non può aumentare: due colonne già coincidenti hanno sempre lo stesso input e, con spareggio deterministico, ricevono sempre lo stesso output. La convergenza è quindi una proprietà strutturale della trasformazione, **non prova di una legge nascosta del generatore**.
- Nei primi 17 passaggi esistono parità di distanza ai passi 10, 13 e 15; i risultati dipendono dalla convenzione di spareggio in tali punti.

### File prodotti

- `superenalotto_serie_vicinanza_v10.csv`: tutte le righe; per ciascuna data, concorso, sei valori generati, numero di valori distinti e **sestina reale** usata come sorgente della trasformazione.
- `superenalotto_serie_vicinanza_v10.png`: grafico delle sei traiettorie nei primi 25 passi.
- `compute_v10.py`: implementazione Python riproducibile; input `estrazioni_con_ritardi.csv` ordinato dal più recente al più vecchio.

### Relazione con i filtri e con il reverse engineering

I filtri **F01–F14 rimangono attivi e invariati**: questo esercizio non introduce un nuovo filtro. La trasformazione verso il passato non costituisce una previsione e non valuta la capacità di recuperare il processo generatore. Per verificare se le traiettorie codificano informazione non casuale bisognerà confrontare statistiche predefinite con serie simulate e fare test predittivi fuori campione.

### Registro versione

- **v10:** definita trasformazione ricorsiva per vicinanza sulle 4.294 estrazioni, confermato l'esempio richiesto, esplicitato lo spareggio e osservata la fusione delle sei traiettorie al passo 17; salvati dati e codice.


---

## Versione 11 — Tempi di convergenza da ogni estrazione e confronto con processi casuali (2 novembre 2026)

**Stato:** studio descrittivo sulla trasformazione retrograda della versione 10. I filtri **F01–F14 restano attivi e invariati**. Non è stato aggiunto alcun filtro e non si sta stimando la prossima sestina.

### Ipotesi sperimentale e definizione

Partendo dalla sestina crescente dell'estrazione `t`, ogni colonna viene trasformata ricorsivamente scegliendo il numero più vicino in ciascuna *vera* estrazione precedente, come definito in v10. È consentito riutilizzare lo stesso numero storico in più colonne. In caso di equidistanza vince il numero minore, per rendere deterministica la regola. Si definisce **tempo di convergenza `T(t)`** il primo numero di passaggi all'indietro dopo cui tutti e sei i valori trasformati coincidono.

Per misurare tutte le partenze su uno stesso orizzonte di osservazione si selezionano soltanto le date con almeno **120 concorsi antecedenti** nell'archivio: risultano **4.174 partenze** sulle **4.294 estrazioni** (escluse le 120 più antiche; per esse manca una storia completa di 120 passi). Il conteggio è espresso in **numero di estrazioni** e non in giorni. Ogni partenza è misurata separatamente e può condividere molti concorsi passati con altre partenze: le osservazioni dei tempi non sono indipendenti. L'algoritmo arresta ogni traiettoria alla prima convergenza; nei dati reali nessuna resta incompleta al passo 120.

Il percorso dell'ultima sestina `4 18 20 33 46 78` converge in **17 passaggi**, verificato contro v10.

### Descrizione dei risultati reali

| Statistica | Valore |
|---|---:|
| Estrazioni di partenza incluse | 4,174 |
| Passaggi medi | 15.6425 |
| Mediana | 13 |
| Minimo–massimo | 1–78 |
| Quartili (25°–75°) | 8–20 |
| 90° percentile | 30 |
| 95° percentile | 39 |
| Convergenza entro 10 passi | 40.08% |
| Convergenza entro 20 passi | 75.92% |
| Convergenza entro 30 passi | 90.15% |
| Almeno una prima fusione già al passo 1 | 98.99% |

Le **fusioni sono irreversibili**: una volta uguali, due colonne sono trasformate sempre nello stesso valore al passo successivo. Per questo il numero di stati distinti non può crescere; una forte tendenza alla coalescenza è già prevista dalla struttura della regola.

### Due modelli di controllo (*null models*)

Sono state generate **500 sequenze replicate per ciascun controllo**, con `seed=20261102`:

1. **Estrazioni indipendenti uniformi:** per ogni concorso si estraggono sei numeri distinti senza reinserimento tra 1 e 90, indipendentemente da tutti gli altri concorsi. Si applica esattamente la stessa trasformazione a tutte le 4.174 partenze con 120 passi disponibili.
2. **Rimescolamento cronologico:** si mantengono le esatte 4.294 sestine storiche, comprese eventuali ripetizioni, e se ne permuta l'ordine temporale; per ciascuna permutazione si ripete integralmente l'esperimento. Questo controllo conserva la distribuzione empirica dei numeri e delle sestine ma distrugge le dipendenze temporali.

Con un limite osservativo comune di 120 passaggi, per ogni sequenza misuriamo il **tempo ristretto `min(T, 120)`**. Il valore reale è esatto perché nessuna traiettoria supera 120; nei controlli alcune restano aperte e sono contate come 120 anziché come zero o come convergenze effettive. Nel controllo indipendente ci sono 156 casi aperti al passo 120 distribuiti in 11 repliche; nel controllo rimescolato 44 casi in 2 repliche, su un totale di 4.174 × 500 partenze per modello. Questi casi hanno un impatto trascurabile sulle medie ma vengono dichiarati esplicitamente.

| Serie | Media dei passi (ristretta a 120) | Intervallo centrale del 95% delle medie replicate | p Monte Carlo bilaterale sulla media |
|---|---:|---:|---:|
| Reale | **15.64** | — | — |
| Casuale indipendente | 16.23 | 14.62–18.12 | 0.521 |
| Storico rimescolato | 15.88 | 14.62–17.41 | 0.756 |

Gli intervalli riportati descrivono la variabilità fra **intere sequenze simulate**, non sono intervalli di confidenza per la vera media storica. I test Monte Carlo confrontano lo scarto assoluto della media osservata dalla media simulata con gli scarti nelle 500 repliche, usando la correzione `(numero_repliche_almeno_altrettanto_estreme+1)/(B+1)`.

### Confronto dell'intera distribuzione

Definendo `S(k)=quota di partenze non ancora convergenti dopo k passaggi`, la curva osservata è confrontata con le curve simulate agli indici predefiniti `k = 5, 8, 10, 13, 17, 20, 30, 40, 50`. Per evitare di scambiare uno scostamento isolato casuale per una scoperta, si usa come statistica **il massimo scarto standardizzato** e si calibra la sua distribuzione su tutte le repliche (*controllo family-wise*).

| Modello di controllo | p del confronto globale della curva |
|---|---:|
| Estrazioni casuali indipendenti | **0.647** |
| Cronologia storica rimescolata | **0.926** |

Esempi di punti della curva:

| Passo k | Reale: ancora separate | Casuale indipendente: media | Storico rimescolato: media |
|---:|---:|---:|---:|
| 5 | 87.25% | 87.17% | 86.82% |
| 10 | 59.92% | 61.12% | 60.18% |
| 17 | 31.70% | 34.17% | 33.03% |
| 20 | 24.08% | 26.47% | 25.38% |
| 30 | 9.85% | 11.21% | 10.50% |
| 40 | 4.60% | 4.75% | 4.37% |
| 50 | 1.84% | 2.01% | 1.81% |


I risultati non indicano, su queste statistiche, una differenza convincente tra la serie reale e i due controlli. **Il fatto che tutte le traiettorie reali convergano non è, da solo, evidenza di un generatore prevedibile**: lo stesso comportamento si osserva nei controlli.

### Confronto esplorativo fra le epoche estrazionali

Le partenze con data antecedente al 01/07/2009 sono **1305**, le successive **2869**. Le medie sono rispettivamente **16.60** e **15.21** passi, con differenza `post – pre = -1.39`. Confrontando la differenza con quella delle simulazioni uniformi otteniamo `p ≈ 0.471`, con le cronologie rimescolate `p ≈ 0.399`. Non emerge una differenza robusta per questa metrica. È un'analisi esplorativa: le finestre vicino alla transizione possono risalire all'altra epoca, e il periodo più antico ha 120 partenze escluse per mancanza di storia sufficiente.

### Interpretazione e limiti

- La trasformazione per vicinanza è **many-to-one**, cioè perde informazione a ogni fusione: non è invertibile. La convergenza rapida può quindi avvenire anche senza alcuna ricorrenza nascosta nelle estrazioni.
- Il test non riguarda direttamente l'**ordine fisico di uscita** delle sfere: usa sestine crescenti e una distanza fra valori, come richiesto nell'esperimento originario.
- La non significatività non dimostra che il generatore sia indeterministico o privo di struttura. Indica soltanto che, rispetto ai due controlli e alle statistiche scelte, non è stato trovato un segnale distinguibile.
- Il progetto di reverse engineering rimane distinto dalla valutazione predittiva: il tempo di coalescenza retrogrado usa estrazioni passate e da solo **non produce una probabilità superiore per la prossima sestina**.
- Il confronto a molte partenze, sovrapposte nel tempo, è calibrato simulando **sequenze intere**, non assumendo erroneamente che le 4.174 partenze siano indipendenti.
- Il risultato è condizionato alla regola deterministica di spareggio al numero minore; una diversa regola potrebbe produrre piccoli cambiamenti e dovrebbe essere valutata come variante predefinita.

### File della versione 11

- `superenalotto_analisi_filtri_v11.md` — questo documento cumulativo, sufficiente a ricostruire scelte, risultati e percorso fino alla presente versione.
- `superenalotto_convergenze_storiche_v11.csv` — tutte le 4.174 partenze e tempi esatti con date di partenza e convergenza.
- `superenalotto_simulazioni_convergenza_v11.csv` — risultati delle 1.000 simulazioni; medie, mediane, massimi, differenze tra epoche, curve e censura.
- `superenalotto_curve_convergenza_v11.csv` — confronto percentuale delle curve con intervalli delle simulazioni.
- `superenalotto_convergenza_confronto_v11.png` — curva delle traiettorie ancora separate con fasce di simulazione al 95%.
- `superenalotto_convergenza_istogramma_v11.png` — distribuzione dei tempi osservati.
- `superenalotto_metriche_v11.json` — metriche, parametri e statistiche dei test.
- `compute_v11.py` — script riproducibile con generatore casuale inizializzato, algoritmi e grafici.
- File di input: `estrazioni_con_ritardi.csv` (SHA-256 `b7e3e27741cb62c0896a7ff23734b117d2d1f3e580acdc5322241b8005bbd8b4`).

**Per riprodurre:** collocare script e CSV nella medesima cartella ed eseguire `python compute_v11.py` con Python 3, NumPy, Pandas e Matplotlib. Il file di origine è atteso in ordine di data decrescente; l'algoritmo usa gli indici `0..4173` come partenze e gli indici progressivamente maggiori come storia precedente.

### Registro aggiornamenti

- **v11:** esperimento di coalescenza da ogni partenza storica (4.174 partenze confrontabili); tempi di fusione, confronto con 500 simulazioni casuali e 500 permutazioni della cronologia, test globali corretti per confronti multipli, controllo esplorativo tra epoche, grafici, dettagli per concorso e codice; F01–F14 invariati.

---

## Versione 12 — Serie ricorsiva di differenze minime (2 novembre 2026)

**Stato:** nuova trasformazione, non un filtro predittivo; i filtri F01–F14 rimangono invariati.

### Definizione operativa

Il file sorgente è in ordine cronologico inverso. Si chiama `E[k]` la sestina realmente estratta alla riga `k`, già ordinata crescente, e `D[k]` la sestina derivata, anch'essa ordinata crescente.

- **Inizializzazione:** `D[0] = E[0] = [4, 18, 20, 33, 46, 78]` (31 ottobre 2026).
- **Passaggio ricorsivo:** per ogni numero `a` della sestina reale **precedente** `E[k]`, con `k >= 1`, si calcola `min(abs(a-b) per b in D[k-1])`, dove `D[k-1]` contiene i sei valori già trasformati al passo più recente. Poi si ordinano i sei valori ottenuti.
- **Formula:** `D[k] = sort([ min_(b in D[k-1]) |a-b|  per ogni a in E[k] ])`.
- **Distanze:** sono ammessi zeri e duplicati; non si cerca un assegnamento biunivoco, e **ogni** numero reale può scegliere lo stesso elemento di `D[k-1]`. L'equidistanza non necessita spareggio perché si conserva **solo la distanza**.
- La serie viene calcolata fino all'ultima estrazione disponibile dell'archivio (03/12/1997), per **4,294** righe e **4,293** trasformazioni.

**Controllo manuale:**

| Passo | Data | Sestina reale E[k] | Sestina derivata D[k] |
|---:|---|---|---|
| 0 | 31/10/2026 | 4 18 20 33 46 78 | 4 18 20 33 46 78 |
| 1 | 30/10/2026 | 19 24 49 62 64 85 | 1 3 4 7 14 16 |
| 2 | 29/10/2026 | 13 20 41 60 77 85 | 1 4 25 44 61 69 |
| 3 | 27/10/2026 | 23 34 44 48 64 70 | 0 1 2 3 4 9 |
| 4 | 24/10/2026 | 11 17 32 50 73 80 | 2 8 23 41 64 71 |

**Esempio passo 1:** ogni valore in `[19,24,49,62,64,85]` prende la distanza minima da `[4,18,20,33,46,78]`. Si ottengono, nell'ordine originale, `[1,4,3,16,14,7]`, che ordinati diventano `[1,3,4,7,14,16]`.

### Caratteristiche empiriche della serie completa

- Il massimo delle sei differenze ha media **40.063**, e la media di tutti i 25.764 valori trasformati è **18.785**.
- Il massimo presenta autocorrelazioni ai lag 1/2/3 di **-0.887 / +0.791 / -0.710**. L'alternanza forte dei segni può segnalare una dinamica oscillatoria **della trasformazione**: valori piccoli di `D[k-1]` possono produrre grandi distanze al passo seguente, e viceversa.
- Ci sono **1354** righe con almeno uno zero, **1** righe con tutti i sei valori uguali e **4267** sestine trasformate differenti.
- A differenza di v10, qui **le colonne possono separarsi dopo avere coinciso**: ciascun nuovo output è calcolato dai sei *nuovi* numeri reali e dai sei valori di `D` del passo precedente. Non si conserva alcun abbinamento fisso tra colonne. La convergenza permanente della versione 10 non è una proprietà di questa nuova trasformazione.

### Verifica dell'alternanza con modelli di controllo

Per distinguere una proprietà delle estrazioni da una proprietà della trasformazione, sono state generate **200 repliche indipendenti uniformi** di 4.294 sestine (6 numeri distinti da 1 a 90, campionati senza rimpiazzo) e **200 repliche con la cronologia delle sestine storiche rimescolata**. Per ogni replica si avvia la trasformazione dalla sestina più recente della sequenza simulata e si applica identica regola retrograda. `seed=20261102`. Gli intervalli della tabella rappresentano il 2,5° e 97,5° percentile delle **statistiche delle repliche**, non intervalli di confidenza sui dati reali.

| Statistica | Reale | Uniforme: media [2,5%–97,5%] | Rimescolato: media [2,5%–97,5%] |
|---|---:|---:|---:|
| ACF massimo lag 1 | -0.8872 | -0.8813 [-0.8904–-0.8715] | -0.8877 [-0.8964–-0.8781] |
| ACF massimo lag 2 | 0.7914 | 0.7827 [0.7615–0.8024] | 0.7933 [0.7746–0.8105] |
| ACF massimo lag 3 | -0.7097 | -0.6960 [-0.7215–-0.6683] | -0.7101 [-0.7347–-0.6860] |
| ACF media lag 1 | -0.6946 | -0.6976 [-0.7122–-0.6825] | -0.7010 [-0.7163–-0.6860] |
| ACF media lag 2 | 0.6593 | 0.6455 [0.6207–0.6712] | 0.6525 [0.6297–0.6760] |
| Media del massimo | 40.06 | 39.84 [39.68–39.99] | 40.08 [39.99–40.16] |
| Righe con almeno uno zero | 1354.00 | 1338.57 [1288.95–1400.03] | 1322.36 [1265.95–1375.03] |
| Righe con sei valori uguali | 1.00 | 0.01 [0.00–0.00] | 0.00 [0.00–0.00] |

**Interpretazione:** se autocorrelazioni molto negative a lag dispari e positive a lag pari si ripetono nei due controlli, sono generate dalla regola matematica anche in assenza di struttura temporale reale. I valori `p` Monte Carlo sono nel JSON delle metriche; con 200 repliche la minima risoluzione è 1/201, e i confronti restano esplorativi in presenza di metriche multiple. Non trarre conclusioni predittive da queste autocorrelazioni senza un confronto fuori campione con estrazioni future.

### File generati e riproducibilità

- `superenalotto_serie_differenze_minime_v12.csv`: 4.294 righe con passo, data, concorso, sestina vera, sei differenze ordinate, minimo, massimo, media, numero di zeri e valori distinti.
- `superenalotto_differenze_minime_v12.png`: prime 85 righe delle sei traiettorie.
- `superenalotto_differenze_autocorrelazione_v12.png`: correlazione temporale del massimo ai lag 1–20.
- `superenalotto_differenze_simulazioni_v12.csv`: 400 risultati delle due famiglie di simulazioni.
- `superenalotto_metriche_v12.json`: tutte le misure e le statistiche di confronto.
- `compute_v12.py`: codice che riproduce serie, verifiche, simulazioni, grafici e appendice Markdown partendo da `estrazioni_con_ritardi.csv` e dal documento `superenalotto_analisi_filtri_v11.md`.
- SHA-256 del file sorgente: `b7e3e27741cb62c0896a7ff23734b117d2d1f3e580acdc5322241b8005bbd8b4`.

**Nota:** queste trasformazioni usano volontariamente l'intera storia *all'indietro*, quindi non sono un algoritmo predittivo per la prossima estrazione. Per verificarne la capacità predittiva sarà necessario definire una caratteristica computabile usando solo l'informazione disponibile prima del concorso previsto, addestrare su un periodo iniziale e valutare su concorsi successivi senza riottimizzare sui risultati del test.

### Registro aggiornamenti

- **v12:** introdotta e calcolata la serie ricorsiva delle sei differenze minime ordinate su tutto il CSV, distinta dalla serie dei numeri più vicini di v10; analizzata l'alternanza osservata e confrontata con sequenze casuali e sequenze storiche rimescolate; F01–F14 invariati.

---

## Versione 13 — Matrice binaria delle estrazioni su 90 colonne (2 novembre 2026)

**Stato:** nuova rappresentazione, non un filtro; F01–F14 invariati.

**Input:** `estrazioni_con_ritardi.csv`, SHA-256 `b7e3e27741cb62c0896a7ff23734b117d2d1f3e580acdc5322241b8005bbd8b4`; 4,294 estrazioni dal 1997-12-03 al 2026-10-31.

### Definizione

Ogni estrazione è rappresentata da un vettore di **90 indicatori binari**, uno per numero del SuperEnalotto: `n01` … `n90`. Per la sestina estratta `E_t`, il valore `x[t,n]` è **1 se `n ∈ E_t`, 0 altrimenti**. Sono ammessi solamente sei numeri distinti: quindi ogni riga ha **6 valori 1 e 84 valori 0**; la somma per riga è 6. Le colonne iniziali `data` e `concorso` sono metadati e non fanno parte delle 90 colonne binarie. Il CSV mantiene lo stesso ordine del sorgente, dal concorso più recente al più vecchio.

La matrice rappresenta la presenza/assenza dei numeri, senza dare un significato artificiale alla prima, seconda, ecc. posizione dei numeri ordinati. Non codifica l’ordine fisico di uscita delle sfere. Non introduce nuova informazione rispetto alle sestine originali ma può facilitare analisi temporali per numero, matrici di co-occorrenza, modelli multivariati e sistemi neurali.

### Prime estrazioni e controllo

| Data | Concorso | Colonne che valgono 1 | Numero di 1 | Numero di 0 |
|---|---:|---|---:|---:|
| 2026-10-31 | 175 | n04, n18, n20, n33, n46, n78 | 6 | 84 |
| 2026-10-30 | 174 | n19, n24, n49, n62, n64, n85 | 6 | 84 |
| 2026-10-29 | 173 | n13, n20, n41, n60, n77, n85 | 6 | 84 |
| 2026-10-27 | 172 | n23, n34, n44, n48, n64, n70 | 6 | 84 |
| 2026-10-24 | 171 | n11, n17, n32, n50, n73, n80 | 6 | 84 |

**Verifiche:** tutte le 4,294 righe hanno sei 1 e 84 zeri; il totale degli 1 è 25,764; le colonne coprono precisamente i numeri da 1 a 90; nessun numero duplicato per sestina.

### File e riproducibilità

- `superenalotto_matrice_binaria_90_v13.csv`: 4,294 righe, 92 colonne (data, concorso, 90 colonne binarie); SHA-256 `6546a40b1d9fccae106035739d3809b03d928990e50235e6773357df377d99e0`.
- `compute_v13.py`: codice riproducibile per costruire la matrice dal CSV sorgente e verificare gli invarianti.
- `superenalotto_analisi_filtri_v13.md`: questo documento cumulativo, con la metodologia e le versioni 1–13.

### Registro aggiornamenti

- **v13:** creata la rappresentazione one-hot multipla (multi-hot) delle 4.294 sestine in 90 colonne binarie; confermata la presenza di sei 1 per riga; F01–F14 invariati.

---

## Versione 14 — Esperimento neurale sulla matrice binaria di 90 colonne (2 novembre 2026)

**Obiettivo:** verificare se una Echo State Network (ESN) e una GRU, alimentate dalle ultime **100 estrazioni** in rappresentazione multi-hot a 90 colonne, prevedano l’estrazione immediatamente successiva meglio del riferimento casuale. Sono compresi anche il controllo con frequenze storiche e una simulazione casuale di sestine.

**Stato:** esperimento di previsione completato, nessuna nuova regola aggiunta ai filtri F01–F14. La versione mantiene integralmente le definizioni e le analisi v01–v13 sopra riportate.

### Dataset e separazione temporale

- Input: `superenalotto_matrice_binaria_90_v13.csv` (4.294 estrazioni; colonne `n01`…`n90`, sei valori 1 per riga).
- Ordine iniziale del CSV: **decrescente**; lo script riordina in senso cronologico crescente prima di produrre esempi.
- Per ogni tempo t >= 100, input = estrazioni t−100…t−1, target = estrazione t; la sequenza e il target sono disgiunti nel tempo.
- Non si forniscono alla rete data, concorso, jolly, superstar, ritardi, numeri futuri o i 14 filtri.
- Numero esempi supervisionati: **4.194** (4.294 − 100).
- La validazione determina iperparametri ESN, calibrazione, ed epoca di early stopping GRU; il test rimane segregato fino a tali scelte.
- Le prime finestre di validazione/test possono includere estrazioni del segmento precedente: è corretto in un esperimento previsionale, perché erano già note prima del target.

| Segmento | Numero target | Inizio target | Fine target |
|---|---:|---|---|
| Train | 2,516 | 1998-11-18 | 2017-02-07 |
| Validazione | 629 | 2017-02-09 | 2021-03-27 |
| Test | 1,049 | 2021-03-30 | 2026-10-31 |

### Architetture e selezione

- **Casuale:** per ogni target di test genera sei numeri distinti uniformemente da 1 a 90, con seed riproducibile. La previsione probabilistica teorica uniforme è p=6/90 per ogni numero; il numero medio di indovinati per sestina casuale è **6×6/90 = 0,4**.
- **Frequenze storiche:** per ciascun numero considera la frequenza sui 2.516 target del train; la forza di regolarizzazione verso uniforme è scelta sulla validazione (griglia 0;0,2;0,5;1;2). Intensità scelta: **0,2**.
- **ESN:** reservoir fisso di 64 neuroni, pesi ricorrenti casuali con raggio spettrale 0,85, leaking rate 0,55, scala input 0,18; stato reinizializzato a zero per **ogni** finestra di 100 estrazioni. Readout Ridge multivariato addestrato solo su train. Alpha selezionato sulla validazione tra [1, 10, 100, 1000]: **1,0**. Scala del readout selezionata tra [0, 4, 8, 16, 32, 64, 128] per ottimizzare log-loss: **0**.
- **Interpretazione ESN:** la scala selezionata è **zero**, perciò le probabilità finali sono tutte p=6/90 e non apportano miglioramento probabilistico. Per valutare comunque la classifica dei candidati vengono usati i punteggi **grezzi del readout** (non le probabilità tutte uguali); questo criterio preserva una classifica riproducibile e non sfrutta i target di test.
- **GRU:** singolo strato GRU da 32 unità, LayerNorm e output lineare da 90 logits, loss BCEWithLogits, AdamW (lr 0,002, weight decay 0,01), batch 128, max 25 epoche, patience 5, clip dei gradienti a 1. Epoca selezionata sulla log-loss di validazione: **8**.
- Per la valutazione probabilistica la matrice dei 90 sigmoid è corretta mediante offset per riga (ricerca binaria) in modo che la somma delle probabilità marginali sia sei. Questa correzione mantiene invariato l’ordinamento quando la scala è positiva.

### Test cronologico definitivo

La metrica di successo è **il numero medio di numeri corretti nella sestina di sei proposti**. Log-loss e Brier sono medie su tutte le 90 uscite binarie, dove valori inferiori sono migliori.

| Metodo | Numeri corretti medi | Numeri corretti totali | Log-loss | Brier | IC 95% bootstrap a blocchi, corretti medi |
|---|---:|---:|---:|---:|---:|
| Casuale | 0,366063 | 384 | 0,244930 | 0,062222 | [0,334604; 0,397521] |
| Frequenze storiche | 0,410867 | 431 | 0,244940 | 0,062223 | [0,372736; 0,448046] |
| Echo State Network | 0,391802 | 411 | 0,244930 | 0,062222 | [0,361296; 0,424214] |
| GRU | 0,391802 | 411 | 0,245202 | 0,062255 | [0,358889; 0,425167] |

- **Riferimento teorico uniforme:** media di 0,4 numeri corretti, log-loss 0,244930, Brier 0,062222. L’unica realizzazione casuale nel confronto ne indovina 384/1.049 = 0,3661: questo scostamento è una fluttuazione della scelta simulata, **non** un nuovo valore atteso.
- In 2.000 ripetizioni di scelta casuale di sei numeri per ciascuna delle 1.049 estrazioni di test, l’intervallo centrale del 95% delle medie va da 0,363203 a 0,435653.
- Le stime di intervallo riportate in tabella usano **2.500 bootstrap a blocchi circolari da 25 estrazioni** sul test. Sono valutazioni della variabilità del campione, non garanzia di generalizzazione futura.
- Il modello **frequenze storiche** raggiunge 0,4109, ma il confronto Monte Carlo con l’atteso uniforme non è significativo (p esplorativo ≈ 0,562719). La sua log-loss è leggermente peggiore del riferimento.
- La **ESN**, utilizzando la classifica dei punteggi grezzi, ottiene 0,3918 indovinati/estrazione (411 su 1.049). La probabilità calibrata scelta su validazione è completamente uniforme: **nessuna informazione probabilistica dimostrata**.
- La **GRU** ottiene 0,3918 indovinati/estrazione (anch’essa 411, con candidati diversi da ESN) e log-loss 0,245202, contro 0,244930 del riferimento uniforme. L’IC bootstrap della differenza log-loss GRU meno uniforme è [0,000126; 0,000418], completamente positivo: il modello peggiora la previsione probabilistica in questo test.
- ESN e GRU hanno lo stesso totale di numeri indovinati per coincidenza, ma non producono necessariamente le stesse sestine.

### Valutazione del potere predittivo e limiti

**In questo test, né ESN né GRU battono il riferimento casuale teorico.** Il risultato non prova che il generatore sia casuale o che non vi sia una legge fisica deterministica: prova soltanto che queste due architetture, con questi iperparametri e i dati forniti, non recuperano una struttura utile fuori campione.

Il dataset contiene una transizione fra sistemi estrazionali nel luglio 2009 e solo 4.194 coppie finestra-target; il train attraversa la transizione, il test no. Le finestre scorrevoli si sovrappongono e ciò può limitare l’indipendenza statistica delle osservazioni. La matrice multi-hot è una trasformazione senza perdita delle sestine ordinate, non contiene l’ordine fisico delle sfere né condizioni della macchina. Le probabilità marginali sommate a sei non rappresentano un modello congiunto completo della sestina.

Le prove su più architetture e configurazioni possono aumentare il rischio di selezionare casualmente un risultato favorevole. Ogni nuova ipotesi, una volta decisa, va verificata su un **periodo futuro non ancora utilizzato per scegliere modelli** o con validazioni rolling-origin annidate.

### Riproducibilità e artefatti

- `compute_v14.py`: script completo, costruisce finestre cronologiche, ESN, GRU, metriche, bootstrap e grafici. Per eseguire: `python compute_v14.py` in ambiente con NumPy, pandas, SciPy, scikit-learn, PyTorch e Matplotlib; i percorsi sono ancorati a `/mnt/data`. Generazione casuale con `seed=20261102`. Il motore PyTorch e la piattaforma possono introdurre piccole differenze numeriche.
- `superenalotto_metriche_v14.json`: split, tutti gli iperparametri, curva epoche GRU, metriche e intervalli.
- `superenalotto_previsioni_test_v14.csv`: per ciascuno dei 1.049 target, data, sestina vincente, hit e sestine proposte da frequenze, ESN e GRU. Per il casuale viene salvato solo il numero di hit; viene rigenerato con lo script e il seed.
- `superenalotto_confronto_reti_v14.png`: confronto delle medie con IC bootstrap e linea del riferimento teorico.
- `superenalotto_gru_apprendimento_v14.png`: training e validazione per epoca.
- SHA-256 della matrice sorgente: `6546a40b1d9fccae106035739d3809b03d928990e50235e6773357df377d99e0`.

### Registro aggiornamenti

- **v14:** eseguito esperimento cronologico su matrice binaria v13 con finestre di 100 estrazioni; addestrate ESN (64 unità) e GRU (32 unità), confrontate con riferimento uniforme casuale e frequenze storiche. Valutazione fuori campione su 1.049 estrazioni del 2021–2026, senza miglioramento rispetto al riferimento teorico. F01–F14 invariati.


---

## Versione 15 — Echo State Network con profondità di memoria variabile (2 novembre 2026)

**Obiettivo:** ripetere lo studio di previsione della sestina successiva usando soltanto l’epoca autonoma successiva al luglio 2009, sperimentare memorie 10/30/100/200 estrazioni e selezionare l’architettura mediante validazione walk-forward cronologica. Mantenere isolati i risultati del test durante la scelta degli iperparametri.

**Stato:** studio sperimentale completato. F01–F14 invariati: nessuna regola aggiunta o modificata. Si preservano tutte le sezioni storiche v01–v14 sopra riportate.

### Serie, esempio supervisionato e controllo anti-leakage
- Sorgente: `superenalotto_matrice_binaria_90_v13.csv`, 4.294 sestine in formato multi-hot 90 dimensioni.
- Filtro temporale: estrazioni dal **2009-07-01** incluso, prima estrazione presente **2009-07-02**; 2.869 estrazioni fino al **2026-10-31**.
- Le 90 caratteristiche di ingresso per ciascun passo sono gli indicatori `n01`–`n90`; ogni riga contiene esattamente sei 1.
- Per il target al tempo `t` il reservoir riceve solo `X[t-w],...,X[t-1]` per ogni `w` in {10, 30, 100, 200}. Lo stato viene **azzerato per ciascuna finestra**: anche il reservoir con finestra 200 non riceve informazioni precedenti al 2009.
- Il target `X[t]` non entra mai nella sua stessa finestra. Gli iperparametri sono scelti dalle sole validazioni precedenti al test.
- La parte di test dal **2021-03-30** al **2026-10-31** coincide cronologicamente con il test v14 (per confrontabilità, 1.049 estrazioni), ma **non è un periodo scientificamente vergine rispetto al progetto**: è già stato esaminato nella v14. Il rischio di ricerca adattiva fra esperimenti rimane e richiederà dati futuri non osservati.

### Tre validazioni progressive e test a finestra espandibile

| Fold | Training target utilizzabili, indici relativi al 2009 (estremo finale escluso) | Validazione target | Esempi validazione |
|---|---|---|---:|
| 1 | da `w` a 899 | 2015-04-02 — 2017-02-28 | 300 |
| 2 | da `w` a 1199 | 2017-03-02 — 2019-01-29 | 300 |
| 3 | da `w` a 1499 | 2019-01-31 — 2021-03-27 | 320 |

- Per ogni fold il modello è riaddestrato **esclusivamente sui target precedenti** alla validazione; il numero di esempi di training cresce nei tre fold.
- Per ciascuna delle quattro profondità si confrontano **2 leak** (0,25 / 0,65) × **2 raggi spettrali** (0,60 / 0,95) × **3 regolarizzazioni Ridge** (1 / 10 / 100): 12 configurazioni per finestra, 48 in totale.
- I **920 target** di validazione sono riuniti per selezionare in modo predefinito la combinazione con **massimo numero medio di numeri corretti fra i sei suggeriti**. Il modello globale è scelto fra i quattro vincitori per finestra, sempre usando la sola validazione.
- La calibrazione dei punteggi Ridge in probabilità marginali viene scelta **separatamente**, minimizzando la log-loss di validazione fra le scale `[0,2,4,8,16,32]`, normalizzando le 90 probabilità in modo che sommino a sei.
- Durante il **test**, gli iperparametri selezionati restano invariati e il readout Ridge è riaddestrato ogni **150 nuove estrazioni**, usando esclusivamente i target storici già noti prima del blocco. All’interno del blocco le finestre di input possono usare le estrazioni appena precedenti già avvenute, senza riaddestrare il readout.
- Confronti di riferimento: margini uniformi `6/90` e ranking casuale seeded, frequenze storiche cumulative aggiornate prima di ogni target, con pseudo-conteggio verso l’uniforme selezionato sulla validazione.

### Iperparametri scelti sui tre fold (prima del test)

| Memoria w | Leak | Raggio spettrale | Ridge α | Media hit validazione | Scala probabilità scelta |
|---:|---:|---:|---:|---:|---:|
| 10 | 0,25 | 0,95 | 100 | 0,423913 | 0 |
| 30 | 0,65 | 0,95 | 1 | 0,408696 | 0 |
| 100 | 0,65 | 0,95 | 1 | 0,404348 | 0 |
| 200 | 0,65 | 0,95 | 1 | 0,418478 | 0 |

**Modello selezionato dalla validazione:** memoria **10**, leak 0,25, raggio spettrale 0,95, Ridge α 100, con 390 hit sui 920 target di validazione (0,423913 per estrazione). La finestra di 200 non è il modello vincente della selezione.

**Risultato sulla calibrazione:** per **tutte e quattro** le finestre la validazione sceglie scala 0. Di conseguenza le probabilità calibrate sono esattamente quelle uniformi (`6/90` per ogni numero) e log-loss/Brier coincidono con l’ipotesi nulla. Per studiare comunque la discriminazione si selezionano i sei numeri dai **punteggi grezzi** del readout Ridge. Non confondere questi ranking con probabilità non uniformi validate.

### Risultati sul test cronologico progressivo (1.049 estrazioni)

| Metodo | Hit medi fra sei proposti | Hit totali | IC 95% bootstrap a blocchi | Log-loss | Brier |
|---|---:|---:|---:|---:|---:|
| Casuale, realizzazione seeded | 0,394662 | 414 | [0,3560; 0,4337] | 0,244930 | 0,062222 |
| Frequenze cumulative | 0,420400 | 441 | [0,3842; 0,4566] | 0,245066 | 0,062239 |
| ESN memoria 10 | 0,394662 | 414 | [0,3622; 0,4290] | 0,244930 | 0,062222 |
| ESN memoria 30 | 0,396568 | 416 | [0,3651; 0,4271] | 0,244930 | 0,062222 |
| ESN memoria 100 | 0,403241 | 423 | [0,3651; 0,4395] | 0,244930 | 0,062222 |
| ESN memoria 200 | 0,410867 | 431 | [0,3737; 0,4452] | 0,244930 | 0,062222 |

- Il **valore atteso teorico** di una sestina proposta uniformemente è **0,4000** numeri corretti per estrazione (419,6 su 1.049). La singola realizzazione casuale seeded ha 414 hit: non è il valore teorico.
- La miglior ESN del **test**, con memoria **200**, totalizza **431** hit (0,410867), ma è **una finestra secondaria non scelta** dalla validazione. Confrontarla ex post con 0,4 o promuoverla a modello preferito creerebbe selezione sul test.
- La ESN **preselezionata dalla validazione**, memoria **10**, totalizza **414** hit (0,394662), senza vantaggio rispetto al caso.
- La baseline **frequenze cumulative** totalizza **441** hit (0,420400), con log-loss 0,245066, peggiore di quella uniforme 0,244930. Differenza piccola e non significativa in termini di hit.
- Bootstrap con **2.500 campioni** a **blocchi circolari da 25 estrazioni**: gli IC di hit medi di tutti i modelli includono 0,4. I confronti fra reti e frequenze cumulativamente non risultano risolutivi.
- Test teorico indicativo: sotto estrazioni indipendenti uniformi il numero di numeri corretti ha distribuzione ipergeometrica `Hypergeom(N=90, K=6, n=6)`, media 0,4 e varianza per estrazione ≈0,35236. Il test normale a due code produce, per il modello selezionato w=10, p≈0,771; per w=200, p≈0,553; per le frequenze, p≈0,266. Queste sono approssimazioni sotto l’ipotesi nulla, non misure della probabilità che il modello sia corretto.
- La previsione con finestra `w=100` non ripete esattamente la ESN v14: sono cambiati il campione di training (solo dal 2009), la selezione degli iperparametri e il riaddestramento progressivo. Sullo stesso intervallo test si ottiene 0,403241 contro 0,391802 della v14, **senza poter attribuire causalmente la differenza a un singolo cambiamento**.

### Prestazioni annue della configurazione selezionata e delle frequenze

| Anno | Estrazioni nel test | ESN selezionata, w10 | Frequenze cumulative |
|---:|---:|---:|---:|
| 2021 | 119 | 0,4454 | 0,3950 |
| 2022 | 157 | 0,3885 | 0,4140 |
| 2023 | 182 | 0,4066 | 0,4615 |
| 2024 | 208 | 0,3317 | 0,3654 |
| 2025 | 208 | 0,3798 | 0,4231 |
| 2026 | 175 | 0,4457 | 0,4629 |

### Interpretazione e limiti

**Esito:** una maggiore profondità di memoria non ha prodotto un vantaggio predittivo robusto. La finestra con performance migliori sul test (200) era stata superata da quella di 10 in validazione. Non emergono evidenze di informazione recuperabile attraverso questo reservoir rispetto alla baseline equa.
Il reservoir di 64 unità è un modello limitato, e l’assenza di miglioramento in questo test non dimostra la casualità ontologica del sistema, né esclude stati fisici deterministici non osservabili. L’esperimento è inoltre esplorativo: sono state confrontate 48 configurazioni, quattro finestre e molti esperimenti precedenti sullo stesso archivio; per una prova positiva servirebbe una vera validazione prospettica su nuove estrazioni.

### Parametri, dati e file per riprodurre

- Seed NumPy/PyTorch: `20261117`; reservoir fisso **64 neuroni**, scala ingresso **0,20**, bias gaussiani **0,02**.
- Stato del reservoir azzerato in ogni finestra e aggiornato per ogni estrazione antecedente al target; pesi ricorrenti normalizzati tramite raggio spettrale. Readout Ridge multivariato con intercetta.
- `compute_v15.py`: script completo di validazione progressive, fitting, calibrazione, previsioni progressive, metriche e grafici. Eseguire `OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 OMP_NUM_THREADS=2 python /mnt/data/compute_v15.py` con Python, NumPy, SciPy, scikit-learn, pandas, PyTorch, Matplotlib e threadpoolctl.
- `superenalotto_previsioni_test_v15.csv`: 1.049 righe test con data, sestina reale, numeri proposti e correttezza per ogni modello.
- `superenalotto_validazione_reservoir_v15.csv`: tutti i 48 risultati della selezione iperparametri sulle tre validazioni.
- `superenalotto_metriche_v15.json`: configurazioni, fold, blocchi di riaddestramento, intervalli bootstrap e risultati annui.
- `superenalotto_reservoir_memorie_v15.png`: confronto dei modelli e incertezza sul test.
- `superenalotto_reservoir_validazione_test_v15.png`: confronto tra hit in validazione e hit nel test, per profondità.
- SHA-256 della matrice di input: `6546a40b1d9fccae106035739d3809b03d928990e50235e6773357df377d99e0`.

### Registro aggiornamenti

- **v15:** selezione ESN su 4 profondità di memoria 10/30/100/200, restringendo il corpus al periodo dal luglio 2009, usando 3 fold cronologici in espansione e test a blocchi con aggiornamento periodico del readout. Nessuna architettura migliora in modo affidabile rispetto all’ipotesi uniforme; F01–F14 invariati.


---

## Versione 16 — Modello generativo auto-supervisionato su 90 colonne (finestra 100)

**Stato:** esperimento eseguito, F01–F14 invariati. Nessun nuovo filtro introdotto.

### Ipotesi e motivazione
La matrice multi-hot (sei valori 1 e 84 zeri su 90 numeri) può servire a costruire una rappresentazione latente delle ultime 100 estrazioni. Questo esperimento distingue tre capacità: (1) ricostruire un'estrazione storica volutamente mascherata; (2) ricordare informazioni già osservate nello stato latente; (3) **prevedere una nuova estrazione**. I risultati di (1) e (2) non costituiscono evidenza di (3).

### Dataset e protocollo
- Sorgente: `superenalotto_matrice_binaria_90_v13.csv`, checksum SHA-256 `6546a40b1d9fccae106035739d3809b03d928990e50235e6773357df377d99e0`.
- Esclusivamente estrazioni successive al 1° luglio 2009: 2869 righe. Per target `t`, l'input è l'intervallo `[t-100, t)` e **non** contiene l'estrazione da predire.
- Training: 1400 esempi, 2010-02-20 – 2019-01-29, indici target 100–1499 (estremi inclusi).
- Validazione: 320 esempi, 2019-01-31 – 2021-03-27, indici target 1500–1819.
- Test: 1049 esempi, 2021-03-30 – 2026-10-31, indici target 1820–2868. Stesso periodo di v15, ma **protocollo di addestramento diverso** (v15 aggiornava progressivamente il readout, qui i modelli neurali restano fissi).
- Si può usare nel contesto di una previsione la parte di storia precedente al target, anche se quell'input comprende estrazioni usate in un blocco precedente: è il normale uso di una finestra causale.
- La selezione di epoca, Ridge e parametri di calibrazione avviene solo sulla validazione; il test viene usato per la valutazione finale. I ripetuti studi v14–v16 sullo stesso periodo test riducono la forza di qualsiasi futura scoperta positiva retrospettiva; una conferma prospettica separata rimane necessaria.

### Architetture e pretraining
1. **Pretraining con mascheramento:** GRU bidirezionale, 32 unità per direzione; in ogni finestra da 100 estrazioni il 20% circa delle intere sestine storiche viene sostituito da un vettore di 90 valori `-1` e la rete deve ricostruire le sei presenze nei passi mascherati. L'obiettivo è la binary cross-entropy sulle sole righe mascherate. La bidirezionalità è consentita perché ricostruisce esclusivamente *dentro una finestra storica già nota*; non legge estrazioni successive al target di previsione.
2. **Validazione del pretraining senza contaminazione del training:** si misurano solo le 220 finestre di validazione il cui intero contesto di 100 estrazioni appartiene al periodo di validazione (2019-09-21 – 2021-03-27 per i target), non finestre che contengono anche date del train. Maschere di validazione fissate deterministicamente.
3. **Encoder congelato:** confronto fra pesi casuali e pesi del pretraining, entrambi con readout Ridge multivariato (alpha 1, 10, 100, 1000), e scala probabilistica scelta per log-loss sulla validazione.
4. **GRU diretta:** identica architettura di encoding (bidirezionale 32+32) con testa lineare, addestrata direttamente per la sestina successiva.
5. **Fine-tuning:** stessa rete di previsione, inizializzata dal pretraining con estrazioni mascherate, poi ottimizzata per prevedere la sestina successiva.
6. **Baseline:** probabilità uniforme 6/90 per ciascun numero, con top-6 teorico atteso 0,4; e frequenze storiche cumulative aggiornate **prima** del target, con smoothing scelto sulla validazione.

La GRU usa AdamW, learning rate 0,001, weight decay 0,01, batch size 128, early stopping di cinque epoche senza miglioramento, massimo 20 epoche. I criteri di selezione sono basati sulla log-loss su 90 probabilità marginali normalizzate a somma 6. Le sestine top-6 sono ottenute ordinando i punteggi grezzi: nessuna selezione sulla base dei risultati del test. Per probabilità di sestina con sei numeri esatti servirebbe un modello congiunto vincolato, non solo sei margini.

### Risultato A — Ricostruzione di estrazioni mascherate
- Migliore epoca di pretraining: **1** (scelta solo sulla ricostruzione di validazione).
- Log-loss su sestine storiche completamente mascherate in validazione: **0.245371**.
- Riferimento uniforme con P(numero estratto)=6/90: **0.244930**.
- La ricostruzione con la rete è **peggiore** dell'ipotesi uniforme. Questo test non riguarda direttamente la sestina successiva.

### Risultato B — Memoria dello stato latente (ricostruzione dell'ultima sestina *visibile*)
Questa prova usa un probe Ridge addestrato solo sul training: dalla rappresentazione di 100 estrazioni già disponibili deve recuperare i sei numeri della **più recente estrazione d'ingresso**; serve a misurare informazione conservata nello stato, non capacità di prevedere il futuro.

| Encoder | Numeri recuperati in media su 6 | Log-loss |
|---|---:|---:|
| Casuale congelato | 3.4013 | 0.178654 |
| Preaddestrato congelato | 3.3727 | 0.179013 |

L'encoder preaddestrato rappresenta un po' meglio l'ultimo ingresso, ma questa differenza **non implica** alcun vantaggio predittivo. La rappresentazione è stata ottenuta con un modello bidirezionale applicato soltanto alle 100 osservazioni precedenti il target.

### Risultato C — Previsione della sestina successiva (test cronologico 2021–2026)

| Metodo | Totale numeri indovinati | Media per estrazione | IC bootstrap 95% sulla media | Log-loss | Brier |
|---|---:|---:|---:|---:|---:|
| Uniforme (riferimento teorico) | — | 0.4000 | — | 0.244930 | 0.062222 |
| Frequenze espansive | 441 | 0.4204 | 0.384–0.459 | 0.244936 | 0.062223 |
| Encoder casuale congelato + Ridge | 431 | 0.4109 | 0.378–0.444 | 0.244930 | 0.062222 |
| Encoder mascherato congelato + Ridge | 448 | 0.4271 | 0.392–0.464 | 0.244938 | 0.062223 |
| GRU diretta | 426 | 0.4061 | 0.369–0.443 | 0.245140 | 0.062248 |
| GRU preaddestrata + fine-tuning | 414 | 0.3947 | 0.357–0.437 | 0.245340 | 0.062273 |

**Interpretazione:** l'encoder preaddestrato e congelato totalizza 448 numeri (media 0.4271), come quello casuale congelato (431; 0.4109). L'architettura con fine-tuning totalizza 414 numeri, rispetto ai 426 della stessa architettura addestrata da zero. Nessuna evidenza affidabile che il pretraining abbia migliorato la capacità di anticipare le estrazioni; la log-loss migliore resta quella uniforme.

Nel confronto accoppiato, il probe con encoder mascherato supera quello casuale congelato di **0,0162 numeri per estrazione**; il suo intervallo bootstrap a blocchi al 95% è **[−0,0305; +0,0648]**, quindi non si distingue chiaramente da zero. Questo confronto è esplorativo, calcolato a posteriori dalle 1.049 righe del CSV di test.

Il valore teorico di 0,4 indica la media attesa della sovrapposizione fra una sestina proposta indipendentemente e la sestina reale, non una predizione effettivamente generata da sei valori top-ranking uniformi (che sarebbe arbitraria per via di tutti i pareggi). I limiti bootstrap sono descrittivi e dipendono da una scelta di blocchi di 25 estrazioni su 3000 campioni. Per la differenza di log-loss rispetto alla probabilità uniforme, gli intervalli a blocchi rendono evidente l'assenza di un miglioramento convincente.

### Risultati di validazione (non confrontare con il test come se fosse un'ulteriore selezione)

| Modello | Media numeri corretti | Log-loss |
|---|---:|---:|
| Frequenze espansive | 0.3750 | 0.244929 |
| Encoder casuale congelato + Ridge | 0.3969 | 0.244922 |
| Encoder mascherato congelato + Ridge | 0.3906 | 0.244925 |
| GRU diretta | 0.4531 | 0.245089 |
| GRU preaddestrata + fine-tuning | 0.4281 | 0.245195 |

Scelte di selezione: Ridge encoder casuale alpha=100, scala=1; Ridge encoder mascherato alpha=1000, scala=2; epoca selezionata GRU diretta=3, GRU con pretraining=2; smoothing frequenze storiche=20000. Il seed è 20261118.

### Riproducibilità, limitazioni e decisioni
- Codice integrale: `compute_v16.py` (include dati, pretraining, due probe, train/fine-tuning, baseline, test, CIs e grafici). Richiede Python, NumPy, Pandas, PyTorch, scikit-learn, SciPy e Matplotlib. Esecuzione: `OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 OMP_NUM_THREADS=2 python compute_v16.py`.
- `superenalotto_encoder_mascherato_v16.pt`, `superenalotto_pretrained_finetuned_v16.pt`, `superenalotto_direct_gru_v16.pt`: checkpoint PyTorch dei modelli principali.
- `superenalotto_previsioni_test_v16.csv`: dati delle 1.049 estrazioni di test, sestine proposte, corrette e log-loss per ogni modello.
- `superenalotto_metriche_v16.json`: iperparametri selezionati, curve train/val, log-loss e Brier, intervalli bootstrap, checksum e limiti.
- `superenalotto_modelli_generativi_v16.png`: confronto previsioni test e validazione; `superenalotto_pretraining_mascherato_v16.png`: progressione del pretraining rispetto all'ipotesi uniforme.
- La ricostruzione di dati già osservati può essere buona per ragioni diverse dalla capacità di ricostruire il generatore. Il modello non ricava lo stato fisico nascosto di una macchina pneumaticamente caotica. Test su modello più grande o più piccolo potrebbero differire, ma ogni configurazione aggiuntiva espone al rischio di overfitting sulle stesse estrazioni pubbliche.
- **Nessun nuovo filtro F15** e nessuna modifica ai risultati precedenti F01–F14. Prima di dichiarare un vantaggio predittivo servirebbe una serie di estrazioni future non ancora utilizzate nella ricerca, con protocollo preregistrato.

### Registro aggiornamenti

- **v16:** pretraining auto-supervisionato con mascheramento di intere sestine nella sequenza a 90 colonne e 100 passi; verifica dello stato latente, probe congelati, GRU diretta e fine-tuning in confronto a baseline uniforme e frequenze storiche su test cronologico. Nessun segnale predittivo affidabile.


---

## Esperimento v17 — Generatore vincolato di sestine e punteggi parziali

### Obiettivo e distinzione delle metriche
Il nuovo obiettivo primario è **predire la sestina intera**. Per non ridurre il monitoraggio a un successo praticamente mai osservabile, registriamo separatamente quanti numeri vengono indovinati (0–6), la quota di 3+, il punteggio parziale ponderato e la **negative log-likelihood dell'intera sestina** (criterio probabilistico proprio). Non si ottimizzano i parametri usando il test finale.

La funzione di utilità, **convenzione sperimentale non equivalente ai premi monetari**, è: `R(0)=0`, `R(1)=0,001`, `R(2)=0,01`, `R(3)=1`, `R(4)=20`, `R(5)=400`, `R(6)=10.000`.
Il salto da 2 a 3 è di 100×; da 3 in poi i pesi crescono in modo marcato. La categoria **2** del SuperEnalotto dà comunque diritto a un premio, secondo il sito ufficiale: https://www.superenalotto.it/quanto-si-vince . La tabella qui misura priorità di ricerca, non importi di vincita.

### Probabilità teoriche dei risultati parziali
Con una sestina proposta indipendente e uniforme e una sestina vincente uniforme,
`P(K=k)=C(6,k) C(84,6-k) / C(90,6)`. Questo è il riferimento corretto anche quando valorizziamo 3, 4, 5 e 6 successi.

| K corrette | Probabilità | Valore atteso su 1.049 test | Punteggio R(K) |
|---:|---:|---:|---:|
| 0 | 0.652862179 | 684.85243 | 0 |
| 1 | 0.2975068157 | 312.08465 | 0.001 |
| 2 | 0.04648543996 | 48.76323 | 0.01 |
| 3 | 0.003060769709 | 3.21075 | 1 |
| 4 | 8.39845347e-05 | 0.08810 | 20 |
| 5 | 8.094894911e-07 | 0.00085 | 400 |
| 6 | 1.606129943e-09 | 0.00000 | 10000 |

- P(K>=3) teorica = **0.31456%**, circa **3.30** eventi in 1049 estrazioni.
- Utilità media teorica con scelta casuale = **0.00584268** punti/estrazione.
- Eventi con 4+ sono troppo rari per stimarne con precisione la frequenza su ~1000 test. Perciò un aumento isolato di 3+ non dimostra un modello del generatore.

### Distribuzione generativa realmente vincolata
Si codificano **100 estrazioni precedenti** come vettori binari di lunghezza 90. Una **GRU causale** produce uno stato latente di 24 dimensioni e 90 logits `a_i`. La rete descrive direttamente **una distribuzione su tutte le 622.614.630 sestine non ordinate e senza ripetizioni**:

`P(S | storia) = exp(sum_{i in S} a_i) / e_6(exp(a_1), ..., exp(a_90))`, per `|S|=6`, dove `e_6` è il sesto polinomio simmetrico elementare calcolato esattamente con programmazione dinamica (O(90·6) operazioni per esempio).

Con logits tutti uguali, il modello torna esattamente alla distribuzione uniforme su 6 numeri distinti. Il set più probabile è formato dai sei pesi maggiori, ma il codice include anche un **campionatore esatto** dalla distribuzione, tramite DP sui coefficienti di suffisso. Le dipendenze fra inclusioni sono imposte dal vincolo 6/90; il modello di prodotto di pesi **non** rappresenta interazioni arbitrarie fra coppie o gruppi di numeri: servirà un modello più espressivo solo se questa baseline presenta evidenza positiva.

È possibile calcolare anche **l'utilità attesa esatta** della distribuzione, dato il risultato reale, senza campionare milioni di sestine: si separano i sei pesi relativi ai numeri vincenti dagli altri 84 e si combina `e_k(6 vincenti) · e_(6-k)(84 non vincenti)`; il peso di ogni k è diviso per `e_6(90 numeri)`.

### Addestramento, controlli e limiti
- Dati: solo estrazioni dal luglio 2009; finestra di 100 estrazioni. Training 1.400 esempi, validazione 320, test 1.049 (2021-03-30 — 2026-10-31); medesima suddivisione della versione 16 per confronto.
- **Set-GRU (likelihood)**: si minimizza la NLL esatta del set osservato.
- **Set-GRU (reward-aware)**: NLL + termine ausiliario che massimizza l'utilità attesa normalizzata rispetto al riferimento casuale, con peso prefissato `0,05`. Non si tratta di assegnare il premio reale durante l'addestramento.
- AdamW lr=0,001, weight decay=0,015, batch=128, massimo 18 epoche, stop dopo 4 senza miglioramento. Selezione della singola epoca **solo tramite NLL di validazione**. Il peso reward-aware è prefissato prima di consultare il test.
- Baseline uniforme e baseline di frequenze storiche causali (smoothing 50 estrazioni). Per la **baseline frequenze**, la sestina proposta deriva sempre dai sei numeri più frequenti dello storico disponibile; la temperatura probabilistica per la NLL è invece selezionata in validazione e può essere zero. La distinzione fra *ranking* e *calibrazione* evita di trasformare una temperatura zero nella previsione fittizia dei numeri 1–6. La sestina uniforme del confronto empirico è campionata con seed fisso, non scelta retroattivamente.
- **Riserva essenziale**: le estrazioni del 2021–2026 sono state utilizzate nei precedenti studi v14–v16. Non si tratta quindi di un nuovo test esterno mai esplorato; sono indispensabili previsioni su estrazioni future per convalidare un eventuale vantaggio.

### Risultati sul test cronologico (1.049 estrazioni)

| Modello | Media corrette | Corrette totali | 3+ | 4+ | 5+ | 6 | Utilità R media | NLL set (minore meglio) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Uniforme | 0.4194 | 440 | 0 | 0 | 0 | 0 | 0.000869 | 20.249438 |
| Frequenze storiche | 0.4204 | 441 | 3 | 0 | 0 | 0 | 0.003691 | 20.249438 |
| Set-GRU (likelihood) | 0.3918 | 411 | 4 | 0 | 0 | 0 | 0.004582 | 20.251564 |
| Set-GRU (reward-aware) | 0.3870 | 406 | 1 | 0 | 0 | 0 | 0.001688 | 20.250211 |

Uniforme teorico: **0,4** numeri indovinati in media, **0.005843** punti/estrazione e NLL esatta **20.249438**. La baseline casuale empirica usa una sequenza campionata indipendentemente (non deve necessariamente realizzare esattamente 0,4).

### Variabilità della baseline casuale (3.000 repliche da 1.049 estrazioni)
- Media numeri corretti: intervallo centrale 95% **0.3632–0.4366**.
- Numero di eventi con **3 o più**: intervallo centrale 95% **0–7**.
- Utilità media: intervallo centrale 95% **0.00082–0.02366** punti.
Questi intervalli descrivono la dispersione del caso: **non sono intervalli di incertezza sulle capacità dei modelli**.

### Esito della validazione e stato latente

- Set-GRU (likelihood): epoca selezionata **1**, NLL validazione **20.248775**.
- Set-GRU (reward-aware): epoca selezionata **2**, NLL validazione **20.250228**.
- Frequenze storiche: intensità selezionata **0.0** sulla validazione.
- Set-GRU (likelihood): similarità coseno fra stati latenti successivi **0.7246** vs coppie permutate **0.4630**. La grande somiglianza fra finestre consecutive deriva anche dalle 99/100 estrazioni condivise: non è, da sola, una struttura predittiva.
- Set-GRU (reward-aware): similarità coseno fra stati latenti successivi **0.7148** vs coppie permutate **0.4480**. La grande somiglianza fra finestre consecutive deriva anche dalle 99/100 estrazioni condivise: non è, da sola, una struttura predittiva.

### Artefatti e riproducibilità
- `compute_v17.py`: codice completo, loss normalizzata esatta, utility-aware, campionatore vincolato, metriche, addestramento e verifica.
- `superenalotto_previsioni_test_v17.csv`: una riga per estrazione, sestine proposte, numero di successi, utilità e NLL esatta per ciascun metodo.
- `superenalotto_metriche_v17.json`: impostazioni, curva di validazione, distribuzioni, stato latente, valori teorici, checksum e scelte degli iperparametri.
- `superenalotto_set_gru_likelihood_v17.pt` e `superenalotto_set_gru_reward_v17.pt`: pesi dei due modelli con seed.
- `superenalotto_punteggi_parziali_v17.png`: istogramma degli esiti da 0 a 6; `superenalotto_set_generator_validazione_v17.png`: NLL di validazione per epoca.
- **F01–F14 invariati.** Nessun nuovo filtro aggiunto; si tratta di un nuovo esperimento di generazione e valutazione.

### Registro aggiornamenti
- **v17:** modello generativo vincolato e non ordinato delle sestine 6/90 con normalizzazione esatta; NLL e funzione di utilità che premia 3–6 corrispondenze, confronto con baseline uniforme e frequenze storiche e diagnostica dello stato latente.


---

## Esperimento v18 — Generatore autoregressivo di sestine con interazioni condizionali

### Domanda e progettazione
Partendo dalle 100 estrazioni precedenti (90 variabili binarie per estrazione), la rete produce una **sestina non ordinata di sei numeri distinti**, modellandola tramite una rappresentazione **canonica crescente** per consentire una fattorizzazione autoregressiva della probabilità. Le posizioni crescenti sono una *codifica*, non la sequenza fisica delle sfere. A differenza di v17, ciascuna probabilità condizionale dipende anche dai numeri precedenti del set, quindi può esprimere dipendenze interne oltre ai semplici pesi marginali. Non occorre enumerare 622.614.630 sestine.

### Distribuzione e baseline matematica esatta
Siano `x1 < x2 < ... < x6` i sei numeri (indici da 0 a 89) e sia `h_t` lo stato latente della finestra precedente. Si fattorizza:

`P({x1,...,x6}|h_t) = ∏_{s=1}^6 P(x_s | x_1,...,x_(s-1),h_t)`.

Al passo `s` sono ammessi soltanto numeri maggiori del precedente e che lascino spazio a quelli successivi. La distribuzione **uniforme sulle sestine** non ha, in generale, probabilità condizionali uniformi sulle posizioni crescenti: il peso teorico del candidato (indice base zero) `j` al passo `s` (indice base zero) è `C(89−j,5−s)`. Il generatore aggiunge a `log C(89−j,5−s)` un correttivo neurale che dipende da storia e prefisso, poi normalizza sulle posizioni ammesse. Se tutti i correttivi sono zero, la probabilità di ciascuna sestina è *esattamente* `1 / C(90,6)`.

Il prefisso è la somma degli embedding dei numeri già scelti; lo stato storico deriva da una GRU di 32 dimensioni. Sono confrontate due reti: **AR senza storia**, che impara soltanto dipendenze interne alle sestine, e **AR con storia**, che può anche apprendere relazioni temporali. I 14 filtri esistenti non vengono inseriti nel generatore né modificati.

### Protocollo
- Archivio: 2.869 estrazioni dal 02/07/2009 al 31/10/2026; matrice binaria 90 colonne.
- Finestra: 100 estrazioni anteriori al bersaglio.
- Addestramento: 1.400 esempi; validazione cronologica: 320; test cronologico: 1.049 (dal 30/03/2021 al 31/10/2026); stessi confini di v17.
- AdamW, learning rate `0,0006`, weight decay `0,025`, batch `128`, massimo 20 epoche, stop dopo 5 senza miglioramento; selezione **solo** mediante NLL della sestina sulla validazione.
- La previsione concreta è formata dai 6 numeri con maggiore **probabilità marginale di inclusione stimata** tramite 256 sestine campionate dal generatore (seed fissato a priori). Questa è una decisione approssimata per il numero atteso di corrispondenze e **non ottimizza esattamente** il punteggio non lineare R(k).
- La funzione di valutazione parziale è quella definita in v17: `R=[0,0.001,0.01,1,20,400,10000]`. Registriamo frequenze di 0,1,2,3,4,5,6 e utility media; la NLL è il controllo probabilistico principale.

### Validazione e test

| Modello | Epoca selezionata | NLL validazione | Migliora la NLL uniforme? |
|---|---:|---:|---|
| AR senza storia | 1 | 20.248421 | Sì |
| AR con storia | 1 | 20.245050 | Sì |

Baseline uniforme: NLL = **20.249438**.

| Modello | NLL test ↓ | Numeri corretti medi ↑ | Totale corretti | 3+ | 4+ | 5+ | 6 | Punteggio medio R ↑ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Uniforme (campione) | 20.249438 | 0.4194 | 440 | 0 | 0 | 0 | 0 | 0.000869 |
| Frequenze storiche | 20.249438 | 0.4204 | 441 | 3 | 0 | 0 | 0 | 0.003691 |
| Set-GRU v17 (likelihood) | 20.251564 | 0.3918 | 411 | 4 | 0 | 0 | 0 | 0.004582 |
| Set-GRU v17 (reward) | 20.250211 | 0.3870 | 406 | 1 | 0 | 0 | 0 | 0.001688 |
| AR senza storia | 20.249632 | 0.3956 | 415 | 2 | 0 | 0 | 0 | 0.002670 |
| AR con storia | 20.251999 | 0.4214 | 442 | 1 | 0 | 0 | 0 | 0.001753 |

Riferimento casuale teorico: **0,4000** numeri corretti medi; NLL **20.249438**; in 1049 estrazioni sono attesi circa **3.30** risultati con almeno tre numeri corretti; punteggio R teorico **0.005843** a estrazione. I casi 4, 5, 6 sono estremamente rari.

### Confronto abbinato e interpretazione
- **AR con storia rispetto al Set-GRU v17**: Δ numeri corretti medi = +0.0296, IC bootstrap appaiato 95% [-0.0191, +0.0763]; Δ NLL = +0.000434 (negativo sarebbe migliore).
- **AR senza storia rispetto al Set-GRU v17**: Δ numeri corretti medi = +0.0038, IC bootstrap appaiato 95% [-0.0486, +0.0534]; Δ NLL = -0.001933 (negativo sarebbe migliore).
- In validazione, permutando le finestre storiche di input senza permutare i bersagli, la NLL del modello con storia cambia da 20.245050 a 20.245277 (Δ=+0.000227). Questa è una diagnostica di condizionamento, non un test definitivo del processo fisico.
- Similarità coseno degli stati latenti vicini: 0.7375; coppie in ordine casuale: 0.4771. Le finestre consecutive condividono il 99% degli input: una similarità elevata **non** dimostra prevedibilità.


### Validità, limiti e registrazione
- Gli esempi, le proposte generate e le estrazioni confrontate sono registrati nel CSV v18; i test automatici verificano ordine strettamente crescente, unicità dei numeri e ritorno esatto alla NLL uniforme quando i correttivi neurali sono nulli.
- Le NLL delle baseline precedenti provengono da `superenalotto_previsioni_test_v17.csv` sulle stesse date e sono confrontate sugli stessi risultati effettivi, non da una nuova ricerca degli iperparametri sul test.
- **Attenzione: il periodo 2021–2026 è già stato consultato nei progetti v14–v17.** I risultati v18 sono esplorativi e non costituiscono convalida indipendente di una strategia di gioco. Un eventuale successo andrebbe verificato con previsioni fissate prima di estrazioni future.
- L'ordine canonico non deve essere confuso con l'ordine fisico di uscita. Lo stato meccanico non è identificabile automaticamente da un archivio di sestine.

### Artefatti v18
- `compute_v18.py` — addestramento e valutazione riproducibili, con seed e vincolo combinatorio.
- `superenalotto_metriche_v18.json` — parametri, NLL per epoca, metriche, diagnostiche, controlli e avvertenze.
- `superenalotto_previsioni_test_v18.csv` — una riga per ciascuna delle 1.049 estrazioni, sestina vera, proposta, match, premio sperimentale e NLL.
- `superenalotto_ar_history_v18.pt`, `superenalotto_ar_static_v18.pt` — pesi salvati.
- `superenalotto_autoregressivo_confronto_v18.png`, `superenalotto_autoregressivo_validazione_v18.png` — grafici.
- **F01–F14 invariati**, nessuna selezione di combinazioni sulla base del test futuro.

### Registro delle versioni
- **v18:** primo generatore autoregressivo di sestine non ordinate con dipendenze dal prefisso e dalla storia; confronto con modello senza storia, baseline e Set-GRU v17; punteggi parziali e controlli di validità.


---

## Esperimento v19 — Generatore autoregressivo con 14 filtri deterministici (rigidi e morbidi)

### Obiettivo e principio di confronto
Integrare F01–F14 nella distribuzione autoregressiva v18 sulle **sestine non ordinate di sei numeri distinti**. La rete GRU con contesto 100×90 è recuperata senza ulteriore addestramento dal checkpoint `superenalotto_ar_history_v18.pt`. Il confronto comprende:

- **M0**: generatore v18 libero, proposta pubblicata in v18 (sei probabilità marginali di inclusione più alte). Per diagnostica si ricalcolano anche proposte M0 da un nuovo campione Monte Carlo condiviso con M1/M2.
- **M1**: generatore vincolato duro. Si estraggono sestine dalla distribuzione esatta v18, rifiutando quelle che violano almeno un filtro; un campione così accettato proviene **esattamente** da `P_v18(S | F01...F14)`. Tra i candidati validi campionati si sceglie quello con la maggior somma delle probabilità marginali condizionate stimate dai campioni. Ogni proposta M1 rispetta necessariamente tutti i filtri. **Non è stato implementato un mascheramento a ogni token con controllo completo della fattibilità: si usa rigetto di sestine complete, equivalente come distribuzione condizionata ma non come algoritmo operativo.**
- **M2**: generatore ibrido non vincolato, con 14 penalità apprese. `Q_lambda(S)=P_v18(S) exp[-Σ_{j=1}^{14} λ_j 1(F_j fallisce)] / Z_t(λ)`, con `λ_j≥0`. I 14 coefficienti sono calibrati **solo sulla validazione cronologica**, minimizzando la log-loss con regolarizzazione `0,02 Σ λ_j²` e normalizzazione Monte Carlo. La proposta M2 è la sestina dei sei maggiori margini d'inclusione stimati dalla distribuzione ripesata.
- **Casuale vincolato**: sestina uniforme casuale 6-su-90 ottenuta con rigetto dei candidati che non passano F01–F14. È il riferimento appropriato per M1.

**Non** è stato riaddestrato l'encoder sulla funzione di premio: i punteggi `R=[0, 0.001, 0.01, 1, 20, 400, 10000]` vengono valutati a posteriori. È intenzionale: la log-loss della sestina è una metrica propria, mentre il punteggio rarefatto per 4–6 corretti può essere sfruttato solo con enormi campioni o una valutazione fuori campione lunga.

### Campione, fonti dei vincoli, rischio di leakage
La divisione temporale è **identica a v18**: 1.400 esempi per l'addestramento del generatore (già compiuto), 320 per calibrazione delle penalità e 1.049 per confronto; finestra 100. La calibrazione è separata dal test, ma **il test 2021–2026 è già stato ripetutamente usato per progettare gli esperimenti precedenti**, dunque l'intera analisi è *esplorativa*. I ritardi di ciascun numero e l'insieme delle sestine già estratte sono calcolati **prima** della sestina target, sulla storia completa disponibile fino a quel momento.

Consideriamo **due regimi paralleli**:

1. **Filtri fissi originali** — F01–F14 esattamente con gli intervalli delle versioni v03/v05/v06. Tuttavia F03–F14 sono stati stimati sull'intero archivio storico, **incluso il periodo di test**: perciò questo confronto non è una verifica priva di leakage.
2. **Filtri ricalibrati prima della validazione** — stesso significato dei 14 vincoli, ma gli intervalli minimi al 95% delle sei posizioni numeriche e dei sei ritardi ordinati sono stimati solo sulle **1.500 estrazioni post-2009 anteriori al 31/01/2019**, poi congelati per validazione e test. È una sensibilità più corretta rispetto alla stima retrospettiva dei limiti, pur rimanendo l'intera indagine esplorativa per la riutilizzazione del test e del modello v18.

| Filtro | Intervalli originali | Intervalli ricalibrati prima della validazione |
|---|---|---|
| F01 | 8–81 (massimo ritardo) | 8–81 (massimo ritardo) |
| F02 | Sestina non già uscita | Sestina non già uscita |
| F03 | 1–36 | 1–36 |
| F04 | 3–54 | 2–51 |
| F05 | 10–68 | 9–66 |
| F06 | 25–81 | 24–79 |
| F07 | 38–87 | 38–87 |
| F08 | 57–90 | 56–90 |
| F09 | 1–7 | 1–7 |
| F10 | 1–13 | 1–13 |
| F11 | 2–19 | 2–19 |
| F12 | 4–28 | 4–28 |
| F13 | 5–40 | 6–41 |
| F14 | 7–69 | 7–68 |


### Protocollo numerico
- Ciascuna estrazione di test produce **512 campioni autoregressivi** con seed fisso; anche la validazione usa 512 campioni per estrazione. Il campione base è condiviso tra le varianti; nella baseline vincolata si usa invece un campionamento uniforme 6-su-90 con rigetto.
- Per la M1 la normalizzazione esatta del modello condizionato **non** viene enumerata; l'accettazione della distribuzione per rigetto è matematicamente esatta, mentre le marginali usate per decidere la sestina sono approssimate da Monte Carlo.
- Per la M2 la normalizzazione `Z_t` e la NLL sono **stime Monte Carlo**. Errori della normalizzazione di piccola entità sono possibili.
- M1 attribuisce probabilità **zero** a una vincente che violi uno qualsiasi dei filtri, quindi la NLL media sui bersagli completi è **infinita** quando vi siano violazioni. Non si deve presentare soltanto la NLL condizionata alle vincitrici ammesse: sarebbe una selezione a posteriori.
- Si registrano numeri corretti medi, frequenza dei casi 3+, punteggio ponderato e proporzioni ammesse. La distribuzione casuale teorica prevede 0,4 numeri corretti medi per un biglietto casuale e circa 3,30 casi 3+ in 1.049 estrazioni.

### Risultati sul test cronologico (1.049 estrazioni; confronto esplorativo)

#### Originali F01–F14
- Vincenti che rispettano tutti i filtri: **666/1049 (63.49%)**.
- Frazione dei campioni v18 ammessi dai filtri: **65.07%** in media; minima **48.05%**.
- Quota media esatta di tutte le 622.614.630 sestine ammesse, dal contatore combinatorio v06: **65.02%**.
- Penalità non nulle dopo validazione: **8** su 14; differenza media di NLL M2−M0 (approssimata): **+0.005356**.

| Modello | Numeri corretti medi | Totale | Casi 3+ | Casi 4+ | Punteggio medio R |
|---|---:|---:|---:|---:|---:|
| **M0 v18 (riferimento)** | 0.4214 | 442 | 1 | 0 | 0.001753 |
| M0_ricalcolato | 0.3966 | 416 | 3 | 0 | 0.003606 |
| Casuale_vincolato | 0.4128 | 433 | 4 | 0 | 0.004588 |
| M1_rigido | 0.3937 | 413 | 3 | 0 | 0.003664 |
| M2_soft | 0.3861 | 405 | 3 | 0 | 0.003603 |

IC bootstrap appaiato 95% sulla differenza dei numeri corretti medi vs M0 v18: M1 **[-0.0801, +0.0239]**, M2 **[-0.0868, +0.0153]**.

Coefficienti appresi con la sola validazione (zero = nessuna penalizzazione):

| Filtro | λ | Tasso passaggio vincente, validazione | Tasso passaggio vincente, test |
|---|---:|---:|---:|
| F01 | 0.00000 | 97.50% | 97.43% |
| F02 | 0.00030 | 100.00% | 100.00% |
| F03 | 0.00000 | 95.62% | 95.23% |
| F04 | 0.18322 | 97.50% | 95.23% |
| F05 | 0.13438 | 97.19% | 95.42% |
| F06 | 0.18658 | 96.56% | 94.38% |
| F07 | 0.02690 | 95.62% | 94.76% |
| F08 | 0.07015 | 95.62% | 95.33% |
| F09 | 0.00000 | 93.44% | 95.14% |
| F10 | 0.00000 | 95.62% | 94.57% |
| F11 | 0.04328 | 95.94% | 94.38% |
| F12 | 0.00000 | 94.69% | 95.42% |
| F13 | 0.00000 | 95.00% | 94.85% |
| F14 | 0.04408 | 95.94% | 94.47% |


#### Ricalibrati pre-validazione
- Vincenti che rispettano tutti i filtri: **658/1049 (62.73%)**.
- Frazione dei campioni v18 ammessi dai filtri: **64.13%** in media; minima **47.46%**.
- Penalità non nulle dopo validazione: **8** su 14; differenza media di NLL M2−M0 (approssimata): **+0.008490**.

| Modello | Numeri corretti medi | Totale | Casi 3+ | Casi 4+ | Punteggio medio R |
|---|---:|---:|---:|---:|---:|
| **M0 v18 (riferimento)** | 0.4214 | 442 | 1 | 0 | 0.001753 |
| M0_ricalcolato | 0.3966 | 416 | 3 | 0 | 0.003606 |
| Casuale_vincolato | 0.4147 | 435 | 3 | 0 | 0.003647 |
| M1_rigido | 0.4166 | 437 | 3 | 0 | 0.003687 |
| M2_soft | 0.3823 | 401 | 3 | 0 | 0.003592 |

IC bootstrap appaiato 95% sulla differenza dei numeri corretti medi vs M0 v18: M1 **[-0.0572, +0.0448]**, M2 **[-0.0915, +0.0124]**.

Coefficienti appresi con la sola validazione (zero = nessuna penalizzazione):

| Filtro | λ | Tasso passaggio vincente, validazione | Tasso passaggio vincente, test |
|---|---:|---:|---:|
| F01 | 0.00000 | 97.50% | 97.43% |
| F02 | 0.00028 | 100.00% | 100.00% |
| F03 | 0.00000 | 95.62% | 95.23% |
| F04 | 0.18303 | 96.56% | 93.23% |
| F05 | 0.16614 | 96.88% | 94.09% |
| F06 | 0.22534 | 96.56% | 94.18% |
| F07 | 0.02977 | 95.62% | 94.76% |
| F08 | 0.04629 | 95.94% | 96.00% |
| F09 | 0.00000 | 93.44% | 95.14% |
| F10 | 0.00000 | 95.62% | 94.57% |
| F11 | 0.04224 | 95.94% | 94.38% |
| F12 | 0.00000 | 94.69% | 95.42% |
| F13 | 0.00000 | 94.69% | 95.04% |
| F14 | 0.07400 | 95.94% | 94.09% |


### Interpretazione e limiti
- Una regola deterministica di selezione non è una legge del generatore. Vincolare duramente ai 14 filtri esclude a priori una parte reale delle sestine vincenti. Il confronto prioritario di M1 è con una baseline casuale assoggettata agli stessi vincoli.
- Se le λ della M2 tendono a zero, la validazione **non** giustifica di penalizzare quei filtri: si tratta di un risultato scientificamente utile, non di un difetto del modello.
- I risultati da una singola griglia di 1.049 sestine non certificano miglioramenti nei rarissimi eventi 4, 5 e 6. Anche le differenze nei casi 3+ sono estremamente rumorose.
- Due limiti distinti: (1) intervalli originali F03–F14 stimati retrospettivamente usando il futuro; (2) periodo 2021–2026 già più volte ispezionato durante lo sviluppo dei modelli. Il regime pre-validazione corregge (1) soltanto, non (2). Per un test realmente nuovo, fissare modello e iperparametri prima di nuove estrazioni.
- Il modello fisico di estrazione non è identificato da questi risultati: le reti descrivono distribuzioni di sestine, non lo stato delle sfere o della macchina.

### Riproducibilità e artefatti v19
- `compute_v19.py`: carica il checkpoint v18, campiona e verifica la validità delle sestine, ottimizza 14 λ su sola validazione, genera le tabelle/grafici; seed fissati.
- `superenalotto_previsioni_test_v19.csv`: una riga per estrazione con target, tutte le proposte, hit, score, accettazione e NLL stimata.
- `superenalotto_calibrazione_filtri_v19.csv`: penalità, frequenze di passaggio delle singole regole, confronto validazione/test.
- `superenalotto_metriche_v19.json`: limiti, impostazioni, numeri e avvertenze in formato strutturato.
- `superenalotto_confronto_ibrido_v19.png`: confronto visivo M0, M1, M2 e baseline vincolata.
- `superenalotto_esperimento_v19_bundle.zip`: archivio autonomo con input, checkpoint congelato, codice, documentazione e risultati.

### Registro delle versioni
- **v19**: integrazione dei filtri deterministici F01–F14 nel generatore autoregressivo v18 con condizionamento rigido e 14 penalità morbide regolarizzate; confronto su filtri originali e limiti preregistrati prima della validazione; distinzione fra descrizione retrospettiva e test indipendente.
