export interface Env {
	/** Emailit API key with `full` scope. */
	EMAILIT_API_KEY: string;
	/** JSON object: caller name -> bearer token. */
	TOKENS: string;
	/** Optional KV namespace for the 24h result cache. */
	CACHE?: KVNamespace;
}

export interface Result {
	ok: boolean;
	block: boolean;
	reason: "invalid_syntax" | "no_mx" | "disposable" | null;
	did_you_mean: string | null;
	risk: string;
	score: number;
}

const UPSTREAM = "https://api.emailit.com/v2/email-verifications";
const TIMEOUT_MS = 3000;
const CACHE_TTL = 24 * 60 * 60;
const MAX_EMAIL = 320;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});

const enc = new TextEncoder();

async function sha256(s: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Constant-time compare: both sides are hashed to equal length first. */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
	let diff = 0;
	for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
	return diff === 0;
}

/** Returns the caller name for a valid bearer token, else null. Checks every token (no early exit). */
export async function authenticate(header: string | null, tokensJson: string): Promise<string | null> {
	const m = /^Bearer (.+)$/.exec(header ?? "");
	if (!m) return null;
	let tokens: Record<string, unknown>;
	try {
		tokens = JSON.parse(tokensJson);
	} catch {
		return null;
	}
	let found: string | null = null;
	for (const [name, token] of Object.entries(tokens)) {
		if (typeof token === "string" && token.length >= 16 && (await safeEqual(m[1], token))) found = name;
	}
	return found;
}

export function toResult(v: any): Result {
	const checks = v?.checks ?? {};
	let reason: Result["reason"] = null;
	if (checks.valid_syntax === false) reason = "invalid_syntax";
	else if (checks.has_mx_records === false) reason = "no_mx";
	else if (checks.disposable === true) reason = "disposable";
	return {
		ok: reason === null,
		block: reason !== null,
		reason,
		did_you_mean: typeof v?.did_you_mean === "string" ? v.did_you_mean : null,
		risk: String(v?.risk ?? "unknown"),
		score: Number(v?.score ?? 0),
	};
}

async function verify(email: string, env: Env): Promise<Result | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(UPSTREAM, {
			method: "POST",
			headers: { authorization: `Bearer ${env.EMAILIT_API_KEY}`, "content-type": "application/json" },
			body: JSON.stringify({ email }),
			signal: ctrl.signal,
		});
		if (!res.ok) return null;
		return toResult(await res.json());
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function cacheKey(email: string): Promise<string> {
	const h = await sha256(email);
	return "v1:" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (new URL(req.url).pathname !== "/") return json({ error: "not_found" }, 404);
		if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
		if (!env.EMAILIT_API_KEY || !env.TOKENS) return json({ error: "not_configured" }, 503);

		const caller = await authenticate(req.headers.get("authorization"), env.TOKENS);
		if (!caller) return json({ error: "unauthorized" }, 401);

		let email: unknown;
		try {
			email = ((await req.json()) as any)?.email;
		} catch {
			return json({ error: "bad_request" }, 400);
		}
		if (typeof email !== "string" || email.length > MAX_EMAIL) return json({ error: "bad_request" }, 400);
		email = email.trim().toLowerCase();
		const addr = email as string;

		// Obvious garbage never costs a credit.
		if (!EMAIL_SHAPE.test(addr)) {
			return json({ ok: false, block: true, reason: "invalid_syntax", did_you_mean: null, risk: "high", score: 0 });
		}

		const key = env.CACHE ? await cacheKey(addr) : null;
		if (env.CACHE && key) {
			try {
				const hit = await env.CACHE.get(key, "json");
				if (hit) return json(hit);
			} catch {}
		}

		const result = await verify(addr, env);
		if (!result) return json({ ok: true, block: false, error: "upstream" });

		if (env.CACHE && key) {
			ctx.waitUntil(env.CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL }).catch(() => {}));
		}
		return json(result);
	},
};
