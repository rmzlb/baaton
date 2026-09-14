# Email Setup — Cloudflare Email Service

notifyd uses **Cloudflare Email Service** to send transactional emails from `notifications@baaton.dev`.

## Prerequisites

- A Cloudflare account with `baaton.dev` as a managed zone
- Access to Dokploy to set environment variables on the notifyd service

---

## 1. Enable Cloudflare Email Routing (if not done)

1. Go to Cloudflare Dashboard → **baaton.dev** → **Email** → **Email Routing**
2. Click **Get started** and follow the wizard — this adds the required MX records automatically

> Note: Email Routing is for *incoming* mail. Outbound sending uses the **Email Service API** (separate product).

---

## 2. Enable Cloudflare Email Service (outbound)

1. Go to **Cloudflare Dashboard** → **Email** → **Email Service**  
   (direct URL: `https://dash.cloudflare.com/{account_id}/email/service`)
2. Click **Enable** — no domain verification required; Cloudflare verifies SPF/DKIM automatically

---

## 3. DNS Records

Add these records in **Cloudflare DNS** for `baaton.dev` :

### SPF
| Type | Name | Content | Proxy |
|------|------|---------|-------|
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | DNS only |

> If you already have an SPF record, append `include:_spf.mx.cloudflare.net` before the `~all`.

### DKIM
Cloudflare Email Service adds DKIM automatically when you enable the service. Verify in Dashboard → Email → Email Service → DKIM.

### DMARC
| Type | Name | Content | Proxy |
|------|------|---------|-------|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@baaton.dev; pct=100` | DNS only |

---

## 4. Create API Token

1. Go to **Cloudflare Dashboard** → **My Profile** → **API Tokens** → **Create Token**
2. Use **Custom Token** with:
   - **Permission**: `Account` → `Email Service` → `Edit`
   - **Account Resources**: Include `baaton` account
3. Click **Continue to summary** → **Create Token**
4. **Copy the token immediately** — it will not be shown again

---

## 5. Get your Account ID

1. Go to Cloudflare Dashboard → **baaton.dev** → right sidebar
2. Copy the **Account ID** (32-character hex string)

---

## 6. Configure notifyd env vars (Dokploy)

In Dokploy, navigate to the **notifyd** service → **Environment Variables** and set:

```
EMAIL_PROVIDER=cloudflare
CLOUDFLARE_EMAIL_API_TOKEN=<token from step 4>
CLOUDFLARE_ACCOUNT_ID=<account id from step 5>
EMAIL_FROM=notifications@baaton.dev
EMAIL_FROM_NAME=Baaton
```

Then **redeploy** notifyd to apply the new variables.

---

## 7. Verify

After deploying, set an email address in Baaton (Settings → Integrations → Email) and create or update a test issue to trigger a notification.

If no email arrives within 5 minutes, check:
- notifyd logs: `docker logs baaton-notifyd` (or via Dokploy log viewer)
- Cloudflare Email Service → **Sending Activity** for bounce/rejection details
- SPF/DMARC: use [MXToolbox](https://mxtoolbox.com/spf.aspx)
