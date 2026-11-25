import { getDomain } from "tldts";

/**
 * Key that probe limits are shared under: the registrable domain, because WAF and CDN
 * rate limits apply at the edge, which usually fronts every subdomain of a site.
 *
 * Hosts with no registrable domain (IP addresses, `localhost`, intranet names) are
 * keyed by the lowercased host itself.
 *
 * Args:
 *   host: Request host, without port.
 *
 * Returns:
 *   The limiter key, e.g. `example.co.uk` for `api.example.co.uk`.
 */
export function hostKey(host: string): string {
  const lower = host.toLowerCase();
  return getDomain(lower, { allowPrivateDomains: false }) ?? lower;
}
