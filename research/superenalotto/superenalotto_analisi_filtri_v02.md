# SuperEnalotto — Registro di analisi dei filtri

**Versione:** 2  
**Aggiornamento:** 2 novembre 2026  
**Fonte:** `estrazioni_con_ritardi.csv`  
**Filtri attivi:** F01, F02

## 1. Obiettivo e protocollo

Si parte dall'universo delle **C(90,6) = 622.614.630** sestine possibili. Per ogni estrazione storica, si calcolano i ritardi usando **soltanto le estrazioni precedenti**; si applicano i filtri e si verifica se la sestina vincente della nuova estrazione appartiene alle combinazioni residue.

Per ciascun filtro, e per la loro intersezione, registriamo:

- **Riduzione:** quota di combinazioni eliminate.
- **Copertura:** quota di estrazioni per cui la sestina vincente supera i filtri.
- **Riferimento casuale:** quota media di combinazioni residue, cioè copertura attesa scegliendo casualmente altrettante combinazioni a ogni estrazione.
- **Efficienza relativa:** copertura osservata divisa per copertura casuale attesa.

## 2. Dati e definizioni

- File: `estrazioni_con_ritardi.csv`, **4.294 estrazioni** dal **03/12/1997** al **31/10/2026**.
- Si ordinano le righe cronologicamente. Le colonne `n1`…`n6` identificano i numeri estratti; i ritardi vengono **ricalcolati** dalle estrazioni precedenti. Non si assume che `ritardo_1`…`ritardo_6` corrispondano nell'ordine a `n1`…`n6`.
- Se un numero è stato estratto l'ultima volta alla posizione storica `j`, il suo ritardo immediatamente prima dell'estrazione `i` è `i − j` (prima estrazione successiva: ritardo 1).
- Si iniziano le verifiche soltanto quando tutti i numeri 1…90 sono comparsi almeno una volta: **4.226 estrazioni**, dal **29/07/1998** al **31/10/2026**.

## 3. Filtro F01 — ritardo massimo tra 8 e 81

Per una sestina candidata `S`, conservare la combinazione se:

```text
8 <= max(ritardo(n) per n in S) <= 81
```

Gli estremi sono inclusi. I ritardi sono calcolati **prima** dell'estrazione da verificare.

### Conteggio senza enumerazione completa

Per ciascuna data:

- `A` = numero di numeri con ritardo `<= 81`;
- `B` = numero di numeri con ritardo `< 8`.

Le sestine ammesse sono esattamente:

```text
residue = C(A, 6) - C(B, 6)
```

con `C(n,6) = 0` se `n < 6`. La formula conta le sestine i cui sei numeri hanno ritardo al massimo 81, escludendo quelle in cui **tutti** hanno ritardo inferiore a 8.

### Risultati della verifica storica

| Indicatore | Valore |
|---|---:|
| Universo iniziale | 622.614.630 |
| Estrazioni testate | 4.226 |
| Sestine vincenti conservate | 4.119 |
| Sestine vincenti escluse | 107 |
| Escluse per massimo < 8 | 11 |
| Escluse per massimo > 81 | 96 |
| **Copertura empirica** | **97,4681%** |
| Sestine residue medie | 607.400.777,64 |
| Sestine eliminate mediamente | 15.213.852,36 |
| **Riduzione media** | **2,4435%** |
| Copertura casuale attesa | 97,5565% |
| Efficienza relativa | 0,99909 |

## 4. Filtro F02 — escludere sestine già estratte

Per ogni estrazione storica `i`, si escludono le sestine già uscite nelle estrazioni `0..i-1`, senza utilizzare la sestina corrente né quelle future. Il filtro è cumulativo con F01.

### Formula esatta dell’intersezione

Sia `H_i` l’insieme delle sestine distinte estratte prima di `i`, e `D_i(n)` il ritardo del numero `n` prima di `i`:

```text
F01_i = C(A_i, 6) - C(B_i, 6)
E_i = numero di S in H_i tali che 8 <= max(D_i(n) per n in S) <= 81
(F01 ∩ F02)_i = F01_i - E_i
```

`E_i` considera **solo** le sestine storiche che supererebbero F01 alla data `i`; non è corretto sottrarre indistintamente tutte le estrazioni precedenti. Le ripetizioni di una stessa sestina storica, se presenti, devono essere contate una sola volta nell’insieme `H_i`.

### Risultati sul medesimo campione di 4.226 estrazioni

| Indicatore | Solo F01 | F01 + F02 |
|---|---:|---:|
| Sestine residue medie | 607.400.777,64 | 607.398.655,89 |
| Sestine eliminate mediamente | 15.213.852,36 | 15.215.974,11 |
| Riduzione media | 2,4435% | 2,4439% |
| Copertura empirica | 4.119 / 4.226 (97,4681%) | 4.119 / 4.226 (97,4681%) |
| Copertura casuale attesa | 97,5565% | 97,5561% |
| Sestine già uscite e ancora ammesse da F01, media | — | 2.121,75 |

- Nell’intero file di 4.294 estrazioni si osservano **4.294 sestine distinte**: nessuna ripetizione esatta.
- F02 esclude mediamente altre **2.121,75** combinazioni rispetto a F01, pari a **0,0003408 punti percentuali** dell’universo.
- Il conteggio delle sestine storiche che soddisfano F01 va da **61 a 4.280** nei test eseguiti.
- Il filtro non perde alcuna sestina vincente ulteriore nel campione, ma l’effetto sulla riduzione è trascurabile. Non implica che le sestine già uscite abbiano probabilità inferiore nelle estrazioni indipendenti.

## 5. Interpretazione e cautele

Il filtro è poco selettivo: elimina mediamente circa il **2,44%** delle sestine e conserva il **97,47%** delle sestine effettivamente estratte. La copertura osservata è leggermente inferiore al riferimento casuale (**97,56%**); questo risultato **non dimostra un vantaggio predittivo**.

La quantità di combinazioni residue varia a ogni estrazione: la media storica non è il conteggio valido per una data specifica. Per confrontare filtri successivi bisogna usare lo stesso periodo di verifica oppure dichiarare esplicitamente eventuali differenze.

## 6. Registro delle modifiche

| Versione | Data | Modifica |
|---|---|---|
| v01 | 2026-11-02 | Definito protocollo storico e applicato F01: `8 <= ritardo massimo <= 81`. |
| v02 | 2026-11-02 | Aggiunto F02: escludere le sestine già estratte; ricalcolata l’intersezione F01 ∩ F02. |

## 7. Stato e riproducibilità

**Filtri attivi:** F01, F02. Nessun altro filtro applicato.

Per riprodurre i risultati: ordinare le estrazioni in senso cronologico; mantenere l’ultima uscita dei 90 numeri e l’insieme delle sestine storiche. **Prima** di inserire la sestina corrente, calcolare i ritardi, contare F01 con la formula del §3, sottrarre le sole sestine già estratte che passano F01 (formula del §4), e verificare se la sestina corrente supera entrambi i filtri. **Dopo** la verifica, aggiornare le ultime uscite e l’insieme storico. Aggregare sulle 4.226 estrazioni ammissibili.

Per ogni modifica futura, aggiornare questo registro, mantenere la storia delle regole e ricalcolare riduzione, copertura e riferimento casuale dell'**intersezione di tutti i filtri attivi**.
