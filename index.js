import express from "express";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

/* ---------------------------
   CORS (demo-friendly)
---------------------------- */
const allowedOrigins = new Set([
  "https://digitalgeekworld.com",
  "https://www.digitalgeekworld.com",
  "https://homepage-3d78.onrender.com",
  process.env.FRONTEND_URL || ""
].filter(Boolean));

const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === "1";

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (CORS_ALLOW_ALL || allowedOrigins.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
/* ---------------------------
   Auth + Credits + Stripe (LYPOS)
   - $1 = 100 LYPOS
   - 30s = 289 LYPOS (based on $2.89)
   NOTE: users.json is a simple starter store.
---------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_PATH = path.join(__dirname, "users.json");

const LYPOS_PER_USD = 100;
const PRICE_PER_30S_USD = Number(process.env.PRICE_PER_30S_USD || 2.89);
const PRICE_PER_30S_LYPOS = Math.round(PRICE_PER_30S_USD * LYPOS_PER_USD);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";

function readDb(){
  try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8")); }
  catch { return { users: [] }; }
}
function writeDb(db){
  fs.writeFileSync(USERS_PATH, JSON.stringify(db, null, 2));
}
function findUser(email){
  const db = readDb();
  const e = String(email||"").toLowerCase();
  const u = db.users.find(x => x.email === e);
  return { db, u, e };
}
function publicUser(u){ return { email: u.email, balance: Number(u.balance||0), createdAt: u.createdAt }; }
function signToken(email){ return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" }); }
function auth(req, res, next){
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  try { req.user = jwt.verify(token, JWT_SECRET); return next(); }
  catch { return res.status(401).json({ error: "INVALID_TOKEN" }); }
}

// Stripe webhook must use RAW body — define BEFORE express.json
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

    if (email && lypos > 0) {
      const { db, u } = findUser(email);
      if (u) {
        u.balance = Number(u.balance||0) + lypos;
        writeDb(db);
        console.log("✅ Credited LYPOS:", { email, lypos, balance: u.balance });
      } else {
        console.log("⚠️ Webhook: user not found:", email);
      }
    }
  }

  res.json({ received: true });
});

// JSON for normal routes
app.use(express.json({ limit: "2mb" }));

// ---- Auth
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

  const { db, u, e } = findUser(email);
  if (u) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = { email: e, passwordHash, balance: 0, createdAt: new Date().toISOString() };
  db.users.push(user);
  writeDb(db);

  res.json({ token: signToken(e), user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  const { u, e } = findUser(email);
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(String(password), String(u.passwordHash||""));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signToken(e), user: publicUser(u) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const email = req.user?.email;
  const { u } = findUser(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: publicUser(u) });
});

// ---- Credits
app.get("/api/credits", auth, (req, res) => {
  const email = req.user.email;
  const { u } = findUser(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ balance: Number(u.balance||0) });
});

app.post("/api/credits/charge", auth, (req, res) => {
  const email = req.user.email;
  const seconds = Number(req.body?.seconds || 0);
  const units = Math.max(1, Math.ceil(seconds / 30));
  const cost = units * PRICE_PER_30S_LYPOS;

  const { db, u } = findUser(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });

  const bal = Number(u.balance||0);
  if (bal < cost) return res.status(402).json({ error: "INSUFFICIENT_LYPOS", required: cost, balance: bal });

  u.balance = bal - cost;
  writeDb(db);
  res.json({ charged: cost, remaining: u.balance });
});

// ---- Stripe checkout: buy LYPOS
app.post("/api/stripe/create-checkout-session", auth, async (req, res) => {
  const usd = Number(req.body?.usd || 0);
  if (!Number.isFinite(usd) || usd <= 0) return res.status(400).json({ error: "Invalid usd" });

  const email = req.user.email;
  const lypos = Math.round(usd * LYPOS_PER_USD);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: Math.round(usd * 100),
        product_data: { name: `${lypos} LYPOS` }
      },
      quantity: 1
    }],
    metadata: { email, lypos: String(lypos) },
    success_url: `${FRONTEND_URL}/?paid=1`,
    cancel_url: `${FRONTEND_URL}/?paid=0`
  });

  res.json({ url: session.url });
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

/**
 * POST /api/dub-upload
 * multipart/form-data:
 *  - video: (file)
 *  - output_language: (string e.g. "Spanish")
 *
 * Uploads the file to S3/R2, then starts a Replicate prediction.
 * Returns id = Replicate prediction id (so polling never loses state).
 */
app.post("/api/dub-upload", auth, (req, res) => {
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
    let secondsField = 0;
    let fileInfo = null;
    let chunks = [];

    bb.on("field", (name, val) => {
      if (name === "output_language") outputLanguage = val;
      if (name === "seconds") secondsField = Number(val || 0);
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
app.get("/api/dub/:id", auth, async (req, res) => {
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

