import express from "express";
import Replicate from "replicate";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Basic CORS (ok for a public demo; tighten later)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const {
  REPLICATE_API_TOKEN,
  REPLICATE_MODEL_VERSION,
  // Optional: if your chosen model uses different input keys:
  // REPLICATE_VIDEO_KEY = "video",
  // REPLICATE_LANG_KEY  = "target_language"
  REPLICATE_VIDEO_KEY = "video",
  REPLICATE_LANG_KEY = "target_language"
} = process.env;

if (!REPLICATE_API_TOKEN) {
  console.error("Missing REPLICATE_API_TOKEN env var");
}
if (!REPLICATE_MODEL_VERSION) {
  console.error("Missing REPLICATE_MODEL_VERSION env var");
}

const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

// Simple in-memory job store (fine for a demo). For production, use a DB/Redis.
const jobs = new Map(); // jobId -> { predictionId }

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /api/dub
 * Body:
 *  { videoUrl: "https://...", targetLanguage: "es", keepVoice: true, lipsync: true }
 *
 * NOTE: The exact input schema depends on the Replicate model you choose.
 * We map videoUrl -> input[REPLICATE_VIDEO_KEY]
 * and targetLanguage -> input[REPLICATE_LANG_KEY]
 */
app.post("/api/dub", async (req, res) => {
  try {
    const { videoUrl, targetLanguage, keepVoice = true, lipsync = true } = req.body || {};

    if (!videoUrl || !targetLanguage) {
      return res.status(400).json({ error: "videoUrl and targetLanguage are required" });
    }
    if (!REPLICATE_MODEL_VERSION) {
      return res.status(500).json({ error: "Server missing REPLICATE_MODEL_VERSION" });
    }

    const input = {
      [REPLICATE_VIDEO_KEY]: videoUrl,
      [REPLICATE_LANG_KEY]: targetLanguage,
      // These may or may not exist on your chosen model; harmless if ignored by your own mapping
      keep_voice: keepVoice,
      lipsync: lipsync
    };

    // Create a prediction (async job)
    const prediction = await replicate.predictions.create({
      version: REPLICATE_MODEL_VERSION,
      input
      // Optional: webhooks are great for production
      // webhook: "https://your-backend.onrender.com/api/replicate/webhook",
      // webhook_events_filter: ["start", "completed"]
    });

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { predictionId: prediction.id });

    res.json({
      id: jobId,
      predictionId: prediction.id,
      status: prediction.status,
      // helpful for debugging:
      inputSent: input
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

/**
 * GET /api/dub/:id
 * Returns a normalized status + outputUrl when available.
 * Poll this from the frontend.
 */
app.get("/api/dub/:id", async (req, res) => {
  try {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const prediction = await replicate.predictions.get(job.predictionId);

    // Normalize output into a single URL if the model returns files/urls
    let outputUrl = null;
    const out = prediction.output;

    // output could be a string URL, array of URLs, or an object containing URLs
    if (typeof out === "string") outputUrl = out;
    else if (Array.isArray(out)) outputUrl = out.find((x) => typeof x === "string") || null;
    else if (out && typeof out === "object") {
      // common patterns: { video: "..."} or { output: "..."}
      outputUrl =
        out.video ||
        out.output ||
        Object.values(out).find((x) => typeof x === "string") ||
        null;
    }

    res.json({
      status: prediction.status, // "starting" | "processing" | "succeeded" | "failed" etc.
      outputUrl,
      error: prediction.error || null,
      logs: prediction.logs || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LYPO backend listening on ${port}`));
