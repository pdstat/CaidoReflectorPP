// Import Caido SDK types in a way compatible with ts-node/NodeNext resolution (type-only to avoid runtime module resolution issues)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { SDK } from "@caido/sdk-workflow";
import { parse, HTMLElement, Node } from "node-html-parser";

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

	// ---------- Utilities ----------
	private _walkNodes(node: Node, cb: (node: Node) => void): void {
		cb(node);
		const kids = (node as any).childNodes as any[] | undefined;
		if (Array.isArray(kids)) {
			for (const child of kids) this._walkNodes(child, cb);
		}
	}

	private _containsTextOutsideTags(marker: string, exclude: string[] = ["SCRIPT", "STYLE"]): boolean {
		let found = false;
		this._walkNodes(this.root as any, (n: Node) => {
			if (found) return;
			const isText =
				(n as any).nodeType === 3 || (n as any).constructor?.name === "TextNode";
			if (isText) {
				const parent = (n as any).parentNode as any | undefined;
				const tag = parent?.rawTagName ? String(parent.rawTagName).toUpperCase() : "";
				if (!exclude.includes(tag) && (n as any).text?.includes(marker)) found = true;
			}
		});
		return found;
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

	private _getRawAttrDetail(el: HTMLElement, name: string): { value: string; quote: '"' | "'" | "" } | null {
		const raw = (el as any).rawAttrs as string | undefined;
		if (!raw) return null;
		const re = new RegExp(
			`(?:^|\\s)${ResponseBodyPayloadGenerator._escapeRegexLiteral(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
			"i"
		);
		const m = raw.match(re);
		if (!m) return null;
		if (m[1] !== undefined) return { value: m[1], quote: '"' };
		if (m[2] !== undefined) return { value: m[2], quote: "'" };
		return { value: m[3], quote: "" };
	}

	private _getQuoteInfo(text: string, value: string): string[] {
		const res = new Set<string>();
		let startIndex = 0;
		while (startIndex < text.length) {
			const index = text.indexOf(value, startIndex);
			if (index === -1) break;
			let inDouble = false, inSingle = false, inTpl = false, escaping = false;
			for (let i = 0; i < index; i++) {
				const ch = text[i];
				if (escaping) { escaping = false; continue; }
				if (ch === "\\" && (inSingle || inDouble || inTpl)) { escaping = true; continue; }
				const inStr = inSingle || inDouble || inTpl;
				if (!inStr && ch === '"' && !inSingle && !inTpl) inDouble = true;
				else if (inDouble && ch === '"') inDouble = false;
				else if (!inStr && ch === "'" && !inDouble && !inTpl) inSingle = true;
				else if (inSingle && ch === "'") inSingle = false;
				else if (!inStr && ch === "`" && !inDouble && !inSingle) inTpl = true;
				else if (inTpl && ch === "`") inTpl = false;
			}
			if (inDouble) res.add('"');
			if (inSingle) res.add("'");
			if (inTpl) res.add("`");
			startIndex = index + value.length;
		}
		return Array.from(res);
	}

	private _isInsideJsQuotedStringAt(src: string, idxStart: number): boolean {
		let inQuote: '"' | "'" | "`" | null = null;
		let escaped = false;
		for (let i = 0; i < idxStart && i < src.length; i++) {
			const ch = src[i];
			if (escaped) { escaped = false; continue; }
			if (inQuote) {
				if (ch === "\\") { escaped = true; continue; }
				if (ch === inQuote) { inQuote = null; continue; }
			} else {
				if (ch === '"' || ch === "'" || ch === "`") { inQuote = ch; continue; }
			}
		}
		return inQuote !== null;
	}

	private _isPayloadInSpecifiedContext(tagName: string, marker: string, inquote: boolean): boolean {
		const dbg = (m: string) => {
			try {
				(this as any)?.sdk?.console?.log?.(`[Reflector++][detectCtx] ${m}`);
			} catch { }
		};
		let nodes: any[] = [];
		const lower = tagName.toLowerCase();
		if (lower === "script") {
			const all = ((this.root as any).querySelectorAll?.("script") ?? []) as any[];
			nodes = all.filter((el) =>
				this._isJsExecutableScriptType((el.getAttribute?.("type") || "").toString())
			);
		} else {
			nodes = ((this.root as any).querySelectorAll?.(tagName) ?? []) as any[];
		}
		dbg(
			`enter tag=${tagName} inquote=${inquote} nodes=${nodes.length} marker=${JSON.stringify(
				marker
			)}`
		);
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
		// map(JSON.stringify) confuses TS's overloads; wrap explicitly
		dbg(
			`candidates=${Array.from(variants)
				.slice(0, 8)
				.map((v) => JSON.stringify(v))
				.join(", ")}${variants.size > 8 ? " …" : ""}`
		);
		for (const el of nodes) {
			const src: string = typeof (el as any).rawText === "string"
				? (el as any).rawText
				: typeof (el as any).text === "string"
					? (el as any).text
					: "";
			dbg(`node len=${src?.length ?? 0}`);
			if (!src) continue;
			try {
				const px = marker.slice(0, 5);
				const sx = marker.slice(-5);
				const iPx = px ? src.indexOf(px) : -1;
				const iSx = sx ? src.indexOf(sx) : -1;
				if (px) dbg(`probe prefix=${JSON.stringify(px)} idx=${iPx}`);
				if (sx) dbg(`probe suffix=${JSON.stringify(sx)} idx=${iSx}`);
			} catch { }
			const srcLC = src.toLowerCase();
			if (inquote) {
				for (const cand of variants) {
					const candLC = cand.toLowerCase();
					let pos = -1,
						tries = 0;
					while ((pos = srcLC.indexOf(candLC, pos + 1)) !== -1) {
						tries++;
						const inside = this._isInsideJsQuotedStringAt(src, pos);
						dbg(`try cand=${JSON.stringify(cand)} pos=${pos} inside=${inside}`);
						if (inside) return true;
						if (tries > 20) break;
					}
				}
			} else {
				for (const cand of variants) {
					if (srcLC.includes(cand.toLowerCase())) return true;
				}
			}
		}
		dbg(`no-hit`);
		return false;
	}

	public detect(
		sdk: SDK | { console: { log: (msg: string) => void } },
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
		if (res.length === 0 && context.context.length > 0) {
			const marker = prefix + payload + suffix;
			if (this.body.includes(marker)) {
				for (const ctx of context.context) {
					res.push({ char: payload, context: ctx });
				}
			}
		}
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
		if (!(ctx.context.includes("attributeInQuote") && (payload === '"' || payload === "'"))) return;
		sdk.console.log(`\[Reflector++] checking [${payload}] is reflected in quoted attribute`);
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		let found = false;
		for (let i = 0; i < allEls.length && !found; i++) {
			const el = allEls[i];
			const attrs: Record<string, string> = (el as any).attributes || el.attributes;
			for (const name in attrs) {
				const raw = this._getRawAttrDetail(el, name);
				if (!raw) continue;
				const marker = prefix + payload + suffix;
				if (raw.value.includes(marker)) {
					sdk.console.log(`\[Reflector++] found [${payload}] is reflected in quoted attribute`);
					out.push({ char: payload, context: "attributeInQuote" });
					found = true;
					break;
				}
				const decoded = attrs[name];
				if (typeof decoded === "string" && decoded.includes(marker))
					out.push({ char: payload, context: "attributeEscaped" });
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
		const candidates = new Set<string>();
		const add = (s: string) => candidates.add(s);
		add(marker);
		add(marker.replace(/\\/g, "\\\\"));
		for (const q of ['"', "'", "`"]) {
			if (marker.includes(q)) {
				const esc = marker.split(q).join("\\" + q);
				add(esc);
				add(esc.replace(/\\/g, "\\\\"));
			}
		}
		for (const base of Array.from(candidates)) {
			add(base.replace(/\\/g, "\\"));
			add(base.replace(/\\/g, "\\\\\\"));
		}
		const scripts = ((this.root as any).querySelectorAll?.("script") ?? []) as any[];
		const execScripts = scripts.filter((el) =>
			this._isJsExecutableScriptType((el.getAttribute?.("type") || "").toString())
		);
		let matched = false;
		for (const el of execScripts) {
			const src: string = typeof (el as any).rawText === "string"
				? (el as any).rawText
				: (typeof (el as any).text === "string" ? (el as any).text : "") || "";
			if (!src) continue;
			try {
				const px = prefix.slice(0, 5),
					sx = suffix.slice(-5);
				const iPx = px ? src.indexOf(px) : -1;
				const iSx = sx ? src.indexOf(sx) : -1;
				sdk?.console?.log?.(`[Reflector++][detectCtx] probe prefix=${JSON.stringify(px)} idx=${iPx}`);
				sdk?.console?.log?.(`[Reflector++][detectCtx] probe suffix=${JSON.stringify(sx)} idx=${iSx}`);
			} catch { }
			for (const cand of candidates) {
				let pos = -1,
					tries = 0;
				while ((pos = src.indexOf(cand, pos + 1)) !== -1) {
					const inside = this._isInsideJsQuotedStringAt(src, pos);
					sdk?.console?.log?.(
						`[Reflector++][detectCtx] try cand=${JSON.stringify(cand)} pos=${pos} inside=${inside}`
					);
					if (inside) {
						matched = true;
						break;
					}
					if (++tries > 32) break;
				}
				if (matched) break;
			}
			if (matched) break;
		}
		sdk?.console?.log?.(`[Reflector++][detect] jsInQuote result=${matched}`);
		if (matched) out.push({ char: payload, context: "jsInQuote" });
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
		const hit = this._isPayloadInSpecifiedContext("style", marker, true);
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
			const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
			let found = false;
			for (let i = 0; i < allEls.length && !found; i++) {
				const el = allEls[i];
				const attrs: Record<string, string> = (el as any).attributes || el.attributes;
				for (const name in attrs) {
					const raw = this._getRawAttrDetail(el, name);
					if (!raw) continue;
					const marker = prefix + payload + suffix;
					if (raw.value.includes(marker)) {
						out.push({ char: payload, context: "attributeInQuote" });
						found = true;
						break;
					}
					const decoded = attrs[name];
					if (typeof decoded === "string" && decoded.includes(marker))
						out.push({ char: payload, context: "attributeEscaped" });
				}
			}
		}
		if (eventHandler) {
			const nodes: any[] = (this.root as any).querySelectorAll("*") as HTMLElement[];
			let found = false;
			for (const el of nodes) {
				const attrs: Record<string, string> = (el as any).attributes || el.attributes;
				for (const name in attrs) {
					if (!/^on/i.test(name)) continue;
					const raw = this._getRawAttrDetail(el as any, name);
					if (!raw) continue;
					const marker = prefix + payload + suffix;
					if (raw.value.includes(marker)) {
						out.push({ char: payload, context: "eventHandler" });
						found = true;
						break;
					}
					const decoded = attrs[name];
					if (typeof decoded === "string" && decoded.includes(marker))
						out.push({ char: payload, context: "eventHandlerEscaped" });
				}
				if (found) break;
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
			if (markers.some((m) => this._isPayloadInSpecifiedContext("template", m, false))) {
				out.push({ char: payload, context: "templateHtml" });
				pushed = true;
			}
		}
		if (markers.some((m) => this._containsTextOutsideTags(m))) {
			if (!pushed) out.push({ char: payload, context: "html" });
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
		if (!matched && ctx.context.includes("jsInQuote")) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)) {
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
			if (this._isPayloadInSpecifiedContext("style", marker, true)) {
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
			if (this._isPayloadInSpecifiedContext("template", marker, false)) {
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
		const _cssUrlChars = new Set([")", "(", "//", "http:", ";", "/", ":", " "]);
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
		const _metaChars = new Set(["/", "//", "http:", ";", ":", "?", "#"]);
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
		if (ctx.context.includes("htmlComment") && _htmlChars.has(payload)
			|| (ctx.context.includes("htmlComment") && payload === "-")) {
			if (this.body.includes(marker)) {
				out.push({ char: payload, context: "htmlComment" });
			}
		}
		if (ctx.context.includes("templateHtml") && _htmlChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("template", marker, false)) {
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
			if (this._markerInAnyAttr(marker)) {
				out.push({ char: payload, context: "attribute" });
			}
		}
		const _jsChars = new Set(["<", ">", "/", ";", "'", '"', "`"]);
		if (ctx.context.includes("jsInQuote") && _jsChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("script", marker, true)) {
				out.push({ char: payload, context: "jsInQuote" });
			}
		}
		if (ctx.context.includes("js") && _jsChars.has(payload)) {
			if (this._isPayloadInSpecifiedContext("script", marker, false)) {
				out.push({ char: payload, context: "js" });
			}
		}
		const _cssChars = new Set(["<", ">", "/", ";", "(", ")", ":"]);
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
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			for (const name in attrs) {
				if (!/^on/i.test(name)) continue;
				const raw = this._getRawAttrDetail(el, name);
				if (!raw) continue;
				if (quoted && (raw.quote === '"' || raw.quote === "'") && raw.value.includes(marker)) return true;
				if (!quoted && raw.quote === "" && raw.value.includes(marker)) return true;
			}
		}
		return false;
	}

	private _markerInUrlAttr(marker: string): boolean {
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			for (const name in attrs) {
				if (!this._urlAttrs.has(name.toLowerCase())) continue;
				const raw = this._getRawAttrDetail(el, name);
				if (raw && raw.value.includes(marker)) return true;
			}
		}
		return false;
	}

	private _markerInStyleAttr(marker: string): boolean {
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			if (!("style" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "style");
			if (raw && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInAnyAttr(marker: string): boolean {
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			for (const name in attrs) {
				const raw = this._getRawAttrDetail(el, name);
				if (raw && raw.value.includes(marker)) return true;
			}
		}
		return false;
	}

	private _markerInCssUrl(marker: string): boolean {
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			if (!("style" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "style");
			if (!raw) continue;
			if (/\burl\s*\(/i.test(raw.value) && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInSrcsetAttr(marker: string): boolean {
		const allEls = (this.root as any).querySelectorAll("*") as HTMLElement[];
		for (const el of allEls) {
			const attrs: Record<string, string> = (el as any).attributes || {};
			if (!("srcset" in attrs)) continue;
			const raw = this._getRawAttrDetail(el, "srcset");
			if (raw && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInMetaRefresh(marker: string): boolean {
		const metas = ((this.root as any).querySelectorAll?.("meta") ?? []) as any[];
		for (const el of metas) {
			const httpEquiv = (el.getAttribute?.("http-equiv") || "").toLowerCase();
			if (httpEquiv !== "refresh") continue;
			const raw = this._getRawAttrDetail(el as any, "content");
			if (raw && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInSrcdoc(marker: string, quoted: boolean): boolean {
		const iframes = ((this.root as any).querySelectorAll?.("iframe") ?? []) as any[];
		for (const el of iframes) {
			const raw = this._getRawAttrDetail(el as any, "srcdoc");
			if (!raw) continue;
			const isQuoted = raw.quote === '"' || raw.quote === "'";
			if (quoted === isQuoted && raw.value.includes(marker)) return true;
		}
		return false;
	}

	private _markerInJsonScriptBlock(marker: string, inquote: boolean): boolean {
		const scripts = ((this.root as any).querySelectorAll?.("script") ?? []) as any[];
		for (const el of scripts) {
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
			} else {
				if (src.includes(marker)) return true;
			}
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
	 *  1. DOM Walk (_walkNodes) – For each node we attempt mutually exclusive specialized handlers:
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
		sdk: SDK | { console: { log: (msg: string) => void } },
		reflectedValue: string
	): { payload: string[]; context: string[] } {
		// Two-step decode (intentional) mirrors original logic: handle double-encoded inputs.
		reflectedValue = decodeURIComponent(reflectedValue);
		const scripts = (this.root as any).querySelectorAll?.("script") ?? [];
		// styles & templates retained for possible future heuristics
		const styles = (this.root as any).querySelectorAll?.("style") ?? [];
		const tmpls = (this.root as any).querySelectorAll?.("template") ?? [];
		const execFlags = scripts.slice(0, 10).map((el: any) => {
			const t = (el.getAttribute?.("type") || "").toString();
			return `${t || "<empty>"} => exec=${this._isJsExecutableScriptType(t)}`;
		});
		sdk.console.log(
			`[Reflector++] Generating payloads for reflected value: ${reflectedValue}`
		);
		reflectedValue = decodeURIComponent(reflectedValue);
		const payloadSet = new Set<string>();
		const contextSet = new Set<string>();
		this._walkNodes(this.root as any, (node: any) => {
			sdk.console.log(`[Reflector++] Examining node: type=${node?.nodeType} tag=${node?.rawTagName || "<none>"}`);
			// Order matters; each helper returns true if it handled the node fully.
			if (this._handleElementStructural(node, reflectedValue, payloadSet, contextSet, sdk)) return;
			if (this._handleTextNode(node, reflectedValue, payloadSet, contextSet, sdk)) return;
			if (this._handleCommentNode(node, reflectedValue, payloadSet, contextSet)) return;
			this._handleAttributes(node, reflectedValue, payloadSet, contextSet);
		});
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
			if (quote) {
				payloadSet.add(quote);
				payloadSet.add("\\");
				ctx = "jsInQuote";
				for (const q of ["'", '"', "`"]) {
					if (q !== quote) payloadSet.add(q);
				}
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("/");
				payloadSet.add(";");
			} else {
				payloadSet.add("<");
				payloadSet.add(">");
				payloadSet.add("/");
				payloadSet.add(";");
				payloadSet.add("'");
				payloadSet.add('"');
				payloadSet.add("`");
				payloadSet.add("\\");
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
			payloadSet.add(";");
			payloadSet.add("(");
			payloadSet.add(")");
		} else {
			payloadSet.add("<");
			payloadSet.add(">");
			payloadSet.add("/");
			payloadSet.add(";");
			payloadSet.add("(");
			payloadSet.add(")");
			payloadSet.add("\\");
			payloadSet.add(":");
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
		const isTextLike =
			(node?.nodeType === 3 || node?.constructor?.name === "TextNode") &&
			typeof node?.text === "string" &&
			node.text.includes(reflectedValue);
		if (!isTextLike) return false;
		const parent = node.parentNode as any;
		if (parent?.rawTagName) {
			const tag = parent.rawTagName.toUpperCase();
			if (tag === "SCRIPT") {
				return this._handleScriptText(node.text, parent, reflectedValue, payloadSet, contextSet, sdk);
			} else if (tag === "STYLE") {
				return this._handleStyleText(node.text, reflectedValue, payloadSet, contextSet);
			} else {
				if (this._hasAncestorTag(parent, "TEMPLATE")) {
					contextSet.add("templateHtml");
					this._addHtmlProbes(payloadSet);
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
		const isComment =
			(node?.nodeType === 8 || node?.constructor?.name === "CommentNode") &&
			typeof node?.text === "string" &&
			node.text.includes(reflectedValue);
		if (!isComment) return false;
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
		const attrs: Record<string, string> = el.attributes || {};
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
				const quoted = raw?.quote === '"' || raw?.quote === "'";
				if (quoted) {
					contextSet.add("urlAttrInQuote");
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
					payloadSet.add("/");
					payloadSet.add("//");
					payloadSet.add("http:");
					payloadSet.add(";");
					payloadSet.add(":");
					payloadSet.add("?");
					payloadSet.add("#");
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
	}
};

export default ResponseBodyPayloadGenerator;

