# Reflector++ Bug Report — Round 8

Comprehensive verification against vuln-reflector (55 endpoints, 55 findings). JSON sealed-string bug from Round 7 is fixed. One remaining issue: `/template` missing `<` from allowed chars.

---

## Bug: `/template` missing `<` from allowed chars

**Endpoint:** `/template` — `<template><div>${q}</div></template>`
**Finding:** CONFIRMED — `> " ' / ; alphanumeric`
**Missing:** `<` — the most critical char for template injection (enables tag injection inside `<template>`)
**Verified:** `curl /template?q=%3Cscript%3E` → `<template><div><script></div></template>` — `<` reflects unescaped.

---

## Fixed: JSON string contexts now check quote breakout (Round 7→8)

**Problem:** In JSON string contexts, `detect()` reports structural chars (`, } ] :`) as "allowed" without first checking whether the attacker can break out of the string. If both `"` and `\` are escaped (e.g. by `JSON.stringify`), the string is sealed — structural chars reflect but cannot affect JSON structure. These findings should be UNCONFIRMED.

**Affected findings (3):**

### `/json-string` — `application/json` response body, `JSON.stringify`

- **Server code:** `res.send(JSON.stringify({ result: q, status: "ok" }))`
- **Content-Type:** `application/json` (not rendered as HTML by browsers)
- **Current finding:** CONFIRMED — `, } ] :`
- **Quote breakout test:**
  - `"` → `{"result":"\"","status":"ok"}` — escaped to `\"`
  - `\"` → `{"result":"\\\"","status":"ok"}` — `\` escaped to `\\`, `"` escaped to `\"`
  - `\\"` → `{"result":"\\\\\"","status":"ok"}` — all escaped
- **Verdict:** Both `"` and `\` are escaped. `, } ] :` reflect inside the string but are completely harmless. Should be **UNCONFIRMED**.

### `/json-script-escaped` — `text/html`, JSON.stringify in `<script type="application/json">`

- **Server code:** `JSON.stringify(q).slice(1, -1).replace(/</g, "\\u003c")` inside `{"user":"${jsonSafe}","role":"viewer"}`
- **Content-Type:** `text/html` (but reflection is inside a non-executable JSON script block)
- **Current finding:** CONFIRMED — `, } ] : alphanumeric`
- **Quote breakout test:**
  - `"` → `{"user":"\"","role":"viewer"}` — escaped
  - `\"` → `{"user":"\\\"","role":"viewer"}` — both escaped
  - `<` → `\u003c` — `</script>` breakout also blocked
- **Verdict:** `"` and `\` escaped, `<` blocked. String is sealed and `</script>` breakout impossible. `, } ] :` are harmless. Should be **UNCONFIRMED**.

### `/json-script-structure-escaped` — `text/html`, JSON.stringify wraps value in quotes

- **Server code:** `JSON.stringify(q).replace(/</g, "\\u003c")` at structure position `{"count":${safe},"items":[]}`
- **Content-Type:** `text/html`
- **Current finding:** CONFIRMED — `, } ] : alphanumeric`
- **Quote breakout test:**
  - `"` → `{"count":"\"","items":[]}` — escaped, trapped inside stringify's wrapping quotes
  - `}` → `{"count":"}","items":[]}` — inside quotes, harmless
- **Verdict:** `JSON.stringify` wraps the value in quotes AND escapes `"` and `\`. What was a structure position is now a properly-escaped string. Should be **UNCONFIRMED**.

### Correctly handled JSON contexts (3)

| Endpoint | Content-Type | Position | Escaping | Finding | Why correct |
|----------|-------------|----------|----------|---------|-------------|
| `/json-script` | `text/html` | String, raw interpolation | None | CONFIRMED: `" \ , } ] : alphanumeric` | `"` breaks the string, `\` escapes the closing `"`, all structural chars exploitable after breakout. `<` enables `</script>` breakout. |
| `/json-script-structure` | `text/html` | Structure, raw interpolation | None | CONFIRMED: `" \ , } ] : alphanumeric` | Structure position — all chars directly inject into JSON structure. |
| `/json-structure` | `application/json` | Structure, raw interpolation | None | CONFIRMED: `" , } ] :` | Verified: `q=1,"admin":true` → `{"count":1,"admin":true,"items":[]}`. Attacker-controlled keys injected. |

### Status: FIXED

All 3 endpoints now correctly UNCONFIRMED:
- `/json-string` — UNCONFIRMED (was: CONFIRMED `, } ] :`)
- `/json-script-escaped` — UNCONFIRMED (was: CONFIRMED `, } ] : alphanumeric`)
- `/json-script-structure-escaped` — UNCONFIRMED (was: CONFIRMED `, } ] : alphanumeric`)

---

## Test Results Summary

| Category | Endpoints | Findings | Status |
|----------|-----------|----------|--------|
| GET body reflections | 25 | 25 CONFIRMED | 24 PASS, 1 BUG (`/template` missing `<`) |
| JSON response body | 10 | 9 CONFIRMED, 1 UNCONFIRMED | PASS |
| Response headers | 7 | 7 CONFIRMED | PASS |
| Encoded-only | 3 | 2 CONFIRMED, 1 UNCONFIRMED | PASS |
| Multi-context | 1 | 1 CONFIRMED (6 contexts listed) | PASS |
| Escaped variants | 7 | 5 CONFIRMED, 2 UNCONFIRMED | PASS |
| POST reflections | 2 | 2 CONFIRMED (Source: Body) | PASS |
| **Total** | **55** | **55** | **54 PASS, 1 BUG** |

---

## GET Body Reflections — 25/25 PASS

| Endpoint | Context | Allowed chars |
|----------|---------|---------------|
| `/html` | HTML | `< > " ' / ; alphanumeric` |
| `/html-comment` | HTML Comment | `< > - " ' alphanumeric` |
| `/attr-quoted` | Tag Attribute (quoted) | `" ' < > & alphanumeric` |
| `/attr-unquoted` | Tag Attribute (unquoted) | `space > " ' ; = alphanumeric` |
| `/attr-escaped` | Tag Attribute (quoted) | `' alphanumeric` |
| `/js` | Script | `< > / ; ' " \` \\ alphanumeric` |
| `/js-in-quote` | Script String (") | `" \\ ' \` < > / ; alphanumeric` |
| `/css` | Style | `< > / ; ( ) \\ : alphanumeric` |
| `/css-in-quote` | Style String (") | `" \\ ' < > ; ( ) alphanumeric` |
| `/event-handler` | Event Handler (quoted) | `" ' \\ ; ( ) & alphanumeric` |
| `/event-handler-unquoted` | Event Handler (unquoted) | `" ' \\ ; ( ) & space alphanumeric` |
| `/event-handler-escaped` | Event Handler (quoted) | `' \\ ; ( ) alphanumeric` |
| `/url-attr` | URL Attribute (quoted) | `" ' : // ? # & = alphanumeric` |
| `/url-attr-unquoted` | URL Attribute (unquoted) | `" ' : // ? # & = space alphanumeric` |
| `/srcset` | Srcset (quoted) | `" / , alphanumeric` |
| `/srcset-unquoted` | Srcset (unquoted) | `space / , alphanumeric` |
| `/meta-refresh` | Meta Refresh URL | `/ // http: ; : ? # alphanumeric` |
| `/srcdoc` | Srcdoc (quoted) | `" ' < > & alphanumeric` |
| `/srcdoc-unquoted` | Srcdoc (unquoted) | `space < > & alphanumeric` |
| `/style-attr` | Style Attribute (quoted) | `" ' \\ ( ) ; : alphanumeric` |
| `/style-attr-unquoted` | Style Attribute (unquoted) | `" ' \\ ( ) ; : space alphanumeric` |
| `/css-url` | CSS url() + styleAttrInQuote | `" ' \\ ( ) ; : // http: alphanumeric` |
| `/template` | Template HTML | `< > " ' / ; alphanumeric` |
| `/json-script` | JSON Script Block (string) | `" \\ , } ] : alphanumeric` |
| `/json-script-structure` | JSON Script Block | `" \\ , } ] : alphanumeric` |

## JSON Response Body — 10/10 PASS

| Endpoint | Context | Allowed chars | Notes |
|----------|---------|---------------|-------|
| `/json-string` | JSON String | *(none)* | UNCONFIRMED — `" \` escaped by JSON.stringify, sealed string |
| `/json-structure` | JSON Structure | `" , } ] :` | Raw interpolation, structure position |
| `/json-int` | JSON Structure | `" , } ] :` | Raw in integer position |
| `/json-float` | JSON Structure | `" , } ] :` | Raw in float position |
| `/json-bool` | JSON Structure | `" , } ] :` | Raw in boolean position |
| `/json-array-string` | JSON String | `" \ , } ] :` | Raw in array string element — `"` breaks out |
| `/json-array-raw` | JSON Structure | `" , } ] :` | Raw in array raw element |
| `/json-key` | JSON String | `" \ , } ] :` | Raw in object key — `"` breaks out |
| `/json-nested` | JSON String | `" \ , } ] :` | Raw in nested object string — `"` breaks out |
| `/json-multi` | JSON String + Structure | `" \ , } ] :` | 4 reflections across both contexts |

## Response Headers — 7/7 PASS

| Endpoint | Header | Score |
|----------|--------|-------|
| `/header-location` | Location | 70% |
| `/header-set-cookie` | Set-Cookie | 62% |
| `/header-csp` | Content-Security-Policy | 65% |
| `/header-cors` | Access-Control-Allow-Origin | 57% |
| `/header-refresh` | Refresh | 66% |
| `/header-content-disposition` | Content-Disposition | 53% |
| `/header-custom` | X-Debug | 47% |

## Encoded-Only — 3/3 PASS

| Endpoint | Context | Status | Notes |
|----------|---------|--------|-------|
| `/encoded-url` | Tag Attribute (quoted) | CONFIRMED | `' alphanumeric` — `encodeURIComponent` doesn't encode `'` |
| `/encoded-html` | HTML | CONFIRMED | `/ ; alphanumeric` — entity encoding doesn't encode `/` `;` |
| `/encoded-json-unicode` | Script (JSON block, \uXXXX) | UNCONFIRMED | Correct — all chars `\uXXXX` escaped |

## Multi-Context — 1/1 PASS

`/multi` — 6 reflections in: HTML Comment, Tag Attribute (quoted), HTML, URL Attribute (quoted), Script String, Style String. All contexts listed via `; also in` syntax. Combined allowed chars: `< > - " & / ; : // ? # = \\ \` ( ) alphanumeric`.

## POST Reflections — 2/2 PASS

| Endpoint | Context | Source | Allowed chars |
|----------|---------|--------|---------------|
| POST `/html` | HTML | Body | `< > " ' / ; alphanumeric` |
| POST `/js-in-quote` | Script String (") | Body | `" \\ ' \` < > / ; alphanumeric` |

POST findings are created with separate dedupe keys when using a distinct body parameter name, correctly labeled `Source: Body`.

## Escaped Variants — 7/7 PASS

| Escaped Endpoint | Context | Allowed chars | Escaping |
|------------------|---------|---------------|----------|
| `/srcset-escaped` | Srcset (quoted) | `/ , alphanumeric` | HTML entity (`&quot;` `&lt;` `&gt;`) |
| `/srcset-unquoted-escaped` | Srcset (unquoted) | `alphanumeric` | `encodeURIComponent` |
| `/meta-refresh-escaped` | Meta Refresh URL | `alphanumeric` | `encodeURIComponent` |
| `/srcdoc-escaped` | Srcdoc (quoted) | `alphanumeric` | HTML entity (full set incl `&#39;`) |
| `/srcdoc-unquoted-escaped` | Srcdoc (unquoted) | `alphanumeric` | `encodeURIComponent` |
| `/json-script-escaped` | JSON Script Block (string) | *(none)* | UNCONFIRMED — `JSON.stringify` seals string |
| `/json-script-structure-escaped` | JSON Script Block (string) | *(none)* | UNCONFIRMED — `JSON.stringify` seals string |

---

## CRLF Endpoints — Not in scope

`/header-crlf` and `/header-crlf-location` on port 4445 (raw TCP server) are for CRLF injection testing, which is outside Reflector++'s scope of reflected parameter detection. No findings expected.

---

## Fixes verified across rounds

Compared to Round 3 (147 missing chars across 26 endpoints):

1. **Category A (insufficient payloads):** All 9 contexts now probe full char sets — `/js`, `/css`, `/html`, `/html-comment`, `/template`, `/attr-unquoted`, `/attr-quoted`, `/js-in-quote`, `/css-in-quote` all PASS
2. **Category B (partial char sets):** All 9 contexts now report complete chars — event handlers, URL attrs, style attrs, css-url, multi all PASS
3. **Category C (no detect handler):** All 7 contexts now CONFIRMED — srcset, meta-refresh, srcdoc, json-script-block all have `detect()` handlers
4. **Quoted-context blind spot (Round 4):** All 6 previously-UNCONFIRMED quoted contexts now CONFIRMED — `/attr-quoted`, `/event-handler`, `/srcset`, `/srcdoc`, `/style-attr`, `/template`
5. **`/css-url` incomplete chars (Round 5):** Now reports full set including `( ) ; : \\ //`
6. **`/multi` single context (Round 5):** Now lists all 6 reflection contexts via `; also in` syntax
7. **POST deduplication (Round 5):** POST findings now created with method-aware dedupe keys

## Remaining: `/template` missing `<` (Round 8)

Single issue — see top of this report.
