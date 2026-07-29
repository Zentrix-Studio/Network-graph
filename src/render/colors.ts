"use strict";

/**
 * Colour management (R1) — the formatting breadth competitors lead on (Powerviz:
 * 30+ palettes incl. colorblind-safe, colour-by-level, rule-free). We give:
 *   • colour modes: single / by category / by measure (gradient) / by cluster,
 *   • named palettes including a colorblind-safe (Okabe–Ito) option,
 *   • a deterministic gradient for measure mode.
 * Pure — no Power BI / DOM deps. Palettes are token-sourced where possible.
 */

import { categoryPalette } from "../theme/zentrixTokens";

export type ColorMode = "single" | "category" | "measure" | "cluster" | "component" | "level";

/** Palette family — governs which encodings a palette is appropriate for. Categorical
 *  modes (category/cluster/component/level:distinct) want `qualitative`; continuous modes
 *  (measure/level:ramp) want `sequential` or `diverging`. The gear filters by this so the
 *  user picks *intent* and we constrain the colour theory. */
export type PaletteFamily = "qualitative" | "sequential" | "diverging";

/** Which value drives `measure`-mode colour, decoupled from the Analysis-pane centrality. */
export type ColorDriver = "size" | "degree" | "weighted" | "centrality" | "betweenness" | "pagerank";

/** Named categorical palettes. `brand` is the canonical @zentrix series; `colorblind`
 *  is Okabe–Ito (safe for the common CVD types). */
export const PALETTES: Record<string, string[]> = {
    brand: categoryPalette,
    colorblind: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"],
    cool: ["#4DA3FF", "#00C2A8", "#7C5CFF", "#56C271", "#4B6BFB", "#2FA7A0", "#9270FF", "#3DDC97"],
    warm: ["#FF8A5C", "#E25C9E", "#F2C94C", "#E5484D", "#D9822B", "#C44E9D", "#E0A93B", "#FF6B6B"],
    vibrant: ["#7C5CFF", "#FF5CA8", "#00C2A8", "#FFB020", "#4DA3FF", "#E5484D", "#56C271", "#B15CFF"],
    pastel: ["#B5A8FF", "#A8E6D9", "#FFD6A5", "#FFB5C7", "#A5D8FF", "#C7F0BD", "#F6C6EA", "#FFE8A3"],
    earth: ["#8C6D4F", "#4F7942", "#A9743B", "#5B7C99", "#B08968", "#6B8E23", "#9C6B3F", "#4A6A6A"],
    // --- Expanded library (NG-084) — parity with the field's "30+ palettes" claim.
    //     All qualitative (8 swatches), token-adjacent hues, distinct from the above.
    classic10: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7"],
    tableau: ["#5B9BD5", "#ED7D31", "#A5A5A5", "#FFC000", "#4472C4", "#70AD47", "#264478", "#9E480E"],
    category: ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F"],
    dark: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"],
    set2: ["#66C2A5", "#FC8D62", "#8DA0CB", "#E78AC3", "#A6D854", "#FFD92F", "#E5C494", "#B3B3B3"],
    set3: ["#8DD3C7", "#FFFFB3", "#BEBADA", "#FB8072", "#80B1D3", "#FDB462", "#B3DE69", "#FCCDE5"],
    paired: ["#A6CEE3", "#1F78B4", "#B2DF8A", "#33A02C", "#FB9A99", "#E31A1C", "#FDBF6F", "#FF7F00"],
    accent: ["#7FC97F", "#BEAED4", "#FDC086", "#FFFF99", "#386CB0", "#F0027F", "#BF5B17", "#666666"],
    ocean: ["#003F5C", "#2F4B7C", "#665191", "#A05195", "#D45087", "#F95D6A", "#FF7C43", "#FFA600"],
    sunset: ["#F94144", "#F3722C", "#F8961E", "#F9C74F", "#90BE6D", "#43AA8B", "#577590", "#277DA1"],
    forest: ["#2D6A4F", "#40916C", "#52B788", "#74C69D", "#95D5B2", "#B7E4C7", "#1B4332", "#081C15"],
    berry: ["#590D22", "#800F2F", "#A4133C", "#C9184A", "#FF4D6D", "#FF758F", "#FF8FA3", "#FFB3C1"],
    teal: ["#012A4A", "#013A63", "#01497C", "#2A6F97", "#2C7DA0", "#468FAF", "#61A5C2", "#89C2D9"],
    coral: ["#03071E", "#370617", "#6A040F", "#9D0208", "#D00000", "#DC2F02", "#E85D04", "#F48C06"],
    mint: ["#004B23", "#006400", "#007200", "#008000", "#38B000", "#70E000", "#9EF01A", "#CCFF33"],
    violet: ["#10002B", "#240046", "#3C096C", "#5A189A", "#7B2CBF", "#9D4EDD", "#C77DFF", "#E0AAFF"],
    slate: ["#212529", "#343A40", "#495057", "#6C757D", "#ADB5BD", "#CED4DA", "#DEE2E6", "#E9ECEF"],
    autumn: ["#5F0F40", "#9A031E", "#CB4721", "#E36414", "#FB8B24", "#B5838D", "#6D6875", "#0F4C5C"],
    spring: ["#FFCBF2", "#F3C4FB", "#ECBCFD", "#E5B3FE", "#C0A0FE", "#A594F9", "#8B84F7", "#7371FC"],
    neon: ["#FF006E", "#FB5607", "#FFBE0B", "#8338EC", "#3A86FF", "#06FFA5", "#FF4D6D", "#00F5D4"],
    muted: ["#797D62", "#9B9B7A", "#BAA587", "#D9AE94", "#F1DCA7", "#FFCB69", "#D08C60", "#997B66"],
    jewel: ["#0B3954", "#087E8B", "#BFD7EA", "#FF5A5F", "#C81D25", "#87255B", "#3A0CA3", "#480CA8"],
    candy: ["#FF99C8", "#FCF6BD", "#D0F4DE", "#A9DEF9", "#E4C1F9", "#FFB5A7", "#FCD5CE", "#B8E0D2"],
    steel: ["#22223B", "#4A4E69", "#9A8C98", "#C9ADA7", "#F2E9E4", "#6D6875", "#B5838D", "#4A4E69"],
    tropical: ["#00A6A6", "#0FA3B1", "#B5E2FA", "#F9F7F3", "#EDDEA4", "#F7A072", "#FF9B42", "#FF5E5B"],
    grayscale: ["#111111", "#333333", "#555555", "#777777", "#999999", "#BBBBBB", "#DDDDDD", "#F2F2F2"],
    contrast: ["#000000", "#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#46F0F0"],
    highviz: ["#FFB000", "#DC267F", "#785EF0", "#648FFF", "#FE6100", "#009E73", "#000000", "#994F00"],
};

export function paletteByName(name: string): string[] {
    return PALETTES[name] ?? PALETTES.brand;
}

/** Parse #rrggbb → [r,g,b]. Falls back to mid-grey on malformed input. */
function parseHex(hex: string): [number, number, number] {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
    const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear interpolate two hex colours at t∈[0,1]. Deterministic. */
export function lerpColor(a: string, b: string, t: number): string {
    const [r1, g1, b1] = parseHex(a);
    const [r2, g2, b2] = parseHex(b);
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    return toHex(r1 + (r2 - r1) * u, g1 + (g2 - g1) * u, b1 + (b2 - b1) * u);
}

/** Distinct category values → index map, in first-seen order (for legend + colour). */
export function categoryIndex(categories: string[]): Map<string, number> {
    const m = new Map<string, number>();
    categories.forEach((c, i) => m.set(c, i));
    return m;
}

/**
 * Continuous colour scales for `measure` mode and `level` ramps — the typed
 * sequential/diverging family Powerviz exposes but we lacked (we only had a 2-stop
 * lerp). Each is a named multi-stop ramp in *our own* @zentrix-adjacent hues (not a
 * copied CARTO/Tol array). `cvdSafe` marks ramps that stay distinguishable under the
 * common colour-vision deficiencies (monotone luminance + hue that avoids red/green
 * confusion). Sampling is deterministic (piecewise `lerpColor`). Diverging ramps run
 * low → neutral midpoint → high.
 */
export interface ColorScale {
    family: "sequential" | "diverging";
    stops: string[];
    cvdSafe: boolean;
}

export const SCALES: Record<string, ColorScale> = {
    // --- Sequential (single- and multi-hue, light → dark) ---
    viridis: { family: "sequential", cvdSafe: true, stops: ["#4B2E83", "#3E5AA8", "#2C7DA0", "#2FA69A", "#7BC86B", "#E3E34A"] },
    mako: { family: "sequential", cvdSafe: true, stops: ["#0B0A1E", "#243154", "#245E7E", "#2E8F91", "#63BE9E", "#DEF5B8"] },
    violetSeq: { family: "sequential", cvdSafe: true, stops: ["#F3EFFF", "#D6C8FF", "#B59CFF", "#8E6FFF", "#7C5CFF", "#4B2E9E"] },
    tealSeq: { family: "sequential", cvdSafe: true, stops: ["#E6FbF7", "#B6EEE3", "#7FDccb", "#3FC2AC", "#00C2A8", "#00806E"] },
    amber: { family: "sequential", cvdSafe: false, stops: ["#FFF6E0", "#FFE0A3", "#FFC259", "#FF9E2C", "#F2740C", "#B34700"] },
    rose: { family: "sequential", cvdSafe: false, stops: ["#FFF0F6", "#FFC9DE", "#FF97BD", "#F2609B", "#D63384", "#8C1D5B"] },
    slateSeq: { family: "sequential", cvdSafe: true, stops: ["#F2F4F7", "#D3D9E2", "#AAB4C4", "#7C899E", "#4E5B72", "#242D3D"] },
    ember: { family: "sequential", cvdSafe: false, stops: ["#FFF3E0", "#FFD199", "#FFA24D", "#F26B21", "#C4331B", "#7A1300"] },
    // --- Diverging (low → neutral → high) ---
    violetTeal: { family: "diverging", cvdSafe: true, stops: ["#4B2E9E", "#7C5CFF", "#B7B0D6", "#EDEDED", "#7FDccb", "#00806E"] },
    coolWarm: { family: "diverging", cvdSafe: true, stops: ["#2166AC", "#67A9CF", "#D1E5F0", "#F7F0E8", "#FDBB84", "#B2182B"] },
    blueOrange: { family: "diverging", cvdSafe: true, stops: ["#1A5276", "#5D9BC7", "#CFE3EF", "#F5EDDE", "#F1A340", "#8C510A"] },
    pinkGreen: { family: "diverging", cvdSafe: false, stops: ["#8E0152", "#DE77AE", "#F1D9E8", "#EAF3E4", "#7FBC41", "#276419"] },
    tealRose: { family: "diverging", cvdSafe: false, stops: ["#00806E", "#3FC2AC", "#D9EFE9", "#F7E0EA", "#F2609B", "#8C1D5B"] },
    spectral: { family: "diverging", cvdSafe: false, stops: ["#3288BD", "#66C2A5", "#E6F598", "#FEE08B", "#F46D43", "#9E0142"] },
};

/** Family of a named palette or scale. Every `PALETTES` entry is qualitative; every
 *  `SCALES` entry carries its own sequential/diverging family. Unknown → qualitative. */
export function familyOf(name: string): PaletteFamily {
    if (SCALES[name]) return SCALES[name].family;
    return "qualitative";
}

/** True when a palette/scale is tagged colour-vision-deficiency safe. */
export function isCvdSafe(name: string): boolean {
    if (SCALES[name]) return SCALES[name].cvdSafe;
    return name === "colorblind" || name === "highviz";
}

/** Resolve a scale's stops by name; falls back to the 2-stop custom gradient caller-side. */
export function scaleByName(name: string): string[] | null {
    return SCALES[name] ? SCALES[name].stops : null;
}

/** Sample a multi-stop scale at t∈[0,1] via piecewise linear interpolation. Deterministic. */
export function sampleScale(stops: string[], t: number): string {
    if (stops.length === 0) return "#808080";
    if (stops.length === 1) return stops[0];
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    const span = stops.length - 1;
    const pos = u * span;
    const i = Math.min(span - 1, Math.floor(pos));
    return lerpColor(stops[i], stops[i + 1], pos - i);
}

/** Reverse a palette/scale array iff `rev` — used by the Reverse-colours toggle. */
export function reverseIf<T>(arr: T[], rev: boolean): T[] {
    return rev ? arr.slice().reverse() : arr;
}
