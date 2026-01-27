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
app.get("/api/languages", (_req, res) => {
  // You can expand this. Keep it simple for now.
  res.json({
    languages: [
      "English","Spanish","French","German","Italian","Portuguese",
      "Dutch","Swedish","Norwegian","Danish","Finnish",
      "Polish","Czech","Slovak","Hungarian","Romanian",
      "Greek","Turkish","Ukrainian","Russian",
      "Arabic","Hebrew",
      "Hindi","Bengali","Urdu",
      "Chinese","Japanese","Korean","Vietnamese","Thai","Indonesian"
    ]
  });
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

app.post("/api/dub-upload", async (req, res) => {
  try {
    if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET || !PUBLIC_BASE_URL) {
      return res.status(500).json({
        error: "Missing S3/R2 env vars. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, PUBLIC_BASE_URL."
      });
    }

    const bb = Busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB
    let outputLanguage = null;

    let uploadPromise = null;
    let uploadedUrl = null;

    bb.on("field", (name, val) => {
      if (name === "output_language") outputLanguage = val;
    });

    bb.on("file", (name, file, info) => {
      if (name !== "video") {
        file.resume();
        return;
      }

      const { filename, mimeType } = info;
      const ext = (filename?.split(".").pop() || "mp4").toLowerCase();
      const key = `uploads/${crypto.randomUUID()}.${ext}`;

      const chunks = [];
      file.on("data", (d) => chunks.push(d));

      uploadPromise = new Promise((resolve, reject) => {
        file.on("end", async () => {
          try {
            const body = Buffer.concat(chunks);

            await s3.send(new PutObjectCommand({
              Bucket: S3_BUCKET,
              Key: key,
              Body: body,
              ContentType: mimeType || "video/mp4"
            }));

            uploadedUrl = PUBLIC_BASE_URL.replace(/\/$/, "") + "/" + key;
            resolve(uploadedUrl);
          } catch (e) {
            reject(e);
          }
        });

        file.on("error", reject);
      });
    });

    bb.on("finish", async () => {
      try {
        if (!uploadPromise) return res.status(400).json({ error: "Missing video file" });
        if (!outputLanguage) return res.status(400).json({ error: "Missing output_language" });

        const videoUrl = await uploadPromise;

        // Create Replicate prediction with heygen/video-translate
        const prediction = await replicate.predictions.create({
          model: "heygen/video-translate",
          input: { video: videoUrl, output_language: outputLanguage }
        });

        const jobId = crypto.randomUUID();
        jobs.set(jobId, prediction.id);

        res.json({
          id: jobId,
          predictionId: prediction.id,
          status: prediction.status,
          uploadedUrl: videoUrl
        });
      } catch (e) {
        res.status(500).json({ error: e?.message || "Upload/Start failed" });
      }
    });

    req.pipe(bb);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LYPO backend running on ${port}`));
