import express from "express";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Stripe from "stripe";

const app = express();

/* ---------------------------
   Credits (LYPOS) — demo store
   1 USD = 100 LYPOS
   NOTE: replace with DB in production.
---------------------------- */
const LYPOS_PER_USD = 100;
const PRICE_PER_30S_LYPOS = 289;

const creditsStore = new Map();
function getBalance(userId){
  if (!userId) return 0;
  if (!creditsStore.has(userId)) creditsStore.set(userId, 0);
  return creditsStore.get(userId) || 0;
}
function addCredits(userId, amount){
  const bal = getBalance(userId);
  const next = Math.max(0, bal + Number(amount || 0));
  creditsStore.set(userId, next);
  return next;
}
function chargeCredits(userId, amount){
  const bal = getBalance(userId);
  const a = Number(amount || 0);
  if (bal < a){
    const err = new Error('INSUFFICIENT_LYPOS');
    err.statusCode = 402;
    err.meta = { required: a, balance: bal };
    throw err;
  }
  const next = bal - a;
  creditsStore.set(userId, next);
  return next;
}

import Stripe from "stripe";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// ---- Stripe + Auth + Credits config
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";

// Credits model
const LYPOS_PER_USD = 100;
const PRICE_PER_30S_USD = Number(process.env.PRICE_PER_30S_USD || 2.89);
const PRICE_PER_30S_LYPOS = Math.round(PRICE_PER_30S_USD * LYPOS_PER_USD);

// ---- SUPER SIMPLE in-memory “DB” (works now; later swap to Postgres)
// userEmail -> { passwordHash, balance }
const users = new Map();

function publicUser(email) {
  const u = users.get(email);
  return { email, balance: Number(u?.balance || 0) };
}

function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

// ---------------------------
// Stripe webhook (RAW body) — MUST be before express.json()
// ---------------------------
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

    if (email && lypos > 0 && users.has(email)) {
      const u = users.get(email);
      u.balance = Number(u.balance || 0) + lypos;
      users.set(email, u);
      console.log("✅ Credited LYPOS", { email, lypos, balance: u.balance });
    }
  }

  res.json({ received: true });
});

// Now your normal JSON middleware can be used:
app.use(express.json({ limit: "2mb" }));

// ---------------------------
// Auth routes
// ---------------------------
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

  const e = String(email).toLowerCase();
  if (users.has(e)) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  users.set(e, { passwordHash, balance: 0 });

  const token = signToken(e);
  res.json({ token, user: publicUser(e) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  const e = String(email).toLowerCase();
  const u = users.get(e);
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(String(password), String(u.passwordHash));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken(e);
  res.json({ token, user: publicUser(e) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const email = req.user.email;
  if (!users.has(email)) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: publicUser(email) });
});

// ---------------------------
// Credits routes
// ---------------------------
app.get("/api/credits", auth, (req, res) => {
  const email = req.user.email;
  res.json({ balance: publicUser(email).balance });
});

app.post("/api/credits/charge", auth, (req, res) => {
  const email = req.user.email;
  const { seconds } = req.body || {};
  const s = Number(seconds || 0);
  const units = Math.max(1, Math.ceil(s / 30));
  const cost = units * PRICE_PER_30S_LYPOS;

  const u = users.get(email);
  const bal = Number(u?.balance || 0);
  if (bal < cost) return res.status(402).json({ error: "INSUFFICIENT_LYPOS", required: cost, balance: bal });

  u.balance = bal - cost;
  users.set(email, u);

  res.json({ charged: cost, remaining: u.balance });
});

// ---------------------------
// Stripe checkout route (buy LYPOS)
// ---------------------------
app.post("/api/stripe/create-checkout-session", auth, async (req, res) => {
  const email = req.user.email;
  const { usd } = req.body || {};
  const dollars = Number(usd || 0);

  if (!Number.isFinite(dollars) || dollars <= 0) {
    return res.status(400).json({ error: "Invalid usd" });
  }

  const lypos = Math.round(dollars * LYPOS_PER_USD);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(dollars * 100),
          product_data: { name: `${lypos} LYPOS` }
        },
        quantity: 1
      }
    ],
    metadata: { email, lypos: String(lypos) },
    success_url: `${FRONTEND_URL}/?paid=1`,
    cancel_url: `${FRONTEND_URL}/?paid=0`
  });

  res.json({ url: session.url });
});


/* ---------------------------
   CORS (demo-friendly)
---------------------------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


/* ---------------------------
   Stripe webhook (RAW body)
---------------------------- */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const lypos = Number(session.metadata?.lypos || 0);
    if (userId && lypos > 0) {
      const next = addCredits(userId, lypos);
      console.log("✅ LYPOS credited:", { userId, lypos, balance: next });
    }
  }

  res.json({ received: true });
});

// JSON body parsing (safe for non-multipart routes)
app.use(express.json({ limit: '1mb' }));

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

/* ---------------------------
   Stripe
---------------------------- */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

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
      "English","Spanish","French","German","Italian","Portuguese",
      "Dutch","Swedish","Norwegian","Danish","Finnish",
      "Polish","Czech","Slovak","Hungarian","Romanian",
      "Greek","Turkish","Ukrainian","Russian",
      "Arabic","Hebrew",
      "Hindi","Bengali","Urdu",
      "Chinese","Japanese","Korean","Vietnamese","Thai","Indonesian"
    ]
  });

/* ---------------------------
   Credits API (LYPOS)
---------------------------- */
app.get("/api/credits", (req, res) => {
  const userId = req.query.userId;
  res.json({ balance: getBalance(userId) });
});

app.post("/api/credits/charge", (req, res, next) => {
  try {
    const { userId, seconds } = req.body || {};
    if (!userId) return res.status(400).json({ error: "Missing userId" });

/* ---------------------------
   Stripe: create checkout (buy LYPOS)
   POST { userId, usd }
---------------------------- */
app.post("/api/stripe/create-checkout", async (req, res, next) => {
  try {
    const { userId, usd } = req.body || {};
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const dollars = Number(usd || 0);
    if (!Number.isFinite(dollars) || dollars <= 0) return res.status(400).json({ error: "Invalid usd" });

    const lypos = Math.round(dollars * LYPOS_PER_USD);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(dollars * 100),
            product_data: { name: `${lypos} LYPOS` }
          },
          quantity: 1
        }
      ],
      metadata: { userId: String(userId), lypos: String(lypos) },
      success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/?paid=1`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/?paid=0`
    });

    res.json({ url: session.url });
  } catch (e) { next(e); }
});


    const s = Number(seconds || 0);
    const units = Math.max(1, Math.ceil(s / 30));
    const cost = units * PRICE_PER_30S_LYPOS;

    const remaining = chargeCredits(userId, cost);
    res.json({ charged: cost, remaining });
  } catch (e) {
    if (e?.statusCode === 402) return res.status(402).json({ error: "INSUFFICIENT_LYPOS", ...(e.meta || {}) });
    next(e);
  }
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


/* ---------------------------
   Error handler
---------------------------- */
app.use((err, req, res, next) => {
  console.error("❌ Error:", err?.message || err);
  res.status(err.statusCode || 500).json({ error: err?.message || "Server error" });
});
