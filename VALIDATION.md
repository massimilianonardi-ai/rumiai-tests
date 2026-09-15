# RumiAI validation launcher

`rumiai-validate` è il launcher operativo delle validation run.

Il runner canonico resta `rumiai-test`; il launcher gestisce self-location, self-update, exact target revision, validation scope e pubblicazione dell'evidenza.

## Uso

Se avviato senza argomenti:

```text
./rumiai-validate
```

il launcher:

1. risolve il proprio pathname e determina la root canonica di `rumiai-tests`;
2. esegue `cd` nella root della suite, indipendentemente dalla current working directory iniziale;
3. tenta ad ogni lancio `git pull --ff-only` su `rumiai-tests`;
4. se la suite cambia, riavvia il bootstrap aggiornato;
5. soltanto dopo il self-update scopre gli scope `validation/*.conf`;
6. mostra gli scope in ordine deterministico con un elenco numerato;
7. chiede all'utente il numero dello scope da eseguire.

Esempio alla revisione corrente:

```text
Available validation scopes:
  1) nodejs-live
  2) resource-model
  3) rumiai-os-health
  4) srv
Select validation scope:
```

L'esempio non è una lista hardcoded: gli scope effettivi sono sempre quelli materializzati sotto `validation/` nella revisione aggiornata.

Input vuoto, non numerico o fuori intervallo produce una nuova richiesta. EOF prima di una scelta valida è un errore del launcher.

Questa modalità è adatta anche all'avvio da Finder/Files: il launcher non dipende dalla directory da cui è stato aperto.

Per automazione o uso non interattivo resta disponibile la forma nominata:

```text
./rumiai-validate <scope-name>
```

Lo scope nominato salta il menu, ma non salta self-location, `cd`, self-update, cleanliness gate, exact target revision o pubblicazione delle evidence.

Il nome deve contenere soltanto lettere, cifre, `.`, `_` o `-` e non può iniziare con `.` o `-`.

## Discovery degli scope

Gli scope disponibili sono i file regolari versionati:

```text
validation/<scope-name>.conf
```

Il menu non contiene una lista hardcoded: viene ricostruito dalla revisione corrente della suite **dopo** il self-update e ordinato con ordinamento C/bytewise.

Il file `rumiai-validate.conf` può restare nel repository per compatibilità o per work unit storiche/concorrenti, ma non è più selezionato implicitamente da `./rumiai-validate` senza argomenti.

Il launcher non sintetizza scope da configurazioni precedenti o da nomi di sottosistemi. Un nuovo task compare nel menu soltanto quando la relativa work unit materializza un `validation/<scope-name>.conf` coerente con l'autorità corrente.

## Configurazione di uno scope

Formato record:

```text
key<TAB>value
```

Chiavi:

```text
kind<TAB>task|health
rumiai-os-commit<TAB><commit>
selection<TAB><test-or-group>
```

`selection` è ripetibile. Almeno una selection è obbligatoria.

Per compatibilità, `kind` può essere assente; uno scope nominato senza `kind` viene interpretato come `task`.

## Semantica

Ogni `selection` viene passata separatamente a:

```text
rumiai-test --validation -- <selection>
```

Il runner resta quindi a singola selection.

Per uno scope `task`, il launcher considera lo scope `VALIDATED` soltanto quando tutti i test effettivamente richiesti hanno PASS. Un test richiesto con SKIP rende lo scope `NOT VALIDATED` senza cambiare retroattivamente lo status del test.

Per uno scope `health`, gli exit status restano quelli aggregati del runner; gli SKIP restano visibili ma non trasformano automaticamente uno status 0 in failure.

## Target revision e parallelismo

Il launcher aggiorna il checkout principale `rumiai-os` con `git pull --ff-only` e richiede che sia clean.

Se l'HEAD corrente coincide con `rumiai-os-commit`, usa il checkout principale.

Se il commit configurato è diverso ma disponibile nel repository, il launcher crea un Git worktree detached temporaneo dell'esatta revisione e imposta il normale override di test:

```text
RUMIAI_TEST_RUMIAI_OS_ROOT
```

Il checkout principale non viene resettato né spostato. Questo permette a scope differenti di puntare a revisioni prodotto differenti senza serializzare lo sviluppo sul checkout dell'operatore.

Il worktree temporaneo viene rimosso al termine; una mancata rimozione è errore del launcher.

## Evidenza e pubblicazione

Ogni validation run elementare produce la normale sessione sotto `sessions/` e viene pubblicata sul remote come:

```text
validation/<run-id>
```

La pubblicazione conserva il parent esatto `rumiai-tests-commit` registrato dalla sessione e non avanza `main`.

Uno scope con più selection produce più sessioni elementari. L'insieme delle sessioni, la configurazione versionata dello scope e l'esatto commit della suite costituiscono l'evidenza del task scope.

Una full-suite session può ancora essere analizzata per subset: PASS dei test pertinenti restano evidence delle proprietà esercitate anche se la sessione complessiva contiene fallimenti estranei.

## Cleanliness

Prima della validation effettiva:

- il bootstrap rifiuta l'auto-update se `rumiai-tests` ha modifiche tracked locali;
- `rumiai-tests` deve essere clean dopo l'eventuale pubblicazione di sessioni completate pendenti;
- il checkout principale `rumiai-os` deve essere clean;
- il commit target configurato deve esistere localmente dopo il pull.

Le working tree non vengono modificate con merge, rebase, reset o force push.

## Scope correnti

Alla revisione corrente gli scope materializzati comprendono:

```text
validation/nodejs-live.conf
validation/resource-model.conf
validation/rumiai-os-health.conf
validation/srv.conf
```

`nodejs-live`, `resource-model` e `srv` sono task scope. `rumiai-os-health` è il health gate della full suite.

Lo scope `nodejs-live` corrente è quello materializzato dalla remediation Node.js attiva e contiene le selection richieste da quella decisione; non è il precedente gate live isolato.

Nuovi scope compariranno automaticamente nel menu quando verranno materializzati con revisioni e selection corrette.

Gli scope task non sostituiscono i controlli di salute complessivi: impediscono soltanto che un fallimento estraneo serializzi o invalidi artificialmente work unit indipendenti.
