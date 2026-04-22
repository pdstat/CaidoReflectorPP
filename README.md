# Reflector++

A [Caido](https://caido.io) plugin that detects HTTP parameter reflections in responses. It identifies where user-supplied input appears in HTML, JavaScript, CSS, JSON, and HTTP headers, probes which breakout characters pass through unfiltered, and scores findings by injection context and severity.

## Features

- **Active probing** -- sends context-aware probe characters to confirm which ones reflect unescaped
- **25 injection contexts** -- distinguishes script tags, quoted strings, template literals, event handlers, attributes, CSS, JSON, SVG, MathML, import maps, and more
- **Header reflection detection** -- scans response headers for reflected parameter values, including CRLF injection
- **Encoded signal detection** -- identifies URL-encoded (`%XX`), HTML entity (`&lt;`), and JSON Unicode (`\uXXXX`) reflections
- **Request header and path segment reflection** -- detects when `User-Agent`, `Referer`, custom headers, or URL path segments are reflected
- **Severity scoring** -- classifies findings as Critical, High, Medium, Low, or Info based on context and confirmed breakout characters
- **Deduplication** -- prevents duplicate findings for the same parameter/context/endpoint combination
- **Settings UI** -- configure content-type filtering, scope behavior, and encoded finding reporting from the Caido sidebar

## Installation

### From Source

Requires [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/pdstat/CaidoReflectorPP.git
cd CaidoReflectorPP
pnpm install
pnpm build
```

The build produces a plugin zip in `dist/`. Install it in Caido via **Settings > Plugins > Install Package**.

### Development

```bash
pnpm watch    # rebuild on file changes
pnpm typecheck # type-check all packages
pnpm lint     # lint with auto-fix
```

## How It Works

Reflector++ hooks into Caido's `onInterceptResponse` event. For every proxied response:

1. **Parameter enumeration** -- extracts parameters from the URL query string, request body, cookies, selected request headers (`User-Agent`, `Referer`, custom headers), and URL path segments.

2. **Header reflection check** -- scans response headers for literal matches of parameter values. If found, sends a confirmation probe with CRLF markers and header-specific characters.

3. **Content-type gating** -- skips responses whose `Content-Type` doesn't match the configured allowlist (e.g., images and fonts are ignored). Analytics endpoints are also excluded.

4. **Body reflection check** -- parses the response body with an HTML parser to locate each parameter value in the DOM. Determines the injection context (script tag, attribute, CSS block, etc.) and generates context-specific probe characters.

5. **Probe execution** -- sends probe requests with batches of test characters wrapped in random markers. Analyzes the probe response to confirm which characters reflected in a valid injection context.

6. **Encoded signal merging** -- detects when values appear only in encoded form and records them as encoded-only signals.

7. **Scoring and reporting** -- classifies severity based on the confirmed context and breakout characters, then creates a Caido finding with structured data, snippets, and a suggested test payload.

## Detected Contexts

| Context | Description | Example Breakout |
|---------|-------------|-----------------|
| Script | Unquoted JS in `<script>` | `</script><svg onload=...>` |
| Script String | Quoted JS string | `"-alert(1)-"` |
| JS Template Literal | Backtick template string | `` ${alert(1)} `` |
| Event Handler | `on*` attribute | `'-alert(1)-'` |
| JavaScript URI | `javascript:` href/src | `javascript:alert(1)` |
| Data URI | `data:` src/href | `data:text/html,<script>...` |
| HTML | Text content | `<img onerror=...>` |
| HTML Comment | `<!-- ... -->` | `--><svg onload=...>` |
| HTML Base Injection | Early DOM before scripts | `<base href=//evil>` |
| Tag Attribute (quoted) | `attr="value"` | `" onmouseover=...` |
| Tag Attribute (unquoted) | `attr=value` | ` onmouseover=...` |
| Tag Attribute (encoded) | Entity-escaped attribute | Informational |
| RAWTEXT Element | `<textarea>`, `<title>`, etc. | `</title><svg onload=...>` |
| SVG Context | Inside `<svg>` | `<svg><script>...` |
| MathML Context | Inside `<math>` | `<math><mtext><script>...` |
| Style | Unquoted CSS in `<style>` | `</style><svg onload=...>` |
| Style String | Quoted CSS string | `');background:url(//evil)` |
| DOM Clobbering | `id`/`name` attributes | Prototype pollution via named access |
| Import Map | `<script type=importmap>` | Module URL redirection |
| Import Map String | Import map quoted value | Module specifier hijack |
| JSON String | JSON string value | Key/value injection |
| JSON Structure | Unquoted JSON position | Structure manipulation |
| Response Header | Value in response header | Header injection |
| Response Splitting | CRLF in response header | Full response control |

## Severity Model

| Tier | When |
|------|------|
| **Critical** | Response splitting; JS URI; template literal with `${}` or backtick breakout; script with quote breakout or `<` escape; event handler with any chars |
| **High** | Script contexts; event handlers (base); quoted attribute with quote breakout; import maps; data URI with chars; base injection with `<`; `Location`/`Set-Cookie`/`CSP` headers |
| **Medium** | RAWTEXT with closing tag + `<`; SVG/MathML with `<`; HTML with `<`; CSS; unquoted attributes; JSON structure; DOM clobbering; general response headers |
| **Low** | Confirmed reflection without context-specific breakout |
| **Info** | Unconfirmed (literal reflection only, no dangerous chars); encoded-only signals |

## Settings

Access settings from the Caido sidebar under the Reflector++ plugin page.

| Setting | Default | Description |
|---------|---------|-------------|
| Probe out-of-scope requests | Off | Include requests outside Caido's configured scope |
| Check response header reflections | On | Scan response headers for reflected parameter values |
| Log unconfirmed (encoded) findings | Off | Report URL-encoded, HTML-entity, and Unicode-escaped reflections as Info findings |
| Content-Type allowlist | 16 types | MIME types that trigger body reflection scanning (editable, resettable to defaults) |

Default content types: `text/html`, `application/xhtml+xml`, `application/xml`, `text/xml`, `image/svg+xml`, `text/xsl`, `application/vnd.wap.xhtml+xml`, `multipart/x-mixed-replace`, `application/rdf+xml`, `application/mathml+xml`, `application/json`, `text/vtt`, `text/cache-manifest`, and three additional browser-parsed types.

## Finding Format

Each finding includes:

- **Title** -- parameter name, context, and severity
- **Request metadata** -- method, URL, status code, content type, CSP and X-Content-Type-Options presence
- **Per-parameter details** -- source (URL/Body/Cookie/Header/Path), reflected value, confirmation status, reflection count
- **Confirmed characters** -- which probe characters reflected unescaped in the injection context
- **Assessment** -- vulnerability description with a suggested test payload
- **Snippets** -- up to 3 response body excerpts showing the reflection in surrounding context
- **Structured data** -- machine-readable JSON in an HTML comment (`<!-- REFLECTOR_DATA [...] -->`) for automation

Findings are deduplicated by `METHOD:ENDPOINT|param@context`.

## Architecture

```
packages/
  backend/           Caido backend plugin (TypeScript)
    src/
      index.ts                 Event handler registration
      reflector++.ts           Main orchestration
      analysis/
        bodyReflection/        HTML parsing, probe generation, context detection
        headerReflection.ts    Response header scanning
        mergeEncodedSignals.ts Encoded-only signal detection
        scoring.ts             Severity classification
        reporting.ts           Finding report generation
        contextMap.ts          Context normalization (25 canonical contexts)
      payload/
        responseBodyPayloadGenerator.ts    DOM-aware probe generation
        responseHeaderPayloadGenerator.ts  Header-specific probes
        jsonResponseBodyPayloadGenerator.ts JSON body probes
      stores/
        configStore.ts         Runtime settings singleton
        paramStore.ts          Parameter deduplication tracking
        errorStore.ts          Error tracking for retry avoidance
        encodedSignalsStore.ts Encoded signal accumulation
      utils/                   HTTP helpers, parameter enumeration, text matching
      core/                    Types and constants
  frontend/          Caido frontend plugin (Vue 3 + PrimeVue + Tailwind)
    src/
      views/Settings.vue       Settings page
      settings.ts              Settings persistence via Caido Storage SDK
```

## License

See repository for license information.
