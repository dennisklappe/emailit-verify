/*! emailit-verify client v1. Vanilla JS, no dependencies, no token. https://github.com/dennisklappe/emailit-verify */
(function (root) {
	"use strict";

	var MESSAGES = {
		en: { didYouMean: "Did you mean {suggestion}?", use: "Use {suggestion}", keep: "No, keep mine", blocked: "We cannot reach {email}, please check the address" },
		nl: { didYouMean: "Bedoelde je {suggestion}?", use: "Gebruik {suggestion}", keep: "Nee, laat zoals het is", blocked: "We kunnen {email} niet bereiken, controleer het adres" },
		de: { didYouMean: "Meinten Sie {suggestion}?", use: "{suggestion} verwenden", keep: "Nein, so lassen", blocked: "Wir können {email} nicht erreichen, bitte prüfen Sie die Adresse" },
		es: { didYouMean: "¿Quisiste decir {suggestion}?", use: "Usar {suggestion}", keep: "No, dejar el mío", blocked: "No podemos contactar con {email}, revisa la dirección" },
		fr: { didYouMean: "Vouliez-vous dire {suggestion} ?", use: "Utiliser {suggestion}", keep: "Non, garder la mienne", blocked: "Nous ne pouvons pas joindre {email}, vérifiez l'adresse" },
		sv: { didYouMean: "Menade du {suggestion}?", use: "Använd {suggestion}", keep: "Nej, behåll min", blocked: "Vi kan inte nå {email}, kontrollera adressen" },
		da: { didYouMean: "Mente du {suggestion}?", use: "Brug {suggestion}", keep: "Nej, behold min", blocked: "Vi kan ikke nå {email}, tjek adressen" },
	};

	var CSS =
		".ev-msg{margin:.35em 0 0;font:inherit;font-size:.9em}" +
		".ev-msg:empty{display:none}" +
		".ev-box{display:flex;flex-wrap:wrap;align-items:center;gap:.5em;padding:.5em .75em;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:rgba(128,128,128,.1)}" +
		".ev-text{flex:1 1 auto}" +
		".ev-btn{font:inherit;font-size:.95em;padding:.2em .6em;border:1px solid rgba(128,128,128,.5);border-radius:4px;background:transparent;color:inherit;cursor:pointer}" +
		".ev-btn:hover,.ev-btn:focus-visible{background:rgba(128,128,128,.2)}";

	var TIMEOUT_MS = 3000;
	var states = typeof WeakMap === "function" ? new WeakMap() : null;

	function fill(tpl, vars) {
		return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? "" : vars[k]; });
	}

	function injectCss() {
		if (document.getElementById("ev-style")) return;
		var s = document.createElement("style");
		s.id = "ev-style";
		s.textContent = CSS;
		document.head.appendChild(s);
	}

	function post(endpoint, email, mode, timeoutMs) {
		var ctrl = typeof AbortController === "function" ? new AbortController() : null;
		var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
		var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, timeoutMs + 50); });
		var req = fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: email, mode: mode }),
			signal: ctrl ? ctrl.signal : undefined,
		})
			.then(function (r) { return r.ok ? r.json() : null; })
			.catch(function () { return null; })
			.then(function (v) { clearTimeout(timer); return v; });
		return Promise.race([req, timeout]); // fail open: null means "no answer"
	}

	function attach(input, options) {
		options = options || {};
		var existing = states && states.get(input);
		if (existing) return existing.api;
		if (options.css !== false) injectCss();

		var lang = String(options.lang || document.documentElement.lang || "en").toLowerCase().split("-")[0];
		var msgs = Object.assign({}, MESSAGES.en, MESSAGES[lang] || {}, options.messages || {});
		var endpoint = options.endpoint || "/api/verify-email";
		var debounce = options.debounceMs == null ? 600 : options.debounceMs;

		var box = document.createElement("div");
		box.className = "ev-msg";
		box.id = "ev-msg-" + Math.random().toString(36).slice(2, 8);
		box.setAttribute("role", "status");
		box.setAttribute("aria-live", "polite");
		input.insertAdjacentElement("afterend", box);

		var st = { seq: 0, timer: null, keptFor: null, full: {}, api: null };

		function norm(v) { return String(v || "").trim(); }
		function key(v) { return norm(v).toLowerCase(); }
		function emit(state, extra) {
			if (typeof options.onState === "function") {
				try { options.onState(Object.assign({ state: state, email: norm(input.value) }, extra || {})); } catch (e) {}
			}
		}
		function clearBox() {
			box.textContent = "";
			input.removeAttribute("aria-invalid");
			input.removeAttribute("aria-describedby");
		}
		function showError(email) {
			box.textContent = "";
			var wrap = document.createElement("div");
			wrap.className = "ev-box ev-error";
			var t = document.createElement("span");
			t.className = "ev-text";
			t.textContent = fill(msgs.blocked, { email: email });
			wrap.appendChild(t);
			box.appendChild(wrap);
			input.setAttribute("aria-invalid", "true");
			input.setAttribute("aria-describedby", box.id);
		}
		function showSuggestion(email, suggestion) {
			box.textContent = "";
			input.removeAttribute("aria-invalid");
			var wrap = document.createElement("div");
			wrap.className = "ev-box ev-suggest";
			var t = document.createElement("span");
			t.className = "ev-text";
			t.textContent = fill(msgs.didYouMean, { suggestion: suggestion });
			var use = document.createElement("button");
			use.type = "button";
			use.className = "ev-btn ev-use";
			use.textContent = fill(msgs.use, { suggestion: suggestion });
			var keep = document.createElement("button");
			keep.type = "button";
			keep.className = "ev-btn ev-keep";
			keep.textContent = msgs.keep;
			use.addEventListener("click", function () {
				input.value = suggestion;
				st.keptFor = null;
				clearBox();
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
				emit("used", { suggestion: suggestion });
				input.focus();
			});
			keep.addEventListener("click", function () {
				st.keptFor = key(email);
				clearBox();
				emit("kept", { suggestion: suggestion });
				input.focus();
			});
			wrap.appendChild(t);
			wrap.appendChild(use);
			wrap.appendChild(keep);
			box.appendChild(wrap);
			input.setAttribute("aria-describedby", box.id);
		}

		function suggestionOf(res, email) {
			if (!res || res.block || !res.did_you_mean) return null;
			if (!res.suggest && res.reason !== "typo_domain") return null;
			if (st.keptFor && st.keptFor === key(email)) return null;
			return res.did_you_mean;
		}

		// Free local check. While typing only suggestions show; on blur a hard failure shows too.
		function live(fromBlur) {
			var email = norm(input.value);
			if (!email || email.indexOf("@") < 1) { clearBox(); emit("idle"); return; }
			var id = ++st.seq;
			emit("checking");
			return post(endpoint, email, "precheck", TIMEOUT_MS).then(function (res) {
				if (id !== st.seq || norm(input.value) !== email) return; // stale
				if (!res) { clearBox(); emit("idle"); return; }
				var sug = suggestionOf(res, email);
				if (sug) { showSuggestion(email, sug); emit("suggest", { suggestion: sug }); return; }
				if (res.block && fromBlur) { showError(email); emit("blocked", { reason: res.reason }); return; }
				clearBox();
				emit(st.keptFor === key(email) ? "kept" : "ok");
			});
		}

		function schedule(fromBlur) {
			clearTimeout(st.timer);
			st.timer = null;
			if (fromBlur) live(true);
			else st.timer = setTimeout(function () { live(false); }, debounce);
		}

		function onInput() {
			if (st.keptFor && st.keptFor !== key(input.value)) st.keptFor = null; // edit resets keep-mine
			st.seq++; // invalidate in-flight answers
			clearBox();
			schedule(false);
		}
		function onBlur() { schedule(true); }
		input.addEventListener("input", onInput);
		input.addEventListener("blur", onBlur);

		// For the form submit: one full check, hard blocks only.
		function check() {
			var email = norm(input.value);
			clearTimeout(st.timer);
			if (!email) return Promise.resolve({ ok: true, block: false, reason: null, suggest: null });
			var cached = st.full[key(email)];
			var p = cached ? Promise.resolve(cached) : post(endpoint, email, "full", TIMEOUT_MS);
			return p.then(function (res) {
				if (norm(input.value) !== email) return { ok: true, block: false, reason: null, suggest: null, stale: true };
				if (!res) return { ok: true, block: false, reason: null, suggest: null, error: "timeout" };
				if (!res.error) st.full[key(email)] = res;
				if (res.block === true) {
					showError(email);
					emit("blocked", { reason: res.reason });
					return { ok: false, block: true, reason: res.reason || null, suggest: null };
				}
				var sug = suggestionOf(res, email);
				if (sug) showSuggestion(email, sug);
				return { ok: true, block: false, reason: null, suggest: sug };
			});
		}

		function destroy() {
			input.removeEventListener("input", onInput);
			input.removeEventListener("blur", onBlur);
			clearTimeout(st.timer);
			box.remove();
			if (states) states.delete(input);
		}

		st.api = { check: check, destroy: destroy, element: box };
		if (states) states.set(input, st);
		return st.api;
	}

	root.EmailitVerify = {
		version: 1,
		messages: MESSAGES,
		attach: attach,
		check: function (input) {
			var st = states && states.get(input);
			if (!st) return Promise.resolve({ ok: true, block: false, reason: null, suggest: null, error: "not_attached" });
			return st.api.check();
		},
	};
})(typeof window !== "undefined" ? window : globalThis);
