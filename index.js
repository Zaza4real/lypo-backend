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


// async wrapper for express routes
function asyncHandler(fn){
  return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
}



/* ---------------------------
   Support notification email (Resend)
   Env:
     RESEND_API_KEY   = your Resend API key
     SUPPORT_EMAIL    = where to notify (e.g. support@lypo.org)
     EMAIL_FROM       = verified sender (e.g. Lypo <no-reply@lypo.org>)
---------------------------- */
async function sendSupportNewUserEmail({ email, ip, ua }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const to = process.env.SUPPORT_EMAIL || "";
  const from = process.env.EMAIL_FROM || "Lypo <no-reply@lypo.org>";

  if (!apiKey || !to) {
    console.warn("⚠️ Support email not sent (missing RESEND_API_KEY or SUPPORT_EMAIL)");
    return;
  }

  const resend = new Resend(apiKey);
  const subject = `🆕 New user signup: ${email}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px 0;">New user created</h2>
      <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${email}</p>
      ${ip ? `<p style="margin:0 0 8px 0;"><strong>IP:</strong> ${ip}</p>` : ``}
      ${ua ? `<p style="margin:0 0 8px 0;"><strong>User-Agent:</strong> ${ua}</p>` : ``}
      <p style="margin:0;color:#666;">Timestamp (UTC): ${new Date().toISOString()}</p>
    </div>
  `;

  try {
    await resend.emails.send({ from, to, subject, html });
  } catch (err) {
    console.error("❌ Resend error:", err);
  }
}

const app = express();
app.set("trust proxy", 1);


/* ---------------------------
   CORS
---------------------------- */
const allowedOrigins = new Set([
  "https://lypo.org",
  "https://www.lypo.org",
  "https://digitalgeekworld.com",
  "https://www.digitalgeekworld.com",
  "https://homepage-3d78.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL || ""
].filter(Boolean));

const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === "1";

app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Set CORS headers for allowed origins
  if (origin && (CORS_ALLOW_ALL || allowedOrigins.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else if (!origin) {
    // If no origin header (same-origin request), allow it
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
  
  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
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
      password_hash TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      google_id TEXT UNIQUE,
      name TEXT,
      picture TEXT,
      auth_provider TEXT DEFAULT 'email',
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

  // Blog posts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      excerpt TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

async function getUserByEmail(email) {
  const e = normEmail(email);
  const { rows } = await pool.query(
    "SELECT email, password_hash, balance, google_id, name, picture, auth_provider, created_at FROM users WHERE email=$1",
    [e]
  );
  return rows[0] || null;
}

async function getUserByGoogleId(googleId) {
  const { rows } = await pool.query(
    "SELECT email, password_hash, balance, google_id, name, picture, auth_provider, created_at FROM users WHERE google_id=$1",
    [googleId]
  );
  return rows[0] || null;
}
async function createUser(email, passwordHash, options = {}) {
  const e = normEmail(email);
  const { googleId, name, picture, authProvider = 'email' } = options;
  
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, balance, google_id, name, picture, auth_provider) VALUES ($1,$2,0,$3,$4,$5,$6) RETURNING email, password_hash, balance, google_id, name, picture, auth_provider, created_at",
    [e, passwordHash, googleId, name, picture, authProvider]
  );
  return rows[0];
}

async function recordPayment({ email, stripeSessionId, amountUsd, lypos, status, invoiceUrl }) {
  const e = normEmail(email);
  await pool.query(
    `INSERT INTO payments (email, stripe_session_id, amount_usd, lypos, status, invoice_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (stripe_session_id) DO UPDATE SET
       status=EXCLUDED.status,
       invoice_url=COALESCE(EXCLUDED.invoice_url, payments.invoice_url)`,
    [e, stripeSessionId || null, Number(amountUsd||0), Math.trunc(lypos||0), status || "completed", invoiceUrl || null]
  );
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


async function getBalance(email) {
  const e = normEmail(email);
  const { rows } = await pool.query("SELECT balance FROM users WHERE email=$1", [e]);
  return rows[0] ? Number(rows[0].balance || 0) : 0;
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
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), asyncHandler(async (req, res) => {
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
    let invoiceUrl = null;
try {
  // For one-time payments, Stripe may not create an "invoice". In that case we store the charge receipt URL.
  if (session.invoice) {
    const inv = await stripe.invoices.retrieve(String(session.invoice));
    // Prefer a directly downloadable PDF when available.
    invoiceUrl = inv.invoice_pdf || inv.hosted_invoice_url || null;
  } else if (session.payment_intent) {
    const pi = await stripe.paymentIntents.retrieve(String(session.payment_intent), { expand: ["charges"] });
    const charge = pi?.charges?.data?.[0];
    invoiceUrl = charge?.receipt_url || null;
  }
} catch (e) {
  invoiceUrl = null;
}

    if (email && lypos > 0) {
      try {
        await recordPayment({ email, stripeSessionId: sessionId, amountUsd: amountTotal, lypos, status: "completed", invoiceUrl });
        await addBalance(email, lypos);
        console.log("✅ Payment stored + credited LYPOS:", { email, lypos, amountTotal });
      } catch (e) {
        console.log("⚠️ Webhook credit failed:", e?.message || e);
      }
    }
  }

  res.json({ received: true });
}));

// JSON for normal routes

/* ---------------------------
   Basic security & diagnostics
---------------------------- */
app.use((req, res, next) => {
  // simple request id
  const rid = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", rid);

  // security headers (lightweight, no design changes)
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

// Fast OPTIONS response for CORS preflight
app.options("*", (req, res) => {
  res.sendStatus(204);
});

app.use(express.json({ limit: "2mb" }));


app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});


function isValidEmail(email){
  const e = String(email || "").trim().toLowerCase();
  // simple, practical email check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Very small in-memory rate limit (per IP) for auth endpoints
const __authHits = new Map(); // ip -> {count, resetAt}
function authRateLimit(req, res, next){
  const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim() || "unknown";
  const now = Date.now();
  const windowMs = 60_000; // 1 min
  const max = 20;

  const entry = __authHits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  __authHits.set(ip, entry);

  if (entry.count > max) {
    return res.status(429).json({ error: "RATE_LIMIT", message: "Too many requests. Try again in a minute." });
  }
  next();
}

// ---- Auth routes
app.post("/api/auth/signup", authRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

  const e = normEmail(email);
  const existing = await getUserByEmail(e);
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(String(password), 10);
  const row = await createUser(e, passwordHash);
  
  // Notify support (non-blocking)
  Promise.resolve(sendSupportNewUserEmail({ email: e, ip: (req.headers["x-forwarded-for"]||req.ip||"").toString().split(",")[0].trim(), ua: req.headers["user-agent"]||"" })).catch((err) => console.error("Support email failed:", err));

  res.json({ token: signToken(e), user: publicUserRow(row) });
}));

app.post("/api/auth/login", authRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });

  const e = normEmail(email);
  const u = await getUserByEmail(e);
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(String(password), String(u.password_hash || ""));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signToken(e), user: publicUserRow(u) });
}));

// Google OAuth Login/Signup
app.post("/api/auth/google", authRateLimit, asyncHandler(async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "Missing Google credential" });

  try {
    // Verify Google token
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!response.ok) throw new Error("Invalid Google token");
    
    const payload = await response.json();
    
    // Extract user info from Google token
    const googleId = payload.sub;
    const email = normEmail(payload.email);
    const name = payload.name || "";
    const picture = payload.picture || "";
    
    if (!googleId || !email) {
      return res.status(400).json({ error: "Invalid Google account data" });
    }

    // Check if user exists by Google ID
    let user = await getUserByGoogleId(googleId);
    
    // If not found by Google ID, check by email
    if (!user) {
      user = await getUserByEmail(email);
      
      // If user exists with email but no Google ID, update to link Google account
      if (user && !user.google_id) {
        await pool.query(
          "UPDATE users SET google_id=$1, name=$2, picture=$3, auth_provider='google' WHERE email=$4",
          [googleId, name, picture, email]
        );
        user = await getUserByEmail(email);
      }
    }
    
    // If no user exists, create new one
    if (!user) {
      user = await createUser(email, null, {
        googleId,
        name,
        picture,
        authProvider: 'google'
      });
      
      // Notify support (non-blocking)
      Promise.resolve(sendSupportNewUserEmail({ 
        email, 
        ip: (req.headers["x-forwarded-for"]||req.ip||"").toString().split(",")[0].trim(), 
        ua: req.headers["user-agent"]||"" 
      })).catch((err) => console.error("Support email failed:", err));
    }

    res.json({ token: signToken(email), user: publicUserRow(user) });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(401).json({ error: "Google authentication failed" });
  }
}));

app.get("/api/auth/me", auth, asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const u = await getUserByEmail(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: publicUserRow(u) });
}));

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

app.get("/api/admin/status", auth, asyncHandler(async (req, res) => {
  return res.json({ isAdmin: isAdminEmail(req.user?.email), email: req.user?.email || null });
}));

app.post("/api/admin/add-credits", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const amount = Number(req.body?.amount || 0);
  const reason = String(req.body?.reason || "").trim();

  if (!email) return res.status(400).json({ error: "MISSING_EMAIL" });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: "INVALID_AMOUNT" });

  const out = await addBalance(email, amount, reason);
  if (!out.ok) return res.status(400).json({ error: out.code || "FAILED" });

  return res.json({ ok: true, user: { email, balance: out.balance } });
}));

app.get("/api/credits", auth, asyncHandler(async (req, res) => {
  const email = req.user.email;
  const u = await getUserByEmail(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ balance: Number(u.balance || 0) });
}));

app.post("/api/credits/charge", auth, asyncHandler(async (req, res) => {
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
}));


// ---- Account dashboard
app.get("/api/account/payments", auth, asyncHandler(async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT stripe_session_id, amount_usd, lypos, status, invoice_url, created_at FROM payments WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );
  res.json({ payments: rows });
}));

app.get("/api/account/videos", auth, asyncHandler(async (req, res) => {
  const email = normEmail(req.user.email);
  const { rows } = await pool.query(
    "SELECT prediction_id, status, input_url, output_url, created_at FROM videos WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
    [email]
  );
  res.json({ videos: rows });
}));


// ---- Stripe checkout: buy LYPOS
app.post("/api/stripe/create-checkout-session", auth, asyncHandler(async (req, res) => {
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
}));

// Confirm Checkout Session on return (fallback if webhook is not configured)
// Idempotent: will not double-credit if already recorded.
app.get("/api/stripe/confirm", auth, asyncHandler(async (req, res) => {
  const sessionId = String(req.query?.session_id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  // Retrieve the session from Stripe
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent", "payment_intent.charges", "payment_intent.latest_charge"] });

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

  // Try to resolve an invoice/receipt URL
  let invoiceUrl = null;
  try {
    if (session.invoice) {
      const inv = await stripe.invoices.retrieve(String(session.invoice));
      invoiceUrl = inv.invoice_pdf || inv.hosted_invoice_url || null;
    } else {
      const pi = session.payment_intent;
const charge = pi?.charges?.data?.[0];
invoiceUrl = charge?.receipt_url || null;

// Fallback: retrieve latest_charge if charges list isn't present
if (!invoiceUrl && pi?.latest_charge) {
  try {
    const ch = await stripe.charges.retrieve(
      typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id
    );
    invoiceUrl = ch?.receipt_url || invoiceUrl;
  } catch {}
}
    }
  } catch {
    invoiceUrl = null;
  }

  // Record payment + credit balance (idempotent because stripe_session_id is UNIQUE)
  let balRes = null;
  try {
    await recordPayment({
      email,
      stripeSessionId: session.id,
      amountUsd: amountTotal,
      lypos: credits,
      status: "completed",
      invoiceUrl
    });
    balRes = await addBalance(email, credits);
} catch (e) {
  // If already recorded, ignore; still return current balance
  const msg = String(e?.message || "");
  if (!msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("unique")) {
    console.log("⚠️ confirm payment failed:", msg);
  }
}

const bal = (balRes && balRes.ok) ? balRes.balance : await getBalance(email);
  res.json({ ok: true, balance: bal, invoice_url: invoiceUrl });
}));

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
app.get("/api/dub/:id", auth, asyncHandler(async (req, res) => {
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
}));

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

// ---- Public blog
app.get("/api/blog/posts", asyncHandler(async (req, res) => {
  const rows = (await pool.query(
    "SELECT id, title, slug, excerpt, cover_url, video_url, content_html, created_at, updated_at FROM blog_posts WHERE status='published' ORDER BY created_at DESC LIMIT 200"
  )).rows;
  res.json({ posts: rows });
}));

app.get("/api/blog/posts/:slug", asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const row = (await pool.query(
    "SELECT id, title, slug, excerpt, cover_url, video_url, content_html, created_at, updated_at FROM blog_posts WHERE status='published' AND slug=$1 LIMIT 1",
    [slug]
  )).rows[0];
  if (!row) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ post: row });
}));

// ---- Admin blog
app.get("/api/admin/blog/posts", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const rows = (await pool.query(
    "SELECT id, title, slug, excerpt, cover_url, video_url, content_html, status, created_at, updated_at FROM blog_posts ORDER BY created_at DESC LIMIT 500"
  )).rows;
  res.json({ posts: rows });
}));

app.get("/api/admin/blog/posts/:id", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "BAD_ID" });
  const row = (await pool.query(
    "SELECT id, title, slug, excerpt, cover_url, video_url, content_html, status, created_at, updated_at FROM blog_posts WHERE id=$1 LIMIT 1",
    [id]
  )).rows[0];
  if (!row) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ post: row });
}));

app.post("/api/admin/blog/posts", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const title = String(req.body?.title || "").trim();
  const slug = String(req.body?.slug || "").trim();
  const excerpt = String(req.body?.excerpt || "");
  const cover_url = String(req.body?.cover_url || "");
  const video_url = String(req.body?.video_url || "");
  const content_html = String(req.body?.content_html || "");
  const status = String(req.body?.status || "draft");
  if (!title || !slug) return res.status(400).json({ error: "MISSING_FIELDS" });
  const row = (await pool.query(
    "INSERT INTO blog_posts (title, slug, excerpt, cover_url, video_url, content_html, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [title, slug, excerpt, cover_url, video_url, content_html, status]
  )).rows[0];
  res.json({ post: row });
}));

app.put("/api/admin/blog/posts/:id", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "BAD_ID" });
  const title = String(req.body?.title || "").trim();
  const slug = String(req.body?.slug || "").trim();
  const excerpt = String(req.body?.excerpt || "");
  const cover_url = String(req.body?.cover_url || "");
  const video_url = String(req.body?.video_url || "");
  const content_html = String(req.body?.content_html || "");
  const status = String(req.body?.status || "draft");
  if (!title || !slug) return res.status(400).json({ error: "MISSING_FIELDS" });
  const row = (await pool.query(
    "UPDATE blog_posts SET title=$1, slug=$2, excerpt=$3, cover_url=$4, video_url=$5, content_html=$6, status=$7, updated_at=NOW() WHERE id=$8 RETURNING *",
    [title, slug, excerpt, cover_url, video_url, content_html, status, id]
  )).rows[0];
  if (!row) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ post: row });
}));

app.delete("/api/admin/blog/posts/:id", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "BAD_ID" });
  await pool.query("DELETE FROM blog_posts WHERE id=$1", [id]);
  res.json({ ok: true });
}));

// ---- Admin: list users
app.get("/api/admin/users", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const limit = Math.min(Math.max(parseInt(req.query?.limit || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query?.offset || "0", 10) || 0, 0);
  const q = String(req.query?.q || "").trim();

  const sqlBase = "SELECT email, balance, created_at FROM users";
  const sqlWhere = q ? " WHERE email ILIKE $1" : "";
  const sqlOrder = " ORDER BY created_at DESC";
  const sqlLimit = q ? " LIMIT $2 OFFSET $3" : " LIMIT $1 OFFSET $2";
  const params = q ? [`%${q}%`, limit, offset] : [limit, offset];

  const rows = (await pool.query(sqlBase + sqlWhere + sqlOrder + sqlLimit, params)).rows;
  res.json({ users: rows.map(u => ({ email: u.email, balance: Number(u.balance||0), created_at: u.created_at, is_admin: isAdminEmail(u.email) })), limit, offset, q });
}));

app.put("/api/admin/user-update", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const email = normEmail(String(req.body?.email || ""));
  const balanceRaw = req.body?.balance;
  if (!email) return res.status(400).json({ error: "MISSING_EMAIL" });
  if (balanceRaw === undefined || balanceRaw === null || balanceRaw === "") return res.status(400).json({ error: "MISSING_BALANCE" });
  const balance = Number(balanceRaw);
  if (!Number.isFinite(balance) || balance < 0) return res.status(400).json({ error: "INVALID_BALANCE" });

  const u = await getUserByEmail(email);
  if (!u) return res.status(404).json({ error: "USER_NOT_FOUND" });

  await pool.query("UPDATE users SET balance=$1 WHERE email=$2", [Math.floor(balance), email]);
  const updated = await getUserByEmail(email);
  res.json({ ok: true, user: { email: updated.email, balance: Number(updated.balance||0), created_at: updated.created_at, is_admin: isAdminEmail(updated.email) } });
}));

app.delete("/api/admin/user-delete", auth, asyncHandler(async (req, res) => {
  if (!isAdminEmail(req.user?.email)) return res.status(403).json({ error: "NOT_AUTHORIZED" });
  const email = normEmail(String(req.query?.email || req.body?.email || ""));
  if (!email) return res.status(400).json({ error: "MISSING_EMAIL" });

  const u = await getUserByEmail(email);
  if (!u) return res.status(404).json({ error: "USER_NOT_FOUND" });

  try { await pool.query("DELETE FROM videos WHERE email=$1", [email]); } catch {}
  try { await pool.query("DELETE FROM payments WHERE email=$1", [email]); } catch {}
  try { await pool.query("DELETE FROM password_resets WHERE email=$1", [email]); } catch {}
  await pool.query("DELETE FROM users WHERE email=$1", [email]);

  res.json({ ok: true });
}));


/* ---------------------------
   ERROR HANDLER
---------------------------- */
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err);
  
  // Ensure CORS headers are set even on errors
  const origin = req.headers.origin;
  if (origin && (CORS_ALLOW_ALL || allowedOrigins.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  
  res.status(err.statusCode || 500).json({
    error: "SERVER_ERROR",
    message: err.message || "Unknown error"
  });
});


// Process-level safety (logs only; keeps Render logs useful)
process.on("unhandledRejection", (reason) => {
  console.error("🔥 UnhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🔥 UncaughtException:", err);
});
