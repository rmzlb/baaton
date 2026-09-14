# Baaton — Cloudflare Email Sending

Provider: Cloudflare Email Service REST API, via notifyd. No Resend or inbound-mail migration is required.

## Current verified state (2026-09-15)

- Zone `baaton.dev` exists in the Cloudflare account named Carbonable.
- Sending MX records on `cf-bounce.baaton.dev` and DKIM on `cf-bounce._domainkey.baaton.dev` are present. This alone does not prove delivery or full domain onboarding.
- The operator credential available to this session verifies as active and can read DNS, but `/zones/{zone}/email/sending/subdomains` returns 403. A send-endpoint request with an empty body (no recipient, no message sent) returns 401.
- Dokploy compose `SD_17_tF_Xju_8Lf221Sd` still specifies `EMAIL_PROVIDER: log`. It has not been switched to real sending.
- No successful Cloudflare email delivery has been demonstrated. A notification logged by the log provider is not delivery.

## 1. Inspect domain onboarding

Go to **Compute → Email Service → Email Sending**, select `baaton.dev`, then **Settings**.

If absent, use **Onboard Domain** and inspect the proposed records before confirming. Sending uses `cf-bounce` MX/SPF, the `cf-bounce._domainkey` DKIM selector and the domain's DMARC policy. Do not replace root MX/SPF records or existing DMARC policy just to enable outbound mail. Inbound **Email Routing** is separate and is not a prerequisite.

Verify sending DNS and domain readiness in Cloudflare. Do not invent a DKIM key or assume verification merely because the domain uses Cloudflare DNS.

## 2. Dedicated sending credential

Use a Cloudflare API token with **Email Sending: Edit**, scoped to the account that owns `baaton.dev`. Administrative domain inspection may require additional documented zone permissions; do not broaden the send token unnecessarily.

Pass the token through protected secret entry or the deployment platform's masked secret settings, never chat, repository files, screenshots, CLI arguments, or logs. The existing DNS token does not authorize sending in the observed account.

## 3. Configure the existing notifyd compose

Inspect and merge the existing compose and environment settings. Keep Telegram, the database, encryption settings, volumes and routing unchanged. Ensure the running notifyd version supports `provider=cloudflare`.

Expected environment **names** (secret values omitted):

```text
EMAIL_PROVIDER=cloudflare
CLOUDFLARE_EMAIL_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
EMAIL_FROM=notifications@baaton.dev
EMAIL_FROM_NAME=Baaton
```

The current compose has `EMAIL_PROVIDER: log` inline. Adding an environment variable elsewhere will not override that inline value unless the compose is updated to reference it. Set the provider only after the dedicated credential and sending domain are ready. Do not deploy placeholder token values.

Check the Baaton notifyd project's own sender overrides and allowed channels too: they can override the instance sender. Use the Baaton project only; do not change unrelated notifyd tenants.

## 4. Delivery check

Use an authorized test recipient with a verified email registered in Baaton. Trigger the requested `in_review` transition from another effective actor and confirm:

1. Recipient selection: current org membership, creator/actor identity, verified address and deduplication.
2. notifyd accepts a request with `body_html` (not `html`), text fallback, subject and recipient-scoped event key.
3. The job reaches the Cloudflare connector, not the log connector.
4. Cloudflare reports delivered/queued/bounced accurately, then check the actual inbox.
5. The hosted PNG mascot, ticket CTA and notification preferences link render correctly. Queue acceptance is not proof of inbox delivery.

Do not notify real project subscribers while debugging or replay old queued production events. Keep email activation blocked if credentials, authentication, or recipient verification fail.

## References

- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/configuration/domains/
- https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
- https://developers.cloudflare.com/api/resources/email_sending/
