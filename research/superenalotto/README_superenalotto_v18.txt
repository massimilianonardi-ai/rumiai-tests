Esperimento 18 — modello autoregressivo SuperEnalotto

Requisiti: Python 3.10+, numpy, pandas, torch, matplotlib.

Da questa cartella eseguire:
  OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 python compute_v18.py

Input inclusi nel pacchetto:
  superenalotto_matrice_binaria_90_v13.csv (4.294 estrazioni)
  superenalotto_previsioni_test_v17.csv (baseline sul medesimo test)

Il test è già stato consultato nei precedenti esperimenti e non costituisce validazione indipendente.
