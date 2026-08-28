# RumiAI Tests

Suite permanente di test e validazione di RumiAI.

Le regole canoniche di testing sono definite in `massimilianonardi-ai/rumiai-dev/TESTING.md`. Questo repository contiene l'implementazione eseguibile dei test, il runner, il supporto comune e le sessioni di validazione.

## Ruolo

`rumiai-tests` protegge nel tempo proprietà consolidate di RumiAI e delle dipendenze esterne effettivamente utilizzate.

I proof-of-concept restano separati in `rumiai-dev-PoCs`.

## Struttura iniziale

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
    external/
sessions/
```

Ogni directory sotto `tests/` è un gruppo. I gruppi possono essere nidificati e la selezione di un gruppo esegue ricorsivamente tutti i test che contiene. `tests/` è il gruppo radice e rappresenta l'intera suite.

Il pathname relativo a `tests/` identifica naturalmente test e gruppi.

## Indipendenza dei test

Ogni test è un'unità completamente indipendente e deve poter essere eseguito singolarmente con lo stesso risultato, a parità di condizioni rilevanti.

Un test non può dipendere da stato, setup, cleanup, output o risultati prodotti da un altro test. Un test che passa soltanto perché un altro test è stato eseguito prima è invalido.

Se una verifica richiede più operazioni coordinate prima del cleanup, tali operazioni appartengono a un unico test indipendente, anche quando internamente il test contiene più step.

I gruppi non forniscono orchestrazione, dipendenze, setup/teardown condivisi o ordine funzionale tra test.

## Ordine di esecuzione

I membri di un gruppo vengono attraversati in ordine lessicografico deterministico dei rispettivi identificatori.

L'ordine serve esclusivamente a rendere l'esecuzione prevedibile e confrontabile; non ha significato funzionale e nessun test può dipenderne.

## Exit status dei test

```text
0 = PASS
1 = FAIL
2 = SKIP
3 = ERROR
```

Lo status del test è distinto dallo status del programma testato.

## Workspace locale consigliato

Il clone può essere collocato accanto al runtime locale sotto:

```text
$RumiAI_ROOT/.dev/rumiai-tests/
```

Questa collocazione è una convenienza di sviluppo e non deve essere l'unico modo per indicare il target da testare.

## Runner

Il runner pubblico è `rumiai-test`, nome scelto per evitare collisioni con la utility POSIX `test`.

La CLI completa e le regole precise di discovery/selezione dei test verranno definite prima dell'implementazione della prima suite permanente.
