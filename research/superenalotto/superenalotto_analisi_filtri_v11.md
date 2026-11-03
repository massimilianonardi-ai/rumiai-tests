# SuperEnalotto — Registro cumulativo di filtri e reverse engineering (v11)

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
