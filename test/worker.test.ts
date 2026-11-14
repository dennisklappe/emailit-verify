import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const TOKEN = "a".repeat(40);
const env = (extra: Partial<Env> = {}): Env => ({
	EMAILIT_API_KEY: "key_test",
	TOKENS: JSON.stringify({ alpha: TOKEN, beta: "b".repeat(40) }),
	...extra,
});
const ctx = { waitUntil: (p: Promise<unknown>) => void p } as unknown as ExecutionContext;
const call = (body: unknown, token: string | null = TOKEN, e: Env = env(), method = "POST") =>
	worker.fetch(
		new Request("https://verify.example.com/", {
			method,
			headers: token ? { authorization: `Bearer ${token}` } : {},
			body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
		}),
		e,
		ctx,
	);

const emailit = (checks: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
	new Response(JSON.stringify({ score: 100, risk: "low", did_you_mean: null, checks: { valid_syntax: true, has_mx_records: true, disposable: false, role_account: false, ...checks }, ...extra }));

afterEach(() => vi.restoreAllMocks());

describe("auth", () => {
	it("401 without or with a bad token", async () => {
		expect((await call({ email: "a@b.co" }, null)).status).toBe(401);
		expect((await call({ email: "a@b.co" }, "wrong")).status).toBe(401);
	});
	it("accepts every configured token", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => emailit({}));
		expect((await call({ email: "a@b.co" }, "b".repeat(40))).status).toBe(200);
	});
	it("503 when not configured", async () => {
		expect((await call({ email: "a@b.co" }, TOKEN, env({ TOKENS: "" }))).status).toBe(503);
	});
});

describe("verification", () => {
	it("passes a normal address and sends the full key upstream", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(emailit({}));
		const r = await (await call({ email: "Me@Gmail.com" })).json();
		expect(r).toEqual({ ok: true, block: false, reason: null, did_you_mean: null, risk: "low", score: 100 });
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.emailit.com/v2/email-verifications");
		expect((init.headers as Record<string, string>).authorization).toBe("Bearer key_test");
		expect(JSON.parse(init.body as string)).toEqual({ email: "me@gmail.com" });
	});
	it("blocks invalid syntax, missing MX and disposable", async () => {
		const cases: [Record<string, unknown>, string][] = [
			[{ valid_syntax: false }, "invalid_syntax"],
			[{ has_mx_records: false }, "no_mx"],
			[{ disposable: true }, "disposable"],
		];
		for (const [checks, reason] of cases) {
			vi.spyOn(globalThis, "fetch").mockResolvedValue(emailit(checks));
			const r: any = await (await call({ email: "a@b.co" })).json();
			expect(r).toMatchObject({ ok: false, block: true, reason });
		}
	});
	it("does not block role accounts and returns did_you_mean unchanged", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(emailit({ role_account: true }, { did_you_mean: "test@gmail.com" }));
		const r: any = await (await call({ email: "test@gnail.com" })).json();
		expect(r).toMatchObject({ ok: true, block: false, did_you_mean: "test@gmail.com", score: 100 });
	});
	it("rejects garbage without calling upstream", async () => {
		const f = vi.spyOn(globalThis, "fetch");
		const r: any = await (await call({ email: "not-an-email" })).json();
		expect(r).toMatchObject({ block: true, reason: "invalid_syntax" });
		expect(f).not.toHaveBeenCalled();
	});
	it("400 on bad body", async () => {
		expect((await call("{nope")).status).toBe(400);
		expect((await call({ email: 5 })).status).toBe(400);
	});
	it("405 on GET", async () => {
		expect((await call(null, TOKEN, env(), "GET")).status).toBe(405);
	});
});

describe("fail open", () => {
	it("on upstream error status", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 403 }));
		expect(await (await call({ email: "a@b.co" })).json()).toEqual({ ok: true, block: false, error: "upstream" });
	});
	it("on network failure", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
		const res = await call({ email: "a@b.co" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, block: false, error: "upstream" });
	});
	it("on timeout (3s abort)", async () => {
		const real = globalThis.setTimeout;
		let delay = 0;
		vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
			delay = ms ?? 0;
			return real(fn, 0);
		}) as typeof setTimeout);
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_u, init) => new Promise((_, rej) => (init as RequestInit).signal!.addEventListener("abort", () => rej(new Error("aborted")))),
		);
		expect(await (await call({ email: "a@b.co" })).json()).toEqual({ ok: true, block: false, error: "upstream" });
		expect(delay).toBe(3000);
	});
});

describe("cache", () => {
	const kv = () => {
		const m = new Map<string, string>();
		return {
			m,
			ns: {
				get: async (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : null),
				put: async (k: string, v: string) => void m.set(k, v),
			} as unknown as KVNamespace,
		};
	};
	it("second call is served from KV, upstream errors are not cached", async () => {
		const { m, ns } = kv();
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(emailit({}));
		await call({ email: "a@b.co" }, TOKEN, env({ CACHE: ns }));
		await call({ email: "A@B.co" }, TOKEN, env({ CACHE: ns }));
		expect(f).toHaveBeenCalledTimes(1);
		expect(m.size).toBe(1);

		const k2 = kv();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
		await call({ email: "c@d.co" }, TOKEN, env({ CACHE: k2.ns }));
		expect(k2.m.size).toBe(0);
	});
});
