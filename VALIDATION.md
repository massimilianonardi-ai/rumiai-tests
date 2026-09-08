# RumiAI validation launcher

`rumiai-validate` è il launcher operativo per eseguire una validation run configurata sugli host disponibili senza ricostruire manualmente la CLI di `rumiai-test`.

Il contratto autorevole è definito in:

```text
massimilianonardi-ai/rumiai-dev/decisions/rumiai-tests/2026-09-08-validation-launcher.md
```

## Uso

Il comando normale dell'operatore è soltanto:

```text
./rumiai-validate
```

Non è necessario eseguire prima `git pull`, cambiare directory o gestire manualmente le sessioni completate.

Il launcher usa due stadi:

```text
rumiai-validate
    -> autodiscovery + cd nella root rumiai-tests
    -> git pull --ff-only di rumiai-tests
    -> eventuale restart del bootstrap aggiornato
    -> lib/sh/rumiai-validate.lib.sh
         -> pubblicazione di eventuali validation session completate e pendenti
         -> gate completo di cleanliness della suite
         -> configurazione + target discovery
         -> git pull --ff-only di rumiai-os
         -> gate completo di cleanliness del target
         -> rumiai-test --validation -- <selection>
         -> pubblicazione della nuova sessione completata
```

Il bootstrap root resta intenzionalmente minimale. La logica evolutiva viene caricata soltanto dopo il self-update della suite.

## Sessioni pendenti e cleanliness

File untracked arbitrari continuano a non essere ammessi prima dell'effettiva validation.

L'unica eccezione operativa è una directory visibile `sessions/<run-id>/` prodotta come validation session completata dal runner. Prima di eseguire una nuova validation, il launcher:

1. verifica che la sessione abbia metadata e risultati completi;
2. legge dalla sessione l'esatto `rumiai-tests-commit` contro cui è stata prodotta;
3. costruisce un commit di sola evidenza basato su quel commit esatto, senza modificare HEAD o index della working tree;
4. pubblica il commit sul remote configurato sotto:

```text
validation/<run-id>
```

5. verifica che il ref remoto punti all'evidenza attesa;
6. soltanto dopo la verifica elimina la copia locale untracked della sessione.

Se il push o la verifica falliscono, la sessione locale resta intatta e il launcher termina con errore. Alla successiva invocazione lo stesso `./rumiai-validate` ritenta la pubblicazione prima di una nuova validation.

Una pubblicazione già presente con lo stesso contenuto viene riconosciuta in modo idempotente; un ref remoto omonimo con parent o tree differenti è un conflitto e non viene sovrascritto.

Le sessioni con runner status `0`, `1` o `2` sono evidenza completata e vengono pubblicate. Le sessioni incomplete/nascoste, incluse quelle lasciate da un runner error prima della pubblicazione finale, non vengono pubblicate automaticamente e continuano a bloccare il gate di cleanliness.

Dopo la gestione delle sessioni pendenti, la working tree di `rumiai-tests` deve essere completamente clean prima dell'invocazione di `rumiai-test --validation`.

## Perché la pubblicazione non modifica `main`

Le evidenze dei diversi host non vengono committate automaticamente su `main`.

Questo mantiene invariato il commit della suite che deve essere validato da tutti gli host. Se una sessione del primo host avanzasse `main`, il secondo host validerebbe una revisione diversa della suite pur usando gli stessi test.

Il ref `validation/<run-id>` è quindi un ref di conservazione dell'evidenza, non una nuova baseline della suite. Un'eventuale successiva consolidazione delle evidenze in `main` è una fase distinta e non appartiene al launcher.

## Operazioni Git

Gli aggiornamenti del codice restano esclusivamente:

```text
git pull --ff-only
```

Per la sola pubblicazione di una validation session completata il launcher può usare primitive Git equivalenti a `add` su index temporaneo, `commit-tree` e `push` verso il ref univoco di evidenza.

Il launcher non esegue automaticamente:

```text
git merge
git rebase
git push --force
```

e non crea commit di codice, test, configurazione o altro contenuto locale.

## Configurazione

`rumiai-validate.conf` è un file versionato con record:

```text
key<TAB>value
```

Le chiavi correnti sono:

```text
rumiai-os-commit
selection
```

La configurazione viene aggiornata insieme ai test quando una modifica richiede una nuova physical validation. La stessa configurazione viene eseguita sui diversi host di riferimento.
