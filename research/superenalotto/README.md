# SuperEnalotto — Archivio completo v01–v24

Questa cartella contiene **tutte le 144 voci estratte** dal pacchetto `superenalotto_export_completo_v01-v24_20261103.zip` creato nella conversazione ChatGPT del 3 novembre 2026.

I file sono pubblicati singolarmente, senza modifiche byte-per-byte: ogni Git blob coincide con il checksum Git registrato nel file `MANIFEST_GIT_BLOBS.json`; è incluso anche il manifesto originale `MANIFEST_SHA256.csv` contenuto nello ZIP.

Il pacchetto ZIP originale (11.597.232 byte, SHA-256 `3fb68ee363475762229ed59b780edbd5cfa917dba54227abdec8461b25477ca6`) rimane scaricabile dalla conversazione; **il pacchetto ZIP intero non è duplicato qui**, perché i suoi 144 membri sono già pubblicati individualmente.

## Come riprendere la ricerca

- `superenalotto_analisi_filtri_v24.md`: registro cumulativo delle versioni v01–v24 e stato dei filtri F01–F17.
- `estrazioni_con_ritardi.csv`: sorgente originale, 4.294 estrazioni.
- `superenalotto_prompt_ripresa_dopo_v24.md` o `PROMPT_RIPRESA.md`: istruzioni per una nuova chat.
- `compute_v24.py` e altri script `compute_v*.py`: elaborazioni riproducibili.
- Dataset CSV, grafici PNG, modelli neurali .pt, risultati JSON, binari, DOCX e archivi ZIP dei singoli esperimenti: tutti presenti in questa cartella.

### Note metodologiche

I filtri al 99% sono retrospettivi. I numeri di combinazioni residue delle versioni 23–24 sono stime Monte Carlo; le verifiche sulle sestine storiche sono esatte. Il periodo di test 2021–2026 è stato riutilizzato nei modelli neurali e non è un test indipendente per esperimenti successivi.

Il sorgente originale `compute_v13.py` non era recuperabile; l'archivio include `compute_v13_RICOSTRUITO.py`, denominato esplicitamente come ricostruzione.
