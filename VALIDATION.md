# RumiAI validation launcher

`rumiai-validate` è il launcher operativo delle validation run.

Il runner canonico resta `rumiai-test`; il launcher gestisce self-update, exact target revision, validation scope e pubblicazione dell'evidenza.

## Uso

Configurazione predefinita/versionata storica:

```text
./rumiai-validate
```

Validation scope nominato:

```text
./rumiai-validate <scope-name>
```

Il launcher accetta zero o un argomento. Senza argomenti usa `rumiai-validate.conf`, preservando il workflow operativo esistente. Uno scope nominato viene caricato da:

```text
validation/<scope-name>.conf
```

Il nome deve contenere soltanto lettere, cifre, `.`, `_` o `-` e non può iniziare con `.` o `-`.

## Configurazione

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

Per compatibilità, `kind` può essere assente. Nel file predefinito viene allora interpretato come `health`, preservando la semantica aggregata storica; negli scope nominati viene interpretato come `task`.

La full suite `rumiai-os` è disponibile come health scope esplicito in:

```text
validation/rumiai-os-health.conf
```

ed è eseguibile con:

```text
./rumiai-validate rumiai-os-health
```

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

- `rumiai-tests` deve essere clean dopo l'eventuale pubblicazione di sessioni completate pendenti;
- il checkout principale `rumiai-os` deve essere clean;
- il commit target configurato deve esistere localmente dopo il pull.

Le working tree non vengono modificate con merge, rebase, reset o force push.

## Scope correnti

La suite contiene scope task separati almeno per:

```text
validation/resource-model.conf
validation/srv.conf
```

La full suite resta disponibile come health gate separato:

```text
validation/rumiai-os-health.conf
```

Gli scope task non sostituiscono i controlli di salute complessivi: impediscono soltanto che un fallimento estraneo serializzi o invalidi artificialmente work unit indipendenti.
