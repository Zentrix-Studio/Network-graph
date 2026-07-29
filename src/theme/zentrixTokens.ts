"use strict";

/**
 * Zentrix Design System — token snapshot for the Network Graph pbiviz build.
 *
 * THIS FILE IS A HAND-MAINTAINED SNAPSHOT of the canonical tokens at
 * `@zentrix/packages/tokens/src/` — the SAME approach the Calendar Heatmap uses
 * (Z-148). pbiviz's webpack compiles an isolated sandbox and cannot resolve the
 * pnpm workspace symlink to `@zentrix/tokens` at bundle time, so the visual
 * imports these static values instead of the package directly. Keep them in sync
 * when canonical changes; never invent values here.
 *
 * Sourced from `@zentrix/packages/tokens/src/`:
 *   palettes.ts   — accent family + the 8-color categorical series
 *   themes.ts     — dark/light surface + text scales
 *   typography.ts — sans font stack
 */

/** Brand accent — canonical `palettes.aurora.accent` (#7C5CFF violet). */
export const accent = "#7C5CFF";
/** Accent strong — canonical `accentStrong` (#6344E0), for emphasized chrome. */
export const accentStrong = "#6344E0";
/** CVD-safe good/bad (Okabe–Ito) — matches the heatmap's tooltip tones (Z-148). */
export const posSafe = "#0072B2";
export const negSafe = "#E69F00";

/** UI font stack — canonical `typography.fontFamily.sans` (sandbox-safe fallback). */
export const fontFamily = "'Inter', system-ui, -apple-system, sans-serif";

/**
 * Categorical palette for node categories / clusters — the canonical 8-color
 * series from `palettes.ts` (accent-led, colour-blind-considerate ordering).
 */
export const categoryPalette = [
    "#7C5CFF", "#00C2A8", "#FF8A5C", "#4DA3FF",
    "#F2C94C", "#E25C9E", "#56C271", "#B59CFF",
];

export interface Surface {
    /** Canvas background. */
    bg: string;
    /** Primary text / node stroke. */
    fg: string;
    /** Muted text. */
    muted: string;
    /** Node default fill when no category is bound. */
    nodeDefault: string;
    /** Edge stroke (rendered at reduced opacity). */
    edge: string;
    /** Emphasis colour for the current selection. Optional: falls back to `fg`.
     *  In high contrast this is the host's `foregroundSelected` role. */
    selected?: string;
}

// Dark theme — canonical themes.dark (base surface + text scale).
const DARK: Surface = {
    bg: "#0A0A0F",        // surface.base
    fg: "#F4F4F6",        // text.primary
    muted: "#A6A6B5",     // text.secondary
    nodeDefault: "#B59CFF", // brand ramp light end
    edge: "#70707F",      // text.tertiary
};

// Light theme — canonical themes.light.
const LIGHT: Surface = {
    bg: "#FFFFFF",        // surface.card
    fg: "#15161E",        // text.primary
    muted: "#54566B",     // text.secondary
    nodeDefault: "#6344E0", // accentStrong
    edge: "#8A8C9E",      // text.tertiary
};

// High contrast — LAST-RESORT fallback only. Power BI ships several HC themes
// (black-on-white "Desert" and "White", yellow-on-black "Night sky", …), so a
// hard-coded black/white pair is wrong for most of them. The real colours come
// from `host.colorPalette` and are threaded in via `hcSurface` below; these
// values only apply when the host hands us no roles at all.
const HIGH_CONTRAST: Surface = {
    bg: "#000000",
    fg: "#FFFFFF",
    muted: "#FFFFFF",
    nodeDefault: "#FFFFFF",
    edge: "#FFFFFF",
    selected: "#FFFFFF",
};

/**
 * The high-contrast roles Power BI exposes on `host.colorPalette` when
 * `isHighContrast` is true. Only these four colours may be used in HC — no
 * brand hex, no categorical palette (see the Power BI HC guidance). Category /
 * cluster encoding therefore falls back to shape, dash pattern and outline.
 */
export interface HCRoles {
    foreground?: string;
    background?: string;
    foregroundSelected?: string;
    hyperlink?: string;
}

/** Build the surface palette from the host's actual high-contrast roles. */
export function hcSurface(roles?: HCRoles): Surface {
    const fg = roles?.foreground || HIGH_CONTRAST.fg;
    const bg = roles?.background || HIGH_CONTRAST.bg;
    return {
        bg,
        fg,
        muted: fg,        // no dimmed text in HC — everything is full-contrast
        nodeDefault: fg,
        edge: fg,
        selected: roles?.foregroundSelected || roles?.hyperlink || fg,
    };
}

/** Resolve the surface palette for the current theme. In high contrast the
 *  host's own roles win over any built-in value. */
export function resolveSurface(dark: boolean, highContrast: boolean, hcRoles?: HCRoles): Surface {
    if (highContrast) return hcSurface(hcRoles);
    return dark ? DARK : LIGHT;
}
