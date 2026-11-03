# Prompt di ripresa — progetto SuperEnalotto (dopo v24)

Riprendi da zero il contesto del progetto di analisi/reverse engineering del SuperEnalotto usando **i file del pacchetto**: `superenalotto_analisi_filtri_v24.md` è il registro cumulativo autorevole, `estrazioni_con_ritardi.csv` è il dataset di 4.294 estrazioni fino al 31/10/2026; gli script `compute_v*.py`, i CSV di verifica e le metriche JSON consentono di riprodurre gli esperimenti. Leggi prima `README_ARCHIVIO.md` e l'inventario SHA-256; risolvi eventuali discrepanze usando il codice/dati, senza inventare numeri.

## Scopo e metodo
Studiamo le 622.614.630 sestine su 90 numeri. Per ogni estrazione valutabile, calcoliamo i filtri usando *esclusivamente* le precedenti, stimiamo la quota di combinazioni rimaste, e verifichiamo se la sestina vincente è fra le ammissibili. Confrontiamo copertura storica con quota di combinazioni conservate, in modo da non confondere riduzione del numero di candidate con potere predittivo. I limiti statistici ricavati dall'intero archivio creano leakage retrospettivo: non trattare risultati del passato come test realmente fuori campione. Distinguere SEMPRE conteggi esatti e stime Monte Carlo con incertezza. Il test 2021–2026 è stato riutilizzato molte volte; è esplorativo.

## Filtri attivi al termine della versione 24 (17 filtri)
- F01: ritardo massimo della sestina fra 6 e 94 inclusi.
- F02: escludere sestine già comparse; attualmente ridondante con F15.
- F03–F08: sei numeri ordinati, rispettivamente nei range **[1,49], [2,64], [7,76], [16,84], [28,89], [46,90]**.
- F09–F14: sei ritardi ordinati crescentemente, rispettivamente **[1,11], [1,18], [1,26], [2,35], [4,53], [6,94]**. F14 è identico a F01.
- F15: escludere la sestina se contiene una qualsiasi cinquina distinta già comparsa in estrazioni precedenti.
- F16: una sestina può contenere AL MASSIMO UNA quartina distinta già comparsa prima. Eventuali ripetizioni della stessa quartina contano una sola volta.
- F17: ogni terzina contenuta nella sestina può essere apparsa al massimo QUATTRO volte nelle estrazioni precedenti; se ce n'è una con 5 o più ricorrenze pregresse, scartare la sestina.

Con F01–F17, sulle 4.226 estrazioni valutabili: **3.804 sestine vincenti conservate, copertura 90,01%**. Combinazioni residue medie **circa 559.465.442**, riduzione **circa 10,14%**, QUESTI ultimi due valori sono stime Monte Carlo (non conteggi esatti). Tutti i limiti al 99% sono stati estratti storicamente; la valutazione è descrittiva.

## Analisi combinatorie già effettuate
- Cinquine: 25.764 occorrenze da 4.294 estrazioni; 25.753 distinte, 11 con ricomparsa; F15 attivato.
- Quartine: 64.410 occorrenze, 63.586 distinte; ricomparse comuni, F16 al massimo una quartina già vista.
- Terzine: 85.880 occorrenze, 60.885 distinte; massimo storico di frequenza 6; F17 esclude terzine con >4 apparizioni pregresse.
- Coppie: 64.410 occorrenze, tutte le 4.005 coppie possibili viste; frequenze fra 5 e 33, media 16,08. L'analisi v24 evidenzia compatibilità con il modello casuale (400 simulazioni). **NON c'è ancora un filtro F18 sulle coppie.**

## Ricerca sul generatore
Vari esperimenti: ritardi e loro intervalli, confronto con casualità, serie delle vicinanze, differenze minime ricorsive, matrice binaria 90 colonne, ESN/GRU/encoder auto-supervisionato, generatore vincolato di sestine, autoregressivo, penalizzazioni e filtri ibridi. Finestra neurale 100 estrazioni. Funzione di utilità per 0..6 centri: [0, 0.001, 0.01, 1, 20, 400, 10000]. Nessun vantaggio predittivo affidabile riscontrato. La sequenza fisica delle sfere è stata raccolta solo per un campione limitato; per le altre il dataset contiene numeri ordinati crescentemente. Non attribuire causalità alle correlazioni introdotte dall'ordinamento.

## Prossimo passo concordato
Studia la distribuzione, per ogni estrazione, della **massima frequenza pregressa delle sue 15 coppie**, usando solo il passato, e analizza quali soglie potrebbero costituire F18. Valuta anche numero di coppie con frequenze superiori alle soglie. Confronta frequenze osservate con simulazioni casuali indipendenti e rimescolamenti cronologici, distinguendo decisioni esplorative e verifica su dati mai usati. Calcola prima copertura esatta delle sestine reali, poi la frazione di tutte le combinazioni ammissibili, esattamente se fattibile, altrimenti Monte Carlo con errore. **Non attivare F18 senza un criterio fondato e indicare chiaramente la differenza rispetto alla selezione casuale.**

## Consegna / processo
Ogni modifica produce una nuova versione del documento cumulativo, in **Markdown scaricabile**, v25 poi v26..., senza perdere l'analisi precedente; fornire inoltre codice, metriche CSV/JSON, grafici e quando utile ZIP completo. Conservare sempre i 17 filtri e non cambiare il significato delle condizioni senza autorizzazione. Non assumere che risultati precedenti siano corretti senza controlli. Se si lavora nel repository `massimilianonardi-ai/rumiai-tests`, verificare HEAD remoto e rispettare il suo ruolo di suite di test: artefatti di ricerca in cartella separata da `tests/`, e verificare le indicazioni di `rumiai-dev` prima di aggiungere test permanenti.

Comincia ispezionando i file disponibili e riportando il piano del test F18. Procedi all'analisi e salva v25.md con risultati riproducibili.
