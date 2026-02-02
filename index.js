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

/* ---------------------------
   Helper: Send credit purchase notification
---------------------------- */
async function sendCreditPurchaseEmail(email, credits, amountUsd, invoiceUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ RESEND_API_KEY not set, skipping email");
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const to = process.env.RESEND_TO_EMAIL || "support@lypo.org";

  if (!to) {
    console.warn("⚠️ RESEND_TO_EMAIL not set, skipping");
    return;
  }

  const resend = new Resend(apiKey);
  const subject = `💰 Credit Purchase: ${email} bought ${credits} credits`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px 0;color:#10b981;">💰 New Credit Purchase</h2>
      <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px 0;font-size:24px;font-weight:bold;color:#10b981;">${credits} Credits</p>
        <p style="margin:0 0 8px 0;"><strong>Customer:</strong> ${email}</p>
        <p style="margin:0 0 8px 0;"><strong>Amount Paid:</strong> $${amountUsd.toFixed(2)} USD</p>
        <p style="margin:0 0 8px 0;"><strong>Rate:</strong> ${(credits / amountUsd).toFixed(0)} credits per $1</p>
        ${invoiceUrl ? `<p style="margin:0 0 8px 0;"><strong>Receipt:</strong> <a href="${invoiceUrl}" style="color:#0066cc;">View Receipt</a></p>` : ''}
      </div>
      <p style="margin:0;color:#666;font-size:13px;">Timestamp (UTC): ${new Date().toISOString()}</p>
    </div>
  `;

  try {
    await resend.emails.send({ from, to, subject, html });
    console.log("✅ Credit purchase email sent to:", to);
  } catch (err) {
    console.error("❌ Resend credit purchase email error:", err);
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
      type TEXT NOT NULL DEFAULT 'video_translation',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migrations for existing databases
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS cost_credits INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'video_translation';`);
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
    "SELECT email, password_hash, balance, created_at FROM users WHERE email=$1",
    [e]
  );
  return rows[0] || null;
}

async function createUser(email, passwordHash) {
  const e = normEmail(email);
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, balance) VALUES ($1,$2,50) RETURNING email, password_hash, balance, created_at",
    [e, passwordHash]
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

async function upsertVideo({ email, predictionId, status, inputUrl, outputUrl, costCredits, type }) {
  const e = normEmail(email);
  await pool.query(
    `INSERT INTO videos (email, prediction_id, status, input_url, output_url, cost_credits, type)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (prediction_id) DO UPDATE SET
       status=EXCLUDED.status,
       input_url=COALESCE(EXCLUDED.input_url, videos.input_url),
       output_url=COALESCE(EXCLUDED.output_url, videos.output_url),
       cost_credits=COALESCE(EXCLUDED.cost_credits, videos.cost_credits),
       type=COALESCE(EXCLUDED.type, videos.type),
       updated_at=now()`,
    [e, predictionId || null, status || "starting", inputUrl || null, outputUrl || null, costCredits || 0, type || 'video_translation']
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

/**
 * Refund credits for a failed prediction
 * @param {string} predictionId - The prediction ID
 * @param {number} refundAmount - Amount of credits to refund (optional, will use cost_credits from DB if not provided)
 * @returns {Promise<{ok: boolean, refunded?: number, alreadyRefunded?: boolean}>}
 */
async function refundCreditsForFailure(predictionId, refundAmount = null) {
  try {
    // Get video details
    const { rows } = await pool.query(
      "SELECT email, cost_credits, refunded FROM videos WHERE prediction_id = $1",
      [predictionId]
    );
    
    if (!rows[0]) {
      console.log(`No video found for prediction ${predictionId}`);
      return { ok: false };
    }
    
    const { email, cost_credits, refunded } = rows[0];
    
    // Check if already refunded
    if (refunded) {
      console.log(`Credits already refunded for prediction ${predictionId}`);
      return { ok: true, alreadyRefunded: true };
    }
    
    // Determine refund amount
    const amount = refundAmount || cost_credits || 0;
    if (amount <= 0) {
      console.log(`No credits to refund for prediction ${predictionId}`);
      return { ok: true, refunded: 0 };
    }
    
    // Refund credits and mark as refunded
    await pool.query("BEGIN");
    
    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE email = $2",
      [amount, email]
    );
    
    await pool.query(
      "UPDATE videos SET refunded = true WHERE prediction_id = $1",
      [predictionId]
    );
    
    await pool.query("COMMIT");
    
    console.log(`✅ Refunded ${amount} credits to ${email} for failed prediction ${predictionId}`);
    return { ok: true, refunded: amount };
    
  } catch (err) {
    try {
      await pool.query("ROLLBACK");
    } catch {}
    console.error(`Failed to refund credits for prediction ${predictionId}:`, err);
    return { ok: false, error: err.message };
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
        
        // Send email notification to admin
        await sendCreditPurchaseEmail(email, lypos, amountTotal, invoiceUrl);
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

// Google OAuth Login/Signup (Simple version - works with current database)
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
    
    if (!googleId || !email) {
      return res.status(400).json({ error: "Invalid Google account data" });
    }

    // Check if user exists by email
    let user = await getUserByEmail(email);
    
    // If no user exists, create new one (using current database schema)
    if (!user) {
      // For Google users, create with a random password (they'll use Google to login)
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      
      user = await createUser(email, passwordHash);
      
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

// ---- Support Contact Form
app.post("/api/support", asyncHandler(async (req, res) => {
  const { email, subject, message } = req.body || {};
  
  // Validate inputs
  if (!message || String(message).trim().length === 0) {
    return res.status(400).json({ error: "Message is required" });
  }
  
  // Get user email if authenticated
  let fromEmail = String(email || "").trim();
  if (req.headers.authorization) {
    try {
      const token = req.headers.authorization.replace(/^Bearer\s+/i, "");
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.email) fromEmail = decoded.email;
    } catch (e) {
      // Not authenticated, use provided email
    }
  }
  
  if (!fromEmail) {
    return res.status(400).json({ error: "Email is required" });
  }
  
  // Send email to support using Resend
  const apiKey = process.env.RESEND_API_KEY || "";
  const to = process.env.SUPPORT_EMAIL || "";
  const from = process.env.EMAIL_FROM || "Lypo <no-reply@lypo.org>";
  
  if (!apiKey || !to) {
    console.warn("⚠️ Support email not configured (missing RESEND_API_KEY or SUPPORT_EMAIL)");
    return res.status(500).json({ error: "Support email not configured" });
  }
  
  const resend = new Resend(apiKey);
  const emailSubject = subject ? `Support: ${subject}` : "Support Message";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2 style="margin:0 0 12px 0;">Support Message</h2>
      <p style="margin:0 0 8px 0;"><strong>From:</strong> ${fromEmail}</p>
      ${subject ? `<p style="margin:0 0 8px 0;"><strong>Subject:</strong> ${subject}</p>` : ''}
      <p style="margin:0 0 8px 0;"><strong>Message:</strong></p>
      <div style="padding:12px; background:#f5f5f5; border-left:3px solid #0066cc;">
        ${String(message).replace(/\n/g, '<br>')}
      </div>
      <p style="margin:12px 0 0 0;color:#666;">
        Sent from: ${req.headers['user-agent'] || 'Unknown browser'}<br>
        IP: ${(req.headers["x-forwarded-for"]||req.ip||"").toString().split(",")[0].trim() || 'Unknown'}<br>
        Time: ${new Date().toISOString()}
      </p>
    </div>
  `;
  
  try {
    await resend.emails.send({ 
      from, 
      to, 
      subject: emailSubject, 
      html,
      replyTo: fromEmail // Allow direct reply
    });
    
    res.json({ ok: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("❌ Resend error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
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
    "SELECT prediction_id, status, input_url, output_url, type, cost_credits, created_at FROM videos WHERE email=$1 ORDER BY created_at DESC LIMIT 100",
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
    
    // Send email notification to admin
    await sendCreditPurchaseEmail(email, credits, amountTotal, invoiceUrl);
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
        await upsertVideo({ email, predictionId: prediction.id, status: prediction.status, inputUrl: videoUrl, costCredits: cost, type: 'video_translation' });

        res.json({
          id: prediction.id,
          predictionId: prediction.id,
          status: prediction.status,
          uploadedUrl: videoUrl
        });
      } catch (e) {
        console.error(e);
        
        // Refund credits if generation failed after charging
        try {
          const email = req.user?.email;
          const seconds = Math.max(1, Number(secondsField || 0));
          const refundAmount = Math.max(1, Math.ceil(seconds)) * CREDITS_PER_SECOND;
          if (email && refundAmount > 0) {
            await pool.query(
              "UPDATE users SET balance = balance + $1 WHERE email = $2",
              [refundAmount, email]
            );
            console.log(`Refunded ${refundAmount} credits to ${email} due to upload/generation error`);
          }
        } catch (refundErr) {
          console.error("Failed to refund credits:", refundErr);
        }
        
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
      
      // Automatically refund credits if prediction failed
      if (prediction.status === "failed" || prediction.status === "canceled") {
        await refundCreditsForFailure(predictionId);
      }
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

// ========================================
// TIKTOK CAPTIONS API
// ========================================

/**
 * POST /api/tiktok-captions
 * Upload video and generate captions/subtitles
 * Cost: 50 credits per video
 */
app.post("/api/tiktok-captions", auth, (req, res) => {
  try {
    requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);
    
    requireEnv("S3_ENDPOINT", S3_ENDPOINT);
    requireEnv("S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID);
    requireEnv("S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY);
    requireEnv("S3_BUCKET", S3_BUCKET);
    requireEnv("PUBLIC_BASE_URL", PUBLIC_BASE_URL);

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: 200 * 1024 * 1024 } // 200MB
    });

    let fileInfo = null;
    let chunks = [];

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

        // Charge 50 credits (fixed cost)
        const TIKTOK_COST = 50;
        const email = req.user.email;
        const charge = await chargeBalance(email, TIKTOK_COST);
        
        if (!charge.ok && charge.code === "NO_USER") {
          return res.status(401).json({ error: "Invalid user" });
        }
        if (!charge.ok && charge.code === "INSUFFICIENT") {
          return res.status(402).json({ 
            error: "INSUFFICIENT_CREDITS", 
            required: TIKTOK_COST, 
            balance: charge.balance 
          });
        }

        const body = Buffer.concat(chunks);
        if (!body.length) {
          return res.status(400).json({ error: "Empty upload or file too large" });
        }

        // Upload to S3
        const original = fileInfo.filename || "video.mp4";
        const ext = (original.split(".").pop() || "mp4").toLowerCase();
        const key = `tiktok-uploads/${crypto.randomUUID()}.${ext}`;

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: fileInfo.mimeType || "video/mp4"
        }));

        const base = PUBLIC_BASE_URL.replace(/\/$/, "");
        const videoUrl = `${base}/${key}`;

        // Create Replicate prediction for captions
        // Using autocaption - adds karaoke-style captions to video (perfect for TikTok!)
        const tiktokReplicate = new Replicate({ auth: REPLICATE_API_TOKEN });
        
        const prediction = await tiktokReplicate.predictions.create({
          version: "18a45ff0d95feb4449d192bbdc06b4a6df168fa33def76dfc51b78ae224b599b", // fictions-ai/autocaption
          input: {
            video_file_input: videoUrl,
            font_size: 6,              // Custom font size
            subs_position: "bottom",    // Position at bottom
            max_chars: 16,             // Max 16 characters per line
            output_video_format: "mp4", // Ensure mp4 output
            video_width: null,          // Preserve original width (auto)
            video_height: null          // Preserve original height (auto)
          }
        });

        // Save to videos table for dashboard history
        await pool.query(
          `INSERT INTO videos (email, prediction_id, status, input_url, cost_credits, type)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (prediction_id) DO UPDATE SET
             status = EXCLUDED.status,
             updated_at = now()`,
          [email, prediction.id, prediction.status, videoUrl, TIKTOK_COST, 'tiktok_captions']
        );

        res.json({
          jobId: prediction.id,
          status: prediction.status
        });

      } catch (e) {
        console.error("TikTok captions error:", e);
        
        // Refund credits if generation failed after charging
        try {
          await pool.query(
            "UPDATE users SET balance = balance + $1 WHERE email = $2",
            [TIKTOK_COST, email]
          );
          console.log(`Refunded ${TIKTOK_COST} credits to ${email} due to error`);
        } catch (refundErr) {
          console.error("Failed to refund credits:", refundErr);
        }
        
        res.status(e.statusCode || 500).json({ 
          error: e?.message || "Failed to generate captions" 
        });
      }
    });

    req.pipe(bb);
  } catch (e) {
    console.error("TikTok captions error:", e);
    res.status(e.statusCode || 500).json({ error: e?.message || "Internal error" });
  }
});

/**
 * GET /api/tiktok-captions/:jobId
 * Check status of caption generation
 */
app.get("/api/tiktok-captions/:jobId", auth, asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  // Query Replicate directly
  requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);
  const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });
  
  const prediction = await replicate.predictions.get(jobId);

  // Update database with latest status and output
  if (prediction.status === 'succeeded' && prediction.output) {
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    
    await pool.query(
      `UPDATE videos 
       SET status = $1, output_url = $2, updated_at = now() 
       WHERE prediction_id = $3`,
      [prediction.status, outputUrl, jobId]
    );
  } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await pool.query(
      `UPDATE videos 
       SET status = $1, updated_at = now() 
       WHERE prediction_id = $2`,
      [prediction.status, jobId]
    );
    
    // Automatically refund credits for failed generation
    await refundCreditsForFailure(jobId);
  }

  res.json({
    status: prediction.status,
    output: prediction.output
  });
}));

// ========================================
// KLING AI VIDEO GENERATOR API
// ========================================

/**
 * POST /api/kling-video
 * Generate AI video from text or image
 * Cost: 20 credits per second (5s = 100 credits, 10s = 200 credits)
 */
app.post("/api/kling-video", auth, (req, res) => {
  try {
    requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);
    
    requireEnv("S3_ENDPOINT", S3_ENDPOINT);
    requireEnv("S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID);
    requireEnv("S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY);
    requireEnv("S3_BUCKET", S3_BUCKET);
    requireEnv("PUBLIC_BASE_URL", PUBLIC_BASE_URL);

    const KLING_COST_PER_SECOND = 20;
    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB for images
        files: 1
      }
    });

    const fields = {};
    let imageFile = null;
    let imageBuffer = null;

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, info) => {
      if (name === "image") {
        const chunks = [];
        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => {
          imageBuffer = Buffer.concat(chunks);
          imageFile = {
            buffer: imageBuffer,
            filename: info.filename || `image_${Date.now()}.png`,
            mimetype: info.mimeType || "image/png"
          };
        });
      } else {
        file.resume(); // Drain unwanted files
      }
    });

    bb.on("finish", async () => {
      try {
        const { email } = req.user;
        const { prompt, mode, duration, aspectRatio } = fields;

        if (!prompt) {
          return res.status(400).json({ error: "Prompt is required" });
        }

        if (mode !== "text" && mode !== "image") {
          return res.status(400).json({ error: "Invalid mode" });
        }

        if (mode === "image" && !imageFile) {
          return res.status(400).json({ error: "Image is required for image-to-video mode" });
        }

        // Calculate cost based on duration (15 credits per second)
        const videoDuration = parseInt(duration) || 10;
        const KLING_COST = videoDuration * KLING_COST_PER_SECOND;

        // Check user balance
        const balRes = await pool.query(
          "SELECT balance FROM users WHERE email = $1",
          [email]
        );
        
        if (!balRes.rows.length) {
          return res.status(404).json({ error: "USER_NOT_FOUND" });
        }

        const currentBalance = balRes.rows[0].balance || 0;
        
        if (currentBalance < KLING_COST) {
          return res.status(402).json({ 
            error: "INSUFFICIENT_BALANCE",
            required: KLING_COST,
            current: currentBalance
          });
        }

        // Deduct credits immediately
        await pool.query(
          "UPDATE users SET balance = balance - $1 WHERE email = $2",
          [KLING_COST, email]
        );

        console.log(`Deducted ${KLING_COST} credits from ${email} for ${videoDuration}s video`);

        // Upload image to S3 if needed
        let imageUrl = null;
        
        if (mode === "image" && imageFile) {
          const s3 = new S3Client({
            endpoint: S3_ENDPOINT,
            region: "auto",
            credentials: {
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY
            }
          });

          const key = `kling-inputs/${Date.now()}_${imageFile.filename}`;
          
          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: imageFile.buffer,
            ContentType: imageFile.mimetype
          }));

          imageUrl = `${PUBLIC_BASE_URL}/${key}`;
          console.log(`Uploaded input image: ${imageUrl}`);
        }

        // Call Kling API via Replicate
        const klingReplicate = new Replicate({ auth: REPLICATE_API_TOKEN });
        
        const input = {
          prompt: prompt,
          duration: parseInt(duration) || 10,
          aspect_ratio: aspectRatio || "16:9"
        };

        // Add image if in image mode
        if (mode === "image" && imageUrl) {
          input.start_image = imageUrl;
        }

        const prediction = await klingReplicate.predictions.create({
          version: "939cd1851c5b112f284681b57ee9b0f36d0f913ba97de5845a7eef92d52837df",
          input: input
        });

        console.log("Kling prediction created:", prediction.id);

        // Store in database
        await pool.query(
          `INSERT INTO videos (email, prediction_id, status, input_url, cost_credits, type) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [email, prediction.id, prediction.status, imageUrl || null, KLING_COST, 'kling_video']
        );

        res.json({
          jobId: prediction.id,
          status: prediction.status
        });

      } catch (e) {
        console.error("Kling video error:", e);
        
        // Refund credits if generation failed after charging
        try {
          const { email: userEmail } = req.user;
          const videoDuration = parseInt(fields.duration) || 10;
          const refundAmount = videoDuration * KLING_COST_PER_SECOND;
          await pool.query(
            "UPDATE users SET balance = balance + $1 WHERE email = $2",
            [refundAmount, userEmail]
          );
          console.log(`Refunded ${refundAmount} credits to ${userEmail} due to error`);
        } catch (refundErr) {
          console.error("Failed to refund credits:", refundErr);
        }

        res.status(500).json({ error: e?.message || "Video generation failed" });
      }
    });

    req.pipe(bb);

  } catch (e) {
    console.error("Kling video error:", e);
    res.status(e.statusCode || 500).json({ error: e?.message || "Internal error" });
  }
});

/**
 * GET /api/kling-video/:jobId
 * Check status of video generation
 */
app.get("/api/kling-video/:jobId", auth, asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  // Query Replicate directly
  requireEnv("REPLICATE_API_TOKEN", REPLICATE_API_TOKEN);
  const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });
  
  const prediction = await replicate.predictions.get(jobId);

  // Update database with latest status and output
  if (prediction.status === 'succeeded' && prediction.output) {
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    
    await pool.query(
      `UPDATE videos 
       SET status = $1, output_url = $2, updated_at = now() 
       WHERE prediction_id = $3`,
      [prediction.status, outputUrl, jobId]
    );
  } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await pool.query(
      `UPDATE videos 
       SET status = $1, updated_at = now() 
       WHERE prediction_id = $2`,
      [prediction.status, jobId]
    );
    
    // Automatically refund credits for failed generation
    await refundCreditsForFailure(jobId);
  }

  res.json({
    status: prediction.status,
    output: prediction.output
  });
}));

