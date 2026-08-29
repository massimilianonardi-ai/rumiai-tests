# RumiAI Test Authoring

Prima di creare o modificare test permanenti devono essere letti i riferimenti canonici nel repository `massimilianonardi-ai/rumiai-dev`:

```text
TESTING.md
TEST-PATTERNS.md
RUNNER.md        quando la modifica riguarda il contratto del runner
```

`TESTING.md` definisce le regole normative della suite.

`TEST-PATTERNS.md` conserva pattern, failure mode e primitive riutilizzabili già emerse e validate durante lo sviluppo dei test. Prima di inventare una nuova soluzione tecnica occorre verificare se il problema è già coperto lì o da una reference implementation sotto `lib/`.

## Reference implementation e indipendenza

I file sotto `lib/` possono avere due ruoli distinti:

- piccole librerie runtime deliberate della piattaforma di test;
- reference implementation per l'authoring.

Una primitive materialmente necessaria a stabilire l'esito di un test dovrebbe normalmente essere copiata inline quando ciò preserva meglio indipendenza e riproducibilità storica.

Ogni copia inline proveniente da una reference implementation deve dichiarare la provenienza immutabile:

```sh
# Reference implementation copied from:
# massimilianonardi-ai/rumiai-tests@<commit>:lib/<name>.lib
# Copied inline intentionally to preserve test independence.
```

Il riferimento deve contenere un commit Git, non un branch.

Se una reference implementation viene successivamente corretta per un bug grave, il commit registrato nei test permette di individuare tutte le copie potenzialmente interessate e di decidere esplicitamente quali test storici devono essere aggiornati o rivalutati.

## Primitive interattive

La reference implementation corrente per pilotare in modo non interattivo programmi che leggono da TTY è:

```text
lib/interactive.lib
```

La documentazione del pattern, comprese le differenze `expect(1)` / `script(1)` osservate fisicamente su macOS e Linux, è in `rumiai-dev/TEST-PATTERNS.md`.
