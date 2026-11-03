#!/usr/bin/env python3
"""Ricostruzione (NON il file originale) del generatore della matrice v13."""
from pathlib import Path
import pandas as pd
p=Path(__file__).resolve().parent
source=pd.read_csv(p/'estrazioni_con_ritardi.csv',sep=';')
cols=[f'n{i}' for i in range(1,7)]
m=pd.DataFrame(0,index=source.index,columns=[f'n{i:02d}' for i in range(1,91)],dtype='uint8')
for ridx,row in source[cols].iterrows():
    ns=[int(x) for x in row]
    assert len(set(ns))==6 and all(1<=n<=90 for n in ns)
    m.loc[ridx,[f'n{n:02d}' for n in ns]]=1
assert (m.sum(axis=1)==6).all()
result=pd.concat([source[['data','concorso']],m],axis=1)
out=p/'superenalotto_matrice_binaria_90_v13_reconstructed.csv'
result.to_csv(out,index=False)
print(f'Created {out}: {len(result)} rows')
