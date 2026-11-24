/**
 * Highlighter colours. Each is a hue plus a lightness tier, drawn in OKLCH so equal steps look equally different.
 * A new colour is the candidate (every 5° of hue, both tiers) farthest in OKLab from every existing one.
 */

export interface Colour { id: number; hue: number; tier: number }

export const DEFAULT_COLOURS: Colour[] = [
  { id: 1, hue: 255, tier: 0 }, { id: 2, hue: 20, tier: 0 }, { id: 3, hue: 150, tier: 0 }, { id: 4, hue: 305, tier: 0 },
];
export const MAX_COLOURS = 16;

/** Lightness and chroma per tier, for the light and dark themes. */
const TIERS = [
  { lightness: 0.905, chroma: 0.075, darkLightness: 0.40, darkChroma: 0.085 },
  { lightness: 0.835, chroma: 0.11, darkLightness: 0.32, darkChroma: 0.075 },
];

function toOklab(hue: number, tier: number): [number, number, number] {
  const { lightness, chroma } = TIERS[tier];
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}
const distance = (from: number[], to: number[]) => Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);

export function newColour(existing: Colour[]): Colour {
  let best = { hue: 0, tier: 0 }, bestDistance = -1;
  for (let tier = 0; tier < TIERS.length; tier++)
    for (let hue = 0; hue < 360; hue += 5) {
      const candidate = toOklab(hue, tier);
      const nearest = existing.length
        ? Math.min(...existing.map(colour => distance(candidate, toOklab(colour.hue, colour.tier))))
        : Infinity;
      if (nearest > bestDistance) { bestDistance = nearest; best = { hue, tier }; }
    }
  return { id: Math.max(0, ...existing.map(colour => colour.id)) + 1, ...best };
}

/** CSS custom properties (--p<id>) for both themes, plus the mark/swatch rules that use them. */
export function colourCss(colours: Colour[]): string {
  const light = colours.map(colour => {
    const tier = TIERS[colour.tier];
    return `--p${colour.id}:oklch(${tier.lightness} ${tier.chroma} ${colour.hue})`;
  }).join(";");
  const dark = colours.map(colour => {
    const tier = TIERS[colour.tier];
    return `--p${colour.id}:oklch(${tier.darkLightness} ${tier.darkChroma} ${colour.hue})`;
  }).join(";");
  const rules = colours.map(colour =>
    `mark.c${colour.id}{background:var(--p${colour.id})}.sw[data-colour="${colour.id}"]{background:var(--p${colour.id})}`).join("");
  return `:root{${light}}` +
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}` +
    `:root[data-theme="dark"]{${dark}}` + rules;
}
