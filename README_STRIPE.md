# Lypo Credits Server (Stripe Checkout + Webhook)

This adds **Option B** payments:
- Frontend starts a Stripe **Checkout Session**
- Stripe sends `checkout.session.completed` to your webhook
- Webhook credits **LYPOS** (1 USD = 100 LYPOS)

## 1) Install
```bash
npm i
```

## 2) Environment variables
Create `.env` (or set in your host):

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `PUBLIC_URL=http://localhost:5500`  (your frontend origin)
- `PORT=4242`

## 3) Run locally
```bash
npm start
```

## 4) Stripe webhook (local testing with Stripe CLI)
Install and login to Stripe CLI, then:
```bash
stripe listen --forward-to localhost:4242/api/stripe-webhook
```

The CLI prints a `whsec_...` signing secret. Use that as `STRIPE_WEBHOOK_SECRET` while testing locally.

## 5) Frontend
Point your frontend to this server:
- set `BACKEND_BASE_URL` in `script.v26.js` to your deployed URL (or `http://localhost:4242`)

Then use the **Pay** button with no file selected to top up.
