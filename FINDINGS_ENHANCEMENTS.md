# Planned Enhancements

Enhancements identified from integration testing against Brute XSS Gym (x55.is) and real-world gap analysis.

## 1. Request header reflection in response body

Request header values (User-Agent, Referer, X-Forwarded-For, custom headers) reflected in response body are not detected. Reflector++ currently only checks if query/body param values appear in response headers — not the reverse direction.

**Real-world scenario:** Admin panels logging User-Agent or Referer into HTML pages, debug endpoints echoing custom headers into script blocks (XSS Gym p31 reflects the `x` request header into `<script>var headers = '...x:VALUE...';</script>`).

**What to implement:** Add request headers as a new parameter source. During baseline scan, extract values from common request headers and check if they appear literally in the response body. Use the same context detection and probe pipeline as existing body reflections.

**Headers to check:** `User-Agent`, `Referer`, `X-Forwarded-For`, `X-Forwarded-Host`, `Origin`, `Accept-Language`, plus any custom/non-standard headers present in the request.

**Complexity:** Medium. Requires extending the parameter enumeration layer to include header values as sources, and the probe mutation layer to replay requests with modified header values. The rest of the pipeline (context detection, scoring, reporting) works unchanged since it operates on generic reflected parameters.

**Impact:** High. Header-based XSS is under-tested by most tools and commonly found in bug bounty programs.

## 2. URL path segment reflection

URL path segments reflected in response body are not detected. Reflector++ only treats query parameters and POST body parameters as reflection sources.

**Real-world scenario:** REST-style URLs where path components appear in the page (XSS Gym p32 reflects the path segment in `<form action="/gym.php/VALUE">`). Common in frameworks that embed path info in HTML (breadcrumbs, canonical URLs, form actions, Open Graph tags).

**What to implement:** During baseline scan, split the URL path into segments and check if any segment appears literally in the response body. Treat matched segments as parameters with source "Path". Probe by replaying requests with modified path segments.

**Complexity:** Medium-high. Path segment mutation is trickier than query param mutation — need to reconstruct the URL with the modified segment in the right position. Also need heuristics to avoid false positives from common path segments that naturally appear in HTML (e.g., `/api/` appearing in other URLs on the page).

**Impact:** Medium. Less common than query/body reflections but represents a real blind spot, especially for modern SPA frameworks with path-based routing.
