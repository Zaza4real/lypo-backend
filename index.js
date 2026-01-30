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

const app = express();

/* ---------------------------
   CORS
---------------------------- */
const allowedOrigins = new Set([
  "https://digitalgeekworld.com",
  "https://www.digitalgeekworld.com",
  "https://homepage-3d78.onrender.com",
  "https://lypo.org",
  "https://www.lypo.org",
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

// Async route wrapper to prevent unhandled promise rejections (which can crash the server)
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

// ---- Resend (Support emails)
let resend = null;
if (process.env.RESEND_API_KEY) {
  try {
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.error("Resend init failed:", e?.message || e);
  }
}
const EMAIL_FROM = process.env.EMAIL_FROM || "LYPO <no-reply@lypo.org>";
const SUPPORT_TO = process.env.SUPPORT_TO || process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || "";

async function sendSupportEmail({ fromEmail, subject, message, authedEmail }) {
  const to = SUPPORT_TO;
  const safeSubject = (subject && String(subject).trim()) ? String(subject).trim() : "New support request";
  const body = String(message || "").trim();
  const fromLine = fromEmail ? String(fromEmail).trim() : "(not provided)";
  const authedLine = authedEmail ? String(authedEmail).trim() : "";
  const html = `
    <p><strong>Support request</strong></p>
    <p><strong>From:</strong> ${fromLine}${authedLine ? ` (logged in as ${authedLine})` : ""}</p>
    <p><strong>Subject:</strong> ${safeSubject}</p>
    <p><strong>Message:</strong></p>
    <pre style="white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${body.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
  `;

  if (!to) {
    console.log("⚠️ SUPPORT_TO not configured. Support message:", { fromEmail, safeSubject, body });
    return { ok: false, reason: "SUPPORT_TO_NOT_SET" };
  }

  if (!resend) {
    console.log("⚠️ RESEND_API_KEY not configured. Support message:", { to, fromEmail, safeSubject, body });
    return { ok: false, reason: "RESEND_NOT_CONFIGURED" };
  }

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: [to],
    replyTo: fromEmail || undefined,
    subject: `[LYPO Support] ${safeSubject}`,
    html
  });

  if (error) {
    console.error("❌ Resend support email error:", error);
    return { ok: false, reason: "SEND_FAILED", error };
  }
  return { ok: true, id: data?.id || null };
}

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
  `);

// Migrations for existing databases
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS cost_credits INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_url TEXT;`);

  // Password reset migrations (older DBs)
  await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
  await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS email TEXT;`);
  await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours');`);
  await pool.query(`ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`);
  try { await pool.query(`ALTER TABLE password_resets ADD PRIMARY KEY (token_hash);`); } catch (e) {}

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
    "INSERT INTO users (email, password_hash, balance) VALUES ($1,$2,0) RETURNING email, password_hash, balance, created_at",
    [e, passwordHash]
  );
  return rows[0];
}

async function recordPayment({ email, stripeSessionId, amountUsd, lypos, status, invoiceUrl }) {
  const e = normEmail(email);
  const sid = stripeSessionId || null;
  if (!sid) throw new Error("Missing stripeSessionId");

  // Idempotent write without requiring a UNIQUE constraint (Render DB schema may differ).
  // Strategy: try UPDATE first; if nothing updated, INSERT if not exists.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upd = await client.query(
      `UPDATE payments
         SET status=$1,
             invoice_url=COALESCE($2, invoice_url),
             amount_usd=COALESCE(NULLIF($3,0), amount_usd),
             lypos=COALESCE(NULLIF($4,0), lypos)
       WHERE stripe_session_id=$5 AND email=$6`,
      [status || "completed", invoiceUrl || null, Number(amountUsd || 0), Math.trunc(lypos || 0), sid, e]
    );

    if (upd.rowCount === 0) {
      await client.query(
        `INSERT INTO payments (email, stripe_session_id, amount_usd, lypos, status, invoice_url)
         SELECT $1,$2,$3,$4,$5,$6
         WHERE NOT EXISTS (SELECT 1 FROM payments WHERE stripe_session_id=$2 AND email=$1)`,
        [e, sid, Number(amountUsd || 0), Math.trunc(lypos || 0), status || "completed", invoiceUrl || null]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
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
});

// JSON for normal routes
app.use(express.json({ limit: "2mb" }));

// ---- Support (send message via Resend)
app.post("/api/support", async (req, res) => {
  const fromEmail = String(req.body?.email || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!message) return res.status(400).json({ error: "Missing message" });

  // Optional: if user is logged in, capture their email from Bearer token
  let authedEmail = "";
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      authedEmail = decoded?.email || "";
    }
  } catch {
    // ignore invalid tokens
  }

  // Require at least one email source: provided email OR logged-in email
  if (!fromEmail && !authedEmail) return res.status(400).json({ error: "Missing email" });

  try {
    const out = await sendSupportEmail({ fromEmail: fromEmail || authedEmail, subject, message, authedEmail });
    // Always return ok to the client (avoid leaking config), but log reasons
    if (!out.ok) {
      console.log("Support email not sent:", out.reason);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("Support endpoint error:", e?.message || e);
    return res.json({ ok: true });
  }
});


// ---- Auth routes


async function sendPasswordResetEmail({ email, token }) {
  const resetUrl = `${FRONTEND_URL}/reset.html?token=${token}&email=${encodeURIComponent(email)}`;
  const from = (process.env.RESEND_FROM || "onboarding@resend.dev").trim();

  if (!resend) {
    console.log("🔑 Password reset link (Resend not configured):", resetUrl);
    return false;
  }

  try {
    await resend.emails.send({
      from,
      to: email,
      subject: "Reset your LYPO password",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 8px 0;">Reset your password</h2>
          <p style="margin:0 0 14px 0;">Click the button below to set a new password.</p>
          <p style="margin:0 0 18px 0;">
            <a href="${resetUrl}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:10px;">
              Reset password
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#444;">If the button doesn't work, open this link:</p>
          <p style="margin:6px 0 0 0;font-size:12px;color:#444;">${resetUrl}</p>
        </div>
      `
    });
    console.log("📩 Password reset email sent to:", email);
    return true;
  } catch (e) {
    console.log("❌ Password reset email failed:", e?.message || e);
    console.log("Full error:", e);
    console.log("🔑 Password reset link (fallback):", resetUrl);
    return false;
  }
}

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


app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = normEmail((req.body && req.body.email) || "");
    if (!email) return res.json({ ok: true });

    // Avoid account enumeration
    const user = await getUserByEmail(email);
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await pool.query(
      "INSERT INTO password_resets(token_hash, email, expires_at) VALUES($1,$2, NOW() + interval '2 hours')",
      [tokenHash, email]
    );

    await sendPasswordResetEmail({ email, token });
    res.json({ ok: true });
  } catch (e) {
    console.error("forgot-password failed:", e?.message || e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const email = normEmail((req.body && req.body.email) || "");
    const token = String((req.body && req.body.token) || "").trim();
    const password = String((req.body && req.body.password) || "");

    if (!email || !token || !password) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 6) return res.status(400).json({ error: "Password too short (min 6)" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const row = (await pool.query(
      "SELECT token_hash, email, expires_at, used_at FROM password_resets WHERE token_hash=$1 AND email=$2",
      [tokenHash, email]
    )).rows[0];

    if (!row) return res.status(400).json({ error: "Invalid token" });
    if (row.used_at) return res.status(400).json({ error: "Token already used" });

    const exp = new Date(row.expires_at);
    if (Date.now() > exp.getTime()) return res.status(400).json({ error: "Token expired" });

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash=$1 WHERE email=$2", [passwordHash, email]);
    await pool.query("UPDATE password_resets SET used_at=now() WHERE token_hash=$1", [tokenHash]);

    res.json({ ok: true });
  } catch (e) {
    console.error("reset-password failed:", e?.message || e);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/api/auth/me", auth, async (req, res) => {
  const email = req.user?.email;
  const u = await getUserByEmail(email);
  if (!u) return res.status(401).json({ error: "Invalid user" });
  res.json({ user: publicUserRow(u) });
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
app.get("/api/stripe/confirm", auth, asyncHandler(async (req, res) => {
  const sessionId = String(req.query?.session_id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  // Retrieve the session from Stripe
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent", "payment_intent.latest_charge"] });

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
      let charge = pi?.latest_charge;
      if (charge && typeof charge === "string") {
        charge = await stripe.charges.retrieve(charge);
      }
      invoiceUrl = charge?.receipt_url || null;
    }
  } catch {
    invoiceUrl = null;
  }

  // Record payment + credit balance (idempotent because stripe_session_id is UNIQUE)
  try {
    await recordPayment({
      email,
      stripeSessionId: session.id,
      amountUsd: amountTotal,
      lypos: credits,
      status: "completed",
      invoiceUrl
    });
    await addBalance(email, credits);
  } catch (e) {
    // If already recorded, ignore; still return current balance
    const msg = String(e?.message || "");
    if (!msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("unique")) {
      console.log("⚠️ confirm payment failed:", msg);
    }
  }

  const bal = await getBalance(email);
  res.json({ ok: true, balance: bal, invoice_url: invoiceUrl, invoiceUrl });
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
    
// Global error handler (ensures we respond instead of crashing, which can surface as 502 + CORS errors)
app.use((err, req, res, next) => {
  try {
    console.log("❌ Unhandled error:", err?.stack || err);
    if (res.headersSent) return next(err);
    const status = Number(err?.statusCode || err?.status || 500);
    res.status(status).json({ error: err?.message || "Internal Server Error" });
  } catch (e) {
    // Last resort: avoid crashing
    try { res.status(500).json({ error: "Internal Server Error" }); } catch {}
  }
});

app.listen(PORT, () => console.log(`LYPO backend running on ${PORT}`));
  })
  .catch((e) => {
    console.error("❌ DB init failed", e);
    process.exit(1);
  });