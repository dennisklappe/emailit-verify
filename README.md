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

### Precheck mode (live typing)

Send `"mode":"precheck"` in the body (or `?mode=precheck`) to run only the local checks: syntax, typo domains and wrong TLDs, and a small list of well-known disposable domains. It never calls Emailit, never spends credits and never uses the cache. The response has the same shape plus `"mode":"precheck"`. Use it while the user types, and the default (full) mode on submit. A mode other than `precheck` or `full` is a `400`.

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

## Browser client (inline "did you mean")

The Worker serves a small dependency-free script, with no token in it:

- `https://verify.example.com/client.v2.js` (immutable, cache for a year)
- `https://verify.example.com/client.js` (alias of the latest version, cached for an hour)
- `https://verify.example.com/client.v1.js` (frozen first version: a suggestion never stops the submit)

```html
<input id="email" type="email" name="email">
<script src="https://verify.example.com/client.v2.js"></script>
<script>
  const ev = EmailitVerify.attach(document.getElementById("email"), {
    endpoint: "/api/verify-email", // your own proxy route, see below
    lang: "en",                    // en, nl, de, es, fr, sv, da
    // messages: { keep: "No thanks" },   // override any text
    // onState: (s) => console.log(s),    // idle, checking, suggest, kept, used, ok, blocked
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await EmailitVerify.check(document.getElementById("email"));
    if (r.ok) form.submit(); // false for a hard block or an undecided suggestion, the UI is already shown
  });
</script>
```

Behaviour:

- While typing (600 ms after the last key, and on blur) it calls your endpoint with `mode: "precheck"` (free, local). A typo shows "Did you mean name@gmail.com?" with "Use name@gmail.com" and "No, keep mine". Keep-mine is remembered for that exact address and forgotten on edit. Stale answers are ignored, typing is never blocked, any failure is silent.
- `EmailitVerify.check(input)` is for submit. It calls your endpoint once with `mode: "full"` (cached per address) and only hard blocks stop (`block: true`: `invalid_syntax`, `no_mx`, `disposable`), with "We cannot reach name@domain, please check the address". In v2 a suggestion the person has not yet answered does stop the submit: `check()` returns `{ ok: false, pending: "suggestion", suggest }`, scrolls the hint into view, moves focus to the "Use" button, announces the choice through an aria-live region and shakes the box (with `prefers-reduced-motion` only a full-border highlight stays), on every attempt. Once the person clicks "Use" or "No, keep mine" the submit passes, and the suggestion is not shown again for an address they kept. (v1 never stopped the submit.) After 3 seconds it passes.
- Markup is `div.ev-msg[aria-live=polite]` after the input with `.ev-box`, `.ev-btn`, `.ev-error` classes and neutral styling. Pass `css: false` to skip the injected style and style it yourself.

The endpoint must be a route on your own site that adds the bearer token and forwards the body to the Worker (the browser never sees the token).

### Proxy route helper

`src/helper.ts` (copy it into your project, no dependencies, Workers and Node 18+) has `verifyEmail(email, { url, token, mode, timeoutMs })`, which never throws and fails open, and `decide(result, { email, keptFor })`, which implements the soft/hard rules.

```ts
import { Hono } from "hono";
import { verifyEmail } from "./helper";

const app = new Hono<{ Bindings: { VERIFY_URL: string; VERIFY_TOKEN: string } }>();

app.post("/api/verify-email", async (c) => {
  const { email, mode } = await c.req.json<{ email?: string; mode?: string }>();
  if (typeof email !== "string") return c.json({ error: "bad_request" }, 400);
  const result = await verifyEmail(email, {
    url: c.env.VERIFY_URL,
    token: c.env.VERIFY_TOKEN,
    mode: mode === "precheck" ? "precheck" : "full",
  });
  return c.json(result);
});
```

Server-side on signup, call `verifyEmail(email, {...})` and `decide(result, { email, keptFor })`: `allow: false` means reject, `suggest` is the soft hint to show.
