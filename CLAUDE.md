# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reflector++ is a **Caido plugin** that detects HTTP parameter reflections in responses. It identifies literal reflections, header reflections, and encoded reflections, then scores findings by context and severity. It creates Caido findings for security analysis.

## Build & Development Commands

```bash
# Install dependencies (pnpm monorepo)
pnpm install

# Build the Caido plugin (outputs to dist/)
pnpm build

# Watch mode for development
pnpm watch

# Type-check all packages
pnpm typecheck

# Lint with auto-fix
pnpm lint

# Run all backend tests
cd packages/backend && pnpm test

# Run a single test file
cd packages/backend && npx jest tests/<filename>.test.ts
```

## Architecture

**Monorepo** with two packages under `packages/`:

- **backend** — Core reflection detection engine (TypeScript, runs in Caido's Node backend)
- **frontend** — Settings UI (Vue 3 + PrimeVue + TailwindCSS)

### Backend Entry Flow

`index.ts` → registers Caido event handler `onInterceptResponse` → calls `reflector++.ts:run()` which orchestrates:

1. Header reflection check (`analysis/headerReflection.ts`)
2. Content-type gating and analytics endpoint filtering (`utils/http.ts`, `core/constants.ts`)
3. Body reflection check (`analysis/bodyReflection/bodyReflection.ts`)
4. Encoded signal merging (`analysis/mergeEncodedSignals.ts`)
5. Scoring (`analysis/scoring.ts`) and finding creation (`analysis/reporting.ts`)

### Key Directories (backend/src/)

- `analysis/` — Detection logic. `bodyReflection/` handles HTML/JS/JSON context detection, probe generation, and encoded signal detection. `headerReflection.ts` handles response header reflections.
- `payload/` — Payload generators for probing (body, header, JSON contexts)
- `stores/` — Singletons: `configStore` (runtime settings), `paramStore` (tracked params), `errorStore` (error tracking), `encodedSignalsStore`
- `utils/` — HTTP helpers, parameter enumeration, query parsing, text matching
- `core/` — Shared types (`types.ts`) and constants (`constants.ts` — analytics hosts, common words)

### Frontend

Vue 3 app registered at `/reflector-config` in Caido's sidebar. Settings UI controls `ConfigStore` options via registered API methods.

## Module System

TypeScript source uses ESM with `.js` extensions in imports (e.g., `import { foo } from "./bar.js"`). This is required for the Vite build. Jest resolves these via extensive `moduleNameMapper` entries in `jest.config.cjs` — when adding new source files, you may need to add corresponding mappings.

## Plugin Configuration

`caido.config.ts` defines plugin ID `"reflector"` and bundles both packages. CSS is scoped with `prefixwrap` to `#plugin--reflector` to avoid style conflicts in Caido.

## Testing

Jest with ts-jest (ESM preset). All tests live in `packages/backend/tests/`. Tests cover analysis logic, stores, utilities, and payload generation — no integration tests against Caido SDK (SDK types are mocked or typed as `any`).

## Integration Testing with vuln-reflector

**vuln-reflector** (`/mnt/d/hacking/vuln-reflector`) is a deliberately vulnerable Express 5 server that serves as the integration test harness for Reflector++. It reflects user input across ~55 distinct injection contexts without sanitization.

### Starting vuln-reflector

```bash
cd /mnt/d/hacking/vuln-reflector && node server.js
```

This starts two servers:
- **Port 4444** — Express HTTP server (~40 GET/POST endpoints)
- **Port 4445** — Raw TCP server (CRLF injection testing)

### How it works

Every endpoint accepts any query/body parameter name and reflects the first non-empty value into a specific context (HTML text, attributes, JS, CSS, JSON, headers, etc.). The root endpoint `/` lists all available endpoints.

### Endpoint categories

| Category | Examples | Count |
|----------|----------|-------|
| HTML body | `/html`, `/attr-quoted`, `/js`, `/css`, `/event-handler`, `/template` | ~25 |
| JSON response | `/json-string`, `/json-structure`, `/json-key`, `/json-multi` | 10 |
| Header reflection | `/header-location`, `/header-set-cookie`, `/header-csp`, `/header-cors` | 7 |
| Encoded-only | `/encoded-url`, `/encoded-html`, `/encoded-json-unicode` | 3 |
| Escaped variants | `/srcset-escaped`, `/srcdoc-escaped`, `/json-script-escaped` | 7 |
| Multi-context | `/multi` (6 contexts in one response) | 1 |
| POST variants | `POST /html`, `POST /js-in-quote` | 2 |
| Cookie reflection | `/cookie-reflect` (reflects `username` cookie) | 1 |
| CRLF (port 4445) | `/header-crlf`, `/header-crlf-location` | 2 |

### Mandatory testing workflow for new features

When adding new detection capabilities to Reflector++:

1. **Add a test endpoint** to vuln-reflector's `server.js` that exercises the new reflection type
2. **Build the plugin** (`pnpm build`) and load it in Caido
3. **Start vuln-reflector** and proxy traffic through Caido to the test endpoint
4. **Validate findings** using `caido-mode` — retrieve Caido findings to confirm the new reflection is detected correctly with the expected context, severity, and confirmation status

This ensures every detection capability has a corresponding integration test target.

### Known test gaps

`/mnt/d/hacking/vuln-reflector/reflector-bugs.md` tracks known detection gaps in Reflector++ against this harness.

## Caido SDK & Developer Docs

- Developer documentation: https://developer.caido.io
- SDK source and API reference: https://github.com/caido/sdk-js
