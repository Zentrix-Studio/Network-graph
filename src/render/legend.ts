"use strict";

/**
 * Colour / edge legends (R1 + NG-082, redesigned NG-113). All legend content now
 * renders as ONE bottom-left card of stacked sections divided by hairlines —
 * CATEGORY (swatch rows with right-aligned node counts), EDGE TYPE (dashed line
 * samples), EDGE WEIGHT (thickness samples, max sample in accent), or a measure
 * GRADIENT bar — matching the Zentrix chrome look (soft shadow, rounded card,
 * letter-spaced uppercase section titles).
 *
 * Arithmetic layout only, no getBBox. Categorical sections optionally take an
 * `interactive` hook (N6): rows become click-to-cross-filter toggles with dim
 * feedback. The old per-legend exports remain as thin single-section wrappers.
 */

import { Selection } from "d3";
import { Surface, fontFamily, accent } from "../theme/zentrixTokens";
import { lerpColor, sampleScale } from "./colors";

type G = Selection<SVGGElement, unknown, null, undefined>;

const PAD = 14;           // card inner padding
const ROW_H = 26;         // per-item row height
const SWATCH = 12;        // rounded-square swatch side
const TITLE_H = 24;       // section title row height
const RADIUS = 12;        // card corner radius
const DIVIDER_H = 21;     // gap + hairline + gap between sections
const LINE_SAMPLE_W = 40; // edge-weight/type line sample length

export interface LegendItem { label: string; color: string; count?: number }

/** Legend expand/collapse (NG-118): a chevron toggle on the card. When
 *  `collapsed`, the whole card shrinks to a small "LEGEND" pill that re-expands
 *  on click — a viewer-side declutter that doesn't touch the persisted settings. */
export interface LegendCollapse { collapsed: boolean; onToggle: () => void }

export type LegendSection =
    | {
        kind: "swatch"; title: string; items: LegendItem[]; maxItems?: number; dashed?: boolean;
        /** Legend interactivity (N6): rows cross-filter on click; while a row is
         *  `active`, the other rows dim so the filter state reads at a glance. */
        interactive?: { onClick: (i: number) => void; active?: number | null };
    }
    | { kind: "lines"; title: string; samples: { width: number; label: string }[]; color: string; plain?: boolean }
    | { kind: "gradient"; title: string; low: string; high: string; minLabel: string; maxLabel: string; stops?: string[] };

/** A soft drop-shadow filter, created once per card (idempotent per group). */
function ensureShadow(g: G): string {
    const id = "zx-legend-shadow";
    const root = g.append("defs");
    const f = root.append("filter").attr("id", id)
        .attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
    f.append("feDropShadow")
        .attr("dx", 0).attr("dy", 2).attr("stdDeviation", 5)
        .attr("flood-color", "#0B1020").attr("flood-opacity", 0.14);
    return id;
}

/** Approximate text advance (no getBBox). */
function advance(s: string, size = 12): number { return s.length * size * 0.58; }

function sectionRows(s: LegendSection): number {
    if (s.kind === "swatch") {
        const max = s.maxItems ?? 8;
        return Math.min(s.items.length, max) + (s.items.length > max ? 1 : 0);
    }
    if (s.kind === "lines") return s.samples.length;
    return 0; // gradient — fixed-height body
}

function sectionHeight(s: LegendSection): number {
    if (s.kind === "gradient") return TITLE_H + 32;
    return TITLE_H + sectionRows(s) * ROW_H - 6; // last row needs no trailing gap
}

/** Content width a section wants (excluding card padding). */
function sectionWidth(s: LegendSection): number {
    if (s.kind === "gradient") return 150;
    if (s.kind === "lines") {
        const longest = s.samples.reduce((m, x) => Math.max(m, advance(x.label)), advance(s.title, 10));
        return LINE_SAMPLE_W + 14 + longest;
    }
    const max = s.maxItems ?? 8;
    const shown = s.items.slice(0, max);
    let w = advance(s.title, 10) * 1.15; // letter-spaced title
    for (const it of shown) {
        const count = it.count != null ? 18 + advance(String(it.count)) : 0;
        w = Math.max(w, SWATCH + 10 + advance(truncate(it.label, 18)) + count);
    }
    return w;
}

/** Legend corner (NG-125). "auto" = the historical bottom-left. */
export type LegendCorner = "auto" | "tl" | "tr" | "bl" | "br";

/** Top-left (x,y) of a `boxW×boxH` card placed in `corner` of a `width×height`
 *  viewport, and lifted off the bottom edge by `liftBy`. The horizontal edge inset is
 *  `nearInset` (default 12px) — the chrome coordinator raises it so the legend steps
 *  clear of higher-priority chrome sharing the same corner (the quick-action toolbar or
 *  the gear), never overlapping them (NG-136). */
function cornerXY(
    corner: LegendCorner, boxW: number, boxH: number, width: number, height: number, liftBy: number,
    nearInset = 12,
): { x: number; y: number } {
    const M = 12;
    const right = Math.max(M, width - boxW - nearInset);
    const bottom = height - boxH - M - liftBy;
    switch (corner) {
        case "tl": return { x: nearInset, y: M };
        case "tr": return { x: right, y: M };
        case "br": return { x: right, y: bottom };
        default: return { x: nearInset, y: bottom }; // "auto" / "bl"
    }
}

/**
 * Draw the combined legend card. Placed bottom-left by default ("auto"), or in the
 * corner given by `corner` (NG-125), lifted by `liftBy`. Returns the card height so
 * other chrome can stack above it; 0 when there is nothing to draw.
 */
export function renderLegendCard(
    overlay: G, sections: LegendSection[], height: number, surface: Surface,
    hc = false, liftBy = 0, collapse?: LegendCollapse, width = 0, corner: LegendCorner = "auto",
    nearInset = 12,
): number {
    const drawn = sections.filter((s) => sectionRows(s) > 0 || s.kind === "gradient");
    if (!drawn.length) return 0;

    const boxW = Math.min(250, Math.max(150, PAD * 2 + Math.max(...drawn.map(sectionWidth))));
    // Collapsed (NG-118): the whole legend folds to a compact clickable pill.
    if (collapse?.collapsed) return renderCollapsedLegend(overlay, height, surface, hc, liftBy, collapse.onToggle, width, corner, nearInset);

    const boxH = PAD * 2 + drawn.reduce((h, s) => h + sectionHeight(s), 0) + (drawn.length - 1) * DIVIDER_H;
    const { x, y } = cornerXY(corner, boxW, boxH, width, height, liftBy, nearInset);
    const interactive = drawn.some((s) => s.kind === "swatch" && s.interactive);

    // The card captures pointer events when any row cross-filters or the collapse
    // toggle is present; the background rect itself stays click-through so panning
    // works over the card body (only the hit targets below capture).
    const g = overlay.append("g").attr("pointer-events", interactive || collapse ? "auto" : "none");
    // In HC the card is opaque, hard-edged and shadowless — translucency and a
    // soft shadow are colour cues the HC themes deliberately strip.
    const shadowId = hc ? null : ensureShadow(g);
    g.append("rect").attr("x", x).attr("y", y).attr("width", boxW).attr("height", boxH)
        .attr("rx", RADIUS).attr("ry", RADIUS)
        .attr("fill", surface.bg).attr("fill-opacity", hc ? 1 : 0.97)
        .attr("stroke", surface.edge).attr("stroke-opacity", hc ? 1 : 0.25)
        .attr("stroke-width", hc ? 1.5 : 1)
        .style("pointer-events", "none")
        .attr("filter", shadowId ? `url(#${shadowId})` : null);

    // Collapse chevron (NG-118): top-right of the card, pointing down = "fold away".
    // cy aligns with the first section title's optical centre (10px caps → ~y+PAD+8).
    if (collapse) drawCollapseToggle(g, x + boxW - PAD - 3, y + PAD + 8, "down", surface, hc, collapse.onToggle);

    let cy = y + PAD;
    drawn.forEach((s, si) => {
        if (si > 0) {
            // Section divider — a full-width hairline with breathing room on both sides.
            g.append("line")
                .attr("x1", x).attr("y1", cy + 10).attr("x2", x + boxW).attr("y2", cy + 10)
                .attr("stroke", surface.edge).attr("stroke-opacity", hc ? 1 : 0.22);
            cy += DIVIDER_H;
        }
        g.append("text").attr("x", x + PAD).attr("y", cy + 12)
            .attr("font-family", fontFamily).attr("font-size", 10)
            .attr("font-weight", 700).attr("letter-spacing", 1.6)
            .attr("fill", surface.muted).text(s.title.toUpperCase());
        const bodyY = cy + TITLE_H;
        if (s.kind === "swatch") drawSwatchRows(g, s, x, bodyY, boxW, surface, hc);
        else if (s.kind === "lines") drawLineRows(g, s, x, bodyY, surface, hc);
        else drawGradientBody(g, s, x, bodyY, boxW, surface, hc);
        cy += sectionHeight(s);
    });
    return boxH;
}

function drawSwatchRows(
    g: G, s: Extract<LegendSection, { kind: "swatch" }>,
    x: number, y: number, boxW: number, surface: Surface, hc: boolean,
): void {
    const max = s.maxItems ?? 8;
    const shown = s.items.slice(0, max);
    const interactive = s.interactive;
    shown.forEach((it, i) => {
        const ry = y + i * ROW_H;
        // Dim the non-active rows while a legend filter is applied (see hit rect below).
        const rowDim = interactive && interactive.active != null && interactive.active !== i;
        const row = g.append("g").attr("class", "legend-row").attr("opacity", rowDim ? 0.4 : 1) as unknown as G;
        if (s.dashed) {
            // A short line sample (typed-edge legend) instead of a filled square.
            row.append("line")
                .attr("x1", x + PAD).attr("y1", ry + SWATCH / 2)
                .attr("x2", x + PAD + SWATCH + 8).attr("y2", ry + SWATCH / 2)
                .attr("stroke", hc ? surface.fg : it.color).attr("stroke-width", 2.5)
                .attr("stroke-linecap", "round")
                .attr("stroke-dasharray", edgeDashSample(i));
        } else {
            row.append("rect")
                .attr("x", x + PAD).attr("y", ry).attr("width", SWATCH).attr("height", SWATCH)
                .attr("rx", 4).attr("ry", 4)
                .attr("fill", hc ? surface.bg : it.color)
                .attr("stroke", surface.fg)
                .attr("stroke-width", hc ? 1.5 : 1)
                .attr("stroke-opacity", hc ? 1 : 0.08);
        }
        row.append("text").attr("x", x + PAD + SWATCH + 10).attr("y", ry + SWATCH - 1)
            .attr("font-family", fontFamily).attr("font-size", 12).attr("fill", surface.fg)
            .text(truncate(it.label, 18));
        if (it.count != null) {
            row.append("text").attr("x", x + boxW - PAD).attr("y", ry + SWATCH - 1)
                .attr("text-anchor", "end")
                .attr("font-family", fontFamily).attr("font-size", 12)
                .attr("fill", surface.muted).text(String(it.count));
        }
        if (interactive) {
            // Full-row invisible hit target (arithmetic bounds — no getBBox).
            row.append("rect").attr("class", "legend-hit")
                .attr("x", x + 4).attr("y", ry - 6).attr("width", boxW - 8).attr("height", ROW_H)
                .attr("fill", "transparent").style("cursor", "pointer")
                .on("click", (event: MouseEvent) => { event.stopPropagation(); interactive.onClick(i); });
        }
    });
    if (s.items.length > max) {
        const ry = y + shown.length * ROW_H;
        g.append("text").attr("x", x + PAD + SWATCH + 10).attr("y", ry + SWATCH - 1)
            .attr("font-family", fontFamily).attr("font-size", 11).attr("font-style", "italic")
            .attr("fill", surface.muted).text(`+${s.items.length - max} more`);
    }
}

function drawLineRows(
    g: G, s: Extract<LegendSection, { kind: "lines" }>,
    x: number, y: number, surface: Surface, hc: boolean,
): void {
    const maxW = s.samples.reduce((m, v) => Math.max(m, v.width), 0);
    s.samples.forEach((v, i) => {
        const midY = y + i * ROW_H + SWATCH / 2;
        // The heaviest sample is drawn in accent — the screenshot look — so the
        // scale reads "this is the strong end" at a glance. HC keeps fg only.
        // `plain` (req 4) drops the accent override so the whole scale reads in the
        // current link colour when the links aren't drawn in the default grey.
        const isMax = !s.plain && v.width >= maxW && i === s.samples.length - 1;
        g.append("line")
            .attr("x1", x + PAD).attr("y1", midY).attr("x2", x + PAD + LINE_SAMPLE_W).attr("y2", midY)
            .attr("stroke", hc ? surface.fg : (isMax ? accent : s.color))
            .attr("stroke-width", Math.max(0.5, v.width))
            .attr("stroke-linecap", "round")
            .attr("stroke-opacity", hc || isMax ? 1 : 0.85);
        g.append("text").attr("x", x + PAD + LINE_SAMPLE_W + 14).attr("y", midY + 4)
            .attr("font-family", fontFamily).attr("font-size", 12).attr("fill", surface.muted)
            .text(v.label);
    });
}

function drawGradientBody(
    g: G, s: Extract<LegendSection, { kind: "gradient" }>,
    x: number, y: number, boxW: number, surface: Surface, hc: boolean,
): void {
    // HC: a two-colour ramp carries no meaning once only fg/bg are allowed, so the
    // bar becomes a background→foreground ramp — still a readable low→high cue.
    const low = hc ? surface.bg : s.low;
    const high = hc ? surface.fg : s.high;
    const stops = hc ? undefined : s.stops;
    const rampAt = (t: number): string => (stops && stops.length ? sampleScale(stops, t) : lerpColor(low, high, t));

    // Approximate a gradient with fixed stops (no <defs> gradient needed → sandbox-safe, jsdom-testable).
    const steps = 24;
    const barX = x + PAD, barW = boxW - PAD * 2, barH = 12;
    for (let i = 0; i < steps; i++) {
        g.append("rect")
            .attr("x", barX + (barW * i) / steps).attr("y", y)
            .attr("width", barW / steps + 0.6).attr("height", barH)
            .attr("rx", i === 0 || i === steps - 1 ? 2 : 0)
            .attr("fill", rampAt(i / (steps - 1)));
    }
    // HC: outline the ramp, or its background-coloured low end vanishes into the card.
    if (hc) {
        g.append("rect").attr("x", barX).attr("y", y).attr("width", barW).attr("height", barH)
            .attr("rx", 2).attr("fill", "none").attr("stroke", surface.fg).attr("stroke-width", 1.5);
    }
    g.append("text").attr("x", barX).attr("y", y + barH + 14)
        .attr("font-family", fontFamily).attr("font-size", 10).attr("fill", surface.muted).text(truncate(s.minLabel, 9));
    g.append("text").attr("x", barX + barW).attr("y", y + barH + 14).attr("text-anchor", "end")
        .attr("font-family", fontFamily).attr("font-size", 10).attr("fill", surface.muted).text(truncate(s.maxLabel, 9));
}

/* ── legacy single-section wrappers (kept for direct/unit-test callers) ────── */

/** Category → swatch legend as a single-section card. Returns the box height. */
export function renderCategoryLegend(
    overlay: G, items: LegendItem[], height: number, surface: Surface,
    title = "", maxItems = 8, liftBy = 0, dashed = false, hc = false,
    interactive?: { onClick: (i: number) => void; active?: number | null },
): number {
    if (!items.length) return 0;
    return renderLegendCard(overlay, [{ kind: "swatch", title, items, maxItems, dashed, interactive }],
        height, surface, hc, liftBy);
}

/** Dash patterns for typed edges, by type index — shared by the renderer + legend. */
export const EDGE_DASHES: (string | null)[] = [null, "6 4", "2 3", "8 3 2 3", "1 4", "10 4"];
function edgeDashSample(i: number): string | null { return EDGE_DASHES[i % EDGE_DASHES.length]; }

/** Gradient bar legend for measure mode (low → high), as a single-section card. */
export function renderGradientLegend(
    overlay: G, low: string, high: string, minLabel: string, maxLabel: string,
    height: number, surface: Surface, title = "", hc = false, stops?: string[],
): number {
    return renderLegendCard(overlay, [{ kind: "gradient", title, low, high, minLabel, maxLabel, stops }],
        height, surface, hc, 0);
}

/**
 * Edge-weight legend (NG-082) — increasingly thick line samples decoding the
 * weight→thickness mapping (min → mid → max). Only meaningful when weights vary;
 * `widthAt(w)` returns the exact stroke width the renderer uses for weight `w`,
 * so the samples match the canvas.
 */
export function renderEdgeWeightLegend(
    overlay: G, minW: number, maxW: number, widthAt: (w: number) => number,
    color: string, height: number, surface: Surface, title = "Edge weight", liftBy = 0, hc = false,
): number {
    const section = edgeWeightSection(minW, maxW, widthAt, color, title);
    if (!section) return 0;
    return renderLegendCard(overlay, [section], height, surface, hc, liftBy);
}

/** Build the edge-weight `lines` section, or null when weights don't vary. */
export function edgeWeightSection(
    minW: number, maxW: number, widthAt: (w: number) => number, color: string, title = "Edge weight",
): LegendSection | null {
    if (!(maxW > minW)) return null;
    const samples = [minW, (minW + maxW) / 2, maxW].map((w) => ({
        width: widthAt(w), label: String(Math.round(w * 100) / 100),
    }));
    return { kind: "lines", title, samples, color };
}

/* ── expand/collapse (NG-118) ──────────────────────────────────────────────── */

/** Chevron glyph as a stroked polyline (no getBBox): a small ‹v› (down) or ‹^› (up)
 *  centred on (cx, cy). Slim, wide-angle and rounded — reads as a quiet affordance,
 *  not a chunky arrow. `cy` is the OPTICAL centre; the two arms are balanced around it. */
function chevronPath(cx: number, cy: number, dir: "up" | "down"): string {
    const w = 4.5, h = 2.2; // wide + shallow → a gentle, modern chevron
    return dir === "down"
        ? `M ${cx - w} ${cy - h} L ${cx} ${cy + h} L ${cx + w} ${cy - h}`
        : `M ${cx - w} ${cy + h} L ${cx} ${cy - h} L ${cx + w} ${cy + h}`;
}

/** A clickable chevron sitting in a subtle rounded "well" so it reads as a button,
 *  with an invisible square hit target (arithmetic bounds — no getBBox). */
function drawCollapseToggle(
    g: G, cx: number, cy: number, dir: "up" | "down", surface: Surface, hc: boolean, onToggle: () => void,
): void {
    // Faint pill behind the chevron — gives the lone glyph an obvious tap affordance.
    if (!hc) {
        g.append("rect")
            .attr("x", cx - 9).attr("y", cy - 9).attr("width", 18).attr("height", 18)
            .attr("rx", 6).attr("ry", 6)
            .attr("fill", surface.fg).attr("fill-opacity", 0.05)
            .attr("pointer-events", "none");
    }
    g.append("path").attr("d", chevronPath(cx, cy, dir))
        .attr("fill", "none").attr("stroke", surface.muted)
        .attr("stroke-width", 1.6).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
        .attr("pointer-events", "none");
    g.append("rect").attr("class", "legend-collapse")
        .attr("x", cx - 11).attr("y", cy - 11).attr("width", 22).attr("height", 22)
        .attr("fill", "transparent").style("cursor", "pointer").style("pointer-events", "auto")
        .attr("aria-label", "Collapse legend")
        .on("click", (event: MouseEvent) => { event.stopPropagation(); onToggle(); });
}

/** The collapsed state: a compact bottom-left "LEGEND" pill that re-expands on click. */
function renderCollapsedLegend(
    overlay: G, height: number, surface: Surface, hc: boolean, liftBy: number, onToggle: () => void,
    width = 0, corner: LegendCorner = "auto", nearInset = 12,
): number {
    const boxW = 104, boxH = 34;
    const { x, y } = cornerXY(corner, boxW, boxH, width, height, liftBy, nearInset);
    const g = overlay.append("g").attr("pointer-events", "auto");
    const shadowId = hc ? null : ensureShadow(g);
    g.append("rect").attr("x", x).attr("y", y).attr("width", boxW).attr("height", boxH)
        .attr("rx", RADIUS).attr("ry", RADIUS)
        .attr("fill", surface.bg).attr("fill-opacity", hc ? 1 : 0.97)
        .attr("stroke", surface.edge).attr("stroke-opacity", hc ? 1 : 0.25)
        .attr("stroke-width", hc ? 1.5 : 1)
        .style("pointer-events", "none")
        .attr("filter", shadowId ? `url(#${shadowId})` : null);
    g.append("text").attr("x", x + PAD).attr("y", y + boxH / 2 + 3.5)
        .attr("font-family", fontFamily).attr("font-size", 10)
        .attr("font-weight", 700).attr("letter-spacing", 1.6)
        .attr("fill", surface.muted).attr("pointer-events", "none").text("LEGEND");
    // Chevron up = "unfold": expands the card back open (same styled well as the collapse toggle).
    if (!hc) {
        g.append("rect")
            .attr("x", x + boxW - PAD - 12).attr("y", y + boxH / 2 - 9).attr("width", 18).attr("height", 18)
            .attr("rx", 6).attr("ry", 6)
            .attr("fill", surface.fg).attr("fill-opacity", 0.05)
            .attr("pointer-events", "none");
    }
    g.append("path").attr("d", chevronPath(x + boxW - PAD - 3, y + boxH / 2, "up"))
        .attr("fill", "none").attr("stroke", surface.muted)
        .attr("stroke-width", 1.6).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
        .attr("pointer-events", "none");
    g.append("rect").attr("class", "legend-expand")
        .attr("x", x).attr("y", y).attr("width", boxW).attr("height", boxH)
        .attr("fill", "transparent").style("cursor", "pointer").style("pointer-events", "auto")
        .attr("aria-label", "Expand legend")
        .on("click", (event: MouseEvent) => { event.stopPropagation(); onToggle(); });
    return boxH;
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
