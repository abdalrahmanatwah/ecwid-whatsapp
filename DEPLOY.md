# Deploying to Render (step by step)

Goal: get the tool running on a public HTTPS URL so you can paste its
`/webhooks/whatsapp` address into Meta's Callback URL field.

You'll do this in two parts: put the code on GitHub, then deploy it on Render.

---

## Part 1 — Put the code on GitHub

1. Go to github.com and sign up / log in.
2. Click **New repository**. Name it `ecwid-whatsapp`, set it to **Private**, click **Create repository**.
3. On the empty repo page, click the **"uploading an existing file"** link.
4. Drag in all the project files you downloaded — `package.json`, `package-lock.json`,
   `render.yaml`, `README.md`, `.env.example`, and the whole `src` folder.
   **Do NOT upload** the `.env` file or a `node_modules` folder (you don't have them, which is correct).
5. Click **Commit changes**.

## Part 2 — Deploy on Render

1. Go to render.com and sign up (you can sign in with your GitHub account).
2. Click **New → Blueprint**.
3. Connect your GitHub and select the `ecwid-whatsapp` repo. Render reads `render.yaml`
   and sets up the service, the disk, and the plan automatically.
4. Render will prompt you for the secret values. Fill in:
   - `ECWID_STORE_ID` — your numeric store ID
   - `ECWID_API_TOKEN` — your `secret_...` token
   - `WHATSAPP_PHONE_NUMBER_ID` — the Phone Number ID of your **499K** number
   - `WHATSAPP_ACCESS_TOKEN` — your token (use the permanent one once you have it)
   - `WHATSAPP_VERIFY_TOKEN` — **any random string you make up** (e.g. `499k-verify-secret`).
     Write it down — you'll type the exact same string into Meta.
   - `WHATSAPP_TEMPLATE_NAME` — `order_confirmation` (or your approved template name)
   - `MERCHANT_WHATSAPP` — optional; leave blank for now
5. Click **Apply / Create**. Wait for the build to finish (a few minutes).
6. When it's live, Render shows a URL like `https://ecwid-whatsapp-xxxx.onrender.com`.
   Open it in a browser — you should see "Ecwid → WhatsApp order confirmation: running".

## Part 3 — Connect it to Meta

Your **Callback URL** is that Render URL with `/webhooks/whatsapp` on the end:

```
https://ecwid-whatsapp-xxxx.onrender.com/webhooks/whatsapp
```

In Meta's **Step 2 → Configure Webhooks**:
1. Paste that into **Callback URL**.
2. Put your `WHATSAPP_VERIFY_TOKEN` string into **Verify token** (must match exactly).
3. Click **Verify and save**. Meta pings your server, the server echoes the challenge, and it verifies.
4. Then subscribe to the **messages** field so button taps are delivered.

> Note from Meta's own warning on that page: while your app is **unpublished**, only test
> webhooks are delivered. To receive real customer taps, you'll publish the app (a later step).
