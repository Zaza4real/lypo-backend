import express from "express";
import Replicate from "replicate";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Busboy from "busboy";
import crypto from "crypto";

const {
  S3_ENDPOINT,
  S3_REGION = "auto",
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  PUBLIC_BASE_URL // e.g. https://<your-public-domain-or-r2-public-url>/
} = process.env;

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY
  }
});

const app = express();
app.use(express.json({ limit: "1mb" }));

// Basic CORS for a public demo (tighten later if you want)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// In-memory store: jobId -> predictionId
// (OK for demo. For production, use Redis/DB.)
const jobs = new Map();

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /api/dub
 * Body:
 *  {
 *    videoUrl: "https://...mp4",
 *    targetLanguage: "Spanish"
 *  }
 *
 * heygen/video-translate expects:
 *  { video: <url>, output_language: <language name> }
 */
app.post("/api/dub", async (req, res) => {
  try {
    const { videoUrl, targetLanguage } = req.body || {};

    if (!videoUrl || !targetLanguage) {
      return res.status(400).json({ error: "videoUrl and targetLanguage are required" });
    }

    // Create prediction for heygen/video-translate
    const prediction = await replicate.predictions.create({
      model: "heygen/video-translate",
      input: {
        video: videoUrl,
        output_language: targetLanguage
      }
    });

    const jobId = crypto.randomUUID();
    jobs.set(jobId, prediction.id);

    res.json({
      id: jobId,
      predictionId: prediction.id,
      status: prediction.status
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

/**
 * GET /api/dub/:id
 * Returns normalized:
 *  { status, outputUrl, error, logs }
 *
 * Output may be a FileOutput object (has url()).
 * Replicate docs show how output file objects work in JS. :contentReference[oaicite:3]{index=3}
 */
app.get("/api/dub/:id", async (req, res) => {
  try {
    const predictionId = jobs.get(req.params.id);
    if (!predictionId) return res.status(404).json({ error: "Job not found" });

    const prediction = await replicate.predictions.get(predictionId);

    let outputUrl = null;

    // For this model, output is typically a file-like object.
    // If it supports .url() (FileOutput), use it.
    const out = prediction.output;

    if (out && typeof out === "object" && typeof out.url === "function") {
      outputUrl = out.url();
    } else if (typeof out === "string") {
      outputUrl = out;
    }

    res.json({
      status: prediction.status,
      outputUrl,
      error: prediction.error || null,
      logs: prediction.logs || null
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LYPO backend running on ${port}`));
