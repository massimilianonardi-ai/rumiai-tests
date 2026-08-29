# RumiAI Tests

Suite permanente di test e validazione di RumiAI.

Le regole canoniche generali sono definite in `massimilianonardi-ai/rumiai-dev/TESTING.md`. Il contratto canonico specifico del runner, della persistenza delle run e degli snapshot filesystem è definito in `massimilianonardi-ai/rumiai-dev/RUNNER.md`.

Questo repository contiene l'implementazione eseguibile dei test, il runner, il supporto comune e le sessioni di validazione.

## Ruolo

`rumiai-tests` protegge nel tempo proprietà consolidate di RumiAI e delle dipendenze esterne effettivamente utilizzate.

I proof-of-concept restano separati in `rumiai-dev-PoCs`.

## Struttura

```text
rumiai-test
lib/
    test.lib
tests/
    rumiai-os/
        bootstrap/
        command/
        i18n/
        log/
        shell/
    rumiai-dev/
        setup-dev/
    runner/
    external/
.runs/
sessions/
```

`.runs/` contiene development run locali ed è ignorata da Git. `sessions/` contiene validation session completate e versionabili.

Ogni directory normale sotto `tests/` è un gruppo. I gruppi possono essere nidificati e la selezione di un gruppo esegue ricorsivamente tutti i test che contiene. `tests/` è il gruppo radice e rappresenta l'intera suite.

Il pathname relativo a `tests/` identifica naturalmente test e gruppi.

## Discovery

Le regole di discovery sono volutamente minime:

1. un file regolare `*.test` identifica un test;
2. ogni directory normale sotto `tests/` identifica un gruppo;
3. directory e pathname il cui nome inizia con `.` sono materiale interno e vengono esclusi dalla discovery;
4. ogni altro file viene ignorato dal runner.

Esempio:

```text
tests/rumiai-os/bootstrap/
├── absolute.test
├── relative.test
├── README.md
├── .fixtures/
│   └── source
└── .support/
    └── helper
```

L'estensione `.test` identifica il ruolo del file nella suite e non il linguaggio con cui il test è implementato.

## Indipendenza dei test

Ogni test è un'unità completamente indipendente e deve poter essere eseguito singolarmente con lo stesso risultato, a parità di condizioni rilevanti.

Un test non può dipendere da stato, setup, cleanup, output o risultati prodotti da un altro test. Un test che passa soltanto perché un altro test è stato eseguito prima è invalido.

Se una verifica richiede più operazioni coordinate prima del cleanup, tali operazioni appartengono a un unico test indipendente, anche quando internamente il test contiene più step.

I gruppi non forniscono orchestrazione, dipendenze, setup/teardown condivisi o ordine funzionale tra test.

## Ordine di esecuzione

I membri di un gruppo vengono attraversati in ordine lessicografico deterministico dei rispettivi identificatori.

L'ordine serve esclusivamente a rendere l'esecuzione prevedibile e confrontabile; non ha significato funzionale e nessun test può dipenderne.

## Test autonomi

Ogni `.test` contiene tutta la conoscenza specifica necessaria alla propria verifica.

Il test si occupa autonomamente di:

- individuare e canonicalizzare la propria posizione quando necessario;
- individuare il target;
- localizzare fixture e file di supporto tramite nomi e relazioni logiche hardcoded;
- preparare ciò che serve alla prova;
- creare e gestire eventuali risorse temporanee;
- verificare il comportamento atteso;
- produrre diagnostica;
- effettuare il cleanup;
- restituire l'exit status del test.

Sono ammessi riferimenti logici relativi, come `.fixtures/input`, `.support/helper` o `bin/log`; non sono ammessi pathname host-specifici hardcoded come home directory personali o path locali dello sviluppatore.

Un `.test` deve poter essere eseguito direttamente. Il suo shebang identifica esclusivamente il proprio interprete; per i test implementati in shell POSIX il normale shebang è `#!/bin/sh`.

`rumiai-test` e `rumiai-os` non sono interpreti impliciti dei file `.test`.

## Exit status dei test

```text
0 = PASS
1 = FAIL
2 = SKIP
3 = ERROR
```

Lo status del test è distinto dallo status del programma testato.

Una incompatibilità reale dell'host rispetto alla proprietà richiesta produce `FAIL`. Non deve essere trasformata in `PASS` o `SKIP` per nascondere una incompatibilità nota.

`SKIP` indica invece un test non applicabile o una precondizione dichiarata non disponibile; `ERROR` indica che il test non è riuscito a determinare un risultato per un problema del test, del runner o dell'ambiente.

Un `.test` che termina con uno status diverso da `0..3`, o che viene terminato da un segnale prima di produrre un esito valido, viene classificato dal runner come `ERROR`.

## Modello host

I test devono essere unici e universali rispetto agli host sui quali sono applicabili. La suite descrive la proprietà da verificare; la sessione registra l'ambiente nel quale la proprietà è stata verificata.

Gli host stabili di riferimento correnti sono:

```text
macOS
Ubuntu 26.04 ARM64
```

Host aggiuntivi usati periodicamente includono:

```text
Ubuntu 26.04 x64
Windows 10 x64
Windows 11 x64
```

Una validation session registra almeno sistema operativo, versione, architettura e altre caratteristiche dell'ambiente materialmente rilevanti.

Se un test fallisce solo su un determinato host, il progetto valuta il fallimento insieme ai metadati della sessione. Un'incompatibilità può essere accettata esplicitamente senza correggere il prodotto quando non è abbastanza importante, ma il risultato storico della sessione rimane `FAIL`.

## Workspace locale consigliato

Il clone può essere collocato accanto al runtime locale sotto:

```text
$RumiAI_ROOT/.dev/rumiai-tests/
```

Questa collocazione è una convenienza di sviluppo. I test devono poter effettuare autonomamente il discovery necessario anche quando il repository è collocato altrove.

## Runner

Il runner pubblico è `rumiai-test`, nome scelto per evitare collisioni con la utility POSIX `test`.

Il runner è intenzionalmente semplice: osserva l'esecuzione, non la prepara.

Il contratto runner -> test è vuoto: il runner non passa argomenti o variabili RumiAI-specifiche, non individua il target, non localizza fixture, non crea workspace temporanei, non cambia la current working directory, non modifica `HOME` o `TMPDIR`, non esegue setup/cleanup e non implementa una sandbox implicita.

Il contratto test -> runner è limitato a:

```text
stream combinato stdout/stderr
exit status 0..3
```

`stdout` e `stderr` vengono catturati in un unico stream, secondo un modello equivalente a:

```sh
1>logfile 2>&1
```

Il contesto globale della sessione viene registrato dal runner separatamente dal log prodotto dal test.

## CLI iniziale

La CLI canonica iniziale è:

```text
rumiai-test [options] [--] [selection]
```

Opzioni iniziali:

```text
--validation
--snapshot=metadata|hash
--snapshot-scope=selection|test|both
--snapshot-root <pathname>
```

`--snapshot-root` è ripetibile.

Con:

```text
selection assente
    intera suite / gruppo radice tests/

selection = directory relativa a tests/
    gruppo ricorsivo

selection = file *.test relativo a tests/
    singolo test
```

Esempi:

```text
rumiai-test
rumiai-test rumiai-os/bootstrap
rumiai-test rumiai-os/bootstrap/path/absolute.test
rumiai-test --validation
rumiai-test --validation rumiai-os/bootstrap
rumiai-test --validation --snapshot=hash --snapshot-scope=test --snapshot-root /path/to/rumiai-os --snapshot-root /home -- rumiai-os/bootstrap
```

`rumiai-test .` non è ammesso. `--snapshot-root .` è invece valido e indica esplicitamente la current working directory come root da osservare.

La CLI accetta un solo selettore. Quando lo snapshot è richiesto, modalità, scope e almeno una root devono essere specificati esplicitamente.

## Exit status del runner

```text
0 = SUCCESS
1 = FAIL
2 = TEST ERROR
3 = RUNNER ERROR
```

La precedenza è:

```text
RUNNER ERROR > TEST ERROR > FAIL > SUCCESS
```

Semantica:

- `0`: run completata senza test `FAIL` o `ERROR`; possono essere presenti `SKIP`;
- `1`: almeno un test `FAIL`, nessun test `ERROR`;
- `2`: almeno un test `ERROR`; prevale sull'eventuale presenza di `FAIL`;
- `3`: errore del runner o run non completabile correttamente.

Una selezione inesistente, invalida o un gruppo selezionato senza alcun test valido produce `RUNNER ERROR=3`.

Se `rumiai-test` viene interrotto esternamente da un segnale, non deve trasformare artificialmente l'evento in status `3`: deve preservare per quanto possibile la normale semantica di terminazione da segnale della piattaforma.

## Persistenza delle run

Development e validation usano lo stesso formato:

```text
<run-id>/
├── session
├── results
├── logs/
└── snapshots/        solo quando richiesto
```

Le development run vengono conservate sotto `.runs/`; le validation run completate sotto `sessions/`.

Il run-id ha forma:

```text
YYYYMMDDThhmmss+zzzz-PID
```

`session` usa record `key<TAB>value` e contiene il contesto globale osservato dal runner. `results` contiene un record elementare per test nel formato `result<TAB>test-id<TAB>observed-termination`, senza totali duplicati. `logs/` replica la gerarchia degli identificatori dei test e ogni `.log` contiene esclusivamente lo stream combinato del relativo `.test`.

Durante una validation la directory nasce come `sessions/.<run-id>/` e diventa `sessions/<run-id>/` soltanto quando il runner ha completato correttamente la produzione dell'evidenza. Una sessione completata non viene sovrascritta o modificata dal runner.

Il runner non applica retention automatica a `.runs/` e non esegue automaticamente `git add`, `git commit` o `git push` delle validation session.

## Filesystem snapshot

La capability di filesystem snapshot fa parte della prima versione del runner ed è opzionale per ogni run.

Modalità:

```text
metadata
hash
```

`metadata` registra almeno pathname relativo alla root, tipo, size dei file regolari, mtime dei file regolari, mode/permessi e target dei symlink quando applicabili. Non usa `atime` e non usa l'`mtime` delle directory come indicatore canonico di differenza.

`hash` comprende tutti i metadata e aggiunge SHA-256 per ogni file regolare.

Scope:

```text
selection
    snapshot prima e dopo l'intera selezione

test
    snapshot prima e dopo ogni singolo test

both
    entrambe le modalità di osservazione
```

È possibile specificare più root ripetendo `--snapshot-root`. Ogni root viene risolta/canonicalizzata dal runner e gli entry pathname dello snapshot sono relativi alla rispettiva root.

Il runner esclude automaticamente soltanto la directory della run corrente che esso stesso sta generando, se ricade sotto una root osservata. Non esclude implicitamente `.dev/`, `.git/`, `rumiai-tests/`, `sessions/` o altre directory generiche.

Gli esiti dell'audit filesystem sono distinti dagli esiti dei test:

```text
CLEAN
CHANGED
ERROR
```

`CHANGED` segnala una differenza osservata e non trasforma automaticamente il test in `FAIL` o `ERROR`. `ERROR` indica che l'audit esplicitamente richiesto non è stato completato e produce `RUNNER ERROR`.

Gli snapshot sono conservati separatamente sotto `snapshots/`, con mapping delle root in `snapshots/roots`, coppie `before/after` e relativo `diff`. Con scope `test` viene replicata la gerarchia del test; con scope `both` vengono conservati sia l'audit della selezione sia gli audit dei singoli test.
