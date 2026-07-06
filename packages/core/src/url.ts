/**
 * #89 review follow-up: chain-provided poster strings flow raw into `<img src>`. A malformed or
 * compromised feed could otherwise make a client request an arbitrary origin/scheme (or a
 * `javascript:`/`data:` URL). Deliberately NOT pinning CDN origins here — hosts rotate per chain
 * (Hoyts imgix, Village ctfassets, etc.) and an origin allowlist would be brittle; https-only is
 * the safety property that actually matters for an `<img>` src.
 */
export function safePosterUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" ? v : undefined;
}
