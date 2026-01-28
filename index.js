import express from "express";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();

/* ---------------------------
   CORS (demo-friendly)
---------------------------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------------------------
   Auth + Credits + Stripe
---------------------------- */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";

const LYPOS_PER_USD = 100;
const PRICE_PER_30S_USD = Number(process.env.PRICE_PER_30S_USD || 2.89);
const PRICE_PER_30S_LYPOS = Math.round(PRICE_PER_30S_USD * LYPOS_PER_USD);

const USERS_FILE = new URL("./users.json", import.meta.url).pathname;

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const data = JSON.parse(raw || "{}");
    return data.users || {};
  } catch (e) {
    console.error("Failed to load users.json:", e);
    return {};
  }
}
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  } catch (e) {
    console.error("Failed to save users.json:", e);
  }
}
let USERS = loadUsers();

function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
}
function getAuthEmail(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.email || null;
  } catch {
    return null;
  }
}
function requireAuth(req, res, next) {
  const email = getAuthEmail(req);
  if (!email || !USERS[email]) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  req.userEmail = email;
  next();
}

// Stripe webhook needs RAW body and must be registered before express.json()
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.metadata?.email;
    const lypos = Number(session.metadata?.lypos || 0);

    if (email && USERS[email] && lypos > 0) {
      USERS[email].balance = Number(USERS[email].balance || 0) + lypos;
      saveUsers(USERS);
      console.log("✅ Credited LYPOS:", { email, lypos, balance: USERS[email].balance });
    }
  }

  res.json({ received: true });
});

// JSON routes (everything except webhook)
app.use(express.json({ limit: "2mb" }));

/* Auth routes */
app.post("/api/auth/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (password.length < 6) return res.status(400).json({ error: "Password too short (min 6)" });
  if (USERS[email]) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  USERS[email] = { passwordHash, balance: 0 };
  saveUsers(USERS);

  res.json({ token: signToken(email), user: { email, balance: 0 } });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const u = USERS[email];
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, String(u.passwordHash || ""));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signToken(email), user: { email, balance: Number(u.balance || 0) } });
});

app.get("/api/auth/me", (req, res) => {
  const email = getAuthEmail(req);
  if (!email || !USERS[email]) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  const u = USERS[email];
  res.json({ user: { email, balance: Number(u.balance || 0) } });
});

/* Credits */
app.get("/api/credits", requireAuth, (req, res) => {
  const u = USERS[req.userEmail];
  res.json({ balance: Number(u.balance || 0) });
});

app.post("/api/credits/charge", requireAuth, (req, res) => {
  const seconds = Number(req.body?.seconds || 0);
  const units = Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 0) / 30));
  const cost = units * PRICE_PER_30S_LYPOS;

  const u = USERS[req.userEmail];
  const bal = Number(u.balance || 0);
  if (bal < cost) {
    return res.status(402).json({ error: "INSUFFICIENT_LYPOS", required: cost, balance: bal });
  }

  u.balance = bal - cost;
  saveUsers(USERS);
  res.json({ charged: cost, remaining: u.balance });
});

/* Stripe checkout: buy LYPOS */
app.post("/api/stripe/create-checkout-session", requireAuth, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

  const usd = Number(req.body?.usd || 0);
  if (!Number.isFinite(usd) || usd <= 0) return res.status(400).json({ error: "Invalid usd" });

  const lypos = Math.round(usd * LYPOS_PER_USD);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: req.userEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(usd * 100),
          product_data: { name: `${lypos} LYPOS` }
        },
        quantity: 1
      }
    ],
    metadata: { email: req.userEmail, lypos: String(lypos) },
    success_url: `${FRONTEND_URL}/?paid=1`,
    cancel_url: `${FRONTEND_URL}/?paid=0`
  });

  res.json({ url: session.url, lypos });
});




/* ---------------------------
   ENV
---------------------------- */
const {
  REPLICATE_API_TOKEN,
  REPLICATE_MODEL_VERSION, // REQUIRED
  S3_ENDPOINT,
  S3_REGION = "auto",
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  PUBLIC_BASE_URL
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    const err = new Error(`Missing env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return value;
}

/* ---------------------------
   Replicate client
---------------------------- */
const replicate = new Replicate({
  auth: REPLICATE_API_TOKEN
});

/* ---------------------------
   S3/R2 client
---------------------------- */
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID || "",
    secretAccessKey: S3_SECRET_ACCESS_KEY || ""
  }
});

/* ---------------------------
   Helper: create prediction
   IMPORTANT: uses version (never model)
---------------------------- */
async function createHeygenPrediction({ videoUrl, outputLanguage }) {
  const version = requireEnv("REPLICATE_MODEL_VERSION", REPLICATE_MODEL_VERSION);
  requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);

  // Useful debug logs (safe—no secrets)
  console.log("Creating Replicate prediction with version:", version);
  console.log("Input:", { video: videoUrl, output_language: outputLanguage });

  return replicate.predictions.create({
    version,
    input: {
      video: videoUrl,
      output_language: outputLanguage
    }
  });
}

/* ---------------------------
   Routes
---------------------------- */
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/languages", (_req, res) => {
  res.json({
    languages: [
      "Arabic",
      "Arabic (Egypt)",
      "Arabic (Saudi Arabia)",
      "Bulgarian",
      "Chinese",
      "Chinese (Mandarin, Simplified)",
      "Chinese (Taiwanese Mandarin, Traditional)",
      "Croatian",
      "Czech",
      "Danish (Denmark)",
      "Dutch (Netherlands)",
      "English",
      "English (Australia)",
      "English (Canada)",
      "English (India)",
      "English (UK)",
      "English (United States)",
      "Filipino (Philippines)",
      "Finnish (Finland)",
      "French (Canada)",
      "French (France)",
      "German (Austria)",
      "German (Germany)",
      "German (Switzerland)",
      "Greek (Greece)",
      "Hindi (India)",
      "Indonesian (Indonesia)",
      "Italian (Italy)",
      "Japanese (Japan)",
      "Korean (Korea)",
      "Malay (Malaysia)",
      "Mandarin",
      "Polish (Poland)",
      "Portuguese (Brazil)",
      "Portuguese (Portugal)",
      "Romanian (Romania)",
      "Russian (Russia)",
      "Slovak (Slovakia)",
      "Spanish (Mexico)",
      "Spanish (Spain)",
      "Swedish (Sweden)",
      "Tamil (India)",
      "Turkish (T\u00fcrkiye)",
      "Ukrainian (Ukraine)",
      "Vietnamese (Vietnam)",
      "Thai (Thailand)"
    ]
  });
});

/**
 * POST /api/dub-upload
 * multipart/form-data:
 *  - video: (file)
 *  - output_language: (string e.g. "Spanish")
 *
 * Uploads the file to S3/R2, then starts a Replicate prediction.
 * Returns id = Replicate prediction id (so polling never loses state).
 */
app.post("/api/dub-upload", (req, res) => {
  try {
    // Validate required env vars early for a clean error message
    requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);
    requireEnv("REPLICATE_MODEL_VERSION", REPLICATE_MODEL_VERSION);
    requireEnv("S3_ENDPOINT", S3_ENDPOINT);
    requireEnv("S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID);
    requireEnv("S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY);
    requireEnv("S3_BUCKET", S3_BUCKET);
    requireEnv("PUBLIC_BASE_URL", PUBLIC_BASE_URL);

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: 500 * 1024 * 1024 } // 500MB
    });

    let outputLanguage = null;
    let fileInfo = null;
    let chunks = [];

    bb.on("field", (name, val) => {
      if (name === "output_language") outputLanguage = val;
    });

    bb.on("file", (name, file, info) => {
      if (name !== "video") {
        file.resume();
        return;
      }

      fileInfo = info;
      chunks = [];

      file.on("data", (d) => chunks.push(d));
      file.on("limit", () => {
        chunks = [];
      });
      file.on("error", (e) => {
        console.error("Upload stream error:", e);
      });
    });

    bb.on("finish", async () => {
      try {
        if (!fileInfo) return res.status(400).json({ error: "Missing video file (field name: video)" });
        if (!outputLanguage) return res.status(400).json({ error: "Missing output_language" });

        const body = Buffer.concat(chunks);
        if (!body.length) return res.status(400).json({ error: "Empty upload or file too large" });

        const original = fileInfo.filename || "video.mp4";
        const ext = (original.split(".").pop() || "mp4").toLowerCase();
        const key = `uploads/${crypto.randomUUID()}.${ext}`;

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: fileInfo.mimeType || "video/mp4"
        }));

        const base = PUBLIC_BASE_URL.replace(/\/$/, "");
        const videoUrl = `${base}/${key}`;

        const prediction = await createHeygenPrediction({
          videoUrl,
          outputLanguage
        });

        // ✅ Return Replicate prediction id as the job id.
        // This avoids “job not found” even if Render restarts.
        res.json({
          id: prediction.id,
          predictionId: prediction.id,
          status: prediction.status,
          uploadedUrl: videoUrl
        });
      } catch (e) {
        console.error(e);
        res.status(e.statusCode || 500).json({ error: e?.message || "Upload/Start failed" });
      }
    });

    req.pipe(bb);
  } catch (e) {
    console.error(e);
    res.status(e.statusCode || 500).json({ error: e?.message || "Internal error" });
  }
});

/**
 * GET /api/dub/:id
 * Polls Replicate prediction by id (no in-memory state needed).
 */
app.get("/api/dub/:id", async (req, res) => {
  try {
    requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);

    const predictionId = req.params.id;
    const prediction = await replicate.predictions.get(predictionId);

    let outputUrl = null;
    const out = prediction.output;

    // Replicate output may be file-like (url()), string, array, etc.
    if (out && typeof out === "object" && typeof out.url === "function") {
      outputUrl = out.url();
    } else if (typeof out === "string") {
      outputUrl = out;
    } else if (Array.isArray(out)) {
      outputUrl = out.find((x) => typeof x === "string") || null;
    } else if (out && typeof out === "object") {
      outputUrl =
        out.url ||
        out.video ||
        out.output ||
        Object.values(out).find((x) => typeof x === "string") ||
        null;
    }
    res.json({
      status: prediction.status,
      outputUrl,
      error: prediction.error || null,
      logs: prediction.logs || null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LYPO backend running on ${port}`));
