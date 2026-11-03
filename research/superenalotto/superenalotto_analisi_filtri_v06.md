# SuperEnalotto — Analisi cumulativa dei filtri (v05)

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
