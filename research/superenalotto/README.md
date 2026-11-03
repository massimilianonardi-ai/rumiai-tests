# SuperEnalotto — archivio della ricerca, versione 24

Questa directory contiene i materiali essenziali per riprendere l'analisi svolta in ChatGPT fino al **3 novembre 2026**.

## Materiali pubblicati su GitHub
- `superenalotto_analisi_filtri_v24.md`: documento cumulativo v01–v24.
- `estrazioni_con_ritardi.csv`: archivio originale 4.294 estrazioni, conservato con BOM UTF-8 e terminatori CRLF.
- `compute_v24.py`: script dell'analisi più recente.
- `superenalotto_coppie_frequenze_v24.csv`: frequenze delle 4.005 coppie.
- `PROMPT_RIPRESA.md`: istruzioni per riprendere la ricerca.

## Archivio integrale della conversazione
L'archivio integrale scaricabile è **`superenalotto_export_completo_v01-v24_20261103.zip`** (11.597.232 byte, 144 voci incluso manifesto). È stato creato e collegato nella conversazione ChatGPT di origine; **non è presente in questa directory GitHub** perché il connettore qui disponibile non consente l'upload diretto del file ZIP binario.

SHA-256 dell'archivio:
```text
3fb68ee363475762229ed59b780edbd5cfa917dba54227abdec8461b25477ca6
```

Il pacchetto contiene anche i file precedentemente pubblicati (Markdown v01–v24, CSV, PNG, script, modelli e ZIP di singoli esperimenti), più manifest SHA-256. Il file storico originale `compute_v13.py` non era recuperabile: il pacchetto contiene una ricostruzione esplicitamente denominata `compute_v13_RICOSTRUITO.py`.

**Attenzione scientifica:** gli intervalli retrospettivi non costituiscono dati fuori campione; i valori di combinazioni residue v23 e v24 sono stime Monte Carlo; il periodo di test 2021–2026 è stato riutilizzato nei modelli neurali. Non inferire capacità predittiva senza nuovi controlli.
