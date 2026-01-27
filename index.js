import express from "express";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();

// CORS for public demo
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// S3/R2 env
const {
S3_ENDPOINT = https://bd93392e54a05c1d6ddbc963fc05d7eb.eu.r2.cloudflarestorage.com
S3_REGION = auto
S3_ACCESS_KEY_ID = 5dd3a2aab1e182cfd4b9e7665d414e12
S3_SECRET_ACCESS_KEY = 87668a55ec8302fecb0aae83bbea590c027bbb724f4dd0b4ce023f1601359f35
S3_BUCKET = lypo-videos
PUBLIC_BASE_URL = https://pub-a6fab564a3874df9920cf82103b5843d.r2.dev
} = process.env;

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY
  }
});

// jobId -> predictionId
const jobs = new Map();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/languages", (_req, res) => {
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

// Upload -> S3/R2 -> Replicate prediction
app.post("/api/dub-upload", (req, res) => {
  const missing =
    !process.env.REPLICATE_API_TOKEN ||
    !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET || !PUBLIC_BASE_URL;

  if (missing) {
    return res.status(500).json({
      error:
        "Missing env vars. Need REPLICATE_API_TOKEN and S3_ENDPOINT,S3_ACCESS_KEY_ID,S3_SECRET_ACCESS_KEY,S3_BUCKET,PUBLIC_BASE_URL"
    });
  }

  const bb = Busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });

  let outputLanguage = null;
  let fileBufferChunks = [];
  let fileInfo = null;

  bb.on("field", (name, val) => {
    if (name === "output_language") outputLanguage = val;
  });

  bb.on("file", (name, file, info) => {
    if (name !== "video") {
      file.resume();
      return;
    }
    fileInfo = info;

    file.on("data", (d) => fileBufferChunks.push(d));
    file.on("limit", () => {
      // file too big
      fileBufferChunks = [];
    });
  });

  bb.on("finish", async () => {
    try {
      if (!fileInfo) return res.status(400).json({ error: "Missing video file (field name: video)" });
      if (!outputLanguage) return res.status(400).json({ error: "Missing output_language" });

      const body = Buffer.concat(fileBufferChunks);
      if (!body.length) return res.status(400).json({ error: "Empty upload or file too large" });

      const filename = fileInfo.filename || "video.mp4";
      const ext = (filename.split(".").pop() || "mp4").toLowerCase();
      const key = `uploads/${crypto.randomUUID()}.${ext}`;

      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: fileInfo.mimeType || "video/mp4"
      }));

      const base = PUBLIC_BASE_URL.replace(/\/$/, "");
      const videoUrl = `${base}/${key}`;

      const prediction = await replicate.predictions.create({
        model: "heygen/video-translate",
        input: { video: videoUrl, output_language: outputLanguage }
      });

      const jobId = crypto.randomUUID();
      jobs.set(jobId, prediction.id);

      res.json({ id: jobId, predictionId: prediction.id, status: prediction.status, uploadedUrl: videoUrl });
    } catch (e) {
      res.status(500).json({ error: e?.message || "Upload/Start failed" });
    }
  });

  req.pipe(bb);
});

// Poll prediction
app.get("/api/dub/:id", async (req, res) => {
  try {
    const predictionId = jobs.get(req.params.id);
    if (!predictionId) return res.status(404).json({ error: "Job not found" });

    const prediction = await replicate.predictions.get(predictionId);

    let outputUrl = null;
    const out = prediction.output;

    // If output is a file-like object with url()
    if (out && typeof out === "object" && typeof out.url === "function") outputUrl = out.url();
    else if (typeof out === "string") outputUrl = out;

    res.json({
      status: prediction.status,
      outputUrl,
      error: prediction.error || null,
      logs: prediction.logs || null
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LYPO backend running on ${port}`));
