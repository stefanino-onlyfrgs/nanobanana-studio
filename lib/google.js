"use strict";

const DEFAULT_API_ENDPOINT = "https://aiplatform.googleapis.com";
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_VIDEO_ANALYSIS_MODEL = "gemini-3.1-pro-preview";

const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
]);
const SUPPORTED_OUTPUT_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const SUPPORTED_IMAGE_SIZES = new Set(["512", "1K", "2K", "4K"]);
const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/quicktime",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
]);

const VIDEO_ANALYSIS_SYSTEM_INSTRUCTION = `You are an elite cinematic prompt engineer for ByteDance Seedance 2.0 and Kuaishou Kling 3.0 video generation models.
You receive a short video. Tasks:

1) Watch the video carefully. Produce a precise structured analysis:
   - subjects (people, objects, animals visible)
   - actions (concrete movements, NOT vague: "tires spray gravel" not "car turns")
   - environment (location, time of day, weather, set design)
   - lighting (key light, mood, color temperature)
   - mood (emotional tone)
   - cameraMovements (pan, dolly, tracking, handheld, push-in, pull-out, crane, whip-pan, static, etc.)
   - durationSeconds (approximate length of the video clip)
   - style (cinematic, 35mm film, anime, documentary, vlog, music video, etc.)
   - audioNotes (speech, music, ambient sound, if audible)

2) Identify bestFrameTimestamp (in seconds, with 1 decimal): the BEST single frame where the main human subject's face and body are clearly visible, sharp, well-lit, with a stable pose. Avoid blurry frames, motion-blur, eyes-closed, mid-blink, or frames where only the back of the head is visible. Provide a short bestFrameRationale.

3) Compose two prompts that reproduce the exact same scene/motion using each model's official prompt formula.

SEEDANCE 2.0 formula (60-100 words, director mindset):
"<Subject>, <Action>, in <Environment>, camera <Camera-movement>, style <Style>, avoid <Constraints>".
For image-to-video, describe what changes and moves, not the static frame. Be specific about physics.

KLING 3.0 formula ("Constraint Sandwich"):
"<Subject Anchor>. <Shot type + Action>. <Environment & Lighting>. <Constraints / Style Bible>."
Use cinematic, directorial English. End with a short Style Bible sentence (e.g. "cinematic lighting, 35mm film grain, moody color grade") to be reusable across shots.

Both prompts MUST be in English, vivid, specific, free of safety-policy refusal text, and should not exceed ~120 words each.

Return ONLY a single JSON object matching the response schema. No markdown, no commentary, no code fences.`;

const VIDEO_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    subjects: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    environment: { type: "string" },
    lighting: { type: "string" },
    mood: { type: "string" },
    cameraMovements: { type: "array", items: { type: "string" } },
    durationSeconds: { type: "number" },
    style: { type: "string" },
    audioNotes: { type: "string" },
    bestFrameTimestamp: { type: "number" },
    bestFrameRationale: { type: "string" },
    seedancePrompt: { type: "string" },
    klingPrompt: { type: "string" },
  },
  required: [
    "summary",
    "seedancePrompt",
    "klingPrompt",
    "bestFrameTimestamp",
  ],
};

function stripDataUrl(data) {
  if (typeof data !== "string") return "";
  const marker = ";base64,";
  const markerIndex = data.indexOf(marker);
  return markerIndex >= 0 ? data.slice(markerIndex + marker.length) : data;
}

function imageToPart(image) {
  if (image.fileUri) {
    return {
      fileData: {
        mimeType: image.mimeType || "image/jpeg",
        fileUri: image.fileUri,
      },
    };
  }

  return {
    inlineData: {
      mimeType: image.mimeType || "image/png",
      data: stripDataUrl(image.data),
    },
  };
}

function imageToGeminiPart(image) {
  if (image.fileUri) {
    return {
      file_data: {
        mime_type: image.mimeType || "image/jpeg",
        file_uri: image.fileUri,
      },
    };
  }

  return {
    inline_data: {
      mime_type: image.mimeType || "image/png",
      data: stripDataUrl(image.data),
    },
  };
}

function normalizeEndpoint(endpoint) {
  const raw = String(endpoint || DEFAULT_API_ENDPOINT).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error("L'endpoint Vertex deve usare https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function extractResponseParts(vertexResponse) {
  const images = [];
  const texts = [];
  const candidates = Array.isArray(vertexResponse.candidates)
    ? vertexResponse.candidates
    : [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        texts.push(part.text);
      }
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        images.push({
          data: inlineData.data,
          mimeType: inlineData.mimeType || inlineData.mime_type || "image/png",
        });
      }
    }
  }

  return { images, text: texts.join("\n\n").trim() };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeGoogleError(provider, response, responseJson, responseText) {
  const message =
    responseJson?.error?.message ||
    responseJson?.message ||
    responseText ||
    `${provider} ha restituito un errore.`;
  const error = new Error(message);
  error.provider = provider;
  error.status = response.status;
  error.reason = responseJson?.error?.status || response.statusText || null;
  error.details = responseJson;
  return error;
}

async function callGoogle(provider, requestUrl, requestPayload, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const googleResponse = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const responseText = await googleResponse.text();
    let responseJson = {};
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseJson = { raw: responseText };
    }

    if (!googleResponse.ok) {
      throw makeGoogleError(provider, googleResponse, responseJson, responseText);
    }

    return responseJson;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`La richiesta a ${provider} e' scaduta dopo 10 minuti.`);
      timeoutError.provider = provider;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGoogleWithRetry(provider, requestUrl, requestPayload, apiKey, retryDelays) {
  const attempts = [];
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await callGoogle(provider, requestUrl, requestPayload, apiKey);
      return { response, attempts };
    } catch (error) {
      attempts.push({
        provider,
        status: error.status || null,
        reason: error.reason || null,
        message: error.message,
      });
      if (error.status !== 429 || attempt >= retryDelays.length) {
        error.attempts = attempts;
        throw error;
      }
      await sleep(retryDelays[attempt]);
    }
  }
}

async function probeGoogle(name, requestUrl, options = {}) {
  try {
    const response = await fetch(requestUrl, options);
    const responseText = await response.text();
    let responseJson = {};
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseJson = { raw: responseText };
    }

    if (response.ok) {
      return {
        name,
        ok: true,
        status: response.status,
        message: "OK",
        details: responseJson,
      };
    }

    const error = responseJson.error || {};
    const firstDetail = Array.isArray(error.details) ? error.details[0] : null;
    return {
      name,
      ok: false,
      status: response.status,
      reason: firstDetail?.reason || error.status || "ERROR",
      message: error.message || responseText || "Errore Google API.",
      activationUrl: firstDetail?.metadata?.activationUrl || null,
      details: responseJson,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      reason: "NETWORK_ERROR",
      message: error.message,
      activationUrl: null,
      details: {},
    };
  }
}

module.exports = {
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
  makeGoogleError,
  callGoogle,
  callGoogleWithRetry,
  probeGoogle,
};
