# Nano Banana 2 Vertex Tool

Tool locale per usare Vertex AI con tre workflow immagine:

- sostituire la persona della prima immagine con quella della seconda;
- generare la stessa persona con posa ed espressione diverse;
- inserire una persona dentro un background.

## Avvio

Apri `start-nanobanana.bat`, poi visita l'URL mostrato dalla console, di solito:

```text
http://127.0.0.1:5177
```

Non serve installare pacchetti npm: il server usa solo Node.js.

## API

Nel box in alto inserisci una API key Vertex AI. Il modello predefinito e':

```text
gemini-3.1-flash-image-preview
```

L'endpoint predefinito segue la documentazione Vertex per API key:

```text
https://aiplatform.googleapis.com
```

Il campo `Motore` puo' usare:

- `Auto: Vertex poi Gemini`: prova Vertex e, se riceve un `429`, passa automaticamente alla Gemini API;
- `Solo Vertex`: usa solo `aiplatform.googleapis.com`;
- `Solo Gemini API`: usa direttamente `generativelanguage.googleapis.com`.

Il tool non applica limiti locali di MB sui file caricati. Vertex AI puo' comunque imporre limiti lato API, specialmente quando le immagini vengono inviate inline in base64.

Per immagini grandi puoi anche incollare in ogni slot un URI `gs://...` o un URL `https://...` pubblico: in quel caso il backend usa `fileData` invece di inviare l'immagine inline.

## Output

Puoi generare da 1 a 4 immagini per volta. Il tool invia richieste parallele a Vertex e aggiunge ogni risultato alla libreria condivisa.

Aspect ratio disponibili per Gemini image:

```text
Auto, 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
```

Formati file output supportati dalla documentazione Vertex:

```text
PNG, JPEG
```

La qualita JPEG si applica solo quando scegli `JPEG`. La dimensione output puo' essere `Auto`, `512`, `1K`, `2K` o `4K`, se supportata dal modello selezionato.

## Diagnostica API

Il bottone `Test API` controlla:

- se Vertex Express accetta la chiave;
- se il modello selezionato e' raggiungibile senza avviare una generazione immagine;
- se la Gemini API classica e' attiva o disabilitata sul progetto.

Il test non crea immagini.

## Errore 429

`Resource exhausted` / `429` significa quota, rate limit o capacita' condivisa esaurita lato Google. Il tool prova il fallback automatico verso Gemini API quando `Motore` e' su `Auto`. Se succede ancora, riduci `Numero immagini` a `1`, usa `512 px`, aspetta qualche minuto o richiedi un aumento quota in Google Cloud.
