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
./rumiai-validate --no-suite-update --rumiai-os-commit=<commit> <scope-name>
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

Opzioni revision-specifiche:

```text
--rumiai-os-commit=<commit>
    usa l'esatto commit target per questa invocazione; è mutuamente esclusivo
    con un rumiai-os-commit già pin-nato nello scope

--no-suite-update
    non esegue l'auto-update di rumiai-tests per questa invocazione e usa
    l'esatto commit della suite già checkoutato
```

Queste opzioni servono soprattutto agli orchestratori multi-host: la coppia esatta `rumiai-tests` / `rumiai-os` viene congelata una sola volta prima del fan-out e riutilizzata su ogni host. Non cambiano selezione dei test, requirement o semantica del target.

## Self-location, update e menu

Nel percorso normale il launcher:

1. risolve la propria root canonica e vi esegue `cd`;
2. rifiuta modifiche tracked locali prima dell'auto-update;
3. esegue `git pull --ff-only` su `rumiai-tests`;
4. se la suite cambia, riavvia il launcher aggiornato preservando scope, isolamento ed eventuale override target;
5. soltanto dopo il self-update scopre gli scope `validation/*.conf`;
6. senza scope nominato mostra `0) full product (all tests)` e gli altri scope in ordine C/bytewise.

Con `--no-suite-update` il passo 3 viene deliberatamente omesso: la revisione della suite già checkoutata è l'identità frozen della validation e non può cambiare a metà di una matrice.

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
rumiai-os-commit<TAB><commit-esatto-opzionale>
selection<TAB><test-or-group>
```

`selection` è ripetibile. Uno scope `task` richiede almeno una selection.

Uno scope `health` senza selection rappresenta la root completa `tests/`. Se `rumiai-os-commit` è omesso e non è presente un override di invocazione, il launcher aggiorna il checkout prodotto primario e valida il suo HEAD committed corrente, registrando comunque l'esatto SHA nell'evidenza. Un commit esplicito nello scope resta disponibile per riproduzioni revision-specifiche; `--rumiai-os-commit=<commit>` consente invece a un orchestratore di congelare per la sola invocazione una revisione corrente già risolta. Le due forme di pin non possono essere combinate.

Gli scope scelgono **quali test eseguire**. Non dichiarano i prerequisiti di esecuzione dei test.

I prerequisiti sono definiti separatamente sotto:

```text
validation/requirements/*.conf
```

Ogni requirement profile usa:

```text
selection<TAB><test-or-group>
target-package<TAB><package-spec>
pkg-catalog-commit<TAB><commit-esatto-opzionale>
```

`selection` e `target-package` sono ripetibili. Il launcher espande sia lo scope sia le selection dei requirement profile con `rumiai-test --list`; un profile si applica quando almeno un test scoperto coincide. Per gli scope task i package dei profile applicabili vengono uniti e deduplicati automaticamente. Nella full product validation, invece, i requirement profile attivi devono selezionare insiemi di test disgiunti: la baseline viene eseguita senza quei test e ogni profile viene eseguito in un clone disposable separato con i soli package dichiarati da quel profile. In questo modo un prerequisito non altera le precondizioni di test appartenenti a un altro gruppo.

`pkg-catalog-commit` è opzionale. Se assente, il path reale `pkg` può usare lo snapshot corrente e il launcher registra il commit effettivamente osservato; se presente, lo snapshot osservato deve coincidere.

Per compatibilità, uno scope nominato senza `kind` viene interpretato come `task`.

## Preparazione del target

Il checkout prodotto individuato nel workspace è un **source/update point**, non il target eseguito dalla validation.

Il launcher:

1. aggiorna quel checkout con `git pull --ff-only`;
2. richiede che sia clean;
3. usa il suo HEAD committed corrente se non esiste alcun pin; altrimenti verifica e usa l'esatto commit dichiarato dallo scope oppure dall'override di invocazione;
4. espande il set di test richiesto con `rumiai-test --list`;
5. risolve automaticamente tutti i requirement profile che intersecano il set scoperto;
6. nella full product validation costruisce una baseline che esclude i test reclamati dai requirement profile e un gruppo separato per ciascun profile attivo;
7. per ogni gruppo crea un **clone Git indipendente** in una root temporanea;
8. effettua checkout detached dell'esatto commit risolto;
9. seleziona la piattaforma target con il reale `osarch update`;
10. installa attraverso il reale `pkg install` soltanto i target package richiesti da quel gruppo;
11. ripristina nel clone l'origin canonica osservata sul checkout primario.

Se la preparazione di un prerequisito dichiarato fallisce, la validation fallisce come errore di preparazione: non viene trasformata in `SKIP` del test.

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

Su Darwin la root disposable viene creata direttamente sotto `/tmp`, invece di ereditare il `TMPDIR` host, per mantenere corti i pathname dei socket Unix usati da software reale dentro la validation. Le root figlie restano protette, isolate, auditate e rimosse con le stesse regole degli altri host.

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

il launcher non reimplementa la discovery. Riusa il set canonico già espanso con `rumiai-test --list` prima della preparazione dei requirement e, per ciascun test-id risultante:

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

Lo scope `health` senza selection è la **validazione completa del prodotto**: esegue tutta la suite permanente contro il prodotto corrente e prepara automaticamente i prerequisiti dichiarati dalla suite. Serve a rilevare regressioni anche in meccanismi diversi da quello appena modificato.

Gli `SKIP` restano visibili e possono essere corretti solo quando il test è realmente non applicabile all'host corrente. Uno `SKIP` causato da un prerequisito preparabile ma non dichiarato è un difetto della suite, non un risultato accettabile da nascondere.

Gli scope task restano un'ottimizzazione per il ciclo di sviluppo; non devono essere composti manualmente dall'operatore per ottenere la copertura completa del prodotto.

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
discovered-tests    set canonico dei test selezionati, sempre presente
requirement-groups/  profili attivi, test reclamati e baseline calcolata quando applicabile
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
