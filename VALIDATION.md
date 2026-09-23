# RumiAI validation launcher

`rumiai-validate` è il launcher operativo della validation formale.

Il runner canonico resta `rumiai-test`. Il launcher gestisce self-location, self-update, scope, revisione target esatta, isolamento dell'ambiente di validation, audit filesystem e pubblicazione dell'evidenza.

## Uso

Forme supportate:

```text
./rumiai-validate
./rumiai-validate <scope-name>
./rumiai-validate --isolation=session <scope-name>
./rumiai-validate --isolation=test <scope-name>
```

L'opzione di isolamento può essere usata anche senza scope esplicito prima della selezione interattiva.

Modalità:

```text
session
    default; un solo ambiente disposable per l'intera invocazione

test
    un ambiente disposable nuovo per ogni singolo test scoperto
```

Un valore diverso produce errore del launcher.

## Self-location, update e menu

Ad ogni avvio il launcher:

1. risolve la propria root canonica e vi esegue `cd`;
2. rifiuta modifiche tracked locali prima dell'auto-update;
3. esegue `git pull --ff-only` su `rumiai-tests`;
4. se la suite cambia, riavvia il launcher aggiornato preservando la modalità di isolamento richiesta;
5. soltanto dopo il self-update scopre gli scope `validation/*.conf`;
6. senza scope nominato mostra `0) all tests` e gli altri scope in ordine C/bytewise.

`0` seleziona il backing scope:

```text
validation/rumiai-os-health.conf
```

Il nome di uno scope esplicito può contenere soltanto lettere, cifre, `.`, `_` o `-` e non può iniziare con `.` o `-`.

## Workspace condivisi e Git trust

Nel layout canonico:

```text
<rumiai-os-root>/src/rumiai-tests
```

il launcher può operare su volumi condivisi macOS/Linux. Per la sola durata del processo configura `safe.directory` esclusivamente per le root esatte riconosciute di `rumiai-tests` e del checkout prodotto primario.

Non usa wildcard, non usa `safe.directory=*` e non modifica configurazioni Git persistenti dell'utente.

## Configurazione degli scope

Formato:

```text
key<TAB>value
```

Chiavi correnti:

```text
kind<TAB>task|health
rumiai-os-commit<TAB><commit-esatto>
selection<TAB><test-or-group>
```

`selection` è ripetibile. Uno scope `task` richiede almeno una selection.

Uno scope `health` senza selection rappresenta la root completa `tests/` e in modalità `session` produce una singola invocazione:

```text
rumiai-test --validation
```

Per compatibilità, uno scope nominato senza `kind` viene interpretato come `task`.

## Preparazione del target

Il checkout prodotto individuato nel workspace è un **source/update point**, non il target eseguito dalla validation.

Il launcher:

1. aggiorna quel checkout con `git pull --ff-only`;
2. richiede che sia clean;
3. verifica che `rumiai-os-commit` sia disponibile;
4. per ogni ambiente necessario crea un **clone Git indipendente** in una root temporanea;
5. effettua checkout detached dell'esatto commit configurato;
6. ripristina nel clone l'origin canonica osservata sul checkout primario.

I test di validation non vengono quindi mai eseguiti direttamente sul checkout dell'operatore e non usano un worktree Git collegato a esso.

Il clone disposable viene esposto ai test tramite:

```text
RUMIAI_TEST_RUMIAI_OS_ROOT
```

## Ambiente utente isolato

Per i soli processi runner/test dell'ambiente disposable il launcher imposta root temporanee per:

```text
HOME
TMPDIR
TMP
TEMP
XDG_CONFIG_HOME
XDG_CACHE_HOME
XDG_DATA_HOME
XDG_STATE_HOME
XDG_RUNTIME_DIR
RUMIAI_TEST_RUMIAI_OS_ROOT
```

Queste variabili sono confinate al processo figlio; non sostituiscono l'ambiente del processo `rumiai-validate` stesso.

L'isolamento non è una security sandbox: OS, architettura, tool di sistema, rete e altre risorse host non reindirizzate restano quelle reali.

## Isolamento `session`

È la modalità predefinita.

Un solo clone target e un solo insieme di root utente temporanee vengono creati prima della prima selection e riutilizzati per tutte le selection dello scope. Questo consente anche di osservare effetti cumulativi o contaminazioni tra test.

Ogni selection resta una normale invocazione elementare di `rumiai-test --validation`.

## Isolamento `test`

In modalità:

```text
--isolation=test
```

il launcher non reimplementa la discovery. Espande ogni selection con:

```text
rumiai-test --list [selection]
```

e per ciascun test-id risultante:

1. crea un clone target indipendente e nuove root utente;
2. esegue quel singolo test attraverso `rumiai-test --validation -- <test-id>`;
3. acquisisce l'audit finale;
4. distrugge l'ambiente;
5. passa al test successivo.

La modalità serve a verificare meccanicamente che un test non dipenda dallo stato filesystem lasciato da un test precedente.

## Audit filesystem automatico

Ogni ambiente di validation viene osservato automaticamente con snapshot **metadata-only** prima dell'esecuzione e immediatamente prima della distruzione.

Esiti:

```text
CLEAN
CHANGED
ERROR
```

`CHANGED` è evidenza osservativa e non trasforma automaticamente un test in `FAIL`.

`ERROR` indica che l'audit richiesto dalla validation formale non è stato completato e produce errore infrastrutturale della validation.

In modalità `session` esiste un audit dell'intera vita dell'ambiente. In modalità `test` esiste un audit distinto per ogni test.

## Risultati task/health

Per uno scope `task`, tutti i test richiesti devono essere `PASS`. Un `SKIP` richiesto lascia lo scope `NOT VALIDATED`.

Per uno scope `health`, gli exit status restano quelli aggregati delle sessioni; gli `SKIP` rimangono visibili ma non trasformano automaticamente uno status 0 in failure.

La full suite resta un health gate, non un prerequisito universale per ogni work unit.

## Evidenza

Ogni esecuzione elementare di `rumiai-test --validation` continua a produrre una sessione sotto:

```text
sessions/<run-id>/
```

La sessione viene pubblicata su un branch:

```text
validation/<run-id>
```

con parent uguale all'esatto `rumiai-tests-commit` registrato.

Poiché una validation può contenere più sessioni elementari e uno o più ambienti disposable, `rumiai-validate` produce inoltre un record esterno sotto:

```text
validations/<validation-id>/
```

Il record contiene almeno:

```text
validation          metadati globali e aggregate status
selections          selection richieste
sessions            run-id delle sessioni elementari
environment/        audit session-wide, in isolation=session
environments/       audit per test, in isolation=test
discovered-tests    presente quando --list è usato per isolation=test
```

Il record viene pubblicato anch'esso sotto `validation/<validation-id>`, basato sull'esatto commit della suite, senza avanzare `main`.

Una pubblicazione fallita lascia l'evidenza completata locale recuperabile; il lancio successivo tenta prima di pubblicare evidence pendenti.

## Cleanliness e cleanup

Prima della validation effettiva:

- `rumiai-tests` non deve avere modifiche tracked prima dell'auto-update;
- dopo la pubblicazione di evidence pendenti, il working tree della suite deve essere clean;
- il checkout primario `rumiai-os` deve essere clean dopo il pull;
- il commit target configurato deve essere disponibile.

Il launcher non resetta o sposta il checkout primario per eseguire i test.

Gli ambienti disposable vengono distrutti al termine della loro vita. Un fallimento di cleanup produce errore del launcher.

## Scope materializzati

Gli scope disponibili sono sempre quelli presenti nella revisione corrente sotto `validation/*.conf`. Il launcher non sintetizza scope da memoria, nomi di sottosistemi o configurazioni storiche.
