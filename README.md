# MCR EV Planner Telegram Relay

A standalone Vercel function authenticates Telegram's secret header, forwards the original JSON text to the existing Apps Script web app, and follows its redirects internally. Telegram receives HTTP 200 after a successful final upstream response, or HTTP 502 on forwarding failure so it can retry. Existing Apps Script duplicate protection handles retries. No bot token, database or dependencies are needed. The existing EV Planner is unchanged.

## Environment variables

Set these three variables in Vercel, with Production enabled:

- `TELEGRAM_WEBHOOK_SECRET`: the secret Telegram will send in `X-Telegram-Bot-Api-Secret-Token`. Use 1–256 characters from A–Z, a–z, 0–9, `_`, `-`.
- `APPS_SCRIPT_WEBHOOK_URL`: your existing deployed `https://script.google.com/macros/s/<deployment-id>/exec` URL, without the token.
- `APPS_SCRIPT_WEBHOOK_SECRET`: the existing Apps Script `WEBHOOK_SECRET` value. The relay adds it with URL.searchParams; do not change the Apps Script value.

Never commit real values. The relay does not use or need the Telegram bot token. Only generic configuration/forwarding failures are logged, never payloads, URLs or secrets.

## Deploy

1. Put only this `telegram-relay` folder's contents in a separate Git repository and push it to your Git provider.
2. In Vercel, choose **Add New → Project**, import that repository and select **Other** as the framework. The repository root must contain `api/` and `package.json`. Leave build and output-directory overrides unset. Use Node.js 24.x.
3. Add the three environment variables above before choosing **Deploy**.
4. Ensure the production endpoint is publicly accessible without Vercel login or deployment-protection challenges. The POST endpoint authenticates using Telegram's secret header.
5. Visit `https://<deployment-domain>/api/telegram-webhook`. GET returns `{"ok":true,"service":"MCR EV Planner Telegram Relay"}`. This checks the relay endpoint, not upstream credentials.
6. Separately register your Telegram webhook with URL `https://<deployment-domain>/api/telegram-webhook` and `secret_token` equal to `TELEGRAM_WEBHOOK_SECRET`. Do not include the Apps Script query token in the Telegram webhook URL. No bot token belongs in this project.

Saving files here does not change or deploy Apps Script. The relay waits for forwarding to finish (20-second timeout); it does not acknowledge updates in the background. A 302 from Apps Script is followed using native fetch (the ContentService redirect is fetched with GET); it is never returned to Telegram. As with the existing application, an upstream HTTP 200 cannot prove the Inbox accepted the update if Apps Script itself returns OK for rejected requests.

## Local tests

With Node.js 24, run `npm test`. Tests use mocked upstream responses and a local loopback redirect server only; they do not call Google, Telegram or Vercel.

Structure follows Vercel's native /api Web Standard functions: https://vercel.com/docs/functions/runtimes/node-js
