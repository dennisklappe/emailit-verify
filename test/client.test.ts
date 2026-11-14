// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import clientSource from "../client/client.js?raw";
import clientV1 from "../client/client.v1.js?raw";
import { CLIENT_JS, CLIENT_V1 } from "../src/client-source";

const EV = () => (window as any).EmailitVerify;
let calls: { email: string; mode: string }[];
let responder: (email: string, mode: string) => Promise<any> | any;

const typo = { ok: true, block: false, reason: "typo_domain", suggest: true, did_you_mean: "test@gmail.com", source: "precheck" };
const fine = { ok: true, block: false, reason: null, did_you_mean: null };

beforeEach(() => {
	vi.useFakeTimers();
	document.body.innerHTML = '<form><input id="e" type="email"></form>';
	calls = [];
	responder = () => fine;
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		calls.push(body);
		const out = await responder(body.email, body.mode);
		return { ok: out !== null, json: async () => out } as Response;
	});
	(0, eval)(clientSource); // defines window.EmailitVerify
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.getElementById("ev-style")?.remove();
});

const input = () => document.getElementById("e") as HTMLInputElement;
const type = (v: string) => {
	input().value = v;
	input().dispatchEvent(new Event("input", { bubbles: true }));
};
const settle = async (ms = 700) => {
	await vi.advanceTimersByTimeAsync(ms);
};
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".ev-btn")];

describe("served source", () => {
	it("the generated Worker copy matches client/client.js (run npm run build:client)", () => {
		expect(CLIENT_JS).toBe(clientSource);
	});
	it("v1 stays frozen and available, and does not block on a pending suggestion", () => {
		expect(CLIENT_V1).toBe(clientV1);
		expect(clientV1).not.toContain("pending");
		expect(clientSource).toContain("version: 2");
	});
	it("contains no token and exposes the API", () => {
		expect(clientSource).not.toMatch(/bearer/i);
		expect(typeof EV().attach).toBe("function");
		expect(typeof EV().check).toBe("function");
		for (const l of ["nl", "en", "de", "es", "fr", "sv", "da"]) expect(EV().messages[l].didYouMean).toBeTruthy();
	});
});

describe("live typing", () => {
	it("debounces, then shows the suggestion with two buttons and aria-live", async () => {
		responder = (e) => (e.includes("gnail") ? typo : fine);
		EV().attach(input(), { endpoint: "/api/v" });
		type("test@gn");
		type("test@gnail.com");
		await settle(300);
		expect(calls).toHaveLength(0);
		await settle(400);
		expect(calls).toEqual([{ email: "test@gnail.com", mode: "precheck" }]);
		expect(document.querySelector(".ev-msg")!.getAttribute("aria-live")).toBe("polite");
		expect(document.querySelector(".ev-text")!.textContent).toBe("Did you mean test@gmail.com?");
		expect(buttons().map((b) => b.textContent)).toEqual(["Use test@gmail.com", "No, keep mine"]);
	});
	it("uses the chosen language and message overrides", async () => {
		responder = () => typo;
		EV().attach(input(), { endpoint: "/x", lang: "nl", messages: { keep: "Nee" } });
		type("test@gnail.com");
		await settle();
		expect(document.querySelector(".ev-text")!.textContent).toBe("Bedoelde je test@gmail.com?");
		expect(buttons()[1].textContent).toBe("Nee");
	});
	it("Use replaces the address", async () => {
		responder = (e) => (e.includes("gnail") ? typo : fine);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		buttons()[0].click();
		expect(input().value).toBe("test@gmail.com");
		expect(document.querySelector(".ev-box")).toBeNull();
	});
	it("ignores a stale response", async () => {
		let release!: (v: any) => void;
		responder = (e) => (e.includes("gnail") ? new Promise((r) => (release = r)) : fine);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		type("test@example.com"); // edited while the first answer is in flight
		release(typo);
		await settle(10);
		expect(document.querySelector(".ev-box")).toBeNull();
	});
	it("fails open on a network error and never shows anything", async () => {
		responder = () => null;
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		expect(document.querySelector(".ev-box")).toBeNull();
	});
	it("shows a hard failure only on blur, not while typing", async () => {
		responder = () => ({ ok: false, block: true, reason: "invalid_syntax" });
		EV().attach(input(), { endpoint: "/x" });
		type("a@@b");
		await settle();
		expect(document.querySelector(".ev-error")).toBeNull();
		input().dispatchEvent(new Event("blur"));
		await settle(10);
		expect(document.querySelector(".ev-error")!.textContent).toBe("We cannot reach a@@b, please check the address");
		expect(input().getAttribute("aria-invalid")).toBe("true");
	});
});

describe("keep mine and submit", () => {
	it("keep mine, then submit: full check passes without asking again", async () => {
		responder = (e, mode) => (mode === "precheck" || e.includes("gnail") ? typo : fine);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		buttons()[1].click();
		expect(document.querySelector(".ev-box")).toBeNull();
		const p = EV().check(input());
		await settle(10);
		const r = await p;
		expect(r).toMatchObject({ ok: true, block: false, suggest: null });
		expect(document.querySelector(".ev-box")).toBeNull();
		expect(calls.filter((c) => c.mode === "full")).toHaveLength(1);
	});
	it("editing resets keep-mine for the new address", async () => {
		responder = () => typo;
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		buttons()[1].click();
		type("other@gnail.com");
		await settle();
		expect(document.querySelector(".ev-suggest")).not.toBeNull();
	});
	it("a hard block still stops the submit after keep mine", async () => {
		responder = (_e, mode) => (mode === "full" ? { ok: false, block: true, reason: "no_mx", did_you_mean: "test@gmail.com" } : typo);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		buttons()[1].click();
		const p = EV().check(input());
		await settle(10);
		const r = await p;
		expect(r).toMatchObject({ ok: false, block: true, reason: "no_mx" });
		expect(document.querySelector(".ev-error")!.textContent).toContain("test@gnail.com");
	});
	it("check reuses its cached full answer for the same address", async () => {
		EV().attach(input(), { endpoint: "/x" });
		type("a@example.com");
		for (let i = 0; i < 2; i++) {
			const p = EV().check(input());
			await settle(10);
			await p;
		}
		expect(calls.filter((c) => c.mode === "full")).toHaveLength(1);
	});
	it("passes after the 3 second timeout", async () => {
		vi.stubGlobal("fetch", () => new Promise(() => {}));
		EV().attach(input(), { endpoint: "/x" });
		type("a@example.com");
		const p = EV().check(input());
		await settle(3200);
		expect(await p).toMatchObject({ ok: true, block: false, error: "timeout" });
	});
});

describe("pending suggestion stops the submit (v2)", () => {
	const submit = async () => {
		const p = EV().check(input());
		await settle(10);
		return p;
	};
	const setup = async () => {
		responder = (_e, _m) => typo;
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
	};

	it("returns pending, focuses Use, highlights it and announces, on every attempt", async () => {
		await setup();
		const box = () => document.querySelector(".ev-suggest") as HTMLElement;
		const scroll = vi.fn();
		box().scrollIntoView = scroll;
		for (let attempt = 1; attempt <= 3; attempt++) {
			const r = await submit();
			expect(r).toMatchObject({ ok: false, pending: "suggestion", suggest: "test@gmail.com" });
			expect(box().classList.contains("ev-attn")).toBe(true);
			expect(document.activeElement).toBe(document.querySelector(".ev-use"));
			expect(document.querySelector(".ev-use")!.classList.contains("ev-primary")).toBe(true);
			await settle(50);
			expect(document.querySelector(".ev-sr")!.textContent).toBe("Please choose: use test@gmail.com or keep your address");
			expect(scroll).toHaveBeenCalledTimes(attempt);
			await settle(1000);
			expect(box().classList.contains("ev-attn")).toBe(false); // animation class is removed, so the next attempt replays it
		}
	});
	it("the first submit before the live check answered is also stopped", async () => {
		responder = (_e, mode) => (mode === "full" ? typo : fine);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		const r = await submit(); // no debounce elapsed yet
		expect(r).toMatchObject({ ok: false, pending: "suggestion" });
		expect(document.querySelector(".ev-suggest")).not.toBeNull();
	});
	it("keep mine, then submit passes", async () => {
		await setup();
		await submit();
		(document.querySelector(".ev-keep") as HTMLButtonElement).click();
		expect(await submit()).toMatchObject({ ok: true });
		expect(document.querySelector(".ev-suggest")).toBeNull();
	});
	it("use replaces the address and the submit passes", async () => {
		responder = (e) => (e.includes("gnail") ? typo : fine);
		EV().attach(input(), { endpoint: "/x" });
		type("test@gnail.com");
		await settle();
		(document.querySelector(".ev-use") as HTMLButtonElement).click();
		await settle();
		expect(input().value).toBe("test@gmail.com");
		expect(await submit()).toMatchObject({ ok: true });
	});
	it("editing the address resets the pending state", async () => {
		await setup();
		await submit();
		type("other@example.com");
		responder = () => fine;
		await settle();
		expect(await submit()).toMatchObject({ ok: true });
	});
	it("uses a full-border highlight and no side or top accent bar in the css", () => {
		const css = clientSource.match(/\.ev-box\.ev-attn\{[^}]*\}/)![0];
		expect(css).toContain("box-shadow:0 0 0 2px");
		expect(clientSource).not.toMatch(/border-(left|top|inline-start|block-start)\s*:/);
		expect(clientSource).toContain("prefers-reduced-motion:reduce");
	});
});
