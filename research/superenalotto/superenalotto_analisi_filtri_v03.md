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
