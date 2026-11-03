Esperimento 19 — filtri deterministici 14 nel generatore autoregressivo
Requisiti: Python 3.10+, numpy, pandas, scipy, torch, matplotlib.
Esecuzione: OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v19.py
Input necessari: estrazioni_con_ritardi.csv, superenalotto_matrice_binaria_90_v13.csv, superenalotto_ar_history_v18.pt, superenalotto_previsioni_test_v18.csv, superenalotto_filtri_ritardi_dettaglio_v06.csv, superenalotto_analisi_filtri_v18.md.
I test 2021-2026 sono esplorativi; i filtri originari contengono leakage perché i range furono stimati sull'archivio completo.
