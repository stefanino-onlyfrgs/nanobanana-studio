# Nano Banana 2 Studio - Developer Handoff

## Executive Summary

This project is a local browser-based tool for running three image workflows with Google's Nano Banana 2 / Gemini image model:

1. Replace the person in a base image with the person from a second image.
2. Generate the same person with a different pose and expression.
3. Insert a person into a provided background.

The application is intentionally dependency-light:

- Backend: plain Node.js HTTP server in `server.js`.
- Frontend: static HTML/CSS/JS under `public/`.
- Startup: `start-nanobanana.bat`.
- No npm install is required for normal operation.

The app currently supports:

- User-supplied API key through the UI.
- Vertex AI endpoint support.
- Gemini API fallback.
- Uploading local images.
- Using generated images as inputs for later workflows.
- Using `gs://...` and public `https://...` image URIs.
- Generating 1 to 4 images.
- Output format controls.
- Aspect ratio controls.
- Output size controls.
- Output zoom modal.
- Basic API diagnostics.

Sensitive note: an API key was provided during testing, but it is intentionally not documented here and should not be committed anywhere. The app does not persist the API key in localStorage; only non-sensitive settings are saved.

## Current Entry Points

Open the app:

```text
http://127.0.0.1:5177
```

Start the server:

```bat
start-nanobanana.bat
```

Equivalent manual command:

```powershell
node --max-old-space-size=8192 server.js
```

The increased heap size was added because earlier real image tests caused Node to run out of memory when handling large base64 image payloads.

## File Map

```text
server.js
  Local HTTP server, static file serving, API proxy, diagnostics, provider fallback.

public/index.html
  Main UI structure: settings, three workflow panels, result area, shared library, zoom modal.

public/styles.css
  Full UI styling, responsive layout, image preview handling, zoom modal styling.

public/app.js
  Frontend state, image upload/library management, workflow execution, result rendering, API diagnostics.

package.json
  Minimal package metadata and start script.

start-nanobanana.bat
  Windows startup script.

README.md
  User-facing quickstart and operational notes.

diagnostic-nanobanana.js
  Developer diagnostic script for direct Google API image tests.

e2e-ui-test.js
  Headless Chrome UI test with a real generation path.

preview-fit-test.js
  Headless Chrome UI test for input image preview scaling.
```

Generated local artifacts may exist from testing:

```text
diagnostic-*.png
preview-*.png
ui-check*.png
e2e-ui-test.png
nanobanana-server.log
nanobanana-server.err.log
```

These are disposable diagnostics and should not be treated as source.

## Functional Workflows

### Workflow 1: Replace Person

Inputs:

- `swapBase`: first image, containing pose/background/light/camera.
- `swapIdentity`: second image, containing the identity to transfer.

Prompt currently used in English:

```text
Create a new edited image. Keep the exact same pose as the person in the first image. Keep the same background as the first image. Keep the same lighting and camera as the first image. Replace the person in the first image with the person from the second image. The facial and physical physiognomy must be perfectly identical in every detail and proportion to the person in the second image. Return only the generated image, with no text.
```

### Workflow 2: Same Person, New Pose

Input:

- `poseSource`: source image. This can be uploaded or selected from the generated/shared library.

Prompt currently used:

```text
Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.
```

### Workflow 3: Person Into Background

Inputs:

- `backgroundScene`: target background.
- `backgroundPerson`: person to insert.

Prompt currently used:

```text
Create a new edited image. Insert the person from the second image, identical in every detail of facial and physical physiognomy, and place them proportionally and coherently into the background of the first image. Return only the generated image, with no text.
```

## Frontend State Model

The frontend keeps all working state in memory:

```js
const state = {
  assets: [],
  assignments: {},
  lastResults: [],
};
```

`assets` contains uploaded images, generated images, and URI references.

Asset shapes:

```js
{
  id,
  name,
  mimeType,
  data,       // base64 for inline assets
  fileUri,    // gs:// or https:// for URI assets
  kind,
  source,     // upload | generated | uri
  createdAt
}
```

`assignments` maps UI slots to selected asset IDs.

`lastResults` powers the result zoom modal.

## API Key Handling

The API key is entered in the UI via `#apiKey`.

Important behavior:

- The key is sent only to the local backend.
- The local backend forwards it to Google via `x-goog-api-key`.
- The key is not stored in localStorage.
- The UI has a "Mostra key" toggle for local visibility only.

Settings that are persisted:

- model
- endpoint
- provider mode
- aspect ratio
- image count
- output MIME type
- output size
- JPEG quality

## Provider Modes

The UI exposes `Motore`:

```text
Auto: Vertex poi Gemini
Solo Vertex
Solo Gemini API
```

### Vertex

Endpoint shape:

```text
https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
```

Payload image parts use camelCase:

```js
{
  inlineData: {
    mimeType: "image/png",
    data: "<base64>"
  }
}
```

URI image parts:

```js
{
  fileData: {
    mimeType: "image/jpeg",
    fileUri: "gs://bucket/file.jpg"
  }
}
```

### Gemini API

Endpoint shape:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

Payload image parts use snake_case:

```js
{
  inline_data: {
    mime_type: "image/png",
    data: "<base64>"
  }
}
```

URI image parts:

```js
{
  file_data: {
    mime_type: "image/jpeg",
    file_uri: "https://example.com/file.jpg"
  }
}
```

## Fallback Logic

The backend has a `generateOne()` helper inside `handleGenerate()`.

Behavior:

- If provider mode is `vertex`, only Vertex is used.
- If provider mode is `gemini`, only Gemini API is used.
- If provider mode is `auto`, Vertex is tried first.
- If Vertex returns `429`, Gemini API is tried.
- If Vertex returns 200 but no image, Gemini API is tried.
- Gemini API has retry delays on 429: `8000ms`, then `20000ms`.

Generation is sequential, not parallel. This is deliberate.

Earlier versions used `Promise.allSettled()` for multiple images. That caused unreliable behavior with 4 images because Google would often return 1-2 outputs, no image in some responses, or quota/rate-limit errors. The current implementation attempts up to `imageCount * 2` requests and collects images until it reaches the requested count or hits quota/capacity limits.

Response metadata:

```js
{
  images,
  text,
  model,
  requestedCount,
  attemptedRequests,
  errors,
  provider,
  providerAttempts,
  raw
}
```

## Output Controls

Supported aspect ratios in UI/backend:

```text
auto
1:1
1:4
1:8
2:3
3:2
3:4
4:1
4:3
4:5
5:4
8:1
9:16
16:9
21:9
```

Supported output MIME types:

```text
image/png
image/jpeg
```

Supported output sizes:

```text
auto
512
1K
2K
4K
```

Important correction already made:

- The UI initially used `0.5K`; the working API value is `512`.

## Input Preview Handling

There was a persistent UX bug where uploaded images appeared as cropped close-ups, for example only hair was visible. The root cause was image sizing inside the preview box.

Current CSS fix:

```css
.preview {
  display: grid;
  place-items: center;
  width: 100%;
  height: clamp(260px, 34vh, 520px);
  overflow: hidden;
}

.preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center center;
  display: block;
}
```

This is intentionally different from the result/library card image rules. Input previews must show the whole source image, not fill/crop the frame.

## Output Zoom Modal

Outputs can be zoomed from the result panel.

User interactions:

- Click the output image.
- Or click `Zoom`.
- Use `+`, `-`, `100%`.
- Mouse wheel zooms in/out.
- `Escape` closes the modal.

Implementation:

- Modal HTML lives at the bottom of `public/index.html`.
- Modal state lives in `public/app.js`:

```js
let modalZoom = 1;
```

Functions:

```js
openImageModal(index)
closeImageModal()
changeModalZoom(delta)
updateModalZoom()
```

## Diagnostics

The UI has a `Test API` button.

It calls:

```text
POST /api/test-key
```

The backend checks:

- Vertex Express via `gemini-2.5-flash:countTokens`.
- Selected image model via a text-only probe.
- Gemini API model listing.

Expected nuance:

- Image models may reject text-only generation with "The request is not supported by this model."
- The app treats that as "model reachable" for diagnostics.

## Known Google Failure Modes

### 429 RESOURCE_EXHAUSTED

Seen during real testing.

Meaning:

- quota exhausted,
- rate limit hit,
- or shared model capacity unavailable.

Tool behavior:

- Auto mode falls back from Vertex to Gemini API.
- Gemini path retries twice on 429.
- If both providers are exhausted, the UI shows a quota/capacity message.

Recommended user mitigation:

```text
Motore: Solo Gemini API
Numero immagini: 1
Dimensione: 512 px
```

Then retry after a short wait.

### 200 OK But No Images

Seen especially in workflow 2 before prompt/fallback corrections.

Mitigation implemented:

- Prompts now explicitly say "Create a new image" and "Return only the generated image, with no text."
- In Auto mode, if Vertex returns no images, the backend tries Gemini API.
- The sequential generation loop continues when a single response has no image.

### Server Out Of Memory

Seen after image-heavy requests.

Mitigation:

```bat
node --max-old-space-size=8192 server.js
```

This is now in both `package.json` and `start-nanobanana.bat`.

## Tests Performed

### Syntax

```powershell
node --check server.js
node --check public\app.js
```

Both pass.

### Server Health

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5177/api/health
```

Expected:

```json
{"ok":true}
```

### Direct Google API Diagnostics

Script:

```text
diagnostic-nanobanana.js
```

Run with:

```powershell
$env:NANOBANANA_API_KEY="<redacted>"
node diagnostic-nanobanana.js
```

It tests:

- Gemini text-to-image
- Gemini image edit
- Vertex text-to-image
- Vertex image edit

### UI E2E Test

Script:

```text
e2e-ui-test.js
```

Run with:

```powershell
$env:NODE_PATH="C:\Users\quain\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$env:NANOBANANA_API_KEY="<redacted>"
C:\Users\quain\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe e2e-ui-test.js
```

This launches Chrome headless, loads the app, uploads synthetic images, runs a generation, and verifies that result cards appear.

### Preview Fit Test

Script:

```text
preview-fit-test.js
```

Purpose:

- Creates extreme portrait and landscape PNGs.
- Uploads them into workflow 1.
- Captures `preview-fit-test.png`.
- Verifies that the preview images are rendered.

This test was used to verify the no-crop preview fix.

### 4-Image Generation Test

A real backend test requested 4 images with `providerMode: "gemini"` and later with Auto/fallback behavior.

Observed after fixes:

```json
{
  "requested": 4,
  "attempted": 4,
  "imageCount": 4
}
```

Workflow 2 was also tested with 4 requested images:

```json
{
  "provider": "Vertex + Gemini API",
  "requested": 4,
  "attempted": 4,
  "imageCount": 4,
  "errors": []
}
```

Vertex produced a 429 in that test, and Gemini API fallback completed the request.

## Implementation Constraints And Tradeoffs

### No npm dependency for production

The production app intentionally uses Node built-ins and static assets only. This makes `start-nanobanana.bat` reliable on the user's machine without `npm install`.

Playwright is used only in optional diagnostic scripts through the bundled Codex runtime path.

### Base64 memory pressure

The app accepts large local uploads in the UI, but base64-encoding large images increases memory usage. Google can also impose request-size limits. For very large assets, `gs://...` or public `https://...` URI inputs are supported and preferable.

### Multiple images

The tool cannot force Google to return N images from one response. Instead, it makes repeated generation calls until it collects N images. This is more reliable but slower and can consume more quota.

### Identity preservation

The prompts ask for strong facial/physical identity preservation. Actual fidelity is model-dependent and cannot be guaranteed by the application layer. The app's responsibility is correct reference image ordering, prompt consistency, and transport correctness.

## Operational Recommendations

For stable user operation:

```text
Motore: Auto: Vertex poi Gemini
Numero immagini: 1-2 for normal use, 4 when quota is healthy
Dimensione: 512 px when testing or under quota pressure
Formato tela: 1:1 or desired production ratio
File output: PNG
```

For troubleshooting:

1. Click `Test API`.
2. If Gemini API is disabled, enable `generativelanguage.googleapis.com`.
3. If 429 appears, switch to `Solo Gemini API`, set `Numero immagini` to `1`, and `Dimensione` to `512 px`.
4. If the server stops responding, restart via `start-nanobanana.bat`.
5. Check `nanobanana-server.err.log`.

## Suggested Next Engineering Tasks

1. Add server-side image resizing/compression before inline upload.
   This would reduce base64 payload size and memory pressure.

2. Add a persistent generation history.
   Current history is in-memory and resets on page refresh.

3. Add per-result metadata display.
   Provider, request number, model, aspect ratio, and size would help debugging.

4. Add cancellation.
   Long 4-image generations currently run until completion or timeout.

5. Add drag/pan in zoom modal.
   Current modal supports zoom and scroll. Panning interaction would improve inspection.

6. Add a clean test command.
   Example:

   ```json
   {
     "scripts": {
       "test:preview": "node preview-fit-test.js",
       "test:e2e": "node e2e-ui-test.js"
     }
   }
   ```

   This requires documenting `NODE_PATH` for Playwright or adding dev dependencies.

7. Move diagnostics to `scripts/`.
   Current diagnostic scripts are in the root for speed of iteration. A mature repo layout should move them under `scripts/` or `tests/`.

## External References

- Vertex AI error 429: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/provisioned-throughput/error-code-429
- Google Nano Banana 2 developer announcement: https://blog.google/innovation-and-ai/technology/developers-tools/build-with-nano-banana-2/
- Gemini API image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Vertex AI generative AI docs: https://cloud.google.com/vertex-ai/generative-ai/docs

