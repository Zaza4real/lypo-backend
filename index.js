import express from "express";
import Replicate from "replicate";
import Busboy from "busboy";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "");
const EMAIL_FROM = process.env.EMAIL_FROM || "LYPO <no-reply@digitalgeekworld.com>";

const app = express();

app.use(express.json());

app.post("/api/auth/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email required" });

  // Always respond OK to avoid account enumeration
  const ok = () => res.json({ ok: true });

  const user = await pool.query("SELECT email FROM users WHERE email=$1", [email]);
  if (user.rowCount === 0) return ok();

  // generate token + store hash
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  await pool.query(
    `INSERT INTO password_resets (email, token_hash, expires_at)
     VALUES ($1,$2,$3)`,
    [email, tokenHash, expiresAt]
  );

  const resetLink = `${FRONTEND_URL}/auth.html#reset=${token}`;

  // send email via Resend API (no SMTP)
  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: "Reset your LYPO password",
    html: `
      <p>We received a request to reset your password.</p>
      <p><a href="${resetLink}">Reset password</a></p>
      <p>This link expires in 30 minutes.</p>
    `
  });

  return ok();
});
app.post("/api/auth/reset", async (req, res) => {
  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.newPassword || "");

  if (token.length < 20) return res.status(400).json({ error: "Invalid token" });
  if (newPassword.length < 8) return res.status(400).json({ error: "Password too short" });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const r = await pool.query(
    `SELECT id, email FROM password_resets
     WHERE token_hash=$1 AND used=false AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash]
  );
  if (r.rowCount === 0) return res.status(400).json({ error: "Token expired or invalid" });

  const email = r.rows[0].email;

  const password_hash = await bcrypt.hash(newPassword, 10);

  await pool.query("UPDATE users SET password_hash=$1 WHERE email=$2", [password_hash, email]);
  await pool.query("UPDATE password_resets SET used=true WHERE id=$1", [r.rows[0].id]);

  res.json({ ok: true });
});

/* ---------------------------
   CORS
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
---------------------------- */
const LYPOS_PER_USD = 100;
const CREDITS_PER_SECOND = Number(process.env.CREDITS_PER_SECOND || 10);
const PRICE_PER_30S_USD = Number(process.env.PRICE_PER_30S_USD || 2.89);
const PRICE_PER_30S_LYPOS = Math.round(PRICE_PER_30S_USD * LYPOS_PER_USD);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";

// ---- Postgres
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render Postgres usually requires SSL in production
  ssl: process.env.DISABLE_PG_SSL === "1" ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  
    CREATE TABLE IF NOT EXISTS password_resets (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS password_resets_email_idx ON password_resets(email);
    CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets(token_hash);
`);
   await pool.query(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      stripe_session_id TEXT UNIQUE,
      amount_usd NUMERIC NOT NULL DEFAULT 0,
      lypos INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      invoice_url TEXT,
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

  // Migrations for existing databases
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS cost_credits INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_url TEXT;`);
}

function normEmail(email) {
  return String(email || "").toLowerCase().trim();
}
function publicUserRow(r) {
  return { email: r.email, balance: Number(r.balance || 0), createdAt: r.created_at };
}
function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  // If SMTP isn't configured, log the URL for development/testing.
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !from || !user || !pass) {
    console.log("🔑 Password reset link (SMTP not configured):", resetUrl);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: "Reset your LYPO password",
    text: `Reset your password using this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`
  });
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function getUserByEmail(email) {
  const e = normEmail(email);
  const { rows } = await pool.query(
    "SELECT email, password_hash, balance, created_at FROM users WHERE email=$1",
    [e]
  );
  return rows[0] || null;
}
async function createUser(email, passwordHash) {
  const e = normEmail(email);
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, balance) VALUES ($1,$2,0) RETURNING email, password_hash, balance, created_at",
    [e, passwordHash]
  );
  return rows[0];
}

async function recordPayment({ email, stripeSessionId, amountUsd, lypos, status, invoiceUrl }) {
  // Returns true if a NEW row was inserted. If the session already exists,
  // the record is updated (status/invoice_url) and we return false.
  const e = normEmail(email);
  const { rows } = await pool.query(
    `WITH upsert AS (
      INSERT INTO payments (email, stripe_session_id, amount_usd, lypos, status, invoice_url)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (stripe_session_id) DO UPDATE SET
        status=EXCLUDED.status,
        invoice_url=COALESCE(EXCLUDED.invoice_url, payments.invoice_url)
      RETURNING (xmax = 0) AS inserted
    )
    SELECT inserted FROM upsert;`,
    [e, stripeSessionId || null, Number(amountUsd||0), Math.trunc(lypos||0), status || "completed", invoiceUrl || null]
  );
  return Boolean(rows?.[0]?.inserted);
}

async function resolveInvoiceOrReceiptUrlFromSession(session) {
  try {
    if (session?.invoice) {
      const inv = await stripe.invoices.retrieve(String(session.invoice));
      return inv.invoice_pdf || inv.hosted_invoice_url || null;
    }

    // For one-time payments, prefer the card receipt URL.
    const piObj = session?.payment_intent;
    const piId = (typeof piObj === "string") ? piObj : (piObj?.id || "");
    if (!piId) return null;

    // Retrieve again to be robust across Stripe API versions; expand charges.
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["charges", "latest_charge"] });
    const charge = pi?.charges?.data?.[0] || (typeof pi?.latest_charge === "object" ? pi.latest_charge : null);
    return charge?.receipt_url || null;
  } catch {
    return null;
  }
}

async function upsertVideo({ email, predictionId, status, inputUrl, outputUrl }) {
  const e = normEmail(email);
  await pool.query(
    `INSERT INTO videos (email, prediction_id, status, input_url, output_url)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (prediction_id) DO UPDATE SET
       status=EXCLUDED.status,
       input_url=COALESCE(EXCLUDED.input_url, videos.input_url),
       output_url=COALESCE(EXCLUDED.output_url, videos.output_url),
       updated_at=now()`,
    [e, predictionId || null, status || "starting", inputUrl || null, outputUrl || null]
  );
}

async function addBalance(email, delta, reason) {
  const e = normEmail(email);
  const d = Math.trunc(Number(delta || 0));
  const { rows } = await pool.query(
    "UPDATE users SET balance = balance + $2 WHERE email=$1 RETURNING balance",
    [e, d]
  );
  if (!rows[0]) return { ok: false, code: "NO_USER" };
  return { ok: true, balance: Number(rows[0].balance || 0) };
}

async function chargeBalance(email, cost) {
  const e = normEmail(email);
  const c = Math.max(0, Math.trunc(cost));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT balance FROM users WHERE email=$1 FOR UPDATE",
      [e]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NO_USER" };
    }
    const bal = Number(rows[0].balance || 0);
    if (bal < c) {
      await client.query("ROLLBACK");
      return { ok: false, code: "INSUFFICIENT", balance: bal };
    }
    const newBal = bal - c;
    await client.query("UPDATE users SET balance=$2 WHERE email=$1", [e, newBal]);
    await client.query("COMMIT");
    return { ok: true, balance: newBal };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
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

// Stripe webhook must use RAW body — define BEFORE express.json
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
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
    const amountTotal = Number(session.amount_total || 0) / 100;
    const sessionId = session.id;
    const invoiceUrl = await resolveInvoiceOrReceiptUrlFromSession(session);

    if (email && lypos > 0) {
      try {
        const inserted = await recordPayment({ email, stripeSessionId: sessionId, amountUsd: amountTotal, lypos, status: "completed", invoiceUrl });
        if (inserted) await addBalance(email, lypos);
        console.log("✅ Payment stored + credited LYPOS:", { email, lypos, amountTotal });
      } catch (e) {
        console.log("⚠️ Webhook credit failed:", e?.message || e);
      }
    }
  }

  res.json({ received: true });
});

// JSON for normal routes
app.use(express.json({ limit: "2mb" }));

// ---- Auth routes
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

  const e = normEmail(email);
  const existing = await getUserByEmail(e);
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  const row = await createUser(e, passwordHash);
  res.json({ token: signToken(e), user: publicUserRow(row) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  const e = normEmail(email);
  const u = await getUserByEmail(e);
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(String(password), String(u.password_hash || ""));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signToken(e), user: publicUserRow(u) });
});

app.get("/api/auth/me", auth, async (req, res) => {
  const email = req.user?.email;
  const u = await getUserByEmail(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: publicUserRow(u) });
});
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const e = email ? normEmail(email) : "";
  // Always return ok to avoid email enumeration
  try {
    if (e) {
      const u = await getUserByEmail(e);
      if (u) {
        const token = crypto.randomBytes(24).toString("hex");
        const tokenHash = sha256Hex(token);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await pool.query(
          "INSERT INTO password_resets (email, token_hash, expires_at) VALUES ($1,$2,$3)",
          [e, tokenHash, expiresAt]
        );

        const appUrl = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
        const base = appUrl || "http://localhost:3000";
        const resetUrl = `${base}/auth.html#reset=${encodeURIComponent(token)}&email=${encodeURIComponent(e)}`;
        await sendPasswordResetEmail(e, resetUrl);
      }
    }
  } catch (err) {
    console.error("forgot-password error:", err?.message || err);
  }
  res.json({ ok: true });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body || {};
  if (!email || !token || !newPassword) return res.status(400).json({ error: "Missing email/token/password" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

  const e = normEmail(email);
  const tokenHash = sha256Hex(token);

  const r = await pool.query(
    "SELECT * FROM password_resets WHERE email=$1 AND token_hash=$2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [e, tokenHash]
  );
  const row = r.rows?.[0];
  if (!row) return res.status(400).json({ error: "Invalid or expired reset link" });

  const exp = new Date(row.expires_at);
  if (Date.now() > exp.getTime()) return res.status(400).json({ error: "Invalid or expired reset link" });

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE email=$2", [passwordHash, e]);
  await pool.query("UPDATE password_resets SET used_at=now() WHERE id=$1", [row.id]);

  res.json({ ok: true });
});


// ---- Credits

function parseAdminEmails() {
  const one = (process.env.ADMIN_EMAIL || "").trim();
  const many = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
  const set = new Set();
  if (one) set.add(one.toLowerCase());
  for (const e of many) set.add(e.toLowerCase());
  return set;
}
function isAdminEmail(email) {
  if (!email) return false;
  const admins = parseAdminEmails();
  return admins.has(String(email).toLowerCase());
}

app.get("/api/admin/status", auth, async (req, res) => {
  return res.json({ isAdmin: isAdminEmail(req.user?.email), email: req.user?.email || null });
});

app.post("/api/admin/add-credits", auth, async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const amount = Number(req.body?.amount || 0);
  const reason = String(req.body?.reason || "").trim();

  if (!email) return res.status(400).json({ error: "MISSING_EMAIL" });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: "INVALID_AMOUNT" });

  const out = await addBalance(email, amount, reason);
  if (!out.ok) return res.status(400).json({ error: out.code || "FAILED" });

  return res.json({ ok: true, user: { email, balance: out.balance } });
});

app.get("/api/credits", auth, async (req, res) => {
  const email = req.user.email;
  const u = await getUserByEmail(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ balance: Number(u.balance || 0) });
});

app.post("/api/credits/charge", auth, async (req, res) => {
  const email = req.user.email;
  const seconds = Number(req.body?.seconds || 0);
  const s = Math.max(1, Math.ceil(seconds));
  const cost = s * CREDITS_PER_SECOND;

  const result = await chargeBalance(email, cost);
  if (!result.ok && result.code === "NO_USER") return res.status(401).json({ error: "Invalid user" });
  if (!result.ok && result.code === "INSUFFICIENT") {
    return res.status(402).json({ error: "INSUFFICIENT_CREDITS", required: cost, balance: result.balance });
  }
  res.json({ charged: cost, remaining: result.balance });
});


// ---- Account dashboard
app.get("/api/account/payments", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT stripe_session_id, amount_usd, lypos, status, invoice_url, created_at FROM payments WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );

  // Best-effort backfill: if a payment exists without an invoice/receipt URL,
  // try to resolve it from Stripe and persist it for future dashboard views.
  // (No balance changes here.)
  const missing = rows.filter(r => r.stripe_session_id && !r.invoice_url).slice(0, 5);
  for (const r of missing) {
    try {
      const session = await stripe.checkout.sessions.retrieve(String(r.stripe_session_id), { expand: ["payment_intent", "payment_intent.charges"] });
      const url = await resolveInvoiceOrReceiptUrlFromSession(session);
      if (url) {
        await pool.query(
          "UPDATE payments SET invoice_url=$2 WHERE stripe_session_id=$1 AND invoice_url IS NULL",
          [String(r.stripe_session_id), url]
        );
        r.invoice_url = url;
      }
    } catch {
      // ignore
    }
  }

  res.json({ payments: rows });
});

app.get("/api/account/videos", auth, async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT prediction_id, status, input_url, output_url, created_at FROM videos WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );
  res.json({ videos: rows });
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
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(usd * 100),
          product_data: { name: `${lypos} Credits` }
        },
        quantity: 1
      }
    ],
    metadata: { email, lypos: String(lypos) },
    success_url: `${FRONTEND_URL}/dashboard.html?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_URL}/dashboard.html?paid=0`
  });

  res.json({ url: session.url });
});

// Confirm Checkout Session on return (fallback if webhook is not configured)
// Idempotent: will not double-credit if already recorded.
app.get("/api/stripe/confirm", auth, async (req, res) => {
  const sessionId = String(req.query?.session_id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  // Retrieve the session from Stripe
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent", "payment_intent.charges"] });

  // Must belong to the logged-in user
  const email = req.user.email;
  const sessionEmail = session.customer_email || session.metadata?.email;
  if (!sessionEmail || String(sessionEmail).toLowerCase() !== String(email).toLowerCase()) {
    return res.status(403).json({ error: "NOT_AUTHORIZED" });
  }

  // Ensure it actually paid
  if (session.payment_status !== "paid") {
    return res.status(400).json({ error: "Payment not completed" });
  }

  const credits = Number(session.metadata?.lypos || session.metadata?.credits || 0);
  if (!Number.isFinite(credits) || credits <= 0) {
    return res.status(400).json({ error: "Missing credits metadata" });
  }

  const amountTotal = Number(session.amount_total || 0) / 100;

  // Resolve an invoice/receipt URL (stored and later shown in Dashboard)
  const invoiceUrl = await resolveInvoiceOrReceiptUrlFromSession(session);

  // Record payment + credit balance (truly idempotent: credit only on first insert)
  try {
    const inserted = await recordPayment({
      email,
      stripeSessionId: session.id,
      amountUsd: amountTotal,
      lypos: credits,
      status: "completed",
      invoiceUrl
    });
    if (inserted) await addBalance(email, credits);
  } catch (e) {
    console.log("⚠️ confirm payment failed:", String(e?.message || e));
  }

  const bal = await getBalance(email);
  res.json({ ok: true, balance: bal, invoice_url: invoiceUrl });
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
---------------------------- */
async function createHeygenPrediction({ videoUrl, outputLanguage }) {
  const version = requireEnv("REPLICATE_MODEL_VERSION", REPLICATE_MODEL_VERSION);
  requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);

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
 *  - output_language: (string)
 *  - seconds: (number, optional)
 */
app.post("/api/dub-upload", auth, (req, res) => {
  try {
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
      file.on("limit", () => { chunks = []; });
      file.on("error", (e) => { console.error("Upload stream error:", e); });
    });

    bb.on("finish", async () => {
      try {
        if (!fileInfo) return res.status(400).json({ error: "Missing video file (field name: video)" });
        if (!outputLanguage) return res.status(400).json({ error: "Missing output_language" });

        // Charge credits server-side (authoritative)
        const seconds = Math.max(1, Number(secondsField || 0));
        const cost = Math.max(1, Math.ceil(seconds)) * CREDITS_PER_SECOND;

        const email = req.user.email;
        const charge = await chargeBalance(email, cost);
        if (!charge.ok && charge.code === "NO_USER") return res.status(401).json({ error: "Invalid user" });
        if (!charge.ok && charge.code === "INSUFFICIENT") {
          return res.status(402).json({ error: "INSUFFICIENT_CREDITS", required: cost, balance: charge.balance });
        }

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

        const prediction = await createHeygenPrediction({ videoUrl, outputLanguage });
        await upsertVideo({ email, predictionId: prediction.id, status: prediction.status, inputUrl: videoUrl });

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
 */
app.get("/api/dub/:id", auth, async (req, res) => {
  try {
    requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);

    const predictionId = req.params.id;
    const prediction = await replicate.predictions.get(predictionId);

    let outputUrl = null;
    const out = prediction.output;

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

    try {
      await upsertVideo({ email: req.user.email, predictionId: predictionId, status: prediction.status, outputUrl });
    } catch (e) {
      console.log("video upsert failed", e?.message || e);
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

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    console.log("✅ DB ready");
    app.listen(PORT, () => console.log(`LYPO backend running on ${PORT}`));
  })
  .catch((e) => {
    console.error("❌ DB init failed", e);
    process.exit(1);
  });
