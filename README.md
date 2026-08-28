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

La CLI completa e le regole di selezione/discovery dei test verranno definite prima dell'implementazione della prima suite permanente.
