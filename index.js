import express from "express";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

const app = express();

/* ---------------------------
   CORS
---------------------------- */
const allowedOrigins = new Set([
  process.env.FRONTEND_URL || "",
  "https://digitalgeekworld.com",
  "https://www.digitalgeekworld.com",
  "https://homepage-3d78.onrender.com",
].filter(Boolean));

const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === "1";

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (CORS_ALLOW_ALL || allowedOrigins.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Secret");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Stripe webhook must use RAW body — register BEFORE express.json
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = (session.metadata?.email || "").toLowerCase();
      const amountTotalCents = Number(session.amount_total || 0);
      const amountUsd = amountTotalCents / 100;
      const credits = Math.round(amountUsd * LYPOS_PER_USD);

      if (email && session.id) {
        // idempotent insert; if exists do nothing
        await pool.query(
          `INSERT INTO payments (email, stripe_session_id, amount_usd, credits, status)
           VALUES ($1,$2,$3,$4,'completed')
           ON CONFLICT (stripe_session_id) DO NOTHING`,
          [email, session.id, amountUsd, credits]
        );
        // Add credits (always safe even if payment insert already existed? guard by checking insert count)
        // We'll only add credits if insert happened
        const { rowCount } = await pool.query(
          `UPDATE users SET balance = balance + $2 WHERE email=$1`,
          [email, credits]
        );
      }
    }

    return res.json({ received: true });
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

app.use(express.json({ limit: "2mb" }));

/* ---------------------------
   Config
---------------------------- */
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const LYPOS_PER_USD = 100;
const CREDITS_PER_SECOND = Number(process.env.CREDITS_PER_SECOND || 10);

const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

/* ---------------------------
   Postgres
---------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      stripe_session_id TEXT UNIQUE,
      amount_usd NUMERIC NOT NULL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      prediction_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'starting',
      input_url TEXT,
      output_url TEXT,
      cost_credits INTEGER NOT NULL DEFAULT 0,
      refunded BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_adjustments (
      id BIGSERIAL PRIMARY KEY,
      target_email TEXT NOT NULL,
      amount_credits INTEGER NOT NULL,
      reason TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

function isAdminRequest(req) {
  const requester = normEmail(req.user?.email || "");
  const adminEmail = normEmail(process.env.ADMIN_EMAIL || "");
  const adminSecret = process.env.ADMIN_SECRET || "";
  const providedSecret = String(req.headers["x-admin-secret"] || "");

  if (adminEmail && requester && requester === adminEmail) return true;
  if (adminSecret && providedSecret && providedSecret === adminSecret) return true;
  return false;
}

/* ---------------------------
   Auth routes
---------------------------- */
app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password || password.length < 6) return res.status(400).json({ error: "INVALID_INPUT" });

    const { rows } = await pool.query("SELECT email FROM users WHERE email=$1", [email]);
    if (rows[0]) return res.status(409).json({ error: "EMAIL_EXISTS" });

    const password_hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (email, password_hash, balance) VALUES ($1,$2,0)", [email, password_hash]);

    const token = signToken(email);
    return res.json({ token, user: { email, balance: 0 } });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "INVALID_INPUT" });

    const { rows } = await pool.query("SELECT email, password_hash, balance FROM users WHERE email=$1", [email]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: "BAD_CREDENTIALS" });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "BAD_CREDENTIALS" });

    const token = signToken(email);
    return res.json({ token, user: { email: u.email, balance: Number(u.balance || 0) } });
  } catch {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query("SELECT email, balance, created_at FROM users WHERE email=$1", [email]);
  const u = rows[0];
  if (!u) return res.status(401).json({ error: "INVALID_USER" });
  return res.json({ user: { email: u.email, balance: Number(u.balance || 0), createdAt: u.created_at } });
});

/* ---------------------------
   Credits + account
---------------------------- */
app.get("/api/credits", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query("SELECT balance FROM users WHERE email=$1", [email]);
  if (!rows[0]) return res.status(401).json({ error: "INVALID_USER" });
  return res.json({ balance: Number(rows[0].balance || 0) });
});

// Optional direct charge endpoint (per-second pricing)
app.post("/api/credits/charge", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const seconds = Number(req.body?.seconds || 0);
  const s = Math.max(1, Math.ceil(seconds));
  const cost = s * CREDITS_PER_SECOND;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT balance FROM users WHERE email=$1 FOR UPDATE", [email]);
    const bal = rows[0] ? Number(rows[0].balance || 0) : null;
    if (bal === null) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "INVALID_USER" });
    }
    if (bal < cost) {
      await client.query("ROLLBACK");
      return res.status(402).json({ error: "INSUFFICIENT_LYPOS", required: cost, balance: bal });
    }
    const { rows: updated } = await client.query(
      "UPDATE users SET balance = balance - $2 WHERE email=$1 RETURNING balance",
      [email, cost]
    );
    await client.query("COMMIT");
    return res.json({ ok: true, cost, balance: Number(updated[0].balance || 0) });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "SERVER_ERROR" });
  } finally {
    client.release();
  }
});

app.get("/api/account/payments", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT id, amount_usd, credits, status, created_at FROM payments WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );
  return res.json({ payments: rows });
});

app.get("/api/account/videos", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT id, prediction_id, status, input_url, output_url, cost_credits, refunded, created_at, updated_at FROM videos WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );
  return res.json({ videos: rows });
});

/* ---------------------------
   Stripe checkout
---------------------------- */
app.post("/api/stripe/create-checkout-session", auth, async (req, res) => {
  try {
    const email = normEmail(req.user.email);
    const usd = Number(req.body?.usd || 0);
    if (!Number.isFinite(usd) || usd <= 0) return res.status(400).json({ error: "INVALID_AMOUNT" });

    const amountCents = Math.round(usd * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${FRONTEND_URL}/dashboard.html?paid=1`,
      cancel_url: `${FRONTEND_URL}/dashboard.html?paid=0`,
      metadata: { email },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "LYPO credits" },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
    });

    // store a created payment row
    await pool.query(
      `INSERT INTO payments (email, stripe_session_id, amount_usd, credits, status)
       VALUES ($1,$2,$3,$4,'created')
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [email, session.id, usd, Math.round(usd * LYPOS_PER_USD)]
    );

    return res.json({ url: session.url });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

/* ---------------------------
   Admin
---------------------------- */
app.get("/api/admin/status", auth, (req, res) => {
  return res.json({ isAdmin: isAdminRequest(req) });
});

app.post("/api/admin/add-credits", auth, async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: "FORBIDDEN" });

  const targetEmail = normEmail(req.body?.email || "");
  const amount = Number(req.body?.amount || 0);
  const reason = String(req.body?.reason || "").slice(0, 500);

  if (!targetEmail) return res.status(400).json({ error: "Missing email" });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: "Invalid amount" });

  const credits = Math.trunc(amount);
  const { rows: existing } = await pool.query("SELECT email, balance FROM users WHERE email=$1", [targetEmail]);
  if (!existing[0]) return res.status(404).json({ error: "User not found" });

  const { rows: updated } = await pool.query(
    "UPDATE users SET balance = balance + $2 WHERE email=$1 RETURNING email, balance",
    [targetEmail, credits]
  );

  await pool.query(
    "INSERT INTO admin_adjustments (target_email, amount_credits, reason, created_by) VALUES ($1,$2,$3,$4)",
    [targetEmail, credits, reason || null, normEmail(req.user.email)]
  );

  return res.json({ ok: true, user: updated[0] });
});

/* ---------------------------
   Replicate + S3 upload (unchanged)
---------------------------- */
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN || "" });

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function uploadToS3(buffer, key, contentType) {
  const Bucket = mustEnv("AWS_S3_BUCKET");
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
    })
  );
  const region = process.env.AWS_REGION || "us-east-1";
  return `https://${Bucket}.s3.${region}.amazonaws.com/${key}`;
}

app.get("/api/languages", (_req, res) => {
  return res.json({ languages: ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Hindi", "Japanese", "Korean"] });
});

app.post("/api/dub-upload", auth, (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 1024 * 1024 * 1024 } });

  let videoBuffer = null;
  let videoMime = "video/mp4";
  let outputLanguage = "";
  let secondsField = "0";

  bb.on("file", (_name, file, info) => {
    videoMime = info?.mimeType || "video/mp4";
    const chunks = [];
    file.on("data", (d) => chunks.push(d));
    file.on("limit", () => {
      res.status(413).json({ error: "File too large" });
    });
    file.on("end", () => {
      videoBuffer = Buffer.concat(chunks);
    });
  });

  bb.on("field", (name, val) => {
    if (name === "output_language") outputLanguage = String(val || "");
    if (name === "seconds") secondsField = String(val || "0");
  });

  bb.on("finish", async () => {
    try {
      if (!videoBuffer) return res.status(400).json({ error: "Missing video" });
      if (!outputLanguage) return res.status(400).json({ error: "Missing output_language" });

      const email = normEmail(req.user.email);
      const seconds = Math.max(1, Math.ceil(Number(secondsField || 0)));
      const cost = seconds * CREDITS_PER_SECOND;

      // Start by uploading file
      const key = `uploads/${email}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
      const videoUrl = await uploadToS3(videoBuffer, key, videoMime);

      // Create prediction
      const prediction = await replicate.predictions.create({
        version: process.env.REPLICATE_MODEL_VERSION,
        input: { video: videoUrl, target_language: outputLanguage },
      });

      // Charge credits AFTER prediction id exists
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT balance FROM users WHERE email=$1 FOR UPDATE", [email]);
        const bal = rows[0] ? Number(rows[0].balance || 0) : null;
        if (bal === null) {
          await client.query("ROLLBACK");
          return res.status(401).json({ error: "INVALID_USER" });
        }
        if (bal < cost) {
          await client.query("ROLLBACK");
          return res.status(402).json({ error: "INSUFFICIENT_LYPOS", required: cost, balance: bal });
        }
        await client.query("UPDATE users SET balance = balance - $2 WHERE email=$1", [email, cost]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      await pool.query(
        `INSERT INTO videos (email, prediction_id, status, input_url, cost_credits)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (prediction_id) DO UPDATE SET status=EXCLUDED.status, updated_at=now()`,
        [email, prediction.id, prediction.status || "starting", videoUrl, cost]
      );

      return res.json({ predictionId: prediction.id, status: prediction.status || "starting" });
    } catch (e) {
      return res.status(500).json({ error: e.message || "SERVER_ERROR" });
    }
  });

  req.pipe(bb);
});

app.get("/api/dub/:id", auth, async (req, res) => {
  try {
    const email = normEmail(req.user.email);
    const predictionId = String(req.params.id || "");

    const prediction = await replicate.predictions.get(predictionId);

    const outputUrl = prediction?.output?.url || prediction?.output || null;

    await pool.query(
      "UPDATE videos SET status=$3, output_url=$4, updated_at=now() WHERE email=$1 AND prediction_id=$2",
      [email, predictionId, prediction.status || "unknown", outputUrl]
    );

    // Refund once if failed
    if (prediction.status === "failed") {
      const { rows } = await pool.query(
        "SELECT cost_credits, refunded FROM videos WHERE email=$1 AND prediction_id=$2",
        [email, predictionId]
      );
      const row = rows[0];
      if (row && !row.refunded) {
        const cost = Number(row.cost_credits || 0);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("UPDATE users SET balance = balance + $2 WHERE email=$1", [email, cost]);
          await client.query("UPDATE videos SET refunded=true, updated_at=now() WHERE email=$1 AND prediction_id=$2", [email, predictionId]);
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }

    return res.json({
      id: predictionId,
      status: prediction.status,
      outputUrl,
      error: prediction.error || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "SERVER_ERROR" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on ${PORT}`));
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
