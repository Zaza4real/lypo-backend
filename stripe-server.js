import express from "express";
import Stripe from "stripe";
import Database from "better-sqlite3";
import cors from "cors";

const app = express();

// --- Config
const PORT = process.env.PORT || 4242;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:5173"; // where your frontend lives
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// --- Stripe
if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
const stripe = new Stripe(STRIPE_SECRET_KEY);

// --- DB (single-file sqlite)
const db = new Database("data.sqlite");
db.exec(`
  CREATE TABLE IF NOT EXISTS balances (
    user_id TEXT PRIMARY KEY,
    balance_lypos INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS processed_sessions (
    session_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL
  );
`);

// --- Middleware
app.use(cors());

// IMPORTANT: webhook needs RAW body, so define it BEFORE express.json()
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Fulfill credits on successful Checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const sessionId = session.id;
    const userId = session.metadata?.userId;
    const lypos = Number(session.metadata?.lypos || 0);

    if (userId && Number.isFinite(lypos) && lypos > 0) {
      const already = db.prepare("SELECT session_id FROM processed_sessions WHERE session_id = ?").get(sessionId);
      if (!already) {
        const tx = db.transaction(() => {
          db.prepare("INSERT INTO processed_sessions(session_id, processed_at) VALUES(?, datetime('now'))").run(sessionId);
          db.prepare(`
            INSERT INTO balances(user_id, balance_lypos) VALUES(?, ?)
            ON CONFLICT(user_id) DO UPDATE SET balance_lypos = balance_lypos + excluded.balance_lypos
          `).run(userId, Math.floor(lypos));
        });
        tx();
        console.log(`Credited ${lypos} LYPOS to ${userId} (session ${sessionId})`);
      }
    }
  }

  res.json({ received: true });
});

// JSON for the rest
app.use(express.json());

// Health
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Get balance
app.get("/api/balance", (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const row = db.prepare("SELECT balance_lypos FROM balances WHERE user_id = ?").get(userId);
  res.json({ balanceLypos: row?.balance_lypos ?? 0 });
});

// Spend credits (optional, to protect your paid flow server-side)
app.post("/api/spend", (req, res) => {
  const userId = String(req.body?.userId || "");
  const amount = Math.floor(Number(req.body?.lypos || 0));
  if (!userId || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid request" });

  const row = db.prepare("SELECT balance_lypos FROM balances WHERE user_id = ?").get(userId);
  const bal = row?.balance_lypos ?? 0;
  if (bal < amount) return res.status(402).json({ error: "Insufficient LYPOS" });

  db.prepare("UPDATE balances SET balance_lypos = balance_lypos - ? WHERE user_id = ?").run(amount, userId);
  const after = db.prepare("SELECT balance_lypos FROM balances WHERE user_id = ?").get(userId)?.balance_lypos ?? 0;
  res.json({ ok: true, balanceLypos: after });
});

// Create Stripe Checkout Session for top-up
app.post("/api/create-checkout-session", async (req, res) => {
  const userId = String(req.body?.userId || "");
  const usd = Number(req.body?.usd);

  if (!userId || !Number.isFinite(usd) || usd <= 0) {
    return res.status(400).json({ error: "Invalid request" });
  }

  // 1 USD = 100 LYPOS
  const lypos = Math.floor(usd * 100);
  const amountCents = Math.round(usd * 100);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `LYPOS Top-up (${lypos} LYPOS)` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${PUBLIC_URL}/?paid=1`,
      cancel_url: `${PUBLIC_URL}/?paid=0`,
      metadata: { userId, lypos: String(lypos) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Stripe error" });
  }
});

app.listen(PORT, () => console.log(`Stripe credits server listening on :${PORT}`));
