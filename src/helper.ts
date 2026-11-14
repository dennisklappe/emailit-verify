/**
 * Server-side helper for a site's own proxy route. Dependency free, works in Workers and Node 18+.
 * Copy this file into your project.
 */

export interface VerifyResult {
	ok: boolean;
	block: boolean;
	reason?: "invalid_syntax" | "no_mx" | "disposable" | "typo_domain" | null;
	did_you_mean?: string | null;
	suggest?: boolean;
	risk?: string;
	score?: number;
	source?: string;
	mode?: string;
	error?: string;
}

export interface VerifyOptions {
	/** Worker URL, for example https://verify.example.com/ */
	url: string;
	/** Bearer token for this caller. */
	token: string;
	/** "precheck" (free, local) or "full" (default). */
	mode?: "precheck" | "full";
	/** Default 3000. */
	timeoutMs?: number;
}

const FAIL_OPEN: VerifyResult = { ok: true, block: false, error: "upstream" };

/** Calls the Worker. Never throws: on any failure or timeout it returns a fail-open result. */
export async function verifyEmail(email: string, opts: VerifyOptions): Promise<VerifyResult> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
	try {
		const res = await fetch(opts.url, {
			method: "POST",
			headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
			body: JSON.stringify(opts.mode ? { email, mode: opts.mode } : { email }),
			signal: ctrl.signal,
		});
		if (!res.ok) return { ...FAIL_OPEN };
		return (await res.json()) as VerifyResult;
	} catch {
		return { ...FAIL_OPEN };
	} finally {
		clearTimeout(timer);
	}
}

export interface Decision {
	/** false only for a hard block. */
	allow: boolean;
	/** A soft "did you mean" to show, or null. */
	suggest: string | null;
	/** Set when allow is false. */
	reason: string | null;
}

/**
 * The soft/hard rules. Hard: block is true (invalid_syntax, no_mx, disposable) and always stops.
 * Soft: a typo suggestion never stops, and is not offered again for an address the person already kept.
 */
export function decide(result: VerifyResult, ctx: { email?: string; keptFor?: string | null } = {}): Decision {
	if (result.block === true) return { allow: false, suggest: null, reason: result.reason ?? "blocked" };
	const kept = ctx.keptFor && ctx.email && ctx.keptFor.trim().toLowerCase() === ctx.email.trim().toLowerCase();
	const suggest = result.did_you_mean && (result.suggest || result.reason === "typo_domain") && !kept ? result.did_you_mean : null;
	return { allow: true, suggest, reason: null };
}
