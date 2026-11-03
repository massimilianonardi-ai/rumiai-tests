#!/usr/bin/env python3
"""Build a local SQLite queryable copy of the authoritative CSV source tables.

All monetary amounts are preserved verbatim as decimal TEXT, without
floating-point conversion.  No delays/frequencies/features are materialized.
The SQLite binary is generated locally and is not a new upstream source.
"""
from __future__ import annotations
import csv
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PARTS = ["1939_1948", "1949_1958", "1959_1968", "1969_1978", "1979_1988", "1989_1997"]
SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE estrazioni (
 codice TEXT PRIMARY KEY, data TEXT NOT NULL UNIQUE, concorso INTEGER NOT NULL,
 n1 INTEGER NOT NULL, n2 INTEGER NOT NULL, n3 INTEGER NOT NULL,
 n4 INTEGER NOT NULL, n5 INTEGER NOT NULL, n6 INTEGER NOT NULL,
 jolly INTEGER, superstar INTEGER, fonte_numeri TEXT, id_fonte TEXT);
CREATE TABLE montepremi (
 codice TEXT PRIMARY KEY REFERENCES estrazioni(codice), data TEXT NOT NULL,
 montepremi_concorso_eur TEXT, riporto_jackpot_eur TEXT,
 montepremi_totale_pubblicato_eur TEXT, id_fonte TEXT);
CREATE TABLE premi (
 codice TEXT NOT NULL REFERENCES estrazioni(codice), data TEXT NOT NULL,
 gioco TEXT NOT NULL, categoria TEXT NOT NULL, numero_vincite INTEGER,
 importo_pubblicato_eur TEXT, natura_importo TEXT NOT NULL, id_fonte TEXT);
CREATE TABLE ulteriore_montepremi_ufficiale (
 codice TEXT NOT NULL REFERENCES estrazioni(codice), data TEXT NOT NULL,
 voce TEXT NOT NULL, importo_eur TEXT,
 fonte_ufficiale_url TEXT, data_rilevazione TEXT,
 PRIMARY KEY(codice,voce));
CREATE TABLE lotto_ruote (
 lotto_data TEXT NOT NULL, lotto_concorso INTEGER, ruota TEXT NOT NULL,
 estratto_1 INTEGER, estratto_2 INTEGER, estratto_3 INTEGER,
 estratto_4 INTEGER, estratto_5 INTEGER,
 PRIMARY KEY(lotto_data,ruota));
CREATE TABLE superenalotto_ipotetico (
 codice_simulazione TEXT PRIMARY KEY, lotto_data TEXT NOT NULL, lotto_concorso INTEGER,
 n1 INTEGER,n2 INTEGER,n3 INTEGER,n4 INTEGER,n5 INTEGER,n6 INTEGER,
 jolly INTEGER,superstar INTEGER,stato TEXT NOT NULL);
CREATE TABLE premi_1997_fonte_secondaria (
 codice TEXT NOT NULL REFERENCES estrazioni(codice),data TEXT NOT NULL,
 gioco TEXT, categoria TEXT NOT NULL,numero_vincite INTEGER,
 quota_eur_pubblicata TEXT,fonte_url TEXT,stato_verifica TEXT,
 PRIMARY KEY(codice,gioco,categoria));
CREATE TABLE jackpot_6_pre2009_da_confermare (
 codice TEXT PRIMARY KEY REFERENCES estrazioni(codice),data TEXT NOT NULL,
 montepremi_6_pubblicato_eur TEXT,numero_vincite INTEGER,
 regione_pubblicata TEXT,fonte TEXT);
CREATE INDEX ix_premi_cat ON premi(gioco,categoria);
CREATE INDEX ix_premi_date ON premi(data);
CREATE INDEX ix_lotto_date ON lotto_ruote(lotto_data);
CREATE INDEX ix_sim_date ON superenalotto_ipotetico(lotto_data);
"""
FILES = [
    ("estrazioni", ["estrazioni.csv"]),
    ("montepremi", ["montepremi.csv"]),
    ("premi", ["premi.csv"]),
    ("ulteriore_montepremi_ufficiale", ["ulteriore_montepremi_ufficiale.csv"]),
    ("lotto_ruote", [f"lotto_ruote_{part}.csv" for part in PARTS]),
    ("superenalotto_ipotetico", [f"superenalotto_ipotetico_{part}.csv" for part in PARTS]),
    ("premi_1997_fonte_secondaria", ["premi_1997_fonte_secondaria.csv"]),
    ("jackpot_6_pre2009_da_confermare", ["jackpot_6_pre2009_da_confermare.csv"]),
]

def import_csv(con: sqlite3.Connection, table: str, name: str) -> int:
    count = 0
    with (ROOT / name).open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        cols = reader.fieldnames
        if not cols:
            raise ValueError(f"{name}: missing header")
        schema_cols = {x[1] for x in con.execute(f"PRAGMA table_info({table})")}
        if not set(cols) <= schema_cols:
            raise ValueError(f"{name}: unknown columns in {table}: {set(cols)-schema_cols}")
        sql = f"INSERT INTO {table} (" + ",".join(cols) + ") VALUES (" + ",".join("?" for _ in cols) + ")"
        batch = []
        for row in reader:
            # Empty fields represent unknown/non-existing values, NOT numeric 0.
            batch.append(tuple(row[c] if row[c] != "" else None for c in cols))
            count += 1
            if len(batch) == 1000:
                con.executemany(sql, batch)
                batch = []
        if batch:
            con.executemany(sql, batch)
    return count

def main() -> int:
    destination = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "archive.sqlite"
    if destination.exists():
        raise FileExistsError(f"{destination} exists: delete explicitly before rebuilding")
    con = sqlite3.connect(destination)
    try:
        con.executescript(SCHEMA)
        with con:
            for table, files in FILES:
                rowcount = sum(import_csv(con, table, file) for file in files)
                print(f"{table}: {rowcount} rows")
            fk = list(con.execute("PRAGMA foreign_key_check"))
            if fk:
                raise RuntimeError(f"SQLite foreign-key violations: {fk[:4]}")
        con.execute("PRAGMA integrity_check").fetchone()
    except BaseException:
        con.close()
        destination.unlink(missing_ok=True)
        raise
    finally:
        con.close()
    print(f"Database created: {destination}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
