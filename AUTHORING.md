# RumiAI Test Authoring

Prima di creare o modificare test permanenti devono essere letti:

```text
rumiai-dev/TESTING.md
rumiai-dev/TEST-PATTERNS.md
rumiai-dev/RUNNER.md        quando la modifica riguarda il runner
```

## Principio

Un test permanente protegge una proprietà corrente, non una particolare forma del codice di test.

Prima di aggiungere o riallineare un test:

1. identificare la proprietà corrente che il test pretende di proteggere;
2. verificare che la proprietà sia ancora contrattuale o una regressione materialmente utile;
3. scegliere il percorso reale minimo che dimostra quella proprietà;
4. classificare il test come `keep`, `simplify`, `merge` o `remove`;
5. soltanto dopo definire infrastruttura e assertion.

Un'assertion storica non è valida solo perché esiste già.

## Target e ambiente ricevuti

Un `.test` usa il target e l'ambiente di processo che riceve dal chiamante.

In sviluppo, l'esecuzione diretta o tramite `rumiai-test` osserva quindi il checkout e l'ambiente reali forniti dall'operatore.

In validation formale, `rumiai-validate` fornisce invece un clone Git indipendente dell'esatto commit configurato e root utente temporanee isolate. Il test usa quell'ambiente senza costruirne un altro.

Un test permanente non deve:

- clonare, copiare o ricostruire un secondo `rumiai-os`;
- creare un proprio `HOME`, `TMPDIR`, package root o ambiente runtime sostitutivo allo scopo di isolarsi;
- sostituire componenti RumiAI-owned del percorso che dichiara di verificare;
- chiamare API private come se fossero interfacce pubbliche.

Può creare input, file, processi e risorse specifici dello scenario dentro l'ambiente ricevuto. Può inoltre simulare confini realmente esterni solo nei casi ammessi da `TESTING.md`.

## Librerie comuni

Le librerie sotto `lib/` possono essere dipendenze runtime deliberate dei `.test` della stessa revisione della suite.

Primitive correnti includono:

```text
lib/rumiai-os-target.lib
lib/interactive.lib
```

I test non creano copie o repliche alternative di `rumiai-os`: usano il target ricevuto dal chiamante. L'isolamento formale del target e delle root utente appartiene a `rumiai-validate`.

La revisione `rumiai-tests` registrata dalla validation identifica anche la versione esatta delle librerie comuni usate, quindi non è necessario copiare helper inline soltanto per riproducibilità storica.

## Copie inline

Una copia inline di una primitive comune è eccezionale. Deve essere accompagnata da un commento che spieghi **perché il congelamento locale è semanticamente necessario**.

Non copiare file o frammenti del sistema sotto test per ricostruirne artificialmente il comportamento.

## Granularità

Non creare un nuovo `.test` per ogni variante meccanica se più casi verificano lo stesso contratto e possono essere diagnosticati bene dentro una sola unità.

Durante l'audit usare la classificazione:

```text
keep
simplify
merge
remove
```

## White-box e diagnostica

Controlli strutturali sono appropriati quando la struttura è parte del contratto. In caso contrario osservare comportamento, status, output strutturato quando contrattuale, filesystem/state effect e altri effetti pubblici.

Evitare come default:

- grep di stringhe interne;
- nomi di funzioni private;
- numeri di riga o ordine testuale del sorgente;
- pathname o naming di staging implementation-private;
- testo diagnostico esatto quando il contratto non ne fissa la formulazione.
