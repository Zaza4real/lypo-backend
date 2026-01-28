import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// IMPORTANT: webhook needs raw body, so we add it BEFORE express.json for that route
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Example: we store email + credits in metadata
    const email = session.customer_details?.email;
    const creditsToAdd = Number(session.metadata?.credits || 0);

    // TODO: save to your DB
    // await db.addCredits(email, creditsToAdd);

    console.log("✅ Payment completed:", { email, creditsToAdd });
  }

  res.json({ received: true });
});

// Normal JSON routes AFTER webhook
app.use(express.json());
app.use(cors({ origin: true }));

// Create checkout session
app.post("/api/stripe/create-checkout-session", async (req, res) => {
  const { packId, email } = req.body;

  // Define packs (you can change)
  const packs = {
    pack5: { usd: 5, credits: 500 },
    pack10: { usd: 10, credits: 1000 },
    pack20: { usd: 20, credits: 2000 },
  };

  const pack = packs[packId];
  if (!pack) return res.status(400).json({ error: "Invalid packId" });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email, // simplest beginner option
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: pack.usd * 100,
          product_data: { name: `${pack.credits} credits` },
        },
        quantity: 1,
      },
    ],
    metadata: {
      credits: String(pack.credits),
    },
    success_url: `${process.env.FRONTEND_URL}/?paid=1`,
    cancel_url: `${process.env.FRONTEND_URL}/?paid=0`,
  });
  res.json({ url: session.url });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
