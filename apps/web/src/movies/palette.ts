// SOH poster-card caption palette (design/iterations/extractions/soh-DESIGN.md's "Cards and
// surfaces" + "Application guide"): each card gets ONE saturated block colour, cycled across the
// grid. Text is white on every block except mustard, which needs dark ink (explicit design brief
// exception).

/** The 8 SOH `block-*` CSS custom properties, in the design brief's listed order. */
export const BLOCK_PALETTE = [
  "--block-crimson",
  "--block-navy",
  "--block-purple",
  "--block-teal",
  "--block-orange",
  "--block-pink",
  "--block-magenta",
  "--block-mustard",
] as const;

export type BlockToken = (typeof BLOCK_PALETTE)[number];

/** Only mustard needs ink (dark) text; every other block colour is dark enough for white text. */
const INK_TOKENS = new Set<BlockToken>(["--block-mustard"]);

/** Deterministic per-string unit in [0, PALETTE.length) (FNV-1a), so the same group key always
 *  lands on the same block colour across renders/reloads — a stable mosaic, not a random flicker. */
function stableIndex(key: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % modulo;
}

/** Pick a block-palette token for a group/card, deterministic by its key (e.g. the group's
 *  normalized title, or a movieKey for single-entry rows). */
export function blockTokenFor(key: string): BlockToken {
  return BLOCK_PALETTE[stableIndex(key, BLOCK_PALETTE.length)]!;
}

/** Caption text colour for a given block token — ink on mustard, white everywhere else. */
export function blockTextColor(token: BlockToken): "ink" | "white" {
  return INK_TOKENS.has(token) ? "ink" : "white";
}
