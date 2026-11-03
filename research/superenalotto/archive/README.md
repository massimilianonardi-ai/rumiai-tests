# SuperEnalotto — archivio storico di osservazioni (v1, 3 novembre 2026)

**Questa directory contiene i dati di base, non risultati statistici.** I filtri,
i ritardi, le frequenze, le somme calcolate, gli indici ML, i profitti teorici e
ogni altra informazione derivabile rimangono FUORI dalle tabelle fattuali. La
sola eccezione esplicita è la serie separata di sestine **ipotetiche** ricavate
dalle estrazioni del Lotto antecedenti al 3 dicembre 1997.

**Snapshot:** ultimi dati inclusi 31 ottobre 2026. Questo archivio non si
aggiorna automaticamente; per modifiche future registrare nuova provenienza,
nuove verifiche e snapshot.

## Tabelle fattuali primarie

| File | Righe | Periodo | Contenuto |
| --- | ---: | --- | --- |
| **estrazioni.csv** | 4.294 | 1997-12-03–2026-10-31 | Codice storico, data, concorso, 6 numeri, Jolly, SuperStar se esiste, ID e fonte originali. |
| **montepremi.csv** | 2.947 | 2009–2026 | Montepremi del concorso, jackpot riportato, totale pubblicato (euro). |
| **premi.csv** | 38.029 | 2009–2026 | Gioco/categoria, numero di vincite e importo pubblicato. |
| **ulteriore_montepremi_ufficiale.csv** | 2 | 2026 | Altre attribuzioni esplicitamente indicate nei prospetti ufficiali. Non sono ricavate per sottrazione. |

La chiave principale è **codice** = anno e numero di concorso storico, es.
\`1997-087\`, \`2004-103\`, \`2026-175\`. La colonna \`id_fonte\` conserva
l'identificativo originario del dataset esterno. La data, non l'ID di terzi,
è stata usata per riconciliare le fonti. Il codice è un identificatore tecnico
che permette di unire le tabelle; non è una variabile statistica.

**Semantica monetaria:** i valori sono riportati così come pubblicati, con
il punto decimale e in EUR; non vengono sommati o ricalcolati. Gli importi
nel gioco \`superenalotto\` e \`superstar\` sono **quote unitarie**; per
\`immediate\` (WinBox, Seconda Chance, ecc.) sono invece **totali di categoria**.
Questa distinzione è indicata nella colonna \`natura_importo\`: non moltiplicare
il totale immediato per \`numero_vincite\`.

Una quota vuota NON significa zero euro: tipicamente non c'è stata alcuna
vincita della categoria. Manteniamo vuoti sia i campi mai pubblicati sia
quelli assenti. \`numero_vincite\` indica vincite/premi assegnati nella
categoria, **non necessariamente persone uniche**.

Non uniformare nomi di categorie storiche inventando categorie che non
esistevano: SuperStar comincia nel 2006 e la categoria **Punti 2** nel 2016.

## Altre osservazioni storiche con minore affidabilità

| File | Righe | Interpretazione |
| --- | ---: | --- |
| **premi_1997_fonte_secondaria.csv** | 45 | Quote pubblicate per i 9 concorsi dicembre 1997; fonte SuperEnalottoOggi, non certificazione ADM. |
| **jackpot_6_pre2009_da_confermare.csv** | 75 | Montepremi della categoria 6, numero vincite e regione da un archivio indipendente; controllo di corrispondenza numeri superato, **importi ancora da verificare** con bollettini ufficiali. |

Le quote pubblicate per il 1997 sono in EUR **già convertiti dalla fonte**
(la vincita originale era in lire). Non usare questi EUR per ottenere i
pagamenti storici esatti in lire. I 75 jackpot sono una fonte indipendente
dalla quale non viene dedotta alcuna quota unitaria.

**LACUNA IMPORTANTE:** quote e montepremi completi per i concorsi 1998–2008
NON sono stati acquisiti qui. La fonte non ufficiale
<https://superenalottooggi.com/archivio> pubblica un CSV/JSON 1997–2026
con queste quote, ma i download in blocco non erano accessibili agli strumenti
di acquisizione di questa esecuzione. Non è corretto riportare
la copertura economica come "completa 1997–2026". Una volta acquisito un
dump verificabile, potremo integrare quelle righe con provenienza e audit.

Non sono disponibili per tutti i concorsi le vendite, il volume delle
giocate, il gettito erariale, la distribuzione geografica dei premi, il
montepremi SuperStar separato, né la ripartizione completa di ogni
attribuzione regolamentare. Non inventare tali campi.

## Serie ipotetiche PRIMA dell'esistenza del SuperEnalotto

- **\`lotto_ruote_<periodo>.csv\`**: 6 partizioni cronologiche; 30.931 righe
  originali di Lotto, ciascuna con cinque estratti **nell'ordine di uscita**,
  suddivisi per data e ruota.
- **\`superenalotto_ipotetico_<periodo>.csv\`**: 6 partizioni;
  **3.068** sestine simulate tra 1939-01-07 e 1997-11-29.
- Estrazioni del Lotto considerate: **3.116**; **48** date senza un insieme
  sufficiente di ruote per produrre una ricostruzione controllabile. Le
  cinque palline originarie restano disponibili; le date incomplete non
  sono sostituite da numeri stimati.

**Regola applicata (storica, controfattuale):** ruote di Bari, Firenze,
Milano, Napoli, Palermo, Roma, nell'ordine, scegliendo il primo numero
di ogni ruota non già apparso in sestina; se duplicato, scorrere verso il
secondo, terzo, quarto, quinto estratto. Ordinare i sei numeri soltanto per
presentarli. Il Jolly è il primo numero della ruota di Venezia non già
nella sestina, con analogo scorrimento. La SuperStar è vuota nel periodo
1939–1997, perché il gioco non esisteva. Se una ruota manca o non è
possibile ottenere sei numeri distinti, **non creare una sestina**.

Questo metodo è stato verificato sulle 9 estrazioni ufficiali dicembre
1997: tutte le sestine e i Jolly coincidono. Resta una simulazione
CONTROFATTUALE: il gioco non esisteva, i concorsi simulati non hanno
jackpot, vincitori, vincite, né codici di SuperEnalotto ufficiali.
Gli ID \`SIM-YYYY-MM-DD\` sono identificativi di simulazione, non concorsi
di SuperEnalotto.

La fonte Lotto è il mirror <https://github.com/pandvan/lotto-archive>
(commit \`828bb7b3b7631b8944858bb27a2b4a51bc47e2b1\`), che documenta come
origine il file ZIP ufficiale
<https://www.brightstarlottery.it/STORICO_ESTRAZIONI_LOTTO/storico.zip>
(e una fonte indipendente di confronto). I file CSV qui pubblicati
sono estratti fattuali per ruota dal mirror, non una copia del ZIP.

## Tracciabilità delle fonti e discrepanze

- **\`source/la-scimmia-vince/draws.csv\`**, **\`pools.csv\`** e **\`prizes.csv\`**:
  copie delle tre fonti strutturate del repository
  <https://github.com/federicodiluca/la-scimmia-vince>,
  snapshot commit \`e7130aa6e787fc80b9eb8c75c6fe333870283f3c\`.
  È inclusa \`source/la-scimmia-vince/LICENSE\` (MIT, copyright Federico Di Luca).
- **\`source/luigimassa/sestine_vincenti_6.csv\`**: sorgente secondaria per
  jackpot storici, da confermare su bollettini ufficiali.
- **\`crosswalk_concorsi_difformi.csv\`**: 9 righe. Nel dicembre 1997,
  La Scimmia Vince numera le estrazioni 1–9, mentre il codice storico
  è 87–95. Il join è stato effettuato per **data**.
- **\`discrepanze_numeri.csv\`**: una discordanza fra sorgenti,
  concorso 2004-103 (27 dicembre 2004), numero **41** contro **4**.
  La ricostruzione dai numeri originali del Lotto porta a **41**,
  adottato in \`estrazioni.csv\`; la fonte discrepante è conservata.
- **\`verifiche_ufficiali_campione.csv\`**: confronto per campo con i
  bollettini ADM/Sisal; **52 verifiche puntuali**, relative ai concorsi
  2026-145 e 2026-175. Non rappresentano un audit completo di 2.947 concorsi.
- **\`ulteriore_montepremi_ufficiale.csv\`**: attributi economici non presenti
  nei CSV primari, registrati direttamente dalle fonti ufficiali.
  In alcuni prospetti ADM il "montepremi totale" è esposto **prima**
  dell'ulteriore attribuzione, mentre il "montepremi totale" di Sisal la
  include. Le due definizioni NON vanno confrontate come se fossero uguali.

**Controllo 2026-175:** Sisal: montepremi 4.462.007,40 EUR,
riporto 47.320.314,61 EUR, ulteriore attribuzione 7.629,24 EUR,
totale pubblicato 51.789.951,25 EUR. ADM può indicare come subtotale
51.782.322,01 EUR, escludendo l'ulteriore attribuzione. Il CSV mantiene
il totale pubblicato da Sisal senza aggiungere una colonna calcolata.

**Controllo 2026-145:** ADM: montepremi 4.688.500,20 EUR,
riporto 221.580.190,86 EUR, ulteriore attribuzione 6.273,98 EUR.
Il totale usato nei dati di origine è 226.274.965,04 EUR (con attribuzione);
ADM espone anche il subtotale prima dell'attribuzione.

## Riproducibilità e utilizzo

Eseguire dalla cartella \`archive/\`:

\`\`\`bash
node build_archive.js --check
# Solo se le fonti originarie cambiano e la riconciliazione è stata esaminata:
node build_archive.js --rebuild
\`\`\`

\`--check\` verifica byte per byte i cinque CSV canonici/di discrepanza e
le sei partizioni delle simulazioni, ricostruendoli dalle fonti versionate.
I due rami della verifica sono stati eseguiti con successo al momento
della pubblicazione. Richiede solo Node.js, nessuna dipendenza esterna.
Non modifica i file v01–v26 né \`estrazioni_con_ritardi.csv\`.

I CSV normalizzati usano **punto e virgola** (decimal point \`.\`);
le tre fonti originali della directory \`source\` mantengono il
separatore **virgola**. Gli importi sono stringhe decimali per evitare
errori da floating point binario quando vengono importati in un DB.

**La base dati non dimostra capacità predittiva.** In particolare,
quote e numeri di vincite di un concorso sono noti soltanto dopo
l'estrazione e non possono essere usati per prevederlo.


## SQLite opzionale (nessun campo derivato)

Per interrogare tutte le tabelle in un database relazionale locale, oltre ai CSV
versionati è disponibile lo script Python standard library:

\`\`\`bash
python3 create_sqlite.py /percorso/archivio-superenalotto.sqlite
\`\`\`

Crea un database SQLite **locale** con chiavi, indici e controllo delle
relazioni tra estrazioni, montepremi, premi, fonti storiche e Lotto.
Mantiene gli importi monetari come **TEXT decimale esatto**, non
floating point, e converte i campi vuoti in \`NULL\`. Non inventa
alcun valore mancante, non calcola ritardi/frequenze e non modifica
i CSV. La procedura non sovrascrive un database esistente.


## Verifiche storiche aggiuntive e manifesto

Il file \`SOURCE_MANIFEST.json\` fissa revisioni, riferimenti, copertura e
limiti di ogni sorgente. Il file \`verifiche_jackpot_pre2009.csv\` contiene
tre confronti puntuali con l'archivio vincite del sito ufficiale Sisal:
i jackpot del 2005-05-04 e del 2007-05-19 differiscono di **1 EUR**
dall'importo della fonte secondaria; quello del 2008-10-23 coincide.
Per questo gli importi in \`jackpot_6_pre2009_da_confermare.csv\` non
sono promossi a valori ufficiali, nemmeno quando la sestina coincide.

Le **52 verifiche** ADM/Sisal elencate nel registro riguardano soltanto
due concorsi del 2026. La fonte dei 75 jackpot storici è indipendente
ma non certificata; per un dato utilizzato in decisioni economiche
effettive occorre riscontro del bollettino ufficiale del concorso.
