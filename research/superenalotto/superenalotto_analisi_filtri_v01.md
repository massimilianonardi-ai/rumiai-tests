# SuperEnalotto — Registro di analisi dei filtri

**Versione:** 1  
**Aggiornamento:** 2 novembre 2026  
**Fonte:** `estrazioni_con_ritardi.csv`  
**Filtri attivi:** F01

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

## 4. Interpretazione e cautele

Il filtro è poco selettivo: elimina mediamente circa il **2,44%** delle sestine e conserva il **97,47%** delle sestine effettivamente estratte. La copertura osservata è leggermente inferiore al riferimento casuale (**97,56%**); questo risultato **non dimostra un vantaggio predittivo**.

La quantità di combinazioni residue varia a ogni estrazione: la media storica non è il conteggio valido per una data specifica. Per confrontare filtri successivi bisogna usare lo stesso periodo di verifica oppure dichiarare esplicitamente eventuali differenze.

## 5. Registro delle modifiche

| Versione | Data | Modifica |
|---|---|---|
| v01 | 2026-11-02 | Definito protocollo storico e applicato F01: `8 <= ritardo massimo <= 81`. |

## 6. Stato e riproducibilità

**Filtri attivi:** F01. Nessun altro filtro applicato.

Per riprodurre i risultati: ordinare le estrazioni in senso cronologico, aggiornare l'ultima uscita di ciascuno dei 90 numeri **dopo** ogni verifica, applicare F01 alla sestina vincente corrente e calcolare il numero di combinazioni residue con la formula del §3. Aggregare i risultati sulle 4.226 estrazioni ammissibili.

Per ogni modifica futura, aggiornare questo registro, mantenere la storia delle regole e ricalcolare riduzione, copertura e riferimento casuale dell'**intersezione di tutti i filtri attivi**.
