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
| `block` | `true` only for clear failures: invalid syntax, no MX records, a disposable domain, or a typo of a major mail provider (see `typo_domain`). Role accounts (`info@`, `test@`) are allowed. |
| `ok` | The opposite of `block`. |
| `reason` | `invalid_syntax`, `no_mx`, `disposable`, `typo_domain`, or `null`. |
| `did_you_mean` | Emailit's typo suggestion, always passed on unchanged so you can show it as a hint. Fast mode is lenient (`test@gnail.com` scores low risk), so when the suggested domain is a major provider (gmail.com, googlemail.com, hotmail.com, outlook.com, live.com, live.nl, msn.com, yahoo.com, icloud.com, ziggo.nl, kpnmail.nl, home.nl, hotmail.nl) and differs from the typed one, the address is blocked with `reason: "typo_domain"`. Suggestions to other domains never block. |
| `risk`, `score` | Emailit's values. |

Other statuses: `401` bad or missing token, `400` bad body, `405` not a POST, `503` not configured.

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
