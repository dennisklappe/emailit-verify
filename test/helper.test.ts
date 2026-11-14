import { afterEach, describe, expect, it, vi } from "vitest";
import { decide, verifyEmail } from "../src/helper";

afterEach(() => vi.restoreAllMocks());

describe("decide", () => {
	it("hard block stops, even after keep mine", () => {
		expect(decide({ ok: false, block: true, reason: "no_mx", did_you_mean: "a@gmail.com" }, { email: "a@gnail.com", keptFor: "a@gnail.com" })).toEqual({ allow: false, suggest: null, reason: "no_mx" });
	});
	it("a soft suggestion allows and suggests", () => {
		expect(decide({ ok: true, block: false, reason: "typo_domain", suggest: true, did_you_mean: "a@gmail.com" }, { email: "a@gnail.com" })).toEqual({ allow: true, suggest: "a@gmail.com", reason: null });
	});
	it("does not suggest again for a kept address (case-insensitive), does for an edited one", () => {
		const r = { ok: true, block: false, reason: "typo_domain" as const, suggest: true, did_you_mean: "a@gmail.com" };
		expect(decide(r, { email: "A@gnail.com", keptFor: "a@gnail.com" }).suggest).toBeNull();
		expect(decide(r, { email: "b@gnail.com", keptFor: "a@gnail.com" }).suggest).toBe("a@gmail.com");
	});
	it("a clean result passes", () => {
		expect(decide({ ok: true, block: false })).toEqual({ allow: true, suggest: null, reason: null });
	});
});

describe("verifyEmail", () => {
	it("sends the token and mode, returns the Worker answer", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, block: false })));
		const r = await verifyEmail("a@b.co", { url: "https://v.example.com/", token: "t", mode: "precheck" });
		expect(r).toEqual({ ok: true, block: false });
		const init = f.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
		expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", mode: "precheck" });
	});
	it("fails open on error, bad status and timeout", async () => {
		const open = { ok: true, block: false, error: "upstream" };
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("x"));
		expect(await verifyEmail("a@b.co", { url: "u", token: "t" })).toEqual(open);
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no", { status: 401 }));
		expect(await verifyEmail("a@b.co", { url: "u", token: "t" })).toEqual(open);
		vi.spyOn(globalThis, "fetch").mockImplementationOnce((_u, init) => new Promise((_, rej) => (init as RequestInit).signal!.addEventListener("abort", () => rej(new Error("a")))));
		expect(await verifyEmail("a@b.co", { url: "u", token: "t", timeoutMs: 20 })).toEqual(open);
	});
});
