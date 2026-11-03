# Prompt per una nuova chat — ripresa SuperEnalotto v24

Riprendi il progetto SuperEnalotto dal documento `superenalotto_analisi_filtri_v24.md` (registro cumulativo v01–v24) e dal file `estrazioni_con_ritardi.csv` (4.294 estrazioni fino al 31/10/2026). Leggi l'intero documento e il codice disponibile, non dedurre numeri da riassunti parziali.

Scopo: identificare, se possibile, il comportamento del sistema estrazionale usando combinatoria, serie temporali e modelli neurali. Non confondere struttura deterministica dei filtri con informazione predittiva. Valutare ogni estrazione utilizzando solo il passato, confrontare la copertura delle sestine vincitrici con la quota di tutte le sestine ammesse, distinguere risultati esatti da stime Monte Carlo, e documentare eventuale leakage dei parametri.

**Filtri attivi F01–F17:**
- F01: massimo ritardo 6–94 (inclusi).
- F02: vieta sestine già estratte, ridondante con F15.
- F03–F08 (numeri in ordine crescente): [1,49], [2,64], [7,76], [16,84], [28,89], [46,90].
- F09–F14 (ritardi ordinati crescentemente): [1,11], [1,18], [1,26], [2,35], [4,53], [6,94]. F14=F01.
- F15: vieta una sestina contenente almeno una cinquina distinta già uscita.
- F16: ammette al massimo **una** quartina distinta già comparsa in una precedente estrazione.
- F17: ogni terzina della sestina può essere comparsa **al massimo quattro volte** nelle estrazioni precedenti.

Risultati v24 su 4.226 valutazioni: 3.804 sestine vincenti conservate, copertura esatta **90,01%**. Combinazioni residue medie **circa 559.465.442**, riduzione **circa 10,14%**, entrambi stimati con Monte Carlo.

Combinatoria esplorata: cinquine 25.764 occorrenze, 25.753 distinte; quartine 64.410 occorrenze, 63.586 distinte; terzine 85.880 occorrenze, 60.885 distinte; coppie 64.410 occorrenze, 4.005 distinte e tutte già osservate, frequenza media 16,08, minimo 5, massimo 33. ESN, GRU, pretraining, modelli vincolati e autoregressivi con input binario 90 e finestra di 100 estrazioni non hanno mostrato un vantaggio predittivo affidabile. Punteggi per 0–6 numeri corretti: 0, 0.001, 0.01, 1, 20, 400, 10000.

**Prossimo esperimento:** analizzare per ogni sestina reale la **frequenza pregressa massima delle sue 15 coppie** e la sua distribuzione; confrontarla con estrazioni casuali indipendenti e storico rimescolato, individuare soglie candidate per F18, valutarne copertura e riduzione dello spazio combinatorio senza attivarlo automaticamente. Esplicitare intervalli di confidenza e limiti. Tutte le analisi storiche sono esplorative, perché i limiti al 99% sono stati calcolati sull'archivio e il test neurale 2021–2026 è già stato riutilizzato.

A **ogni modifica** creare e fornire un nuovo **documento Markdown cumulativo scaricabile** (prossimo v25), oltre a codice e dati riproducibili. Conservare le versioni precedenti e i 17 filtri correnti. Se si lavora in `massimilianonardi-ai/rumiai-tests`, verificare HEAD remoto, non interferire con `tests/` e rispettare le regole del repository. Procedi al prossimo esperimento.
