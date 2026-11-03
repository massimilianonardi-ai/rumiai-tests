#!/usr/bin/env python3
"""Opzionale: raccoglie sequenze di uscita dagli URL individuali del sito terzo.
Uso su una macchina dotata di rete (non eseguito per la ricerca v09):
 python collect_superenalotto_order_v09.py estrazioni_con_ritardi.csv ordini_raccolti.csv --limit 25
 python collect_superenalotto_order_v09.py estrazioni_con_ritardi.csv ordini_raccolti.csv --all
Rispetta robots.txt, attende fra richieste, NON scavalca blocchi di accesso.
Le sequenze in ordine crescente vengono etichettate 'DA_VERIFICARE'.
Non considera la dichiarazione di provenienza ADM come attestazione ufficiale.
"""
import argparse, csv, re, time
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
import pandas as pd

URL='https://www.superenalottoitalia.com/estrazione-superenalotto-{n}-{anno}/'
USER_AGENT='SuperenalottoResearch/0.9 (ricerca non commerciale; contatto via User-Agent opzionale)'
RX=re.compile(r'Ordine di estrazione(?: pubblicato da ADM)?\s*:\s*((?:\d{1,2}\s*[-–—]\s*){5}\d{1,2})',re.I)

def parse_order(html):
    soup=BeautifulSoup(html,'html.parser')
    text=soup.get_text(' ',strip=True)
    match=RX.search(text)
    return [int(x) for x in re.findall(r'\d{1,2}',match.group(1))] if match else None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('input_csv',type=Path)
    parser.add_argument('output_csv',type=Path)
    mx=parser.add_mutually_exclusive_group(required=True)
    mx.add_argument('--all',action='store_true')
    mx.add_argument('--limit',type=int)
    parser.add_argument('--from-date',default='2009-07-01')
    parser.add_argument('--delay',type=float,default=1.5)
    args=parser.parse_args()
    if args.delay<1:parser.error('Usare almeno un secondo di intervallo fra richieste')
    df=pd.read_csv(args.input_csv,sep=';',encoding='utf-8-sig')
    df['data']=pd.to_datetime(df['data'])
    df=df[df['data']>=pd.Timestamp(args.from_date)].sort_values('data',ascending=False)
    if args.limit is not None:df=df.head(args.limit)
    session=requests.Session()
    session.headers['User-Agent']=USER_AGENT
    domain='https://www.superenalottoitalia.com'
    robots=RobotFileParser()
    robots.set_url(domain+'/robots.txt')
    try:robots.read()
    except Exception as exc:
        raise RuntimeError(f'Impossibile verificare robots.txt: {exc}')
    out=[]
    for _,row in df.iterrows():
        year=row['data'].year;n=int(row['concorso']);url=URL.format(n=n,anno=year)
        sorted_sestina=[int(row[f'n{i}']) for i in range(1,7)]
        entry={'data':row['data'].strftime('%Y-%m-%d'),'concorso':n,'url':url,
            'status':'',**{f'estratto_{i}':'' for i in range(1,7)}}
        if not robots.can_fetch(USER_AGENT,url):
            entry['status']='ROBOTS_DISALLOW';out.append(entry);continue
        try:
            response=session.get(url,timeout=20)
            response.raise_for_status()
            sequence=parse_order(response.text)
            if not sequence:
                entry['status']='NON_PRESENTE'
            elif len(sequence)!=6 or len(set(sequence))!=6 or sorted(sequence)!=sorted_sestina:
                entry['status']='CONFLITTO_DATI'
            else:
                for i,v in enumerate(sequence,1):entry[f'estratto_{i}']=v
                entry['status']='DA_VERIFICARE_ORDINE_CRESCENTE' if sequence==sorted_sestina else 'CANDIDATO_ORDINE_FISICO'
        except requests.RequestException as exc:
            entry['status']='ERRORE_FETCH:'+type(exc).__name__
        out.append(entry)
        time.sleep(args.delay)
        print(entry['data'],entry['concorso'],entry['status'],flush=True)
    args.output_csv.parent.mkdir(parents=True,exist_ok=True)
    with args.output_csv.open('w',encoding='utf-8',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=['data','concorso','url','status']+[f'estratto_{i}' for i in range(1,7)])
        writer.writeheader();writer.writerows(out)
    print('Salvati',len(out),'record in',args.output_csv)

if __name__=='__main__':main()
