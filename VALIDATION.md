# RumiAI validation launcher

`rumiai-validate` è il launcher operativo per eseguire una validation run configurata sugli host disponibili senza ricostruire manualmente ogni volta la CLI di `rumiai-test`.

Il contratto autorevole è definito in:

```text
massimilianonardi-ai/rumiai-dev/decisions/rumiai-tests/2026-09-08-validation-launcher.md
```

## Uso

Dalla root di `rumiai-tests`, oppure invocando l'eseguibile tramite un pathname da qualunque current working directory:

```text
./rumiai-validate
```

Il launcher:

1. individua la propria root;
2. richiede una working tree `rumiai-tests` pulita;
3. esegue `git pull --ff-only` su `rumiai-tests`;
4. se il checkout è stato aggiornato, riavvia l'eseguibile appena aggiornato;
5. legge `rumiai-validate.conf`;
6. individua `rumiai-os` tramite `lib/rumiai-os-target.lib`;
7. richiede una working tree `rumiai-os` pulita;
8. esegue `git pull --ff-only` su `rumiai-os`;
9. verifica l'HEAD `rumiai-os` configurato;
10. mostra piattaforma, revisioni e selezione;
11. esegue `rumiai-test --validation -- <selection>`;
12. restituisce lo stesso exit status del runner.

Il launcher non esegue automaticamente `git add`, `git commit`, `git push`, merge o rebase.

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

## Stato dopo una validation

Una validation completata crea una nuova directory sotto `sessions/`. Di conseguenza la working tree di `rumiai-tests` risulta intenzionalmente dirty finché l'evidenza non viene versionata o altrimenti gestita secondo il workflow Git concordato.

Una nuova esecuzione di `rumiai-validate` rifiuta una working tree dirty, coerentemente con il contratto delle validation run.
