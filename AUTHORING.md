# RumiAI Test Authoring

Prima di creare o modificare test permanenti devono essere letti:

```text
rumiai-dev/TESTING.md
rumiai-dev/TEST-PATTERNS.md
rumiai-dev/RUNNER.md        quando la modifica riguarda il runner
```

## Principio

Un test permanente protegge una proprietà corrente, non una particolare forma del codice di test.

Prima di aggiungere un test o una primitive verificare:

1. quale requisito/invariante protegge;
2. se la stessa proprietà è già coperta;
3. se esiste già un helper sotto `lib/` per l'infrastruttura comune;
4. se la verifica può osservare il comportamento invece di ispezionare dettagli incidentali dell'implementazione;
5. se il costo futuro di manutenzione è proporzionato al rischio.

## Librerie comuni

Le librerie sotto `lib/` possono essere dipendenze runtime deliberate dei `.test` della stessa revisione della suite.

Per il target `rumiai-os` esistono già:

```text
lib/rumiai-os-target.lib
lib/rumiai-os-fixture.lib
```

Per il pilotaggio TTY interattivo esiste:

```text
lib/interactive.lib
```

I test devono preferire il riuso di queste primitive quando il contratto coincide.

La revisione `rumiai-tests` registrata da una validation identifica anche la versione esatta delle librerie comuni usate, quindi non è necessario copiare helper inline soltanto per riproducibilità storica.

## Copie inline

Una copia inline di una primitive comune è eccezionale. Deve essere accompagnata da un commento che spieghi **perché il congelamento locale è semanticamente necessario**.

Un riferimento al commit di provenienza può essere mantenuto quando utile, ma non costituisce da solo una giustificazione alla duplicazione.

Le copie inline storiche devono essere migrate quando provocano drift o manutenzione duplicata.

## Granularità

Non creare un nuovo `.test` per ogni variante meccanica se più casi verificano lo stesso contratto e possono essere diagnosticati bene dentro una sola unità.

Durante l'audit usare la classificazione:

```text
keep
simplify
merge
remove
```

## White-box

Controlli strutturali sono appropriati quando la struttura è parte del contratto. In caso contrario preferire fixture/fake che osservano effetti, argomenti, status, output e file prodotti.

Evitare come default grep di stringhe interne, nomi di funzioni private, numeri di riga o ordine testuale del sorgente.
