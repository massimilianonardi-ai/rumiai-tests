#!/usr/bin/env python3
"""SuperEnalotto v10: recursively follow nearest number in prior historical draw.

Input is reverse chronological, as given in estrazioni_con_ritardi.csv.
Ties are broken towards smaller previous-draw number.
"""
from pathlib import Path
import pandas as pd
import numpy as np
ROOT=Path('/mnt/data')
d=pd.read_csv(ROOT/'estrazioni_con_ritardi.csv', sep=';', encoding='utf-8-sig')
assert d['data'].is_monotonic_decreasing
numbers=d[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=int)
assert len(numbers)==4294 and np.all(np.sort(numbers,axis=1)==numbers)
current=numbers[0].copy()
rows=[]
all_ties=0
first_one=None
for i, previous_draw in enumerate(numbers):
    # i=0: actual final draw, no projection
    if i:
        distances=np.abs(current[:,None] - previous_draw[None,:])
        minimal=distances.min(axis=1)
        all_ties+=int(np.sum((distances==minimal[:,None]).sum(axis=1)>1))
        indices=np.argmin(distances,axis=1)
        current=previous_draw[indices]
    unique=len(set(current))
    if first_one is None and unique==1:
        first_one=i
    rows.append({'passo':i,'data':str(d.loc[i,'data']),'concorso':int(d.loc[i,'concorso']),
                 **{f's{i}':int(current[i-1]) for i in range(1,7)},
                 'valori_distinti':unique,
                 'estrazione_reale': ' '.join(map(str,previous_draw)),
                 'somma_spostamenti':int(np.abs(current-numbers[0]).sum()) if i==0 else None})
result=pd.DataFrame(rows).drop(columns='somma_spostamenti')
result.to_csv(ROOT/'superenalotto_serie_vicinanza_v10.csv',index=False)
print('tie instances',all_ties, 'first one',first_one)
print('distinct counts:\n',result['valori_distinti'].value_counts().sort_index().to_string())
print(result.head(25).to_string(index=False))
print('last rows',result.tail(5).to_string(index=False))
print('first collapse',result.loc[first_one].to_dict() if first_one is not None else None)
print('all values',result[[f's{i}' for i in range(1,7)]].nunique().to_dict())
