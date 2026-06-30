# Ecwid → WhatsApp order confirmation

When a customer places an order in your Ecwid store, this tool sends them a WhatsApp
message with two buttons — **Confirm order** / **Cancel order** — and updates the order
in Ecwid based on their reply.

```
This server checks Ecwid for new orders every minute
   │  finds a new order
   ▼
WhatsApp poll sent to the customer:  [ ✅ Confirm ]   [ ❌ Cancel ]
   │  customer taps a button
   ▼
This server  ──► Ecwid: Confirm → "Processing"   |   Cancel → "Cancelled"
             ──► WhatsApp: thank-you / cancellation note to the customer
```

The order ID is embedded in each button, so a tap always maps to the right order.

## Why polling (and not Ecwid webhooks)

Ecwid only lets you attach a webhook URL to a *custom app* by emailing their support team —
the App details page is read-only and you can't set it yourself. To avoid that dependency,
this tool **polls** the Ecwid orders API once a minute instead. The only tradeoff is that the
customer gets the WhatsApp message up to ~1 minute after ordering, which is fine for
confirmation. Everything is self-serve: you just need your secret token and store ID.

---

## What you need to set up (one time)

### 1. Ecwid: token + store ID  (no webhook, no emailing support)

1. Open `https://my.ecwid.com/#develop-apps` while logged into your store.
2. Create a custom app and install it. Required scopes — `read_orders`, `update_orders`,
   `read_store_profile` — are included in the default custom app (you already have them).
3. On the app's **Details** page, copy the **Secret token** (starts with `secret_`) →
   `ECWID_API_TOKEN`.
4. Your numeric **store ID** is in the footer at the bottom of the control panel →
   `ECWID_STORE_ID`.

That's the entire Ecwid side.

### 2. Meta: WhatsApp Cloud API

1. Create a Meta app at developers.facebook.com and add the **WhatsApp** product.
2. From **WhatsApp → API Setup**, copy the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
3. Create a **permanent access token** (via a System User in Business Settings) →
   `WHATSAPP_ACCESS_TOKEN`. (The temporary token on the setup page expires in 24h — fine for
   a first test only.)
4. Configure the webhook (this one IS self-serve, in the Meta dashboard): callback URL
   `https://YOUR-DOMAIN/webhooks/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN`,
   then **subscribe to the `messages` field**.

### 3. Meta: the message template

WhatsApp requires an approved template for the first (business-initiated) message.

- Create a template, category **Utility**, with two **Quick reply** buttons.
- Name it `order_confirmation` (or set your own in `WHATSAPP_TEMPLATE_NAME`).
- Body (3 variables):

  > Hello {{1}} 👋
  > We received your order **#{{2}}** for **{{3}}**.
  > Please confirm it so we can start preparing it, or cancel if it was a mistake.

- Buttons: `Confirm order` then `Cancel order` (Confirm must be first = index 0).
- Submit for approval. Put the matching language code in `WHATSAPP_TEMPLATE_LANG`
  (`en`, `en_US`, or `ar` for Arabic).

### 4. Fill in `.env`

```
cp .env.example .env
```
Edit `.env` with the values above.

### 5. Run it on a public server

The server must be reachable over HTTPS so WhatsApp can deliver button taps to it.

**Easiest (Render / Railway):** new Web Service from this repo, build `npm install`,
start `npm start`, add the `.env` values as environment variables. Use the HTTPS URL it
gives you for the WhatsApp webhook above.

**On your own VPS:** `npm install` then `npm start`, behind Nginx/Caddy with HTTPS.

**Test locally first:**
```
npm start
ngrok http 3000      # use the https URL for the WhatsApp webhook
```

> Use a host with a **persistent disk** (or set `STORE_FILE` to a mounted path). The tool
> keeps a small `data/orders.json` to remember which orders it already messaged.

---

## Dashboard

`/dashboard` shows Bosta delivery rate, earnings, undelivered orders, cash collected vs
pending, average order value, top products, and the Tennis & Padel / Running & Fitness
revenue split — for Today, Last 7/14/30 days, or a custom date range.

It reads straight from Ecwid (no separate database): orders already carry the delivered /
returned / cancelled status that the tracking bridge writes back onto them, so the numbers
are always live and never drift out of sync.

**Definitions** (so the numbers mean what you'd expect):
- A day "starts" at midnight **Cairo time**, not server time.
- *Earnings* and *cash collected* only count **delivered** orders — COD cash only really
  lands once the courier actually hands it over.
- *Undelivered* = returned or cancelled, **resolved** within the window. Orders still moving
  (Processing / Shipped, tracking not yet resolved) are shown separately as "in transit" and
  don't count against the delivery rate — they just haven't had time to resolve yet.
- *Top products* and the *category split* are built from delivered orders only.
- The category split is keyword-based (`tennis`/`padel` → Tennis & Padel,
  `running`/`fitness`/`training`/`gym` → Running & Fitness, everything else → Other) since
  Ecwid's order API doesn't carry a category field. Edit `CATEGORY_KEYWORDS` near the top of
  `src/metrics.js` if a product lands in the wrong bucket.

It's protected by a username/password (browser will prompt) — set `DASHBOARD_PASSWORD`
before deploying, or the route refuses to serve anything rather than going public by
accident.

---

## Configuration reference

| Variable | Meaning |
|---|---|
| `POLL_INTERVAL_SECONDS` | How often to check Ecwid for new orders (default 60) |
| `ECWID_STORE_ID` | Numeric store ID (page footer) |
| `ECWID_API_TOKEN` | `secret_...` token from the Details page |
| `CONFIRM_FULFILLMENT_STATUS` | Status set on confirm (default `PROCESSING`) |
| `CANCEL_PAYMENT_STATUS` | Status set on cancel (default `CANCELLED`) |
| `WHATSAPP_PHONE_NUMBER_ID` | From Meta WhatsApp API Setup |
| `WHATSAPP_ACCESS_TOKEN` | Permanent token |
| `WHATSAPP_VERIFY_TOKEN` | Any random string; must match Meta's webhook config |
| `WHATSAPP_TEMPLATE_NAME` / `_LANG` | Your approved template |
| `DEFAULT_COUNTRY_CODE` | For phone normalization. Egypt = `20` |
| `MERCHANT_WHATSAPP` | Optional: get pinged on each reply |
| `DASHBOARD_USER` | Dashboard login username (default `499k`) |
| `DASHBOARD_PASSWORD` | Dashboard login password — **required**, no default |

---

## Notes & limits

- On first launch the tool records the current time and only messages orders placed
  **after** that — it won't blast your existing orders.
- Customers must enter a valid WhatsApp number at checkout. Numbers are normalized to the
  `DEFAULT_COUNTRY_CODE`; orders with no phone are skipped and logged.
- Meta charges per conversation (utility category is cheap). Check current WhatsApp pricing.
- Ecwid may email the customer when an order status changes (per your store's notification
  settings). Turn those off in Ecwid if you don't want double messaging.
