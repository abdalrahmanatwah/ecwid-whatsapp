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

## Auto-ship

After a customer confirms (نعم), the order is **not** shipped immediately — it waits
`SHIP_DELAY_MIN` minutes (default 15) so a customer who changes their mind seconds later
doesn't get a shipment created anyway. Once that window passes with no cancellation, the
order ships automatically via Bosta — but only if **every** one of these holds:

- Exactly one line item, quantity 1 (multi-item orders are left for manual shipping, same
  scope as before)
- The order's city matches one of Bosta's own cities exactly (fetched live from Bosta, not
  a hardcoded list — a near-miss is **not** force-matched)
- The address is already in Arabic script

That last one is worth being direct about: **this build does not auto-translate an
English-written address.** The original system's documented behavior was to fail safe on a
translation failure rather than risk a wrong address, and since the original translation
code wasn't available to restore, I kept the safe half of that behavior (fail to manual) but
left out the automatic part. If you want that back, it's a real follow-up, not a silent gap —
let me know and I'll wire in an actual translation step.

Any of the checks above failing — multi-item, unrecognized city, English address, missing
phone, anything — leaves the order exactly where it would sit under fully-manual shipping:
**Processing**, with status `ship_failed` internally, and a WhatsApp alert to you. Nothing
ships on a guess.

On success, the tracking number is written onto the order automatically — the same field
you've been pasting it into by hand — so the existing delivery-status bridge, dashboard, and
"100 EGP delivered offer" message all pick it up with no manual step.

Turn it off entirely with `AUTO_SHIP=false` to go back to fully manual.

---

## Dashboard

`/dashboard` shows Bosta delivery rate, earnings, undelivered orders, cash collected vs
pending, average order value, top products, and the Tennis & Padel / Running & Fitness
revenue split — for Today, Last 7/14/30 days, or a custom date range.

It reads straight from Ecwid (no separate database): orders already carry the delivered /
returned / cancelled status that the tracking bridge writes back onto them, so the numbers
are always live and never drift out of sync.

**The date model — read this, it's not the obvious choice:**

The period tabs (Today / 7d / etc.) filter by **resolution date** — when an order was
*marked* delivered/returned/cancelled — not by when it was originally placed. So "Today"
means "what got resolved today", which can absolutely include an order placed a week ago
that only finished its delivery attempt today. This matches what Bosta's own dashboard
shows for "yesterday", and it's the only framing where "today's earnings" means real cash
that landed today rather than a number that's structurally near-zero for any recent day
(since delivery takes time, almost nothing placed *today* has resolved *today*).

Two things are deliberately **not** filtered by the period tabs at all, since they're "right
now" concepts, not historical ones:
- **In transit** — currently-unresolved orders, found via a fixed 45-day lookback (past
  the 21-day point where the tracking bridge gives up on a delivery).
- **Cash pending** — the value of those in-transit orders.

These sit in their own dashed "Right now" box on the dashboard so they're visually distinct
from the period-scoped numbers above them.

A separate **"X placed"** stat (next to "Resolved this period") shows orders actually placed
in the selected window, by creation date — kept apart from the delivered/undelivered counts
on purpose, since blending the two is exactly what caused the original confusion.

**Other definitions:**
- A day "starts" at midnight **Cairo time**, not server time.
- *Earnings* / *cash collected* = sum of `total` for delivered orders resolved in the window.
- *Top products* and *category split* are built from those same delivered orders.
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
| `AUTO_SHIP` | `true`/`false` — auto-ship via Bosta after the grace window (default `true`) |
| `SHIP_DELAY_MIN` | Minutes to wait after confirm before auto-shipping (default `15`) |

---

## Notes & limits

- On first launch the tool records the current time and only messages orders placed
  **after** that — it won't blast your existing orders.
- Customers must enter a valid WhatsApp number at checkout. Numbers are normalized to the
  `DEFAULT_COUNTRY_CODE`; orders with no phone are skipped and logged.
- Meta charges per conversation (utility category is cheap). Check current WhatsApp pricing.
- Ecwid may email the customer when an order status changes (per your store's notification
  settings). Turn those off in Ecwid if you don't want double messaging.
