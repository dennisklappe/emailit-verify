# emailit-verify

A tiny Cloudflare Worker that exposes **only** email verification from [Emailit](https://emailit.com). Runs on the Cloudflare free tier.

## Why

Emailit's `POST /v2/email-verifications` needs an API key with `full` scope. Sending keys (scope `sending`) get `403 Permission denied: full`. Putting a full key in every app that wants to check an address before its first mail is a bad idea: that key can do everything in your account. This Worker holds the one full key and gives each app its own bearer token that can do exactly one thing: verify an address.

## Setup

```sh
npm install
npx wrangler secret put EMAILIT_API_KEY   # an Emailit key with full scope
npx wrangler secret put TOKENS            # JSON: {"my-app":"<long random token>","other-app":"<another>"}
npm run deploy
```

Generate a token with `openssl rand -hex 32`. Rotate by editing `TOKENS`; there is no redeploy needed beyond setting the secret.

Typo precheck: the variable `TYPO_PRECHECK` (default `on`, set `off` to disable; add it under `vars` in `wrangler.jsonc` or as a secret/variable in the dashboard). See below.

Optional, in `wrangler.jsonc`:

- A KV namespace bound as `CACHE`: results are cached per address for 24 hours (a verification costs credits at Emailit). Upstream failures are never cached.
- A custom domain route, for example `verify.example.com`.

## Request

```sh
curl -X POST https://verify.example.com/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"someone@example.com"}'
```

## Response

`200` with

```json
{ "ok": true, "block": false, "reason": null, "did_you_mean": null, "risk": "low", "score": 100 }
```

| Field | Meaning |
|---|---|
| `block` | `true` only for clear failures: invalid syntax, no MX records, or a disposable domain. A typo of a popular provider never blocks (someone may really own `gnail.com`); it sets `suggest: true` instead. Role accounts (`info@`, `test@`) are allowed. |
| `ok` | The opposite of `block`. |
| `reason` | `invalid_syntax`, `no_mx`, `disposable`, `typo_domain` (with `block: false`, `suggest: true`), or `null`. |
| `did_you_mean` | A suggested corrected address, to show as a hint. For `typo_domain` it is the full corrected address (`test@gmail.com`); otherwise it is Emailit's suggestion, unchanged. |
| `risk`, `score` | Emailit's values. |

Other statuses: `401` bad or missing token, `400` bad body, `405` not a POST, `503` not configured.

### Typo precheck

Emailit's fast mode is lenient: `test@gnail.com` scores low risk and only gets a suggestion. So before calling Emailit (no credits spent), the Worker checks the domain against popular providers (gmail, googlemail, hotmail, outlook, live, msn, yahoo, icloud, ziggo, kpnmail, home.nl) and answers, without blocking (show the suggestion and let the user confirm),

```json
{ "ok": true, "block": false, "reason": "typo_domain", "suggest": true, "did_you_mean": "test@gmail.com", "risk": "medium", "score": 0, "source": "precheck" }
```

for misspellings (`gnail.com`, `gmial.com`, `hotmial.com`, `outlok.com`), wrong TLDs on the big brands (`gmail.co`, `gmail.con`, `gmail.nl`, `outlook.nl`), and dot or dash variants (`g-mail.com`, `gmailcom`). It is deliberately conservative: real provider domains (`hotmail.nl`, `live.nl`, `yahoo.co.uk`) pass, only labels of 5+ characters are fuzzy matched (one edit, same TLD group), and unrelated domains pass. Set `TYPO_PRECHECK=off` to skip it.

### Fail open

If Emailit errors or does not answer within 3 seconds, the Worker answers `200 {"ok":true,"block":false,"error":"upstream"}`. A verification outage should never stop a signup.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
npm test
```

## License

MIT
