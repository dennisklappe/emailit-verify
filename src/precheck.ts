/**
 * Local typo precheck: catches misspelled or wrong-TLD versions of popular mail providers
 * before Emailit is called (no credits spent). Conservative on purpose: it only fires when the
 * domain is not a real provider domain and is an exact known typo, a wrong TLD on a big provider
 * label, a dot/dash variant, or one edit away from a popular label (labels of 5+ characters).
 */

/** Real TLD groups per provider label. The first entry is the preferred correction. */
const PROVIDERS: Record<string, string[]> = {
	gmail: ["com"],
	googlemail: ["com"],
	hotmail: ["com", "nl", "co.uk", "fr", "de", "it", "es", "be"],
	outlook: ["com", "fr", "de", "es", "it", "be"],
	live: ["com", "nl", "fr", "be", "de", "it", "co.uk"],
	msn: ["com"],
	yahoo: ["com", "nl", "fr", "de", "it", "es", "co.uk", "co.jp"],
	icloud: ["com"],
	ziggo: ["nl"],
	kpnmail: ["nl"],
	home: ["nl"],
};

/** Providers whose label with any other TLD is treated as a typo (big, unambiguous brands). */
const TLD_RULE = new Set(["gmail", "googlemail", "hotmail", "outlook", "yahoo", "icloud"]);

/** Labels one edit away from a popular label that are real, different services. */
const LOOKALIKE_ALLOW = new Set(["email.com", "gmx.com"]);

/** Explicit misspellings. */
const EXPLICIT: Record<string, string> = {
	"gnail.com": "gmail.com",
	"gmial.com": "gmail.com",
	"gmai.com": "gmail.com",
	"gmaul.com": "gmail.com",
	"gmal.com": "gmail.com",
	"gmail.co": "gmail.com",
	"gmail.con": "gmail.com",
	"gmail.cm": "gmail.com",
	"gmail.nl": "gmail.com",
	"gmail.om": "gmail.com",
	"gmil.com": "gmail.com",
	"gamil.com": "gmail.com",
	"hotmial.com": "hotmail.com",
	"hotmai.com": "hotmail.com",
	"hotmil.com": "hotmail.com",
	"hotmail.con": "hotmail.com",
	"hotmail.cm": "hotmail.com",
	"outlok.com": "outlook.com",
	"outloo.com": "outlook.com",
	"outlook.con": "outlook.com",
	"yaho.com": "yahoo.com",
	"yahooo.com": "yahoo.com",
	"yahoo.con": "yahoo.com",
	"iclod.com": "icloud.com",
	"icloud.con": "icloud.com",
	"ziggo.con": "ziggo.nl",
	"ziggo.nll": "ziggo.nl",
};

const REAL = new Set<string>();
for (const [label, tlds] of Object.entries(PROVIDERS)) for (const t of tlds) REAL.add(`${label}.${t}`);
const COLLAPSED = new Map<string, string>();
for (const d of REAL) COLLAPSED.set(d.replace(/[.-]/g, ""), d);

/** Edit distance 1 including adjacent transposition (Damerau, restricted). */
function withinOneEdit(a: string, b: string): boolean {
	if (a === b) return false;
	if (Math.abs(a.length - b.length) > 1) return false;
	if (a.length === b.length) {
		const diff: number[] = [];
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
		if (diff.length === 1) return true;
		return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
	}
	const [s, l] = a.length < b.length ? [a, b] : [b, a];
	let i = 0;
	while (i < s.length && s[i] === l[i]) i++;
	return s.slice(i) === l.slice(i + 1);
}

/** Returns the corrected domain, or null when the domain looks fine (or is not recognisably a typo). */
export function correctDomain(domainIn: string): string | null {
	let domain = domainIn.trim().toLowerCase().replace(/\.$/, "");
	if (domain.startsWith("www.") && REAL.has(domain.slice(4))) return domain.slice(4);
	if (REAL.has(domain) || LOOKALIKE_ALLOW.has(domain)) return null;
	if (EXPLICIT[domain]) return EXPLICIT[domain];

	// Missing, extra or dash variants of a real domain: g-mail.com, gma.il.com, gmailcom.
	const collapsed = COLLAPSED.get(domain.replace(/[.-]/g, ""));
	if (collapsed && collapsed !== domain) return collapsed;

	const dot = domain.indexOf(".");
	if (dot < 1) return null;
	const label = domain.slice(0, dot);
	const tld = domain.slice(dot + 1);

	// Popular label with a TLD the provider does not use: gmail.nl, hotmail.xyz.
	if (TLD_RULE.has(label) && !PROVIDERS[label].includes(tld)) return `${label}.${PROVIDERS[label][0]}`;

	// One edit from a popular label, same TLD group: gmial.com, hotmal.com. Short labels are never fuzzy matched.
	if (label.length >= 5) {
		for (const [pl, tlds] of Object.entries(PROVIDERS)) {
			if (pl.length >= 5 && tlds.includes(tld) && withinOneEdit(label, pl)) return `${pl}.${tld}`;
		}
	}
	return null;
}

export interface PrecheckHit {
	did_you_mean: string;
}

export function typoPrecheck(email: string): PrecheckHit | null {
	const at = email.lastIndexOf("@");
	if (at < 1) return null;
	const fixed = correctDomain(email.slice(at + 1));
	return fixed ? { did_you_mean: `${email.slice(0, at)}@${fixed}` } : null;
}

const DISPOSABLE = new Set([
	"mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "yopmail.com",
	"tempmail.com", "temp-mail.org", "trashmail.com", "throwawaymail.com", "getnada.com", "maildrop.cc", "dispostable.com",
]);

export function isDisposable(email: string): boolean {
	return DISPOSABLE.has(email.slice(email.lastIndexOf("@") + 1).toLowerCase());
}

/** Stricter local syntax check (used in precheck mode only; full mode leaves syntax to Emailit). */
export function strictSyntax(email: string): boolean {
	const at = email.lastIndexOf("@");
	if (at < 1 || at !== email.indexOf("@")) return false;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
	if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
	return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}
