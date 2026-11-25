import type { LogSdk } from "../core/types.js";
import { parse, HTMLElement, Node } from "node-html-parser";

type RawAttrDetail = { value: string; quote: '"' | "'" | "" };
type Spans = { starts: number[]; ends: number[] };

// Moved from src/payloadGenerator.ts (original location) for modularization.
// NOTE: Keep default export name stable for existing imports via shim.
const ResponseBodyPayloadGenerator = class {
	root: HTMLElement | Node;
	body = "";

	constructor(html: string) {
		this.body = html;
		this.root = parse(html, {
			comment: true,
			blockTextElements: {
				script: true,
				style: true,
				pre: true,
			},
		});
	}

	// ---------- Per-instance caches ----------
	// The parsed DOM and body are never modified after construction, so element lists,
	// decoded attributes, lowercased sources and JS quote state are computed once and reused
	// across the generate()/detect() calls made on one response.
	private _nodeList?: any[];
	private _textNodeList?: Array<{ raw: string | undefined; tag: string }>;
	private _selectorCache = new Map<string, any[]>();
	private _execScriptList?: any[];
	private _attrCache = new WeakMap<object, Record<string, string>>();
	private _rawAttrCache = new WeakMap<object, Map<string, RawAttrDetail | null>>();
	private _rawAttrRegexes = new Map<string, RegExp>();
	private _textCache = new WeakMap<object, unknown>();
	private _innerLowerCache = new WeakMap<object, string>();
	private _lowerCache = new Map<string, string>();
	private _quoteOpenTables = new Map<string, Int32Array>();
	private _bodyLowerCache?: string;
	private _tagSpanCache?: Spans;
	private _handlerSpanCache?: Spans;

	// All nodes in document order (pre-order, the order a recursive walk visits them).
	private _nodes(): any[] {
		if (this._nodeList) return this._nodeList;
		const out: any[] = [];
		const walk = (node: any): void => {
			out.push(node);
			const kids = node.childNodes as any[] | undefined;
			if (Array.isArray(kids)) {
				for (const child of kids) walk(child);
			}
		};
		walk(this.root);
		this._nodeList = out;
		return out;
	}

	// Text nodes with their raw (undecoded) text and parent tag, in document order.
	private _textNodes(): Array<{ raw: string | undefined; tag: string }> {
		if (this._textNodeList) return this._textNodeList;
		const out: Array<{ raw: string | undefined; tag: string }> = [];
		for (const n of this._nodes()) {
			const isText = n.nodeType === 3 || n.constructor?.name === "TextNode";
			if (!isText) continue;
			const parent = n.parentNode as any | undefined;
			const tag = parent?.rawTagName ? String(parent.rawTagName).toUpperCase() : "";
			// rawText, not the entity-decoded text: "&lt;" in the source is not a literal "<".
			out.push({ raw: n.rawText ?? n.text, tag });
		}
		this._textNodeList = out;
		return out;
	}

	private _select(selector: string): any[] {
		let els = this._selectorCache.get(selector);
		if (!els) {
			els = ((this.root as any).querySelectorAll?.(selector) ?? []) as any[];
			this._selectorCache.set(selector, els);
		}
		return els;
	}

	private _execScripts(): any[] {
		if (!this._execScriptList) {
			this._execScriptList = this._select("script").filter((el) =>
				this._isJsExecutableScriptType((el.getAttribute?.("type") || "").toString())
			);
		}
		return this._execScriptList;
	}

	// Decoded attributes (node-html-parser re-decodes them on every `attributes` access).
	private _attrsOf(el: any): Record<string, string> {
		let attrs = this._attrCache.get(el);
		if (!attrs) {
			attrs = el.attributes || {};
			this._attrCache.set(el, attrs!);
		}
		return attrs!;
	}

	// Entity-decoded node text (node-html-parser decodes on every `text` access).
	private _textOf(node: any): unknown {
		if (!this._textCache.has(node)) this._textCache.set(node, node.text);
		return this._textCache.get(node);
	}

	private _lower(s: string): string {
		let lc = this._lowerCache.get(s);
		if (lc === undefined) {
			lc = s.toLowerCase();
			this._lowerCache.set(s, lc);
		}
		return lc;
	}

	private _bodyLower(): string {
		if (this._bodyLowerCache === undefined) this._bodyLowerCache = this.body.toLowerCase();
		return this._bodyLowerCache;
	}

	// For each position i in src: the index of the JS string quote open before src[i], or
	// -1 in code position. Backslash escapes only inside a string; outside a string any of
	// " ' ` opens one, and only the same char closes it.
	private _quoteOpenTable(src: string): Int32Array {
		let table = this._quoteOpenTables.get(src);
		if (table) return table;
		table = new Int32Array(src.length + 1);
		let open = -1;
		let escaped = false;
		for (let i = 0; i < src.length; i++) {
			table[i] = open;
			const ch = src[i];
			if (escaped) { escaped = false; continue; }
			if (open !== -1) {
				if (ch === "\\") { escaped = true; continue; }
				if (ch === src[open]) open = -1;
			} else if (ch === '"' || ch === "'" || ch === "`") {
				open = i;
			}
		}
		table[src.length] = open;
		this._quoteOpenTables.set(src, table);
		return table;
	}

	// Start/end of every regex match region in the body, for "is this marker occurrence
	// inside any region" queries. Regions are found left to right and their ends never
	// decrease, so the last region starting at or before a position has the furthest end.
	private static _spansContain(spans: Spans, body: string, marker: string): boolean {
		if (spans.starts.length === 0) return false;
		if (marker.length === 0) return true; // "" is inside every region
		let pos = body.indexOf(marker);
		while (pos !== -1) {
			let lo = 0, hi = spans.starts.length - 1, last = -1;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (spans.starts[mid] <= pos) { last = mid; lo = mid + 1; } else hi = mid - 1;
			}
			if (last !== -1 && pos + marker.length <= spans.ends[last]) return true;
			pos = body.indexOf(marker, pos + 1);
		}
		return false;
	}

	// Each start tag "<name ..." up to its first ">" (inclusive).
	private _tagSpans(): Spans {
		if (this._tagSpanCache) return this._tagSpanCache;
		const spans: Spans = { starts: [], ends: [] };
		const tagRe = /<[a-z][a-z0-9]*\s/gi;
		let tm;
		while ((tm = tagRe.exec(this.body)) !== null) {
			const tagEnd = this.body.indexOf('>', tm.index);
			if (tagEnd === -1) continue;
			spans.starts.push(tm.index);
			spans.ends.push(tagEnd + 1);
		}
		this._tagSpanCache = spans;
		return spans;
	}

	// Each on*= attribute value region: up to the tag's ">" (exclusive), else 500 chars.
	private _handlerSpans(): Spans {
		if (this._handlerSpanCache) return this._handlerSpanCache;
		const spans: Spans = { starts: [], ends: [] };
		const re = /\bon[a-z]+\s*=\s*/gi;
		let m;
		while ((m = re.exec(this.body)) !== null) {
			const start = m.index + m[0].length;
			const tagEnd = this.body.indexOf('>', start);
			spans.starts.push(start);
			spans.ends.push(start + (tagEnd === -1 ? 500 : tagEnd - start));
		}
		this._handlerSpanCache = spans;
		return spans;
	}

	// ---------- Utilities ----------

	// Script/style source is never element text: those contexts are detected separately,
	// so their raw content must not count here even when the caller excludes nothing.
	private static _NEVER_TEXT = ["SCRIPT", "STYLE"];

	private _containsTextOutsideTags(marker: string, exclude: string[] = ["SCRIPT", "STYLE"]): boolean {
		const skip = new Set([...exclude, ...ResponseBodyPayloadGenerator._NEVER_TEXT]);
		let found = false;
		for (const { raw, tag } of this._textNodes()) {
			if (!skip.has(tag) && raw?.includes(marker)) { found = true; break; }
		}
		if (!found && this.body.includes(marker)) {
			found = !this._noTextOccurrence(marker, Array.from(skip));
		}
		return found;
	}

	// True when no occurrence of the marker is page text: each one sits inside an excluded
	// element (script/style/...) or -- for a "<" marker -- inside a start tag's attribute
	// value, where a raw "<" cannot open a tag. Other chars (notably quotes) inside a value
	// can still end it, so they keep counting.
	private _noTextOccurrence(marker: string, exclude: string[]): boolean {
		const bodyLC = this._bodyLower();
		const markerLC = marker.toLowerCase();
		// Lowercasing can change length for some non-ASCII chars; only then are bodyLC
		// offsets unusable as body offsets for the attribute-value check.
		const checkAttrValue = marker.includes("<") && bodyLC.length === this.body.length;
		let pos = bodyLC.indexOf(markerLC);
		while (pos !== -1) {
			const where = checkAttrValue ? this._tagPositionAt(pos) : "text";
			const inAttrValue = where === "quoted" || where === "unquoted";
			if (!inAttrValue && !this._insideElement(bodyLC, pos, exclude)) return false;
			pos = bodyLC.indexOf(markerLC, pos + 1);
		}
		return true;
	}

	private _insideElement(bodyLC: string, pos: number, tags: string[]): boolean {
		for (const tag of tags) {
			const lastOpen = bodyLC.lastIndexOf(`<${tag.toLowerCase()}`, pos);
			if (lastOpen === -1) continue;
			const lastClose = bodyLC.lastIndexOf(`</${tag.toLowerCase()}>`, pos);
			if (lastClose < lastOpen) return true;
		}
		return false;
	}

	private _htmlEntityDecode(s: string): string {
		return s
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&amp;/gi, "&")
			.replace(/&#(\d+);/g, (_: string, d: string) => String.fromCharCode(parseInt(d, 10)))
			.replace(/&#x([0-9a-f]+);/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
	}

	private _jsEscapeDecode(s: string): string {
		return s
			// \xNN
			.replace(/\\x([0-9a-f]{2})/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
			// \uNNNN and \u{N}
			.replace(/\\u\{([0-9a-f]+)\}/gi, (_: string, h: string) => String.fromCodePoint(parseInt(h, 16)))
			.replace(/\\u([0-9a-f]{4})/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
			// octal \NN or \NNN (0–377)
			.replace(/\\([0-3]?[0-7]{1,2})/g, (_: string, o: string) => String.fromCharCode(parseInt(o, 8)));
	}

	private _uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }

	private _isJsExecutableScriptType(t?: string | null): boolean {
		if (!t) return true; // no type => JS by default
		const v = t.toLowerCase().trim();
		return (
			v === "text/javascript" ||
			v === "application/javascript" ||
			v === "module" ||
			v === "application/ecmascript" ||
			v === "text/ecmascript"
		);
	}

	private _variantsOf(s: string): string[] {
		let urlDec = s;
		try { urlDec = decodeURIComponent(s); } catch { }
		const htmlDec = this._htmlEntityDecode(urlDec);
		const jsDec = this._jsEscapeDecode(urlDec);
		const htmlJsDec = this._jsEscapeDecode(htmlDec);
		return this._uniq([s, urlDec, htmlDec, jsDec, htmlJsDec]);
	}


	/**
	 * Escape a string so it can be safely embedded as a literal inside a RegExp pattern.
	 */
	private static _escapeRegexLiteral(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private _getRawAttrDetail(el: HTMLElement, name: string): RawAttrDetail | null {
		let byName = this._rawAttrCache.get(el);
		if (!byName) {
			byName = new Map();
			this._rawAttrCache.set(el, byName);
		}
		let detail = byName.get(name);
		if (detail === undefined) {
			detail = this._parseRawAttrDetail(el, name);
			byName.set(name, detail);
		}
		return detail;
	}

	private _parseRawAttrDetail(el: HTMLElement, name: string): RawAttrDetail | null {
		const raw = (el as any).rawAttrs as string | undefined;
		if (!raw) return null;
		let re = this._rawAttrRegexes.get(name);
		if (!re) {
			re = new RegExp(
				`(?:^|\\s)${ResponseBodyPayloadGenerator._escapeRegexLiteral(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
				"i"
			);
			this._rawAttrRegexes.set(name, re);
		}
		const m = raw.match(re);
		if (!m) return null;
		if (m[1] !== undefined) return { value: m[1], quote: '"' };
		if (m[2] !== undefined) return { value: m[2], quote: "'" };
		return { value: m[3], quote: "" };
	}

	// Quote chars enclosing the (non-overlapping) occurrences of value in text.
	private _getQuoteInfo(text: string, value: string): string[] {
		const res = new Set<string>();
		const table = this._quoteOpenTable(text);
		let startIndex = 0;
		while (startIndex < text.length) {
			const index = text.indexOf(value, startIndex);
			if (index === -1) break;
			if (table[index] !== -1) res.add(text[table[index]]);
			startIndex = index + value.length;
		}
		return Array.from(res);
	}

	isInScriptOutsideString(needle: string): boolean {
		for (const el of this._execScripts()) {
			const src: string = typeof el.rawText === "string"
				? el.rawText
				: (typeof el.text === "string" ? el.text : "");
			if (!src) continue;
			let pos = -1;
			while ((pos = src.indexOf(needle, pos + 1)) !== -1) {
				if (!this._isInsideJsQuotedStringAt(src, pos)) return true;
			}
		}
		return false;
	}

	private _isInsideJsQuotedStringAt(src: string, idxStart: number): boolean {
		return this._jsQuoteOpenAt(src, idxStart).quote !== null;
	}

	// Delimiter of the JS string enclosing src[idxStart] and the index of its opening quote
	// (null / -1 in code position).
	private _jsQuoteOpenAt(src: string, idxStart: number): { quote: '"' | "'" | "`" | null; open: number } {
		const open = this._quoteOpenTable(src)[Math.max(0, Math.min(idxStart, src.length))];
		return { quote: open === -1 ? null : (src[open] as '"' | "'" | "`"), open };
	}

	// True when a probed quote char lands, in every executable-script occurrence, inside a
	// JS string delimited by a DIFFERENT quote that was already open before the probe value
	// began (`batchStartPrefix` = first marker of the probe batch). Such a quote cannot end
	// its string. A string opened by the probe's own earlier chars does not count -- those
	// markers are really in the reflection's original context.
	public isQuoteInertInScript(batchStartPrefix: string, prefix: string, quote: string, suffix: string): boolean {
		const marker = prefix + quote + suffix;
		let sawInert = false;
		for (const el of this._execScripts()) {
			const src: string = typeof el.rawText === "string" ? el.rawText : "";
			let pos = src.indexOf(marker);
			while (pos !== -1) {
				const { quote: enclosing, open } = this._jsQuoteOpenAt(src, pos + prefix.length);
				const batchStart = src.lastIndexOf(batchStartPrefix, pos);
				const preExisting = batchStart !== -1 && open !== -1 && open < batchStart;
				if (enclosing === null || enclosing === quote || !preExisting) return false;
				sawInert = true;
				pos = src.indexOf(marker, pos + 1);
			}
		}
		return sawInert;
	}

	private _isPayloadInSpecifiedContext(tagName: string, marker: string, inquote: boolean): boolean {
		let nodes: any[] = [];
		const lower = tagName.toLowerCase();
		if (lower === "script") {
			nodes = this._execScripts();
		} else {
			nodes = this._select(tagName);
		}
		const variants = new Set<string>();
		const expandBackslashes = (s: string, depth: number) => {
			let out = s;
			for (let i = 0; i < depth; i++) out = out.replace(/\\/g, "\\\\");
			return out;
		};
		const addQuoteEscapes = (s: string) => {
			const out = new Set<string>([s]);
			for (const q of ['"', "'", "`"]) {
				if (s.includes(q)) {
					const esc = s.split(q).join("\\" + q);
					out.add(esc);
				}
			}
			return Array.from(out);
		};
		let seeds = addQuoteEscapes(marker);
		seeds.push(marker.replace(/\\/g, "\\\\"));
		for (const seed of seeds) {
			for (let d = 0; d <= 3; d++) variants.add(expandBackslashes(seed, d));
		}
		for (const el of nodes) {
			const src: string = typeof (el as any).rawText === "string"
				? (el as any).rawText
				: typeof (el as any).text === "string"
					? (el as any).text
					: "";
			if (!src) continue;
			const srcLC = this._lower(src);
			if (inquote) {
				for (const cand of variants) {
					const candLC = cand.toLowerCase();
					let pos = -1,
						tries = 0;
					while ((pos = srcLC.indexOf(candLC, pos + 1)) !== -1) {
						tries++;
						if (this._isInsideJsQuotedStringAt(src, pos)) return true;
						if (tries > 20) break;
					}
				}
			} else {
				for (const cand of variants) {
					if (srcLC.includes(cand.toLowerCase())) return true;
				}
				if (lower === "template") {
					const inner = this._innerLower(el);
					if (inner) {
						for (const cand of variants) {
							if (inner.includes(cand.toLowerCase())) return true;
						}
					}
				}
			}
		}
		return false;
	}

	private _innerLower(el: any): string {
		let inner = this._innerLowerCache.get(el);
		if (inner === undefined) {
			inner = typeof el.innerHTML === "string" ? el.innerHTML.toLowerCase() : "";
			this._innerLowerCache.set(el, inner!);
		}
		return inner!;
	}

	public detect(
		sdk: LogSdk,
		context: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string
	): Array<{ char: string; context: string }> {
		const res: Array<{ char: string; context: string }> = [];
		sdk.console.log(`[Reflector++] Detecting payload: prefix=${JSON.stringify(prefix)} payload=${JSON.stringify(payload)} suffix=${JSON.stringify(suffix)} in contexts: ${context.context.join(", ")}`);
		// Maintain original ordering – each helper may append to results.
		this._detectAttributeQuotePayload(sdk, context, prefix, payload, suffix, res);
		this._detectJsInQuote(sdk, context, prefix, payload, suffix, res);
		this._detectCssInQuote(sdk, context, prefix, payload, suffix, res);
		this._detectSlashSpaceGt(sdk, context, prefix, payload, suffix, res);
		this._detectLessThanPayload(context, prefix, payload, suffix, res);
		this._detectBackslashOrEmpty(context, prefix, payload, suffix, res);
		this._detectSpecializedPayload(context, prefix, payload, suffix, res);
		return res;
	}

	// ------- detect() helper breakdown -------
	private _detectAttributeQuotePayload(
		sdk: any,
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		// URL/srcset/meta-refresh values live inside a quoted attribute too, so an
		// enclosing-quote breakout there is the same generic tag-attribute escape. Run
		// the check for them as well, not only for a plain quoted attribute.
		const quoteAttrContexts = ["attributeInQuote", "urlAttrInQuote", "srcsetUrlInQuote", "metaRefresh"];
		if (!(quoteAttrContexts.some((c) => ctx.context.includes(c)) && (payload === '"' || payload === "'"))) return;
		sdk.console.log(`\[Reflector++] checking [${payload}] is reflected in quoted attribute`);
		const allEls = this._select("*") as HTMLElement[];
		let found = false;
		for (let i = 0; i < allEls.length && !found; i++) {
			const el = allEls[i];
			const attrs: Record<string, string> = this._attrsOf(el);
			for (const name in attrs) {
				const raw = this._getRawAttrDetail(el, name);
				if (!raw) continue;
				const marker = prefix + payload + suffix;
				if (raw.value.includes(marker)) {
					// Only the ENCLOSING quote breaks out of the attribute; the other quote
					// reflects inertly inside the value and must not count as a breakout.
					if (payload === raw.quote) {
						sdk.console.log(`\[Reflector++] found enclosing-quote [${payload}] breakout in quoted attribute`);
						out.push({ char: payload, context: "attributeInQuote" });
					}
					found = true;
					break;
				}
				const decoded = attrs[name];
				if (typeof decoded === "string" && decoded.includes(marker))
					out.push({ char: payload, context: "attributeEscaped" });
			}
		}
		if (!found) {
			const marker = prefix + payload + suffix;
			if (this.body.includes(marker)) {
				out.push({ char: payload, context: "attributeInQuote" });
			}
		}
	}

	private _detectJsInQuote(
		sdk: any,
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		if (!ctx.context.includes("jsInQuote")) return;
		const marker = prefix + payload + suffix;
		try {
			sdk?.console?.log?.(
				`[Reflector++][detect] jsInQuote check: payload=${JSON.stringify(payload)} prefix=${JSON.stringify(
					prefix
				)} suffix=${JSON.stringify(suffix)} marker=${JSON.stringify(marker)}`
			);
		} catch { }
		const literalCandidates = new Set<string>();
		const escapedCandidates = new Set<string>();
		literalCandidates.add(marker);
		escapedCandidates.add(marker.replace(/\\/g, "\\\\"));
		for (const q of ['"', "'", "`"]) {
			if (marker.includes(q)) {
				const esc = marker.split(q).join("\\" + q);
				escapedCandidates.add(esc);
				escapedCandidates.add(esc.replace(/\\/g, "\\\\"));
			}
		}
		for (const base of Array.from(literalCandidates)) {
			literalCandidates.add(base.replace(/\\/g, "\\"));
		}
		for (const base of Array.from(escapedCandidates)) {
			escapedCandidates.add(base.replace(/\\/g, "\\\\\\"));
		}
		for (const lit of literalCandidates) escapedCandidates.delete(lit);
		const execScripts = this._execScripts();
		let literalMatch = false;
		let escapedMatch = false;
		const searchCandidates = (
			cands: Set<string>,
			srcs: { src: string }[]
		): boolean => {
			for (const { src } of srcs) {
				for (const cand of cands) {
					let pos = -1,
						tries = 0;
					while ((pos = src.indexOf(cand, pos + 1)) !== -1) {
						if (this._isInsideJsQuotedStringAt(src, pos)) return true;
						if (++tries > 32) break;
					}
				}
			}
			return false;
		};
		const scriptSrcs = execScripts.map((el) => ({
			src: typeof (el as any).rawText === "string"
				? (el as any).rawText
				: (typeof (el as any).text === "string" ? (el as any).text : "") || ""
		})).filter(({ src }) => src.length > 0);
		literalMatch = searchCandidates(literalCandidates, scriptSrcs);
		if (!literalMatch) {
			escapedMatch = searchCandidates(escapedCandidates, scriptSrcs);
		}
		if (!literalMatch && !escapedMatch) {
			for (const { src } of scriptSrcs) {
				const srcLC = this._lower(src);
				for (const cand of literalCandidates) {
					if (srcLC.includes(cand.toLowerCase())) {
						literalMatch = true;
						break;
					}
				}
				if (literalMatch) break;
				for (const cand of escapedCandidates) {
					if (srcLC.includes(cand.toLowerCase())) {
						escapedMatch = true;
						break;
					}
				}
				if (escapedMatch) break;
			}
		}
		sdk?.console?.log?.(`[Reflector++][detect] jsInQuote literal=${literalMatch} escaped=${escapedMatch}`);
		if (literalMatch) {
			out.push({ char: payload, context: "jsInQuote" });
		} else if (escapedMatch) {
			out.push({ char: payload, context: "jsInQuoteEscaped" });
		}
	}

	private _detectCssInQuote(
		sdk: any,
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		if (!ctx.context.includes("cssInQuote")) return;
		const marker = prefix + payload + suffix;
		sdk.console.log(
			`[Reflector++][detect] cssInQuote check: payload=${JSON.stringify(payload)} prefix=${JSON.stringify(
				prefix
			)} suffix=${JSON.stringify(suffix)} marker=${JSON.stringify(marker)}`
		);
		const hit = this._isPayloadInSpecifiedContext("style", marker, true)
			|| this._isPayloadInSpecifiedContext("style", marker, false);
		sdk.console.log(`[Reflector++][detect] cssInQuote result=${hit}`);
		if (hit) out.push({ char: payload, context: "cssInQuote" });
	}

	private _detectSlashSpaceGt(
		sdk: any,
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		if (!(payload === "/" || payload === " " || payload === ">")) return;
		sdk.console.log(`[Reflector++] checking [${payload}] is reflected`);
		const attrQuote = ctx.context.includes("attributeInQuote");
		const eventHandler = ctx.context.includes("eventHandler");
		const js = ctx.context.includes("js") || ctx.context.includes("jsInQuote");
		const css = ctx.context.includes("css") || ctx.context.includes("cssInQuote");
		const inquote = payload === "/";
		if (attrQuote) {
			sdk.console.log(`\[Reflector++] checking [${payload}] is reflected in quoted attribute`);
			const marker = prefix + payload + suffix;
			let aqFound = false;
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "attributeInQuote" });
				aqFound = true;
			}
			if (!aqFound) {
				for (const el of this._select("*")) {
					const attrs: Record<string, string> = this._attrsOf(el);
					for (const name in attrs) {
						const decoded = attrs[name];
						if (typeof decoded === "string" && decoded.includes(marker)) {
							out.push({ char: payload, context: "attributeEscaped" });
							aqFound = true;
							break;
						}
					}
					if (aqFound) break;
				}
			}
		}
		if (eventHandler) {
			const marker = prefix + payload + suffix;
			let ehFound = false;
			if (this._markerInEventHandler(marker, true)
				|| this._markerInEventHandler(marker, false)) {
				out.push({ char: payload, context: "eventHandler" });
				ehFound = true;
			}
			if (!ehFound) {
				for (const el of this._select("*")) {
					const attrs: Record<string, string> = this._attrsOf(el);
					for (const name in attrs) {
						if (!/^on/i.test(name)) continue;
						const decoded = attrs[name];
						if (typeof decoded === "string" && decoded.includes(marker)) {
							out.push({ char: payload, context: "eventHandlerEscaped" });
							ehFound = true;
							break;
						}
					}
					if (ehFound) break;
				}
			}
		}
		if (js) {
			if (this._isPayloadInSpecifiedContext("script", prefix + payload + suffix, inquote)) {
				out.push({ char: payload, context: inquote ? "jsInQuote" : "js" });
			}
		}
		if (css) {
			if (this._isPayloadInSpecifiedContext("style", prefix + payload + suffix, inquote)) {
				out.push({ char: payload, context: inquote ? "cssInQuote" : "css" });
			}
		}
		const jsonCtx = ctx.context.includes("jsonInQuote") || ctx.context.includes("json");
		if (jsonCtx) {
			const isQuoted = ctx.context.includes("jsonInQuote");
			const marker = prefix + payload + suffix;
			if (this._markerInJsonScriptBlock(marker, isQuoted)) {
				out.push({ char: payload, context: isQuoted ? "jsonInQuote" : "json" });
			}
		}
	}

	private _detectLessThanPayload(
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		if (payload !== "<") return;
		const markers = this._variantsOf(prefix + payload + suffix);
		let pushed = false;
		if (markers.some((m) => this._isPayloadInSpecifiedContext("script", m, false))) {
			out.push({ char: payload, context: "js" });
			pushed = true;
		}
		if (markers.some((m) => this._isPayloadInSpecifiedContext("style", m, false))) {
			out.push({ char: payload, context: "css" });
			pushed = true;
		}
		if (ctx.context.includes("srcdocHtmlInQuote")) {
			if (markers.some((m) => this._markerInSrcdoc(m, true))) {
				out.push({ char: payload, context: "srcdocHtmlInQuote" });
				pushed = true;
			}
		}
		if (ctx.context.includes("srcdocHtml")) {
			if (markers.some((m) => this._markerInSrcdoc(m, false))) {
				out.push({ char: payload, context: "srcdocHtml" });
				pushed = true;
			}
		}
		if (ctx.context.includes("templateHtml")) {
			const inTemplate = markers.some((m) => this._isPayloadInSpecifiedContext("template", m, false))
				|| markers.some((m) => this._markerInTemplateRaw(m));
			if (inTemplate) {
				out.push({ char: payload, context: "templateHtml" });
				pushed = true;
			}
		}
		if (ctx.context.includes("jsonInQuote")) {
			if (markers.some((m) => this._markerInJsonScriptBlock(m, true))) {
				out.push({ char: payload, context: "jsonInQuote" });
				pushed = true;
			}
		}
		if (ctx.context.includes("json") && !ctx.context.includes("jsonInQuote")) {
			if (markers.some((m) => this._markerInJsonScriptBlock(m, false))) {
				out.push({ char: payload, context: "json" });
				pushed = true;
			}
		}
		if (ctx.context.includes("rawtextElement")) {
			if (markers.some((m) => this._containsTextOutsideTags(m, []))) {
				out.push({ char: payload, context: "rawtextElement" });
				pushed = true;
			}
		}
		if (ctx.context.includes("svgContext")) {
			if (markers.some((m) => this._containsTextOutsideTags(m, []))) {
				out.push({ char: payload, context: "svgContext" });
				pushed = true;
			}
		}
		if (ctx.context.includes("mathContext")) {
			if (markers.some((m) => this._containsTextOutsideTags(m, []))) {
				out.push({ char: payload, context: "mathContext" });
				pushed = true;
			}
		}
		if (ctx.context.includes("htmlComment")) {
			if (markers.some((m) => this.body.includes(m))) {
				out.push({ char: payload, context: "htmlComment" });
				pushed = true;
			}
		}
		// A raw "<" in genuine HTML flow text is an html breakout, even when a looser
		// rawtext/comment check above already matched the same occurrence. Exclude the
		// rawtext elements (their content is not flow text) so a textarea/title-only "<"
		// stays rawtext and does not become a false html breakout.
		const flowTextExclude = ["SCRIPT", "STYLE", "TEXTAREA", "TITLE", "NOSCRIPT", "XMP", "IFRAME"];
		if (markers.some((m) => this._containsTextOutsideTags(m, flowTextExclude))) {
			out.push({ char: payload, context: "html" });
		}
	}

	private _detectBackslashOrEmpty(
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	) {
		if (!(payload === "\\" || payload === "")) return;
		const marker = prefix + payload + suffix;
		let matched = false;
		const alreadyHasJsInQuote = out.some(
			(r) => r.context === "jsInQuote" || r.context === "jsInQuoteEscaped"
		);
		if (!matched && !alreadyHasJsInQuote && ctx.context.includes("jsInQuote")) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)
				|| this._isPayloadInSpecifiedContext("script", marker, false)) {
				out.push({ char: payload, context: "jsInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("js")) {
			if (this._isPayloadInSpecifiedContext("script", marker, false)) {
				out.push({ char: payload, context: "js" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("cssInQuote")) {
			if (this._isPayloadInSpecifiedContext("style", marker, true)
				|| this._isPayloadInSpecifiedContext("style", marker, false)) {
				out.push({ char: payload, context: "cssInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("css")) {
			if (this._isPayloadInSpecifiedContext("style", marker, false)) {
				out.push({ char: payload, context: "css" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("eventHandlerAttrInQuote")) {
			if (this._markerInEventHandler(marker, true)) {
				out.push({ char: payload, context: "eventHandlerAttrInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("eventHandlerAttr")) {
			if (this._markerInEventHandler(marker, false)) {
				out.push({ char: payload, context: "eventHandlerAttr" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("urlAttrInQuote")) {
			if (this._markerInUrlAttr(marker)) {
				out.push({ char: payload, context: "urlAttrInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("urlAttr")) {
			if (this._markerInUrlAttr(marker)) {
				out.push({ char: payload, context: "urlAttr" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("cssUrl")) {
			if (this._markerInCssUrl(marker)) {
				out.push({ char: payload, context: "cssUrl" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("styleAttrInQuote")) {
			if (this._markerInStyleAttr(marker)) {
				out.push({ char: payload, context: "styleAttrInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("styleAttr")) {
			if (this._markerInStyleAttr(marker)) {
				out.push({ char: payload, context: "styleAttr" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("srcsetUrlInQuote")) {
			if (this._markerInSrcsetAttr(marker)) {
				out.push({ char: payload, context: "srcsetUrlInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("srcsetUrl")) {
			if (this._markerInSrcsetAttr(marker)) {
				out.push({ char: payload, context: "srcsetUrl" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("metaRefresh")) {
			if (this._markerInMetaRefresh(marker)) {
				out.push({ char: payload, context: "metaRefresh" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("srcdocHtmlInQuote")) {
			if (this._markerInSrcdoc(marker, true)) {
				out.push({ char: payload, context: "srcdocHtmlInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("srcdocHtml")) {
			if (this._markerInSrcdoc(marker, false)) {
				out.push({ char: payload, context: "srcdocHtml" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("jsTemplateLiteral")) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)) {
				out.push({ char: payload, context: "jsTemplateLiteral" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("importMapString")) {
			if (this._markerInImportMap(marker, true)) {
				out.push({ char: payload, context: "importMapString" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("importMap")) {
			if (this._markerInImportMap(marker, false)) {
				out.push({ char: payload, context: "importMap" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("jsonInQuote")) {
			if (this._markerInJsonScriptBlock(marker, true)) {
				out.push({ char: payload, context: "jsonInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("json")) {
			if (this._markerInJsonScriptBlock(marker, false)) {
				out.push({ char: payload, context: "json" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("attributeInQuote")) {
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "attributeInQuote" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("attribute")) {
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "attribute" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("rawtextElement")) {
			if (this._containsTextOutsideTags(marker, [])) {
				out.push({ char: payload, context: "rawtextElement" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("svgContext")) {
			if (this._containsTextOutsideTags(marker, [])) {
				out.push({ char: payload, context: "svgContext" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("mathContext")) {
			if (this._containsTextOutsideTags(marker, [])) {
				out.push({ char: payload, context: "mathContext" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("html")) {
			if (this._containsTextOutsideTags(marker)) {
				out.push({ char: payload, context: "html" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("htmlComment")) {
			if (this.body.includes(marker)) {
				out.push({ char: payload, context: "htmlComment" });
				matched = true;
			}
		}
		if (!matched && ctx.context.includes("templateHtml")) {
			if (this._isPayloadInSpecifiedContext("template", marker, false)
				|| this._markerInTemplateRaw(marker)) {
				out.push({ char: payload, context: "templateHtml" });
				matched = true;
			}
		}
	}

	private _detectSpecializedPayload(
		ctx: { context: string[] },
		prefix: string,
		payload: string,
		suffix: string,
		out: Array<{ char: string; context: string }>
	): void {
		if (payload === "\\" || payload === "") return;
		const marker = prefix + payload + suffix;
		const _cssUrlChars = new Set([")", "(", "//", "http:", ";", "/", ":", " ", '"', "'"]);
		if (ctx.context.includes("cssUrl") && _cssUrlChars.has(payload)) {
			if (this._markerInCssUrl(marker)) {
				out.push({ char: payload, context: "cssUrl" });
			}
		}
		const _styleChars = new Set(["(", ")", ";", ":", "'", '"', " "]);
		if (ctx.context.includes("styleAttrInQuote") && _styleChars.has(payload)) {
			if (this._markerInStyleAttr(marker)) {
				out.push({ char: payload, context: "styleAttrInQuote" });
			}
		}
		if (ctx.context.includes("styleAttr") && _styleChars.has(payload)) {
			if (this._markerInStyleAttr(marker)) {
				out.push({ char: payload, context: "styleAttr" });
			}
		}
		const _srcsetChars = new Set(['"', "'", "/", ",", " "]);
		if ((ctx.context.includes("srcsetUrlInQuote") || ctx.context.includes("srcsetUrl"))
			&& _srcsetChars.has(payload)) {
			if (this._markerInSrcsetAttr(marker)) {
				const c = ctx.context.includes("srcsetUrlInQuote")
					? "srcsetUrlInQuote" : "srcsetUrl";
				out.push({ char: payload, context: c });
			}
		}
		const _metaChars = new Set(["/", "//", "http:", ";", ":", "?", "#", '"', "<", ">"]);
		if (ctx.context.includes("metaRefresh") && _metaChars.has(payload)) {
			if (this._markerInMetaRefresh(marker)) {
				out.push({ char: payload, context: "metaRefresh" });
			}
		}
		const _srcdocChars = new Set(["<", ">", '"', "'", "&", " "]);
		if (ctx.context.includes("srcdocHtmlInQuote") && _srcdocChars.has(payload)) {
			if (this._markerInSrcdoc(marker, true)) {
				out.push({ char: payload, context: "srcdocHtmlInQuote" });
			}
		}
		if (ctx.context.includes("srcdocHtml") && _srcdocChars.has(payload)) {
			if (this._markerInSrcdoc(marker, false)) {
				out.push({ char: payload, context: "srcdocHtml" });
			}
		}
		const _jsonChars = new Set(['"', "'", ",", "}", "]", ":"]);
		if (ctx.context.includes("jsonInQuote") && _jsonChars.has(payload)) {
			if (this._markerInJsonScriptBlock(marker, true)) {
				out.push({ char: payload, context: "jsonInQuote" });
			}
		}
		if (ctx.context.includes("json") && _jsonChars.has(payload)) {
			if (this._markerInJsonScriptBlock(marker, false)) {
				out.push({ char: payload, context: "json" });
			}
		}
		const _handlerChars = new Set([";", '"', "'", "(", ")", "&", " "]);
		if (ctx.context.includes("eventHandlerAttrInQuote")
			&& _handlerChars.has(payload)) {
			if (this._markerInEventHandler(marker, true)) {
				out.push({ char: payload, context: "eventHandlerAttrInQuote" });
			}
		}
		if (ctx.context.includes("eventHandlerAttr")
			&& _handlerChars.has(payload)) {
			if (this._markerInEventHandler(marker, false)) {
				out.push({ char: payload, context: "eventHandlerAttr" });
			}
		}
		const _urlChars = new Set([":", "//", "?", "#", "&", "=", "'", '"', " "]);
		if ((ctx.context.includes("urlAttrInQuote") || ctx.context.includes("urlAttr"))
			&& _urlChars.has(payload)) {
			if (this._markerInUrlAttr(marker)) {
				const c = ctx.context.includes("urlAttrInQuote")
					? "urlAttrInQuote" : "urlAttr";
				out.push({ char: payload, context: c });
			}
		}
		const _htmlChars = new Set([">", '"', "'", "/", ";", "&"]);
		if (ctx.context.includes("html") && _htmlChars.has(payload)) {
			if (this._containsTextOutsideTags(marker)) {
				out.push({ char: payload, context: "html" });
			}
		}
		if (ctx.context.includes("htmlBaseInjection") && (payload === "<" || _htmlChars.has(payload))) {
			if (this._containsTextOutsideTags(marker)) {
				out.push({ char: payload, context: "htmlBaseInjection" });
			}
		}
		if (ctx.context.includes("domClobber")) {
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "domClobber" });
			}
		}
		if (ctx.context.includes("htmlComment") && _htmlChars.has(payload)
			|| (ctx.context.includes("htmlComment") && payload === "-")) {
			if (this.body.includes(marker)) {
				out.push({ char: payload, context: "htmlComment" });
			}
		}
		if (ctx.context.includes("templateHtml") && _htmlChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("template", marker, false)
				|| this._markerInTemplateRaw(marker)) {
				out.push({ char: payload, context: "templateHtml" });
			}
		}
		const _attrQuotedChars = new Set(["<", ">", "'", '"', "&"]);
		if (ctx.context.includes("attributeInQuote")
			&& _attrQuotedChars.has(payload)) {
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "attributeInQuote" });
			}
		}
		const _attrUnquotedChars = new Set([" ", '"', "'", ">", "<", ";", "="]);
		if (ctx.context.includes("attribute")
			&& _attrUnquotedChars.has(payload)) {
			if ((this._markerInAnyAttr(marker) || this.body.includes(marker))
				&& !this._markerOnlyInQuotedAttrValues(marker)) {
				out.push({ char: payload, context: "attribute" });
			}
		}
		if (ctx.context.includes("rawtextElement")) {
			const isClosingTag = /^<\/[a-z]+>$/i.test(payload);
			const _rawtextChars = new Set([">", "/", '"', "'", ";"]);
			if (isClosingTag || _rawtextChars.has(payload)) {
				if (this.body.includes(marker)) {
					out.push({ char: payload, context: "rawtextElement" });
				}
			}
		}
		const _svgChars = new Set(["<", ">", "/", '"', "'", ";"]);
		if (ctx.context.includes("svgContext") && _svgChars.has(payload)) {
			if (this._containsTextOutsideTags(marker, [])) {
				out.push({ char: payload, context: "svgContext" });
			}
		}
		if (ctx.context.includes("mathContext") && _svgChars.has(payload)) {
			if (this._containsTextOutsideTags(marker, [])) {
				out.push({ char: payload, context: "mathContext" });
			}
		}
		const _jsUriChars = new Set(["(", ")", ";", "'", '"', "//", "\\"]);
		if (ctx.context.includes("jsUri") && _jsUriChars.has(payload)) {
			if (this._markerInUrlAttr(marker)) {
				out.push({ char: payload, context: "jsUri" });
			}
		}
		const _dataUriChars = new Set(["/", ",", ";", "<", ">", "'", '"']);
		if (ctx.context.includes("dataUri") && _dataUriChars.has(payload)) {
			if (this._markerInUrlAttr(marker)) {
				out.push({ char: payload, context: "dataUri" });
			}
		}
		const _templateLiteralChars = new Set(["$", "{", "}", "`", "\\", "<", ">", "/", ";", "(", ")", "*"]);
		if (ctx.context.includes("jsTemplateLiteral") && _templateLiteralChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)) {
				out.push({ char: payload, context: "jsTemplateLiteral" });
			}
		}
		const _importMapChars = new Set(['"', "'", ",", "}", "]", ":", "\\"]);
		if (ctx.context.includes("importMapString") && _importMapChars.has(payload)) {
			if (this._markerInImportMap(marker, true)) {
				out.push({ char: payload, context: "importMapString" });
			}
		}
		if (ctx.context.includes("importMap") && _importMapChars.has(payload)) {
			if (this._markerInImportMap(marker, false)) {
				out.push({ char: payload, context: "importMap" });
			}
		}
		const _jsChars = new Set(["<", ">", "/", ";", "'", '"', "`", "(", ")", "{", "}", "*"]);
		const alreadyHasJsInQuote = out.some(
			(r) => r.context === "jsInQuote" || r.context === "jsInQuoteEscaped"
		);
		if (!alreadyHasJsInQuote && ctx.context.includes("jsInQuote") && _jsChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)) {
				out.push({ char: payload, context: "jsInQuote" });
			}
		}
		if (ctx.context.includes("js") && _jsChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("script", marker, false)) {
				out.push({ char: payload, context: "js" });
			}
		}
		const _cssChars = new Set(["<", ">", "/", ";", "(", ")", ":", "@"]);
		if (ctx.context.includes("cssInQuote") && _cssChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("style", marker, true)) {
				out.push({ char: payload, context: "cssInQuote" });
			}
		}
		if (ctx.context.includes("css") && _cssChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("style", marker, false)) {
				out.push({ char: payload, context: "css" });
			}
		}
	}

	private _markerInEventHandler(marker: string, quoted: boolean): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			for (const name in attrs) {
				if (!/^on/i.test(name)) continue;
				const raw = this._getRawAttrDetail(el, name);
				if (!raw) continue;
				if (quoted && (raw.quote === '"' || raw.quote === "'") && raw.value.includes(marker)) return true;
				if (!quoted && raw.quote === "" && raw.value.includes(marker)) return true;
			}
		}
		return ResponseBodyPayloadGenerator._spansContain(this._handlerSpans(), this.body, marker);
	}

	private _markerInUrlAttr(marker: string): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			for (const name in attrs) {
				if (!this._urlAttrs.has(name.toLowerCase())) continue;
				const raw = this._getRawAttrDetail(el, name);
				if (raw && raw.value.includes(marker)) return true;
			}
		}
		return this._markerInRawAttrFallback(marker);
	}

	private _markerInStyleAttr(marker: string): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			if (!("style" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "style");
			if (raw && raw.value.includes(marker)) return true;
		}
		return this._markerInRawAttrFallback(marker);
	}

	private _markerInAnyAttr(marker: string): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			for (const name in attrs) {
				const raw = this._getRawAttrDetail(el, name);
				if (raw && raw.value.includes(marker)) return true;
			}
		}
		return this._markerInRawAttrFallback(marker);
	}

	// True when the marker shows up inside a QUOTED attribute value and never in an unquoted
	// value or a tag's attribute area -- i.e. the server re-quoted the value (minifiers do
	// this once it contains a space or quote), so a "surviving" char cannot end the value.
	// Text-only occurrences are left to the caller: in a batch probe, markers after a real
	// ">" breakout legitimately land in text.
	private _markerOnlyInQuotedAttrValues(marker: string): boolean {
		let quoted = false;
		let pos = this.body.indexOf(marker);
		while (pos !== -1) {
			const where = this._tagPositionAt(pos);
			if (where === "unquoted" || where === "tag") return false;
			if (where === "quoted") quoted = true;
			pos = this.body.indexOf(marker, pos + 1);
		}
		return quoted;
	}

	// Classifies body[pos] relative to the enclosing start tag: inside a quoted or unquoted
	// attribute value, elsewhere in the tag (names/whitespace), or outside any tag (text).
	private _tagPositionAt(pos: number): "quoted" | "unquoted" | "tag" | "text" {
		const body = this.body;
		const tagStart = body.lastIndexOf("<", pos);
		if (tagStart === -1 || !/[a-z]/i.test(body[tagStart + 1] ?? "")) return "text";
		let quote: '"' | "'" | "" | null = null;
		for (let i = tagStart + 1; i < pos; i++) {
			const ch = body[i];
			if (quote === '"' || quote === "'") {
				if (ch === quote) quote = null;
			} else if (ch === ">") {
				return "text";
			} else if (quote === "") {
				if (/\s/.test(ch)) quote = null;
			} else if (ch === "=") {
				let j = i + 1;
				while (j < pos && /\s/.test(body[j])) j++;
				const q = body[j];
				if (j < pos && (q === '"' || q === "'")) { quote = q; i = j; }
				else { quote = ""; i = j - 1; }
			}
		}
		if (quote === null) return "tag";
		return quote === "" ? "unquoted" : "quoted";
	}

	// True when the marker sits inside a start tag's text (from "<name " to its ">").
	private _markerInRawAttrFallback(marker: string): boolean {
		return ResponseBodyPayloadGenerator._spansContain(this._tagSpans(), this.body, marker);
	}

	private _markerInCssUrl(marker: string): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			if (!("style" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "style");
			if (!raw) continue;
			if (/\burl\s*\(/i.test(raw.value) && raw.value.includes(marker)) return true;
		}
		return this._markerInRawAttrFallback(marker);
	}

	private _markerInSrcsetAttr(marker: string): boolean {
		for (const el of this._select("*") as HTMLElement[]) {
			const attrs: Record<string, string> = this._attrsOf(el);
			if (!("srcset" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "srcset");
			if (raw && raw.value.includes(marker)) return true;
		}
		return this._markerInRawAttrFallback(marker);
	}

	private _markerInMetaRefresh(marker: string): boolean {
		for (const el of this._select("meta")) {
			const httpEquiv = (el.getAttribute?.("http-equiv") || "").toLowerCase();
			if (httpEquiv !== "refresh") continue;
			const raw = this._getRawAttrDetail(el as any, "content");
			if (raw && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInSrcdoc(marker: string, quoted: boolean): boolean {
		for (const el of this._select("iframe")) {
			const raw = this._getRawAttrDetail(el as any, "srcdoc");
			if (!raw) continue;
			const isQuoted = raw.quote === '"' || raw.quote === "'";
			if (quoted === isQuoted && raw.value.includes(marker)) return true;
		}
		return this._markerInRawAttrFallback(marker);
	}

	private _markerInImportMap(marker: string, inquote: boolean): boolean {
		for (const el of this._select("script")) {
			const type = (el.getAttribute?.("type") || "").toLowerCase();
			if (type !== "importmap") continue;
			const src: string = typeof el.rawText === "string"
				? el.rawText
				: (typeof el.text === "string" ? el.text : "");
			if (!src) continue;
			if (inquote) {
				let pos = -1;
				while ((pos = src.indexOf(marker, pos + 1)) !== -1) {
					if (this._isInsideJsQuotedStringAt(src, pos)) return true;
				}
			} else {
				if (src.includes(marker)) return true;
			}
		}
		return false;
	}

	private _markerInJsonScriptBlock(marker: string, inquote: boolean): boolean {
		for (const el of this._select("script")) {
			const type = (el.getAttribute?.("type") || "").toLowerCase();
			if (!/(?:application|text)\/(?:json|ld\+json)/.test(type)) continue;
			const src: string = typeof el.rawText === "string"
				? el.rawText
				: (typeof el.text === "string" ? el.text : "");
			if (!src) continue;
			if (inquote) {
				let pos = -1;
				while ((pos = src.indexOf(marker, pos + 1)) !== -1) {
					if (this._isInsideJsQuotedStringAt(src, pos)) return true;
				}
				if (src.includes(marker)) return true;
			} else {
				if (src.includes(marker)) return true;
			}
		}
		return false;
	}

	private _markerInTemplateRaw(marker: string): boolean {
		if (!this.body.includes(marker)) return false;
		const bodyLC = this._bodyLower();
		const open = '<template';
		const close = '</template>';
		let pos = 0;
		while ((pos = bodyLC.indexOf(open, pos)) !== -1) {
			const tagEnd = bodyLC.indexOf('>', pos + open.length);
			if (tagEnd === -1) break;
			const contentStart = tagEnd + 1;
			const closePos = bodyLC.indexOf(close, contentStart);
			if (closePos === -1) break;
			const content = this.body.substring(contentStart, closePos);
			if (content.includes(marker)) return true;
			pos = closePos + close.length;
		}
		return false;
	}

	/**
	 * High-level: Derive a minimal yet capability‑revealing set of probe payload characters ("payload")
	 * and the set of contextual classifications ("context") for a value already observed in the
	 * response body. These guide follow‑up probing & scoring.
	 *
	 * Inputs:
	 *  - sdk: logging surface (subset of Caido SDK; only console.log used here).
	 *  - reflectedValue: The raw reflected parameter value as originally supplied by the request.
	 *    NOTE: It may arrive URL‑encoded (possibly twice). We intentionally perform TWO decodeURIComponent
	 *    passes (mirroring legacy behavior) to surface decoded appearances while still marking contexts.
	 *
	 * Output object:
	 *  {
	 *    payload: string[]  // Ordered set of unique probe tokens (single chars or short strings) that
	 *                       // have evidential value in the detected contexts. Examples:
	 *                       //   '"' or '\''  → attempt quote breakout
	 *                       //   '<'            → tag / markup injection capability
	 *                       //   '\\'         → escape sequence leverage (JS/CSS string contexts)
	 *                       //   '' (empty)     → attribute / handler / url attr value present unquoted
	 *                       //   ':' '//' 'http:' ')' '(' ';' etc. → context‑specific follow‑up probes
	 *    context: string[]  // Unique set (string identifiers) of where the reflection appears literally
	 *                       // or structurally. Examples: 'js', 'jsInQuote', 'css', 'attributeInQuote',
	 *                       // 'eventHandlerAttr', 'styleAttrInQuote', 'urlAttr', 'html', 'htmlComment'.
	 *  }
	 *
	 * Detection Strategy (ordered for determinism & minimal probe inflation):
	 *  1. DOM Walk (document order) – For each node we attempt mutually exclusive specialized handlers:
	 *     a. _handleElementStructural: SCRIPT / STYLE / TEMPLATE containers where the reflected value
	 *        is inside raw text. Determines scripting vs style contexts & whether inside quotes.
	 *     b. _handleTextNode: Plain text nodes outside script/style map to 'html'. If nested in <template>,
	 *        we classify as 'templateHtml'.
	 *     c. _handleCommentNode: Marks 'htmlComment'. (Lower signal for exploitation, but recorded.)
	 *     d. _handleAttributes: Attribute‑level heuristics – distinguishes:
	 *         - Generic attributes (quoted vs unquoted vs encoded only)
	 *         - Event handler attributes (on*) w/ quoting
	 *         - URL attributes (href/src/etc.) + srcset descriptors
	 *         - style / meta refresh / iframe srcdoc special cases
	 *         - style/event/url attribute forms add tailored probe characters (e.g., ':' '//' ';' '(' ')').
	 *  2. After traversal, _applyHtmlFallbackIfNeeded adds { '<', 'html' } if no other context matched but
	 *     the value clearly appears in visible text outside tags after decoding variants.
	 *
	 * Probe Generation Principles:
	 *  - Only add characters relevant to the confirmed context(s) to keep later probing efficient.
	 *  - Quote characters (" ' `) added only when the value appears inside that quote type.
	 *  - Backslash (\\) added when inside quoted JS/CSS or JSON string contexts to test escape handling.
	 *  - Empty string payload ("") signals that re‑sending the baseline can confirm structure where
	 *    literal injection already implies capability (e.g., unquoted attribute, handler, or url attr).
	 *  - URL / navigation contexts add ':' '//' 'http:' to explore protocol / scheme vector potential.
	 *
	 * Encoding / Variant Considerations:
	 *  - We examine the literal reflected body text for inclusion; separate encoded‑only signals are
	 *    handled elsewhere (encodedSignalDetection). Here we focus strictly on literal presences.
	 *  - Attribute raw vs decoded value: If the *raw* attribute source contains the exact string, we can
	 *    infer quoting precisely. If only the decoded value (parser normalized) includes the reflection,
	 *    we mark it as an encoded / escaped variant (e.g., 'attributeEscaped').
	 *
	 * Ordering & Determinism:
	 *  - Sets (payloadSet/contextSet) preserve logical insertion order by operating on a Set then
	 *    spreading to arrays at the end – consistent test snapshots rely on stable ordering of traversal.
	 *  - Early returns in handlers ensure the *first* structural match for a node governs classification,
	 *    preventing double counting the same occurrence into multiple mutually exclusive contexts.
	 *
	 * Complexity:
	 *  Let N = total DOM nodes, A = total attributes on candidate elements.
	 *  Traversal is O(N + A). Per‑node operations are string includes / small RegExp matches; no quadratic
	 *  concatenations. This method executes once per reflected parameter candidate.
	 *
	 * Edge Cases / Defensive Notes:
	 *  - Extremely large bodies: current library parsing cost dominates; this routine adds minimal overhead.
	 *  - Duplicate contexts from multiple occurrences are de‑duplicated by the Set semantics.
	 *  - If a value appears in multiple structural contexts (rare), multiple context labels are emitted,
	 *    enabling composite scoring later.
	 */
	public generate(
		sdk: LogSdk,
		reflectedValue: string
	): { payload: string[]; context: string[] } {
		// Two-step decode (intentional) mirrors original logic: handle double-encoded inputs.
		reflectedValue = decodeURIComponent(reflectedValue);
		sdk.console.log(
			`[Reflector++] Generating payloads for reflected value: ${reflectedValue}`
		);
		reflectedValue = decodeURIComponent(reflectedValue);
		const payloadSet = new Set<string>();
		const contextSet = new Set<string>();
		for (const node of this._nodes()) {
			// Order matters; each helper returns true if it handled the node fully.
			if (this._handleElementStructural(node, reflectedValue, payloadSet, contextSet, sdk)) continue;
			if (this._handleTextNode(node, reflectedValue, payloadSet, contextSet, sdk)) continue;
			if (this._handleCommentNode(node, reflectedValue, payloadSet, contextSet)) continue;
			this._handleAttributes(node, reflectedValue, payloadSet, contextSet);
		}
		this._applyHtmlFallbackIfNeeded(reflectedValue, payloadSet, contextSet);
		payloadSet.add("");
		sdk.console.log(`[Reflector++] Generated payloads: ${Array.from(payloadSet).join(", ")}`);
		sdk.console.log(`[Reflector++] Detected contexts: ${Array.from(contextSet).join(", ")}`);
		return { payload: Array.from(payloadSet), context: Array.from(contextSet) };
	}

	// -------- Helper decomposition for generate() --------
	private _urlAttrs = new Set([
		"href",
		"src",
		"action",
		"formaction",
		"cite",
		"data",
		"poster",
		"background",
		"lowsrc",
		"xlink:href",
	]);

	private _addHtmlProbes(set: Set<string>) {
		set.add("<");
		set.add(">");
		set.add('"');
		set.add("'");
		set.add("/");
		set.add(";");
	}
	private _addUrlProbes(set: Set<string>, quoted: boolean, quoteChar?: string) {
		if (quoted && quoteChar) set.add(quoteChar);
		for (const q of ["'", '"']) {
			if (q !== quoteChar) set.add(q);
		}
		set.add(":");
		set.add("//");
		set.add("?");
		set.add("#");
		set.add("&");
		set.add("=");
		if (!quoted) set.add(" ");
	}
	private _addCssUrlProbes(set: Set<string>) {
		set.add(")");
		set.add("(");
		set.add("//");
		set.add("http:");
		set.add(";");
		set.add("\\");
	}
	private _addStyleAttrProbes(set: Set<string>, quote?: string) {
		if (quote) set.add(quote);
		for (const q of ["'", '"']) {
			if (q !== quote) set.add(q);
		}
		set.add("\\");
		set.add("(");
		set.add(")");
		set.add(";");
		set.add(":");
		if (!quote) set.add(" ");
	}
	private _addJsHandlerProbes(set: Set<string>, quote?: string) {
		if (quote) set.add(quote);
		for (const q of ["'", '"']) {
			if (q !== quote) set.add(q);
		}
		set.add("\\");
		set.add(";");
		set.add("(");
		set.add(")");
		set.add("&");
		if (!quote) set.add(" ");
	}
	private _hasAncestorTag(node: any, tagUpper: string): boolean {
		let p: any = node;
		while (p) {
			if (p.rawTagName && String(p.rawTagName).toUpperCase() === tagUpper) return true;
			p = p.parentNode;
		}
		return false;
	}

	private static _RAWTEXT_ELEMENTS = new Set([
		"TEXTAREA", "TITLE", "NOSCRIPT", "XMP", "IFRAME"
	]);

	private static _SVG_MATH_ELEMENTS = new Set(["SVG", "MATH"]);

	private _findAncestorTag(node: any, tagSet: Set<string>): string | null {
		let p: any = node;
		while (p) {
			if (p.rawTagName && tagSet.has(String(p.rawTagName).toUpperCase())) {
				return String(p.rawTagName).toUpperCase();
			}
			p = p.parentNode;
		}
		return null;
	}

	private _addRawtextProbes(set: Set<string>, closingTag: string) {
		set.add("<");
		set.add(">");
		set.add("/");
		set.add(closingTag);
	}

	private _addSvgProbes(set: Set<string>) {
		set.add("<");
		set.add(">");
		set.add("/");
		set.add('"');
		set.add("'");
	}

	private _addJsUriProbes(set: Set<string>, quote?: string) {
		if (quote) set.add(quote);
		set.add("(");
		set.add(")");
		set.add(";");
		set.add("'");
		set.add('"');
		set.add("//");
		set.add("\\");
	}

	private _addDataUriProbes(set: Set<string>, quote?: string) {
		if (quote) set.add(quote);
		set.add("/");
		set.add(",");
		set.add(";");
		set.add("<");
		set.add(">");
	}

	private _handleElementStructural(
		node: any,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>,
		sdk: any
	): boolean {
		const isElement = node?.nodeType === 1 && typeof node?.rawTagName === "string";
		if (!isElement) return false;
		const tag = (node.rawTagName || "").toUpperCase();
		if (!(tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE")) return false;
		const text = typeof node.rawText === "string" ? node.rawText : (node.text as string) || "";
		if (!text || !text.includes(reflectedValue)) return false;
		if (tag === "SCRIPT") return this._handleScriptText(text, node, reflectedValue, payloadSet, contextSet, sdk);
		if (tag === "STYLE") return this._handleStyleText(text, reflectedValue, payloadSet, contextSet);
		if (tag === "TEMPLATE") {
			contextSet.add("templateHtml");
			this._addHtmlProbes(payloadSet);
			return true;
		}
		return false;
	}

	private _handleScriptText(
		text: string,
		node: any,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>,
		sdk: any
	): boolean {
		const typeAttr = (node.getAttribute?.("type") || "") as string;
		if (this._isJsExecutableScriptType(typeAttr)) {
			const quotes = this._getQuoteInfo(text, reflectedValue);
			const quote = quotes[0] || "";
			let ctx = "js";
			if (quote === "`") {
				ctx = "jsTemplateLiteral";
				payloadSet.add("`");
				payloadSet.add("\\");
				payloadSet.add("$");
				payloadSet.add("{");
				payloadSet.add("}");
				for (const q of ["'", '"']) payloadSet.add(q);
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("/");
				payloadSet.add(";");
				payloadSet.add("(");
				payloadSet.add(")");
				payloadSet.add("*");
			} else if (quote) {
				payloadSet.add(quote);
				payloadSet.add("\\");
				ctx = "jsInQuote";
				contextSet.add(quote === '"' ? "jsInDQuote" : "jsInSQuote");
				for (const q of ["'", '"', "`"]) {
					if (q !== quote) payloadSet.add(q);
				}
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("/");
				payloadSet.add(";");
				payloadSet.add("(");
				payloadSet.add(")");
				payloadSet.add("{");
				payloadSet.add("}");
				payloadSet.add("*");
			} else {
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("/");
				payloadSet.add(";");
				payloadSet.add("'");
				payloadSet.add('"');
				payloadSet.add("`");
				payloadSet.add("\\");
				payloadSet.add("(");
				payloadSet.add(")");
				payloadSet.add("{");
				payloadSet.add("}");
				payloadSet.add("*");
			}
			contextSet.add(ctx);
			try {
				sdk?.console?.log?.(
					`[Reflector++][gen] SCRIPT hit: type="${typeAttr}" exec=true ctx=${ctx} quote=${JSON.stringify(
						quote
					)}`
				);
			} catch { }
			return true;
		}
		const t = (typeAttr || "").toLowerCase();
		if (t === "importmap") {
			const quotes = this._getQuoteInfo(text, reflectedValue);
			const quote = quotes[0] || '"';
			contextSet.add(quotes.length ? "importMapString" : "importMap");
			payloadSet.add(quote);
			payloadSet.add("\\");
			payloadSet.add(",");
			payloadSet.add("}");
			payloadSet.add("]");
			payloadSet.add(":");
			try {
				sdk?.console?.log?.(
					`[Reflector++][gen] SCRIPT hit: type="importmap" ctx=${quotes.length ? "importMapString" : "importMap"}`
				);
			} catch { }
			return true;
		}
		if (/(?:application|text)\/(?:json|ld\+json)/.test(t)) {
			const quotes = this._getQuoteInfo(text, reflectedValue);
			const quote = quotes[0] || '"';
			contextSet.add(quotes.length ? "jsonInQuote" : "json");
			payloadSet.add(quote);
			payloadSet.add("\\");
			payloadSet.add(",");
			payloadSet.add("}");
			payloadSet.add("]");
			payloadSet.add(":");
			payloadSet.add("<");
			payloadSet.add("/");
			try {
				sdk?.console?.log?.(
					`[Reflector++][gen] SCRIPT hit: type="${typeAttr}" exec=false ctx=${quotes.length ? "jsonInQuote" : "json"} quote=${JSON.stringify(
						quote
					)}`
				);
			} catch { }
			return true;
		}
		return false;
	}

	private _handleStyleText(
		text: string,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>
	): boolean {
		const quotes = this._getQuoteInfo(text, reflectedValue);
		const quote = quotes[0] || "";
		let ctx = "css";
		if (quote) {
			payloadSet.add(quote);
			payloadSet.add("\\");
			ctx = "cssInQuote";
			for (const q of ["'", '"']) {
				if (q !== quote) payloadSet.add(q);
			}
			payloadSet.add("<");
			payloadSet.add(">");
			payloadSet.add("/"); // needed to detect a </style> breakout from a quoted CSS string
			payloadSet.add(";");
			payloadSet.add("(");
			payloadSet.add(")");
			payloadSet.add("@");
		} else {
			payloadSet.add("<");
			payloadSet.add(">");
			payloadSet.add("/");
			payloadSet.add(";");
			payloadSet.add("(");
			payloadSet.add(")");
			payloadSet.add("\\");
			payloadSet.add(":");
			payloadSet.add("@");
		}
		contextSet.add(ctx);
		return true;
	}

	private _handleTextNode(
		node: any,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>,
		sdk: any
	): boolean {
		const isTextNode = node?.nodeType === 3 || node?.constructor?.name === "TextNode";
		const text = isTextNode ? this._textOf(node) : undefined;
		if (typeof text !== "string" || !text.includes(reflectedValue)) return false;
		const parent = node.parentNode as any;
		if (parent?.rawTagName) {
			const tag = parent.rawTagName.toUpperCase();
			if (tag === "SCRIPT") {
				return this._handleScriptText(text, parent, reflectedValue, payloadSet, contextSet, sdk);
			} else if (tag === "STYLE") {
				return this._handleStyleText(text, reflectedValue, payloadSet, contextSet);
			} else {
				if (this._hasAncestorTag(parent, "TEMPLATE")) {
					contextSet.add("templateHtml");
					this._addHtmlProbes(payloadSet);
					return true;
				}
				if (ResponseBodyPayloadGenerator._RAWTEXT_ELEMENTS.has(tag)) {
					const closingTag = `</${tag.toLowerCase()}>`;
					contextSet.add("rawtextElement");
					this._addRawtextProbes(payloadSet, closingTag);
					return true;
				}
				const svgMathAncestor = this._findAncestorTag(
					parent, ResponseBodyPayloadGenerator._SVG_MATH_ELEMENTS
				);
				if (svgMathAncestor) {
					contextSet.add(svgMathAncestor === "SVG" ? "svgContext" : "mathContext");
					this._addSvgProbes(payloadSet);
					return true;
				}
				this._addHtmlProbes(payloadSet);
				contextSet.add("html");
				return true;
			}
		} else {
			this._addHtmlProbes(payloadSet);
			contextSet.add("html");
			return true;
		}
	}

	private _handleCommentNode(
		node: any,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>
	): boolean {
		const isCommentNode = node?.nodeType === 8 || node?.constructor?.name === "CommentNode";
		const text = isCommentNode ? this._textOf(node) : undefined;
		if (typeof text !== "string" || !text.includes(reflectedValue)) return false;
		payloadSet.add("<");
		payloadSet.add(">");
		payloadSet.add("-");
		payloadSet.add('"');
		payloadSet.add("'");
		contextSet.add("htmlComment");
		return true;
	}

	private _handleAttributes(
		node: any,
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>
	): void {
		const isElement = node?.nodeType === 1 && typeof node?.rawTagName === "string";
		if (!isElement) return;
		const el = node as any;
		const attrs: Record<string, string> = this._attrsOf(el);
		for (const name in attrs) {
			const decoded = attrs[name];
			if (!decoded || !decoded.includes(reflectedValue)) continue;
			const raw = this._getRawAttrDetail(el, name);
			const lower = name.toLowerCase();
			const tagName = (el.rawTagName || "").toUpperCase();
			if (/^on[a-z0-9_:-]+$/i.test(lower)) {
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (quoted) {
					contextSet.add("eventHandlerAttrInQuote");
					this._addJsHandlerProbes(payloadSet, raw!.quote);
				} else {
					contextSet.add("eventHandlerAttr");
					this._addJsHandlerProbes(payloadSet);
					payloadSet.add("");
				}
				return;
			}
			if (lower === "style") {
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (quoted) {
					contextSet.add("styleAttrInQuote");
					this._addStyleAttrProbes(payloadSet, raw!.quote);
				} else {
					contextSet.add("styleAttr");
					this._addStyleAttrProbes(payloadSet);
					payloadSet.add("");
				}
				if (/\burl\s*\(/i.test(decoded)) {
					contextSet.add("cssUrl");
					this._addCssUrlProbes(payloadSet);
				}
				return;
			}
			if (this._urlAttrs.has(lower)) {
				const attrVal = raw?.value ?? decoded;
				const refIdx = attrVal.indexOf(reflectedValue);
				const beforeRef = refIdx >= 0 ? attrVal.substring(0, refIdx) : "";
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (/^\s*javascript\s*:/i.test(beforeRef)) {
					contextSet.add("jsUri");
					this._addJsUriProbes(payloadSet, quoted ? raw!.quote : undefined);
					return;
				}
				if (/^\s*data\s*:/i.test(beforeRef)) {
					contextSet.add("dataUri");
					this._addDataUriProbes(payloadSet, quoted ? raw!.quote : undefined);
					return;
				}
				if (quoted) {
					contextSet.add("urlAttrInQuote");
					contextSet.add(raw!.quote === '"' ? "attrInDQuote" : "attrInSQuote");
					payloadSet.add(raw!.quote);
					this._addUrlProbes(payloadSet, true, raw!.quote);
				} else {
					contextSet.add("urlAttr");
					this._addUrlProbes(payloadSet, false);
					payloadSet.add("");
				}
				return;
			}
			if (lower === "srcset") {
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (quoted) {
					contextSet.add("srcsetUrlInQuote");
					contextSet.add(raw!.quote === '"' ? "attrInDQuote" : "attrInSQuote");
					payloadSet.add(raw!.quote);
				} else {
					contextSet.add("srcsetUrl");
					payloadSet.add("");
					payloadSet.add(" ");
				}
				payloadSet.add("/");
				payloadSet.add(",");
				return;
			}
			if (tagName === "META" && lower === "content") {
				const httpEquiv = (el.getAttribute?.("http-equiv") || "").toLowerCase();
				if (httpEquiv === "refresh" && /url\s*=/.test(decoded)) {
					contextSet.add("metaRefresh");
					const metaQuote = raw?.quote === "'" ? "'" : '"';
					contextSet.add(metaQuote === '"' ? "attrInDQuote" : "attrInSQuote");
					payloadSet.add("/");
					payloadSet.add("//");
					payloadSet.add("http:");
					payloadSet.add(";");
					payloadSet.add(":");
					payloadSet.add("?");
					payloadSet.add("#");
					// Breakout of content="0;url=..." (enclosing quote) and tag injection.
					payloadSet.add(metaQuote);
					payloadSet.add("<");
					payloadSet.add(">");
					return;
				}
			}
			if (tagName === "IFRAME" && lower === "srcdoc") {
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (quoted) {
					contextSet.add("srcdocHtmlInQuote");
					payloadSet.add(raw!.quote);
					for (const q of ["'", '"']) {
						if (q !== raw!.quote) payloadSet.add(q);
					}
				} else {
					contextSet.add("srcdocHtml");
					payloadSet.add("");
					payloadSet.add(" ");
				}
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("&");
				return;
			}
			if (lower === "id" || lower === "name") {
				contextSet.add("domClobber");
			}
			if (!raw) {
				contextSet.add("attributeEscaped");
				return;
			}
			if (raw.value.includes(reflectedValue)) {
				if (raw.quote === '"' || raw.quote === "'") {
					payloadSet.add(raw.quote);
					for (const q of ["'", '"']) {
						if (q !== raw.quote) payloadSet.add(q);
					}
					payloadSet.add("<");
					payloadSet.add(">");
					payloadSet.add("&");
					contextSet.add("attributeInQuote");
					contextSet.add(raw.quote === '"' ? "attrInDQuote" : "attrInSQuote");
				} else {
					payloadSet.add("");
					payloadSet.add(" ");
					payloadSet.add('"');
					payloadSet.add("'");
					payloadSet.add(">");
					payloadSet.add("<");
					payloadSet.add(";");
					payloadSet.add("=");
					contextSet.add("attribute");
				}
			} else {
				contextSet.add("attributeEscaped");
			}
			return;
		}
	}

	private _isEarlyReflection(reflectedValue: string): boolean {
		const refIdx = this.body.indexOf(reflectedValue);
		if (refIdx < 0) return false;
		const before = this.body.substring(0, refIdx);
		const relativeScriptRe = /<script[^>]+src\s*=\s*["'](?!(?:https?:)?\/\/|\/[^/])/i;
		const relativeLinkRe = /<link[^>]+href\s*=\s*["'](?!(?:https?:)?\/\/|\/[^/])/i;
		const relativeFormRe = /<form[^>]+action\s*=\s*["'](?!(?:https?:)?\/\/|\/[^/])/i;
		const afterRef = this.body.substring(refIdx);
		return (
			relativeScriptRe.test(afterRef) ||
			relativeLinkRe.test(afterRef) ||
			relativeFormRe.test(afterRef)
		) && !relativeScriptRe.test(before);
	}

	private _applyHtmlFallbackIfNeeded(
		reflectedValue: string,
		payloadSet: Set<string>,
		contextSet: Set<string>
	) {
		const markers = this._variantsOf(reflectedValue);
		if (contextSet.size === 0 && markers.some((m) => this._containsTextOutsideTags(m))) {
			contextSet.add("html");
			payloadSet.add("<");
		}
		if (
			(contextSet.has("html") || contextSet.size === 0) &&
			this._isEarlyReflection(reflectedValue)
		) {
			contextSet.add("htmlBaseInjection");
			payloadSet.add("<");
		}
	}
};

export default ResponseBodyPayloadGenerator;

