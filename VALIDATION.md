# RumiAI validation launcher

`rumiai-validate` è il launcher operativo per eseguire una validation run configurata sugli host disponibili senza ricostruire manualmente ogni volta la CLI di `rumiai-test`.

Il contratto autorevole è definito in:

```text
massimilianonardi-ai/rumiai-dev/decisions/rumiai-tests/2026-09-08-validation-launcher.md
```

## Uso

Il comando normale dell'operatore è soltanto:

```text
./rumiai-validate
```

Non è necessario eseguire prima `git pull` né portarsi manualmente in una directory specifica, purché `rumiai-validate` venga invocato tramite il proprio pathname oppure sia risolvibile tramite `PATH`.

Il launcher usa due stadi:

```text
rumiai-validate
    -> autodiscovery + cd nella root rumiai-tests
    -> git pull --ff-only di rumiai-tests
    -> eventuale restart del bootstrap aggiornato
    -> lib/sh/rumiai-validate.lib.sh
         -> gate completo di cleanliness della suite
         -> configurazione + target discovery
         -> git pull --ff-only di rumiai-os
         -> gate completo di cleanliness del target
         -> rumiai-test --validation -- <selection>
```

Il bootstrap root resta intenzionalmente minimale. La logica evolutiva viene caricata soltanto dopo il self-update della suite, così un problema nella helper/config locale non impedisce di ricevere una correzione remota.

## Self-update e working tree

Prima del `git pull --ff-only` di `rumiai-tests`, il launcher blocca eventuali modifiche **tracked** locali.

I file **untracked** non impediscono il self-update. Dopo l'aggiornamento, però, la working tree deve risultare completamente pulita prima della validation, coerentemente con `TESTING.md`.

Lo stesso principio viene applicato a `rumiai-os`:

1. modifiche tracked locali bloccano il pull automatico;
2. il launcher esegue `git pull --ff-only`;
3. prima della validation il target deve risultare completamente clean, inclusi gli untracked.

Il launcher non cancella, sposta o modifica automaticamente file locali per ottenere una working tree clean.

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

La configurazione viene aggiornata insieme ai test quando una modifica richiede una nuova physical validation.

La stessa configurazione viene eseguita sui diversi host di riferimento; il launcher rileva e mostra OS/architettura ma non sceglie test differenti in base alla piattaforma.

## Operazioni Git escluse

Il launcher non esegue automaticamente:

```text
git add
git commit
git push
git merge
git rebase
```

Gli aggiornamenti automatici dei checkout sono esclusivamente `git pull --ff-only`.

## Stato dopo una validation

Una validation completata crea una nuova directory sotto `sessions/`. Di conseguenza la working tree di `rumiai-tests` risulta intenzionalmente dirty finché l'evidenza non viene versionata o altrimenti gestita secondo il workflow Git concordato.

Una successiva invocazione di `rumiai-validate` può comunque eseguire il proprio self-update in presenza di quella sessione untracked; prima di avviare una nuova validation applicherà nuovamente il gate completo di cleanliness.
