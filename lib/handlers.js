"use strict";

const {
  DEFAULT_API_ENDPOINT,
  GEMINI_API_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_VIDEO_ANALYSIS_MODEL,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_OUTPUT_MIME_TYPES,
  SUPPORTED_IMAGE_SIZES,
  SUPPORTED_VIDEO_MIME_TYPES,
  VIDEO_ANALYSIS_SYSTEM_INSTRUCTION,
  VIDEO_ANALYSIS_RESPONSE_SCHEMA,
  stripDataUrl,
  imageToPart,
  imageToGeminiPart,
  normalizeEndpoint,
  extractResponseParts,
  clampInteger,
  sleep,
  callGoogle,
  callGoogleWithRetry,
  probeGoogle,
} = require("./google");

function ok(body) {
  return { status: 200, body };
}

function bad(status, error, extra) {
  return { status, body: { error, ...(extra || {}) } };
}

async function handleHealth() {
  return ok({ ok: true });
}

async function handleGenerate(payload) {
  if (!payload || typeof payload !== "object") {
    return bad(400, "Richiesta JSON non valida.");
  }

  const apiKey = String(payload.apiKey || "").trim();
  const model = String(payload.model || DEFAULT_MODEL).trim();
  const prompt = String(payload.prompt || "").trim();
  const images = Array.isArray(payload.images) ? payload.images : [];
  const imageCount = clampInteger(payload.imageCount, 1, 1, 4);
  const aspectRatio = String(payload.aspectRatio || "auto").trim();
  const outputMimeType = String(payload.outputMimeType || "image/png").trim();
  const imageSize = String(payload.imageSize || "auto").trim();
  const providerMode = String(payload.providerMode || "auto").trim();
  const jpegQuality = clampInteger(payload.jpegQuality, 90, 0, 100);

  if (!apiKey) return bad(400, "Inserisci una API key Vertex valida.");
  if (!model) return bad(400, "Inserisci un model ID Vertex.");
  if (!prompt) return bad(400, "Prompt mancante.");
  if (!images.length) return bad(400, "Carica o seleziona almeno una immagine.");
  if (aspectRatio !== "auto" && !SUPPORTED_ASPECT_RATIOS.has(aspectRatio)) {
    return bad(400, "Formato immagine non supportato da Vertex.");
  }
  if (!SUPPORTED_OUTPUT_MIME_TYPES.has(outputMimeType)) {
    return bad(400, "Formato file output non supportato da Vertex.");
  }
  if (imageSize !== "auto" && !SUPPORTED_IMAGE_SIZES.has(imageSize)) {
    return bad(400, "Dimensione output non supportata da Vertex.");
  }
  if (!["auto", "vertex", "gemini"].includes(providerMode)) {
    return bad(400, "Provider non supportato.");
  }

  let endpoint;
  try {
    endpoint = normalizeEndpoint(payload.apiEndpoint);
  } catch (error) {
    return bad(400, error.message);
  }

  const requestUrl = new URL(
    `${endpoint}/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`
  );
  const geminiUrl = new URL(
    `${GEMINI_API_ENDPOINT}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  );

  const vertexParts = images.map(imageToPart);
  vertexParts.push({ text: prompt });
  const geminiParts = images.map(imageToGeminiPart);
  geminiParts.push({ text: prompt });

  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
    candidateCount: 1,
  };

  const imageConfig = {
    imageOutputOptions: { mimeType: outputMimeType },
  };

  if (outputMimeType === "image/jpeg") {
    imageConfig.imageOutputOptions.compressionQuality = jpegQuality;
  }
  if (aspectRatio !== "auto") imageConfig.aspectRatio = aspectRatio;
  if (imageSize !== "auto") imageConfig.imageSize = imageSize;
  generationConfig.imageConfig = imageConfig;

  const vertexPayload = {
    contents: [{ role: "user", parts: vertexParts }],
    generationConfig,
  };

  const geminiImageConfig = {};
  if (aspectRatio !== "auto") geminiImageConfig.aspectRatio = aspectRatio;
  if (imageSize !== "auto") geminiImageConfig.imageSize = imageSize;
  const geminiGenerationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
    candidateCount: 1,
  };
  if (Object.keys(geminiImageConfig).length) {
    geminiGenerationConfig.imageConfig = geminiImageConfig;
  }
  const geminiPayload = {
    contents: [{ role: "user", parts: geminiParts }],
    generationConfig: geminiGenerationConfig,
  };

  async function generateOne() {
    const attempts = [];

    if (providerMode === "vertex" || providerMode === "auto") {
      try {
        const { response, attempts: vertexAttempts } = await callGoogleWithRetry(
          "Vertex",
          requestUrl,
          vertexPayload,
          apiKey,
          []
        );
        const result = extractResponseParts(response);
        if (providerMode === "auto" && !result.images.length) {
          attempts.push(...vertexAttempts, {
            provider: "Vertex",
            status: 200,
            reason: "NO_IMAGE",
            message: "Vertex ha risposto senza immagini; provo Gemini API.",
          });
        } else {
          return { response, provider: "Vertex", attempts: vertexAttempts };
        }
      } catch (error) {
        attempts.push(...(error.attempts || [{
          provider: "Vertex",
          status: error.status || null,
          reason: error.reason || null,
          message: error.message,
        }]));
        const isQuotaIssue = error.status === 429;
        const isApiKeyUnsupported =
          error.status === 401 &&
          /api keys are not supported/i.test(error.message || "");
        const shouldFallback =
          providerMode === "auto" && (isQuotaIssue || isApiKeyUnsupported);
        if (!shouldFallback) {
          error.attempts = attempts;
          throw error;
        }
      }
    }

    if (providerMode === "gemini" || providerMode === "auto") {
      try {
        const { response, attempts: geminiAttempts } = await callGoogleWithRetry(
          "Gemini API",
          geminiUrl,
          geminiPayload,
          apiKey,
          [8000, 20000]
        );
        return {
          response,
          provider: "Gemini API",
          attempts: [...attempts, ...geminiAttempts],
        };
      } catch (error) {
        error.attempts = [
          ...attempts,
          ...(error.attempts || [{
            provider: "Gemini API",
            status: error.status || null,
            reason: error.reason || null,
            message: error.message,
          }]),
        ];
        throw error;
      }
    }
  }

  try {
    const imagesOut = [];
    const texts = [];
    const raw = [];
    const errors = [];
    const providerAttempts = [];
    const providersUsed = new Set();
    let attemptedRequests = 0;

    const maxAttempts = imageCount * 2;
    for (let requestIndex = 0; requestIndex < maxAttempts && imagesOut.length < imageCount; requestIndex += 1) {
      attemptedRequests += 1;
      try {
        const generated = await generateOne();
        raw.push(generated.response);
        providersUsed.add(generated.provider);
        providerAttempts.push(...generated.attempts);

        const result = extractResponseParts(generated.response);
        const remaining = imageCount - imagesOut.length;
        imagesOut.push(...result.images.slice(0, remaining));
        if (result.text) texts.push(`Richiesta ${requestIndex + 1}: ${result.text}`);

        if (!result.images.length) {
          errors.push({
            request: requestIndex + 1,
            message: "Google ha risposto senza immagini per questa richiesta.",
            status: 200,
            provider: generated.provider,
          });
          await sleep(1200);
          continue;
        }

        if (imagesOut.length < imageCount) await sleep(1200);
      } catch (error) {
        providerAttempts.push(...(error.attempts || []));
        errors.push({
          request: requestIndex + 1,
          message: error.message || "Errore sconosciuto.",
          status: error.status,
          provider: error.provider,
          attempts: error.attempts,
          details: error.details,
        });
        if (error.status === 429) break;
      }
    }

    if (!imagesOut.length && errors.length) {
      const allQuotaErrors = providerAttempts.length > 0 &&
        providerAttempts.every((attempt) => attempt.status === 429);
      return {
        status: errors[0].status || 502,
        body: {
          error: allQuotaErrors
            ? "Quota/capacita' esaurita su Vertex e Gemini API. Riprova tra qualche minuto, riduci numero immagini/dimensione, oppure richiedi un aumento quota."
            : errors[0].message,
          errors,
          providerAttempts,
        },
      };
    }

    return ok({
      images: imagesOut,
      text: texts.join("\n\n").trim(),
      model,
      requestedCount: imageCount,
      attemptedRequests,
      errors,
      provider: Array.from(providersUsed).join(" + "),
      providerAttempts,
      raw,
    });
  } catch (error) {
    return bad(502, error.message);
  }
}

async function handleTestKey(payload) {
  if (!payload || typeof payload !== "object") {
    return bad(400, "Richiesta JSON non valida.");
  }

  const apiKey = String(payload.apiKey || "").trim();
  const model = String(payload.model || DEFAULT_MODEL).trim();
  if (!apiKey) return bad(400, "Inserisci una API key Vertex valida.");

  let endpoint;
  try {
    endpoint = normalizeEndpoint(payload.apiEndpoint);
  } catch (error) {
    return bad(400, error.message);
  }

  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
  const countBody = {
    contents: [{ role: "user", parts: [{ text: "diagnostic" }] }],
  };
  const textProbeBody = {
    contents: [{ role: "user", parts: [{ text: "Reply with exactly OK." }] }],
    generationConfig: {
      responseModalities: ["TEXT"],
      candidateCount: 1,
    },
  };

  const vertexCountUrl = `${endpoint}/v1/publishers/google/models/gemini-2.5-flash:countTokens`;
  const nanoProbeUrl = `${endpoint}/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const geminiModelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";

  const [vertex, nanoBanana, geminiApi] = await Promise.all([
    probeGoogle("Vertex Express", vertexCountUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(countBody),
    }),
    probeGoogle("Modello selezionato", nanoProbeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(textProbeBody),
    }),
    probeGoogle("Gemini API", geminiModelsUrl, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
    }),
  ]);

  const imageModelTextOnly =
    !nanoBanana.ok &&
    nanoBanana.status === 400 &&
    /not supported by this model/i.test(nanoBanana.message);

  return ok({
    vertex: {
      ok: vertex.ok,
      status: vertex.status,
      message: vertex.ok
        ? "Vertex Express risponde: la chiave e' accettata."
        : vertex.message,
      reason: vertex.reason || null,
    },
    selectedModel: {
      ok: nanoBanana.ok || imageModelTextOnly,
      status: nanoBanana.status,
      message: imageModelTextOnly
        ? "Il modello selezionato e' raggiungibile, ma non supporta il probe solo testo. Per testarlo davvero serve una generazione immagine."
        : nanoBanana.ok
          ? "Il modello selezionato risponde al probe."
          : nanoBanana.message,
      reason: nanoBanana.reason || null,
    },
    geminiApi: {
      ok: geminiApi.ok,
      status: geminiApi.status,
      message: geminiApi.ok
        ? "Gemini API risponde."
        : geminiApi.message,
      reason: geminiApi.reason || null,
      activationUrl: geminiApi.activationUrl || null,
    },
  });
}

async function handleAnalyzeVideo(payload) {
  if (!payload || typeof payload !== "object") {
    return bad(400, "Richiesta JSON non valida.");
  }

  const apiKey = String(payload.apiKey || "").trim();
  const model = String(payload.model || DEFAULT_VIDEO_ANALYSIS_MODEL).trim();
  const customInstruction = String(payload.customInstruction || "").trim();
  const video = payload.video || {};
  const videoMime = String(video.mimeType || "video/mp4").trim();
  const videoData = video.data;
  const videoUri = video.fileUri;

  if (!apiKey) return bad(400, "Inserisci una API key Gemini valida.");
  if (!model) return bad(400, "Seleziona un modello di analisi.");
  if (!videoData && !videoUri) return bad(400, "Carica un video da analizzare.");
  if (!SUPPORTED_VIDEO_MIME_TYPES.has(videoMime)) {
    return bad(
      400,
      `Formato video non supportato: ${videoMime}. Usa MP4, MOV, WEBM, MPEG, AVI o 3GPP.`
    );
  }

  const videoPart = videoUri
    ? {
        file_data: {
          mime_type: videoMime,
          file_uri: videoUri,
        },
      }
    : {
        inline_data: {
          mime_type: videoMime,
          data: stripDataUrl(videoData),
        },
      };

  const userText =
    customInstruction ||
    "Analizza questo video e produci l'analisi strutturata e i due prompt richiesti.";

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [videoPart, { text: userText }],
      },
    ],
    systemInstruction: {
      parts: [{ text: VIDEO_ANALYSIS_SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: VIDEO_ANALYSIS_RESPONSE_SCHEMA,
      candidateCount: 1,
      temperature: 0.4,
    },
  };

  const url = `${GEMINI_API_ENDPOINT}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await callGoogle("Gemini API", url, requestBody, apiKey);
    const candidates = Array.isArray(response.candidates) ? response.candidates : [];
    const text = candidates
      .flatMap((candidate) => candidate?.content?.parts || [])
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("");

    if (!text) {
      return bad(502, "Gemini non ha restituito testo. Prova un modello diverso o un video pi\u00f9 corto.", { raw: response });
    }

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      return bad(502, "Gemini ha restituito JSON non valido.", { raw: text.slice(0, 800) });
    }

    return ok({ analysis, model, provider: "Gemini API" });
  } catch (error) {
    return {
      status: error.status || 502,
      body: {
        error: error.message || "Errore durante l'analisi del video.",
        status: error.status || null,
        reason: error.reason || null,
      },
    };
  }
}

module.exports = {
  handleHealth,
  handleGenerate,
  handleTestKey,
  handleAnalyzeVideo,
};
