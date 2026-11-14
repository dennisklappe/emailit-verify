import { describe, expect, it } from "vitest";
import { typoPrecheck } from "../src/precheck";

const fix = (email: string) => typoPrecheck(email)?.did_you_mean ?? null;

describe("typoPrecheck blocks", () => {
	const typos: [string, string][] = [
		["test@gnail.com", "test@gmail.com"],
		["test@gmial.com", "test@gmail.com"],
		["test@gmai.com", "test@gmail.com"],
		["test@gmaill.com", "test@gmail.com"],
		["test@gmail.co", "test@gmail.com"],
		["test@gmail.con", "test@gmail.com"],
		["test@gmail.cm", "test@gmail.com"],
		["test@gmail.nl", "test@gmail.com"],
		["test@gmail.xyz", "test@gmail.com"],
		["test@googlemail.nl", "test@googlemail.com"],
		["a@hotmial.com", "a@hotmail.com"],
		["a@hotmal.com", "a@hotmail.com"],
		["a@hotmail.con", "a@hotmail.com"],
		["a@hotmail.cm", "a@hotmail.com"],
		["a@hotmail.xyz", "a@hotmail.com"],
		["a@outlok.com", "a@outlook.com"],
		["a@outlook.nl", "a@outlook.com"],
		["a@outlook.con", "a@outlook.com"],
		["a@yaho.com", "a@yahoo.com"],
		["a@yahooo.com", "a@yahoo.com"],
		["a@yahoo.cm", "a@yahoo.com"],
		["a@icloud.con", "a@icloud.com"],
		["a@iclould.com", "a@icloud.com"],
		["a@ziggo.con", "a@ziggo.nl"],
		["a@kpnmial.nl", "a@kpnmail.nl"],
		["a@g-mail.com", "a@gmail.com"],
		["a@gma.il.com", "a@gmail.com"],
		["a@gmailcom", "a@gmail.com"],
		["a@hot-mail.com", "a@hotmail.com"],
		["a@www.gmail.com", "a@gmail.com"],
		["A.B+tag@GNAIL.com", "A.B+tag@gmail.com"],
	];
	it.each(typos)("%s -> %s", (input, expected) => {
		expect(fix(input)).toBe(expected);
	});
});

describe("typoPrecheck passes", () => {
	const fine = [
		"a@gmail.com", "a@googlemail.com", "a@hotmail.com", "a@hotmail.nl", "a@hotmail.co.uk", "a@outlook.com",
		"a@live.nl", "a@live.com", "a@msn.com", "a@yahoo.com", "a@yahoo.co.uk", "a@icloud.com", "a@ziggo.nl",
		"a@kpnmail.nl", "a@home.nl", "a@email.com", "a@gmx.com", "a@mail.com", "a@proton.me",
		"info@example.com", "info@acme-corp.nl", "info@outlooks.org", "a@liver.com", "a@homes.nl", "a@live.xyz",
		"a@ziggo.com", "a@hot.com", "a@yahoo.fr", "a@gmailer.com", "a@mailgun.com",
		"a@schakel.io", "a@hitify.nl", "a@klappe.dev", "a@treingeldterug.nl", "a@mymail.com", "a@gmaily.io",
	];
	it.each(fine)("%s", (email) => {
		expect(fix(email)).toBeNull();
	});
	it("no at sign is ignored", () => {
		expect(fix("nonsense")).toBeNull();
	});
});
