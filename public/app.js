const PROMPTS = {
  swap:
    "Create a new edited image. Keep the exact same pose as the person in the first image. Keep the same background as the first image. Keep the same lighting and camera as the first image. Replace the person in the first image with the person from the second image. The facial and physical physiognomy must be perfectly identical in every detail and proportion to the person in the second image. Return only the generated image, with no text.",
  pose:
    "Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.",
  background:
    "Create a new edited image. Insert the person from the second image, identical in every detail of facial and physical physiognomy, and place them proportionally and coherently into the background of the first image. Return only the generated image, with no text.",
};

const WORKFLOWS = {
  swap: {
    title: "Sostituzione persona",
    slots: ["swapBase", "swapIdentity"],
  },
  pose: {
    title: "Nuova posa",
    slots: ["poseSource"],
  },
  background: {
    title: "Persona in background",
    slots: ["backgroundScene", "backgroundPerson"],
  },
};

const SLOT_NAMES = {
  swapBase: "Persona 1",
  swapIdentity: "Persona 2",
  poseSource: "Immagine sorgente",
  backgroundScene: "Background 1",
  backgroundPerson: "Persona 2",
};

const state = {
  assets: [],
  assignments: {},
  lastResults: [],
  lastResultMeta: null,
  video: {
    fileName: "",
    mimeType: "",
    base64: "",
    duration: 0,
    width: 0,
    height: 0,
    objectUrl: "",
    analysis: null,
    analysisModel: "",
    bestFrameTimestamp: null,
    frameDataUrl: "",
    frameAtSecond: 0,
    lastFrameAssetId: null,
  },
};

const DB_NAME = "nanobanana";
const DB_VERSION = 1;
const DB_STORE = "assets";
const ASSIGNMENTS_KEY = "nanobanana-assignments";

let currentAbort = null;
let activeGenerateButton = null;
let activeGenerateLabel = "";

const apiKeyInput = document.querySelector("#apiKey");
const modelInput = document.querySelector("#model");
const endpointInput = document.querySelector("#apiEndpoint");
const providerModeInput = document.querySelector("#providerMode");
const aspectRatioInput = document.querySelector("#aspectRatio");
const imageCountInput = document.querySelector("#imageCount");
const outputMimeTypeInput = document.querySelector("#outputMimeType");
const imageSizeInput = document.querySelector("#imageSize");
const jpegQualityInput = document.querySelector("#jpegQuality");
const jpegQualityValue = document.querySelector("#jpegQualityValue");
const toggleApiKeyButton = document.querySelector("#toggleApiKey");
const testApiKeyButton = document.querySelector("#testApiKey");
const apiDiagnostics = document.querySelector("#apiDiagnostics");
const statusBox = document.querySelector("#status");
const resultsBox = document.querySelector("#results");
const resultText = document.querySelector("#resultText");
const assetList = document.querySelector("#assetList");
const imageModal = document.querySelector("#imageModal");
const imageModalImage = document.querySelector("#imageModalImage");
const imageModalTitle = document.querySelector("#imageModalTitle");
const zoomOutButton = document.querySelector("#zoomOut");
const zoomResetButton = document.querySelector("#zoomReset");
const zoomInButton = document.querySelector("#zoomIn");
const settingsForm = document.querySelector("#settingsForm");

const videoFileInput = document.querySelector("#videoFile");
const videoPlayer = document.querySelector("#videoPlayer");
const videoCurrentTime = document.querySelector("#videoCurrentTime");
const videoDurationOutput = document.querySelector("#videoDuration");
const extractFrameNowButton = document.querySelector("#extractFrameNow");
const seekBestFrameButton = document.querySelector("#seekBestFrame");
const analyzeVideoButton = document.querySelector("#analyzeVideo");
const videoAnalysisModelInput = document.querySelector("#videoAnalysisModel");
const videoCustomInstructionInput = document.querySelector("#videoCustomInstruction");
const videoAnalysisSummary = document.querySelector("#videoAnalysisSummary");
const videoAnalysisText = document.querySelector("#videoAnalysisText");
const videoAnalysisTags = document.querySelector("#videoAnalysisTags");
const videoAnalysisMeta = document.querySelector("#videoAnalysisMeta");
const videoFramePreview = document.querySelector("#videoFramePreview");
const promptPair = document.querySelector("#promptPair");
const seedancePromptInput = document.querySelector("#seedancePrompt");
const klingPromptInput = document.querySelector("#klingPrompt");
const addFrameToLibraryButton = document.querySelector("#addFrameToLibrary");
let modalZoom = 1;
let modalPanX = 0;
let modalPanY = 0;
let modalPanStart = null;
let modalFocusReturn = null;

function uid(prefix = "asset") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status-strip ${type}`.trim();
}

function dataUrl(asset) {
  return `data:${asset.mimeType};base64,${asset.data}`;
}

function assetImageSrc(asset) {
  if (asset?.data) return dataUrl(asset);
  if (asset?.fileUri?.startsWith("https://")) return asset.fileUri;
  return "";
}

function getAsset(id) {
  return state.assets.find((asset) => asset.id === id);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function extensionForMime(mimeType) {
  return mimeType === "image/jpeg" ? "jpg" : "png";
}

function saveSettings() {
  localStorage.setItem(
    "nanobanana-settings",
    JSON.stringify({
      model: modelInput.value,
      apiEndpoint: endpointInput.value,
      providerMode: providerModeInput.value,
      aspectRatio: aspectRatioInput.value,
      imageCount: imageCountInput.value,
      outputMimeType: outputMimeTypeInput.value,
      imageSize: imageSizeInput.value,
      jpegQuality: jpegQualityInput.value,
    })
  );
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("nanobanana-settings") || "{}");
    if (settings.model) modelInput.value = settings.model;
    if (settings.apiEndpoint) endpointInput.value = settings.apiEndpoint;
    if (settings.providerMode) providerModeInput.value = settings.providerMode;
    if (settings.aspectRatio) aspectRatioInput.value = settings.aspectRatio;
    if (settings.imageCount) imageCountInput.value = settings.imageCount;
    if (settings.outputMimeType) outputMimeTypeInput.value = settings.outputMimeType;
    if (settings.imageSize) imageSizeInput.value = settings.imageSize;
    if (settings.jpegQuality) jpegQualityInput.value = settings.jpegQuality;
  } catch {
    return;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB non disponibile."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbReadAll() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function dbWriteAll(assets) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      store.clear();
      for (const asset of assets) store.put(asset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("Impossibile salvare la libreria:", error?.message || error);
  }
}

let persistTimer = null;
function persistLibrary() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    dbWriteAll(state.assets);
  }, 200);
}

function persistAssignments() {
  try {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(state.assignments));
  } catch {
    return;
  }
}

function loadAssignments() {
  try {
    const stored = JSON.parse(localStorage.getItem(ASSIGNMENTS_KEY) || "{}");
    if (stored && typeof stored === "object") {
      state.assignments = stored;
    }
  } catch {
    return;
  }
}

async function hydrateLibrary() {
  const stored = await dbReadAll();
  if (!stored.length) return;
  if (state.assets.length) return;
  state.assets = stored.sort((a, b) => {
    const left = a.createdAt || "";
    const right = b.createdAt || "";
    return right.localeCompare(left);
  });
  for (const slotId of Object.keys(state.assignments)) {
    if (!getAsset(state.assignments[slotId])) {
      delete state.assignments[slotId];
    }
  }
  renderLibrary();
  renderSelectors();
  Object.keys(SLOT_NAMES).forEach(renderPreview);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "Non riesco a decodificare questa immagine. Se e' una foto HEIC da iPhone non supportata da questo dispositivo, attiva 'Massima compatibilita' in iOS: Impostazioni > Fotocamera > Formati > Massima compatibilita (JPEG)."
        )
      );
    };
    img.src = url;
  });
}

async function compressImageOnce(image, maxSide, quality) {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const ratio = longestSide > maxSide ? maxSide / longestSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile su questo dispositivo.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error("Compressione immagine fallita.");
  return { mimeType: match[1], data: match[2], width, height };
}

const MAX_INLINE_BYTES = 1_400_000;
const COMPRESSION_PASSES = [
  { maxSide: 2048, quality: 0.92 },
  { maxSide: 1600, quality: 0.86 },
  { maxSide: 1280, quality: 0.82 },
  { maxSide: 1024, quality: 0.78 },
  { maxSide: 768, quality: 0.74 },
];

async function smartCompress(file) {
  const image = await loadImageElement(file);
  let lastResult = null;
  for (const pass of COMPRESSION_PASSES) {
    const result = await compressImageOnce(image, pass.maxSide, pass.quality);
    lastResult = result;
    const approxBytes = (result.data.length * 3) / 4;
    if (approxBytes <= MAX_INLINE_BYTES) return result;
  }
  return lastResult;
}

async function readFileAsAsset(file, source = "upload") {
  if (!file) throw new Error("File mancante.");
  const looksLikeImage =
    (typeof file.type === "string" && file.type.startsWith("image/")) ||
    /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || "");
  if (!looksLikeImage) {
    throw new Error("Seleziona un file immagine.");
  }
  const compressed = await smartCompress(file);
  return {
    id: uid(source),
    name: file.name || `immagine-${state.assets.length + 1}`,
    mimeType: compressed.mimeType,
    data: compressed.data,
    kind: "inline",
    source,
    createdAt: new Date().toISOString(),
    width: compressed.width,
    height: compressed.height,
  };
}

function addAsset(asset) {
  state.assets.unshift(asset);
  renderLibrary();
  renderSelectors();
  persistLibrary();
  return asset.id;
}

function assignSlot(slotId, assetId) {
  if (assetId) {
    state.assignments[slotId] = assetId;
  } else {
    delete state.assignments[slotId];
  }
  renderPreview(slotId);
  renderSelectors();
  persistAssignments();
}

function renderPreview(slotId) {
  const preview = document.querySelector(`[data-preview="${slotId}"]`);
  const asset = getAsset(state.assignments[slotId]);
  if (!preview) return;
  if (!asset) {
    preview.innerHTML = "<span>Trascina qui una immagine o selezionala dalla libreria.</span>";
    return;
  }
  const imageSrc = assetImageSrc(asset);
  if (imageSrc) {
    preview.innerHTML = `<img alt="${SLOT_NAMES[slotId]}" src="${imageSrc}">`;
    return;
  }
  preview.innerHTML = `
    <div class="uri-preview">
      <strong>URI collegato</strong>
      <span>${escapeHtml(asset.fileUri)}</span>
    </div>
  `;
}

function renderSelectors() {
  document.querySelectorAll("[data-library]").forEach((select) => {
    const slotId = select.dataset.library;
    const selected = state.assignments[slotId] || "";
    const options = [
      '<option value="">Scegli dalla libreria</option>',
      ...state.assets.map((asset) => {
        const sourceName =
          asset.source === "generated"
            ? "generata"
            : asset.source === "uri"
              ? "URI"
              : "upload";
        const label = `${asset.name} - ${sourceName}`;
        return `<option value="${asset.id}">${escapeHtml(label)}</option>`;
      }),
    ];
    select.innerHTML = options.join("");
    select.value = selected;
  });
}

function renderLibrary() {
  if (!state.assets.length) {
    assetList.className = "asset-list empty";
    assetList.textContent = "Carica immagini o genera un risultato per popolare la libreria.";
    return;
  }

  assetList.className = "asset-list";
  assetList.innerHTML = state.assets
    .map((asset) => {
      const imageSrc = assetImageSrc(asset);
      const figure = imageSrc
        ? `<figure><img alt="${escapeHtml(asset.name)}" src="${imageSrc}"></figure>`
        : `<figure><div class="uri-preview"><strong>URI</strong><span>${escapeHtml(asset.fileUri)}</span></div></figure>`;
      const sourceName =
        asset.source === "generated"
          ? "Generata"
          : asset.source === "uri"
            ? "URI"
            : "Upload";
      return `
        <article class="asset-card">
          ${figure}
          <div class="asset-meta">
            <strong title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</strong>
            <span>${sourceName} - ${escapeHtml(asset.mimeType)} - ${formatTime(new Date(asset.createdAt))}</span>
          </div>
          <div class="asset-actions">
            <button type="button" class="asset-action" data-remove="${asset.id}">Rimuovi</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderResults(images = [], text = "", meta = null) {
  state.lastResults = images;
  state.lastResultMeta = meta;
  resultText.textContent = text || "";

  if (!images.length) {
    resultsBox.className = "result-grid empty";
    resultsBox.textContent = "Nessuna immagine restituita da Google.";
    return;
  }

  resultsBox.className = "result-grid";
  resultsBox.innerHTML = images
    .map((image, index) => {
      const href = `data:${image.mimeType};base64,${image.data}`;
      const extension = extensionForMime(image.mimeType);
      const badges = meta
        ? [
            meta.provider ? `<span>${escapeHtml(meta.provider)}</span>` : "",
            meta.model ? `<span>${escapeHtml(meta.model)}</span>` : "",
            meta.aspectRatio && meta.aspectRatio !== "auto"
              ? `<span>${escapeHtml(meta.aspectRatio)}</span>`
              : "",
            meta.imageSize && meta.imageSize !== "auto"
              ? `<span>${escapeHtml(meta.imageSize)}</span>`
              : "",
          ]
            .filter(Boolean)
            .join("")
        : "";
      const badgesMarkup = badges
        ? `<div class="result-badges">${badges}</div>`
        : "";
      return `
        <article class="result-card">
          <figure>
            <button type="button" class="image-open" data-view-result="${index}" aria-label="Ingrandisci risultato ${index + 1}">
              <img alt="Risultato ${index + 1}" src="${href}">
            </button>
          </figure>
          ${badgesMarkup}
          <div class="result-actions">
            <button type="button" class="asset-action" data-view-result="${index}">Zoom</button>
            <a class="download" href="${href}" download="nanobanana-result-${index + 1}.${extension}">Scarica</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateModalZoom() {
  imageModalImage.style.transform =
    `translate(${modalPanX}px, ${modalPanY}px) scale(${modalZoom})`;
  zoomResetButton.textContent = `${Math.round(modalZoom * 100)}%`;
  const canvas = document.querySelector("#imageModalCanvas");
  if (canvas) {
    canvas.classList.toggle("is-pannable", modalZoom > 1);
  }
}

function resetModalPan() {
  modalPanX = 0;
  modalPanY = 0;
}

function openImageModal(index) {
  const image = state.lastResults[index];
  if (!image) return;
  modalFocusReturn = document.activeElement;
  modalZoom = 1;
  resetModalPan();
  imageModalImage.src = `data:${image.mimeType};base64,${image.data}`;
  imageModalTitle.textContent = `Risultato ${index + 1}`;
  imageModal.hidden = false;
  updateModalZoom();
  const closeBtn = imageModal.querySelector(".image-modal-bar [data-close-modal]");
  closeBtn?.focus({ preventScroll: true });
}

function closeImageModal() {
  imageModal.hidden = true;
  imageModalImage.removeAttribute("src");
  resetModalPan();
  const returnTarget = modalFocusReturn;
  modalFocusReturn = null;
  if (returnTarget && typeof returnTarget.focus === "function") {
    returnTarget.focus({ preventScroll: true });
  }
}

function changeModalZoom(delta) {
  const previous = modalZoom;
  modalZoom = Math.max(0.25, Math.min(6, modalZoom + delta));
  if (modalZoom <= 1 || previous <= 1) {
    resetModalPan();
  }
  updateModalZoom();
}

function formatGenerateError(payload) {
  const attempts = Array.isArray(payload.providerAttempts) ? payload.providerAttempts : [];
  const quotaAttempts = attempts.filter((attempt) => attempt.status === 429);
  if (quotaAttempts.length) {
    const providers = [
      ...new Set(quotaAttempts.map((attempt) => attempt.provider).filter(Boolean)),
    ];
    const providerText = providers.length ? ` su ${providers.join(" e ")}` : "";
    return `Quota/capacita' esaurita${providerText}. Il tool ha provato il fallback automatico quando disponibile. Riprova tra qualche minuto, usa 1 immagine e 512 px, oppure chiedi un aumento quota in Google Cloud.`;
  }
  return payload.error || "Errore durante la richiesta a Google.";
}

function diagnosticClass(item) {
  if (item.ok) return "ok";
  if (item.reason === "SERVICE_DISABLED" || item.status === 400) return "warn";
  return "error";
}

function renderDiagnostics(payload) {
  const rows = [
    ["Vertex Express", payload.vertex],
    ["Modello selezionato", payload.selectedModel],
    ["Gemini API", payload.geminiApi],
  ];

  apiDiagnostics.className = "diagnostics is-visible";
  apiDiagnostics.innerHTML = rows
    .map(([label, item]) => {
      const detail = item.activationUrl
        ? `${item.message} Attiva qui: ${item.activationUrl}`
        : item.message;
      return `
        <div class="diagnostic-item ${diagnosticClass(item)}">
          <strong>${escapeHtml(label)} ${item.ok ? "OK" : "attenzione"}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readJsonResponse(response) {
  if (response.status === 413) {
    throw new Error(
      "Le immagini sono troppo grandi per Vercel (limite 4.5 MB per richiesta). Ricarica con foto piu' piccole o riduci a 1 immagine per volta."
    );
  }
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    if (response.status === 413 || /payload\s+too\s+large/i.test(snippet)) {
      throw new Error(
        "Le immagini sono troppo grandi per Vercel (limite 4.5 MB per richiesta). Ricarica con foto piu' piccole o riduci a 1 immagine per volta."
      );
    }
    throw new Error(
      `Risposta dal server non valida (${response.status}). ${snippet || "Corpo vuoto."}`
    );
  }
}

async function handleFiles(slotId, fileList) {
  const file = fileList?.[0];
  if (!file) return;
  const looksLikeImage =
    (typeof file.type === "string" && file.type.startsWith("image/")) ||
    /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || "");
  if (!looksLikeImage) {
    setStatus("Seleziona un file immagine.", "error");
    return;
  }

  try {
    const sizeMb = file.size > 0 ? (file.size / (1024 * 1024)).toFixed(1) : "?";
    setStatus(`Comprimo l'immagine (${sizeMb} MB) per stare nei limiti di Vercel...`, "loading");
    const asset = await readFileAsAsset(file, "upload");
    addAsset(asset);
    assignSlot(slotId, asset.id);
    const finalKb = Math.round((asset.data.length * 3) / 4 / 1024);
    setStatus(
      `${SLOT_NAMES[slotId]} aggiornata. (compressa: ${asset.width}x${asset.height}, ~${finalKb} KB)`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function inferMimeType(uri) {
  const cleanUri = uri.split("?")[0].toLowerCase();
  if (cleanUri.endsWith(".png")) return "image/png";
  if (cleanUri.endsWith(".webp")) return "image/webp";
  if (cleanUri.endsWith(".jpg") || cleanUri.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

function assetNameFromUri(uri) {
  const withoutQuery = uri.split("?")[0];
  const lastPart = withoutQuery.split("/").filter(Boolean).pop();
  return lastPart || `uri-${state.assets.length + 1}`;
}

function addUriAsset(slotId) {
  const input = document.querySelector(`[data-uri-input="${slotId}"]`);
  const rawUri = input?.value.trim() || "";
  if (!rawUri) return;
  if (!rawUri.startsWith("gs://") && !rawUri.startsWith("https://")) {
    setStatus("Usa un URI gs:// oppure un URL https pubblico.", "error");
    return;
  }

  const asset = {
    id: uid("uri"),
    name: assetNameFromUri(rawUri),
    mimeType: inferMimeType(rawUri),
    fileUri: rawUri,
    kind: "uri",
    source: "uri",
    createdAt: new Date().toISOString(),
  };

  addAsset(asset);
  assignSlot(slotId, asset.id);
  input.value = "";
  setStatus(`${SLOT_NAMES[slotId]} collegata via URI.`);
}

function validateWorkflow(workflowId) {
  const workflow = WORKFLOWS[workflowId];
  const missing = workflow.slots.filter((slotId) => !getAsset(state.assignments[slotId]));
  if (missing.length) {
    const labels = missing.map((slotId) => SLOT_NAMES[slotId]).join(", ");
    throw new Error(`Mancano immagini per: ${labels}.`);
  }
  if (!apiKeyInput.value.trim()) {
    throw new Error("Inserisci la API key Vertex nel box in alto.");
  }
}

function setGenerateButtonsBusy(workflowId) {
  const buttons = document.querySelectorAll("[data-generate]");
  buttons.forEach((button) => {
    if (button.dataset.generate === workflowId) {
      activeGenerateButton = button;
      activeGenerateLabel = button.textContent;
      button.textContent = "Annulla";
      button.dataset.cancelMode = "1";
      button.classList.add("is-cancel");
      button.disabled = false;
    } else {
      button.disabled = true;
    }
  });
}

function restoreGenerateButtons() {
  const buttons = document.querySelectorAll("[data-generate]");
  if (activeGenerateButton) {
    activeGenerateButton.textContent = activeGenerateLabel || "Genera";
    activeGenerateButton.classList.remove("is-cancel");
    delete activeGenerateButton.dataset.cancelMode;
  }
  buttons.forEach((button) => (button.disabled = false));
  activeGenerateButton = null;
  activeGenerateLabel = "";
  updateGenerateLabels();
}

function humanizeFetchError(error) {
  if (!error) return "Errore sconosciuto.";
  if (error.name === "AbortError") return "Generazione annullata.";
  const msg = String(error.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return (
      "Connessione persa con il server. Su Vercel Hobby il timeout e' 60 secondi: " +
      "se hai chiesto piu' immagini o foto grandi puo' scattare. Riprova con 1-2 immagini per volta."
    );
  }
  return msg;
}

async function fetchOneImage(body, abortSignal) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortSignal,
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = new Error(formatGenerateError(payload));
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function generate(workflowId) {
  const workflow = WORKFLOWS[workflowId];
  try {
    validateWorkflow(workflowId);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  const images = workflow.slots.map((slotId) => {
    const asset = getAsset(state.assignments[slotId]);
    if (asset.fileUri) {
      return {
        name: asset.name,
        mimeType: asset.mimeType,
        fileUri: asset.fileUri,
      };
    }
    return {
      name: asset.name,
      mimeType: asset.mimeType,
      data: asset.data,
    };
  });

  const requestedCount = Math.max(1, Math.min(4, Number.parseInt(imageCountInput.value, 10) || 1));
  const aspectRatio = aspectRatioInput.value;
  const imageSize = imageSizeInput.value;
  const model = modelInput.value.trim();
  const baseBody = {
    apiKey: apiKeyInput.value.trim(),
    model,
    apiEndpoint: endpointInput.value.trim(),
    providerMode: providerModeInput.value,
    aspectRatio,
    imageCount: 1,
    outputMimeType: outputMimeTypeInput.value,
    imageSize,
    jpegQuality: jpegQualityInput.value,
    prompt: PROMPTS[workflowId],
    images,
  };

  setStatus(
    `Generazione ${workflow.title.toLowerCase()}: ${requestedCount} ${
      requestedCount === 1 ? "richiesta" : "richieste"
    } in parallelo (puoi annullare).`,
    "loading"
  );
  setGenerateButtonsBusy(workflowId);

  currentAbort = new AbortController();
  let aborted = false;

  try {
    const settled = await Promise.allSettled(
      Array.from({ length: requestedCount }, () =>
        fetchOneImage(baseBody, currentAbort.signal)
      )
    );

    const fulfilled = settled
      .filter((entry) => entry.status === "fulfilled")
      .map((entry) => entry.value);
    const rejected = settled
      .filter((entry) => entry.status === "rejected")
      .map((entry) => entry.reason);

    const allImages = fulfilled.flatMap((payload) => payload.images || []);
    const providers = [
      ...new Set(
        fulfilled
          .map((payload) => payload.provider)
          .filter((provider) => provider && provider.length > 0)
      ),
    ];
    const texts = fulfilled
      .map((payload) => payload.text || "")
      .filter((text) => text);

    if (rejected.some((err) => err && err.name === "AbortError")) {
      aborted = true;
      setStatus("Generazione annullata.", "error");
      return;
    }

    if (!allImages.length) {
      const firstError = rejected[0];
      const message = firstError
        ? humanizeFetchError(firstError)
        : "Google ha risposto senza immagini.";
      setStatus(message, "error");
      renderResults([], texts.join("\n\n"), {
        provider: providers.join(" + "),
        model,
        aspectRatio,
        imageSize,
      });
      return;
    }

    allImages.forEach((image, index) => {
      addAsset({
        id: uid("generated"),
        name: `${workflow.title} ${formatTime()} #${index + 1}`,
        mimeType: image.mimeType || "image/png",
        data: image.data,
        source: "generated",
        createdAt: new Date().toISOString(),
      });
    });

    const warningParts = [];
    if (rejected.length) {
      warningParts.push(
        `${rejected.length} ${rejected.length === 1 ? "richiesta fallita" : "richieste fallite"}: ${rejected
          .map((err) => humanizeFetchError(err))
          .join("; ")}`
      );
    }
    fulfilled.forEach((payload, index) => {
      if (Array.isArray(payload.errors) && payload.errors.length) {
        warningParts.push(
          `Richiesta ${index + 1}: ${payload.errors
            .map((item) => item.message)
            .join("; ")}`
        );
      }
    });

    renderResults(
      allImages,
      warningParts.join("\n"),
      {
        provider: providers.join(" + "),
        model,
        aspectRatio,
        imageSize,
      }
    );

    const successLabel =
      allImages.length === 1
        ? "1 immagine generata"
        : `${allImages.length} immagini generate`;
    const failTail = rejected.length
      ? ` (${rejected.length} ${rejected.length === 1 ? "fallita" : "fallite"})`
      : "";
    setStatus(
      `Fatto: ${successLabel}${failTail}${providers.length ? ` via ${providers.join(" + ")}` : ""}.`,
      rejected.length && allImages.length < requestedCount ? "error" : ""
    );
  } catch (error) {
    if (error.name === "AbortError") {
      aborted = true;
      setStatus("Generazione annullata.", "error");
    } else {
      setStatus(humanizeFetchError(error), "error");
    }
  } finally {
    currentAbort = null;
    restoreGenerateButtons();
    if (aborted) {
      // no-op: status already set
    }
  }
}

function cancelGenerate() {
  if (currentAbort) {
    currentAbort.abort();
  }
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.tab === tab);
      });
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === tab);
      });
    });
  });
}

function bindSlots() {
  document.querySelectorAll("[data-file]").forEach((input) => {
    input.addEventListener("change", () => handleFiles(input.dataset.file, input.files));
  });

  document.querySelectorAll("[data-library]").forEach((select) => {
    select.addEventListener("change", () => {
      assignSlot(select.dataset.library, select.value);
      if (select.value) setStatus(`${SLOT_NAMES[select.dataset.library]} aggiornata dalla libreria.`);
    });
  });

  document.querySelectorAll("[data-uri-button]").forEach((button) => {
    button.addEventListener("click", () => addUriAsset(button.dataset.uriButton));
  });

  document.querySelectorAll("[data-uri-input]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addUriAsset(input.dataset.uriInput);
      }
    });
  });

  document.querySelectorAll(".slot").forEach((slot) => {
    const slotId = slot.dataset.slot;
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      handleFiles(slotId, event.dataTransfer.files);
    });
  });
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}s`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lettura file fallita."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const match = result.match(/^data:(.+?);base64,(.+)$/);
      if (!match) {
        reject(new Error("File non leggibile come base64."));
        return;
      }
      resolve({ mimeType: match[1], data: match[2] });
    };
    reader.readAsDataURL(file);
  });
}

function snapshotCurrentVideoFrame() {
  if (!videoPlayer || !videoPlayer.videoWidth || !videoPlayer.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = videoPlayer.videoWidth;
  canvas.height = videoPlayer.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function extractFrameAtTime(seconds) {
  return new Promise((resolve, reject) => {
    if (!videoPlayer || !videoPlayer.duration) {
      reject(new Error("Carica prima un video."));
      return;
    }
    const target = Math.max(0, Math.min(seconds, videoPlayer.duration));
    const handler = () => {
      videoPlayer.removeEventListener("seeked", handler);
      const dataUrl = snapshotCurrentVideoFrame();
      if (!dataUrl) {
        reject(new Error("Impossibile estrarre il frame."));
        return;
      }
      resolve({ dataUrl, time: videoPlayer.currentTime });
    };
    videoPlayer.addEventListener("seeked", handler, { once: true });
    try {
      videoPlayer.currentTime = target;
    } catch (error) {
      videoPlayer.removeEventListener("seeked", handler);
      reject(error);
    }
  });
}

function setVideoFrame(dataUrl, time) {
  state.video.frameDataUrl = dataUrl;
  state.video.frameAtSecond = Number.isFinite(time) ? time : videoPlayer.currentTime || 0;
  state.video.lastFrameAssetId = null;
  if (!videoFramePreview) return;
  if (!dataUrl) {
    videoFramePreview.innerHTML = "<span>Nessun frame estratto.</span>";
    return;
  }
  videoFramePreview.innerHTML = `<img alt="Frame estratto" src="${dataUrl}">`;
}

async function handleVideoFileSelected(file) {
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    setStatus("Il file selezionato non e un video.", "error");
    return;
  }
  if (file.size > 22 * 1024 * 1024) {
    setStatus(
      "Il video supera 20 MB: l'analisi inline non e supportata. Usa un clip piu corto.",
      "error",
    );
    return;
  }

  setStatus("Carico il video in memoria...", "loading");
  try {
    const { mimeType, data } = await readFileAsBase64(file);
    if (state.video.objectUrl) {
      try {
        URL.revokeObjectURL(state.video.objectUrl);
      } catch {
        /* noop */
      }
    }
    const objectUrl = URL.createObjectURL(file);
    state.video.fileName = file.name;
    state.video.mimeType = mimeType;
    state.video.base64 = data;
    state.video.objectUrl = objectUrl;
    videoPlayer.src = objectUrl;
    videoPlayer.load();
    if (analyzeVideoButton) analyzeVideoButton.disabled = false;
    if (extractFrameNowButton) extractFrameNowButton.disabled = false;
    if (videoAnalysisSummary) videoAnalysisSummary.hidden = true;
    if (promptPair) promptPair.hidden = true;
    setStatus(`Video pronto: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (error) {
    setStatus(error.message || "Errore caricamento video.", "error");
  }
}

function renderVideoAnalysis(analysis, model) {
  if (!videoAnalysisSummary) return;
  videoAnalysisSummary.hidden = false;
  videoAnalysisText.textContent = analysis.summary || "(nessun riassunto)";
  videoAnalysisMeta.textContent = model ? `Modello: ${model}` : "";

  const tags = [];
  const pushTags = (label, items) => {
    if (!items) return;
    if (Array.isArray(items)) items.forEach((value) => value && tags.push(`${label}: ${value}`));
    else tags.push(`${label}: ${items}`);
  };
  pushTags("Soggetti", analysis.subjects);
  pushTags("Azioni", analysis.actions);
  if (analysis.environment) tags.push(`Ambiente: ${analysis.environment}`);
  if (analysis.lighting) tags.push(`Luce: ${analysis.lighting}`);
  if (analysis.mood) tags.push(`Mood: ${analysis.mood}`);
  pushTags("Camera", analysis.cameraMovements);
  if (analysis.style) tags.push(`Stile: ${analysis.style}`);
  if (Number.isFinite(analysis.durationSeconds)) {
    tags.push(`Durata: ~${analysis.durationSeconds}s`);
  }
  if (analysis.audioNotes) tags.push(`Audio: ${analysis.audioNotes}`);
  videoAnalysisTags.innerHTML = tags
    .map((tag) => `<li>${escapeHtml(tag)}</li>`)
    .join("");

  if (promptPair) promptPair.hidden = false;
  if (seedancePromptInput) seedancePromptInput.value = analysis.seedancePrompt || "";
  if (klingPromptInput) klingPromptInput.value = analysis.klingPrompt || "";

  if (Number.isFinite(analysis.bestFrameTimestamp)) {
    state.video.bestFrameTimestamp = analysis.bestFrameTimestamp;
    if (seekBestFrameButton) {
      seekBestFrameButton.disabled = false;
      const note = analysis.bestFrameRationale
        ? ` (${analysis.bestFrameRationale.slice(0, 60)})`
        : "";
      seekBestFrameButton.title = `Frame consigliato: ${analysis.bestFrameTimestamp.toFixed(2)}s${note}`;
    }
  } else {
    state.video.bestFrameTimestamp = null;
    if (seekBestFrameButton) seekBestFrameButton.disabled = true;
  }
}

async function analyzeVideo() {
  if (!state.video.base64) {
    setStatus("Carica prima un video.", "error");
    return;
  }
  if (!apiKeyInput.value.trim()) {
    setStatus("Inserisci la API key Gemini prima di analizzare.", "error");
    return;
  }

  analyzeVideoButton.disabled = true;
  const previousLabel = analyzeVideoButton.textContent;
  analyzeVideoButton.textContent = "Analisi in corso...";
  setStatus("Invio video a Gemini per analisi e prompt...", "loading");

  try {
    const response = await fetch("/api/analyze-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKeyInput.value.trim(),
        model: videoAnalysisModelInput.value,
        customInstruction: videoCustomInstructionInput.value.trim(),
        video: {
          mimeType: state.video.mimeType || "video/mp4",
          data: state.video.base64,
        },
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Analisi video fallita.");
    }
    state.video.analysis = payload.analysis;
    state.video.analysisModel = payload.model || videoAnalysisModelInput.value;
    renderVideoAnalysis(payload.analysis, state.video.analysisModel);
    setStatus("Analisi completata: prompt Seedance + Kling pronti.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    analyzeVideoButton.disabled = !state.video.base64;
    analyzeVideoButton.textContent = previousLabel || "Analizza video";
  }
}

async function extractFrameNowAction() {
  if (!videoPlayer.videoWidth) {
    setStatus("Il video non e ancora pronto.", "error");
    return;
  }
  const dataUrl = snapshotCurrentVideoFrame();
  if (!dataUrl) {
    setStatus("Impossibile estrarre il frame corrente.", "error");
    return;
  }
  setVideoFrame(dataUrl, videoPlayer.currentTime || 0);
  setStatus(`Frame estratto a ${formatSeconds(videoPlayer.currentTime || 0)}.`);
}

async function seekToBestFrameAction() {
  const target = state.video.bestFrameTimestamp;
  if (!Number.isFinite(target)) {
    setStatus("Non c'e un frame consigliato. Esegui prima l'analisi.", "error");
    return;
  }
  setStatus(`Vado al frame consigliato (${target.toFixed(2)}s)...`, "loading");
  try {
    const { dataUrl, time } = await extractFrameAtTime(target);
    setVideoFrame(dataUrl, time);
    setStatus(`Frame consigliato estratto a ${formatSeconds(time)}.`);
  } catch (error) {
    setStatus(error.message || "Estrazione frame fallita.", "error");
  }
}

function ensureFrameInLibrary() {
  if (!state.video.frameDataUrl) {
    setStatus("Estrai prima un frame dal video.", "error");
    return null;
  }
  if (state.video.lastFrameAssetId && getAsset(state.video.lastFrameAssetId)) {
    return state.video.lastFrameAssetId;
  }
  const baseName = (state.video.fileName || "video").replace(/\.[^.]+$/, "");
  const time = state.video.frameAtSecond || 0;
  const data = state.video.frameDataUrl.replace(/^data:image\/png;base64,/, "");
  const asset = {
    id: uid(`video-frame-${baseName}-${time.toFixed(2)}`),
    name: `${baseName} - frame ${time.toFixed(2)}s`,
    mimeType: "image/png",
    data,
    kind: "inline",
    source: "video",
    createdAt: new Date().toISOString(),
  };
  addAsset(asset);
  state.video.lastFrameAssetId = asset.id;
  return asset.id;
}

function sendFrameToWorkflow(slotId) {
  const assetId = ensureFrameInLibrary();
  if (!assetId) return;
  assignSlot(slotId, assetId);
  const targetTab = ["swapBase", "swapIdentity"].includes(slotId)
    ? "swap"
    : ["poseSource"].includes(slotId)
      ? "pose"
      : "background";
  document.querySelector(`[data-tab="${targetTab}"]`)?.click();
  setStatus(`${SLOT_NAMES[slotId]} aggiornata dal frame video.`);
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy */
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

function bindVideoStudio() {
  if (!videoFileInput || !videoPlayer) return;

  videoFileInput.addEventListener("change", () => {
    const file = videoFileInput.files?.[0];
    if (file) handleVideoFileSelected(file);
  });

  videoPlayer.addEventListener("loadedmetadata", () => {
    state.video.duration = videoPlayer.duration || 0;
    state.video.width = videoPlayer.videoWidth || 0;
    state.video.height = videoPlayer.videoHeight || 0;
    if (videoDurationOutput) {
      videoDurationOutput.textContent = formatSeconds(state.video.duration);
    }
  });

  videoPlayer.addEventListener("timeupdate", () => {
    if (videoCurrentTime) {
      videoCurrentTime.textContent = formatSeconds(videoPlayer.currentTime || 0);
    }
  });

  if (extractFrameNowButton) {
    extractFrameNowButton.disabled = true;
    extractFrameNowButton.addEventListener("click", () => extractFrameNowAction());
  }
  if (seekBestFrameButton) {
    seekBestFrameButton.disabled = true;
    seekBestFrameButton.addEventListener("click", () => seekToBestFrameAction());
  }
  if (analyzeVideoButton) {
    analyzeVideoButton.disabled = true;
    analyzeVideoButton.addEventListener("click", () => analyzeVideo());
  }
  if (addFrameToLibraryButton) {
    addFrameToLibraryButton.addEventListener("click", () => {
      const id = ensureFrameInLibrary();
      if (id) setStatus("Frame aggiunto alla libreria.");
    });
  }

  document.querySelectorAll("[data-send-frame]").forEach((button) => {
    button.addEventListener("click", () => {
      sendFrameToWorkflow(button.dataset.sendFrame);
    });
  });

  document.querySelectorAll("[data-copy-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const which = button.dataset.copyPrompt;
      const value =
        which === "seedance"
          ? seedancePromptInput?.value
          : which === "kling"
            ? klingPromptInput?.value
            : "";
      const ok = await copyToClipboard(value || "");
      setStatus(ok ? `Prompt ${which} copiato.` : "Copia non riuscita.", ok ? "" : "error");
    });
  });

}

function bindActions() {
  document.querySelectorAll("[data-generate]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.cancelMode === "1") {
        cancelGenerate();
        return;
      }
      generate(button.dataset.generate);
    });
  });

  document.querySelector("#clearResults").addEventListener("click", () => {
    renderResults([], "");
    resultsBox.textContent = "Le immagini generate appariranno qui.";
  });

  resultsBox.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-result]");
    if (!button) return;
    openImageModal(Number.parseInt(button.dataset.viewResult, 10));
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeImageModal);
  });

  zoomOutButton.addEventListener("click", () => changeModalZoom(-0.25));
  zoomInButton.addEventListener("click", () => changeModalZoom(0.25));
  zoomResetButton.addEventListener("click", () => {
    modalZoom = 1;
    resetModalPan();
    updateModalZoom();
  });

  imageModal.addEventListener("wheel", (event) => {
    if (imageModal.hidden) return;
    event.preventDefault();
    changeModalZoom(event.deltaY < 0 ? 0.15 : -0.15);
  }, { passive: false });

  const modalCanvas = document.querySelector("#imageModalCanvas");
  if (modalCanvas) {
    modalCanvas.addEventListener("pointerdown", (event) => {
      if (modalZoom <= 1) return;
      modalPanStart = {
        pointerId: event.pointerId,
        startX: event.clientX - modalPanX,
        startY: event.clientY - modalPanY,
      };
      modalCanvas.setPointerCapture(event.pointerId);
      modalCanvas.classList.add("is-grabbing");
    });
    modalCanvas.addEventListener("pointermove", (event) => {
      if (!modalPanStart || event.pointerId !== modalPanStart.pointerId) return;
      modalPanX = event.clientX - modalPanStart.startX;
      modalPanY = event.clientY - modalPanStart.startY;
      updateModalZoom();
    });
    const endPan = (event) => {
      if (!modalPanStart || event.pointerId !== modalPanStart.pointerId) return;
      try {
        modalCanvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore: pointer may already be released
      }
      modalPanStart = null;
      modalCanvas.classList.remove("is-grabbing");
    };
    modalCanvas.addEventListener("pointerup", endPan);
    modalCanvas.addEventListener("pointercancel", endPan);
    modalCanvas.addEventListener("dragstart", (event) => event.preventDefault());
  }

  document.addEventListener("keydown", (event) => {
    if (!imageModal.hidden && event.key === "Escape") closeImageModal();
  });

  imageModal.addEventListener("keydown", (event) => {
    if (imageModal.hidden || event.key !== "Tab") return;
    const focusables = imageModal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusables);
    if (list.length < 2) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  settingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  document.querySelector("#clearLibrary").addEventListener("click", () => {
    state.assets = [];
    state.assignments = {};
    renderLibrary();
    renderSelectors();
    Object.keys(SLOT_NAMES).forEach(renderPreview);
    persistLibrary();
    persistAssignments();
    setStatus("Libreria svuotata.");
  });

  assetList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = button.dataset.remove;
    state.assets = state.assets.filter((asset) => asset.id !== id);
    for (const [slotId, assetId] of Object.entries(state.assignments)) {
      if (assetId === id) delete state.assignments[slotId];
    }
    renderLibrary();
    renderSelectors();
    Object.keys(SLOT_NAMES).forEach(renderPreview);
    persistLibrary();
    persistAssignments();
  });

  toggleApiKeyButton.addEventListener("click", () => {
    const isHidden = apiKeyInput.type === "password";
    apiKeyInput.type = isHidden ? "text" : "password";
    toggleApiKeyButton.textContent = isHidden ? "Nascondi key" : "Mostra key";
  });

  testApiKeyButton.addEventListener("click", testApiKey);

  jpegQualityInput.addEventListener("input", () => {
    jpegQualityValue.textContent = jpegQualityInput.value;
  });

  outputMimeTypeInput.addEventListener("change", updateOutputControls);
  imageCountInput.addEventListener("change", updateGenerateLabels);

  [
    modelInput,
    endpointInput,
    providerModeInput,
    aspectRatioInput,
    imageCountInput,
    outputMimeTypeInput,
    imageSizeInput,
    jpegQualityInput,
  ].forEach((input) => {
    input.addEventListener("change", saveSettings);
  });
}

async function testApiKey() {
  if (!apiKeyInput.value.trim()) {
    setStatus("Inserisci la API key prima di avviare il test.", "error");
    return;
  }

  testApiKeyButton.disabled = true;
  setStatus("Test API in corso...", "loading");
  apiDiagnostics.className = "diagnostics is-visible";
  apiDiagnostics.innerHTML = `
    <div class="diagnostic-item warn">
      <strong>Test in corso</strong>
      <span>Controllo Vertex Express, modello selezionato e Gemini API.</span>
    </div>
  `;

  try {
    const response = await fetch("/api/test-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKeyInput.value.trim(),
        apiEndpoint: endpointInput.value.trim(),
        providerMode: providerModeInput.value,
        model: modelInput.value.trim(),
      }),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Test API non riuscito.");
    }
    renderDiagnostics(payload);
    const ok = payload.vertex?.ok && payload.selectedModel?.ok;
    setStatus(
      ok
        ? "Test completato: Vertex risponde. Guarda i dettagli nel pannello Connessione."
        : "Test completato con avvisi. Guarda i dettagli nel pannello Connessione.",
      ok ? "" : "error"
    );
  } catch (error) {
    apiDiagnostics.className = "diagnostics is-visible";
    apiDiagnostics.innerHTML = `
      <div class="diagnostic-item error">
        <strong>Test non riuscito</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
    setStatus(error.message, "error");
  } finally {
    testApiKeyButton.disabled = false;
  }
}

function updateOutputControls() {
  const isJpeg = outputMimeTypeInput.value === "image/jpeg";
  jpegQualityInput.disabled = !isJpeg;
  jpegQualityValue.textContent = isJpeg ? jpegQualityInput.value : "PNG";
  saveSettings();
}

function updateGenerateLabels() {
  const count = Number.parseInt(imageCountInput.value, 10) || 1;
  const label = count === 1 ? "Genera 1 immagine" : `Genera ${count} immagini`;
  document.querySelectorAll("[data-generate]").forEach((button) => {
    if (button.dataset.cancelMode === "1") return;
    button.textContent = label;
  });
}

function initPrompts() {
  document.querySelectorAll("[data-prompt]").forEach((textarea) => {
    textarea.value = PROMPTS[textarea.dataset.prompt];
  });
}

function init() {
  loadSettings();
  loadAssignments();
  initPrompts();
  bindTabs();
  bindSlots();
  bindActions();
  bindVideoStudio();
  updateOutputControls();
  updateGenerateLabels();
  renderLibrary();
  renderSelectors();
  Object.keys(SLOT_NAMES).forEach(renderPreview);
  hydrateLibrary();
}

init();
