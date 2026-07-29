"use strict";

/**
 * Scale-mode helpers (Enterprise E1): level-of-detail label gating, a minimap
 * overview, and the honest truncation note. Pure/deterministic, no getBBox.
 */

import { Selection } from "d3";
import { Vec2 } from "../model/graphTypes";
import { ZoomState } from "../interaction/zoom";
import { Surface, fontFamily } from "../theme/zentrixTokens";

type G = Selection<SVGGElement, unknown, null, undefined>;

/** Beyond this many nodes, labels collapse to dots unless the user has zoomed in
 *  (level-of-detail). Keeps a large graph legible instead of a wall of text. */
export const LABEL_LOD_LIMIT = 300;

/** Node-radius settings are authored for a normal 600px-or-taller graph.
 * Smaller tiles smoothly reduce both ends of the radius range so large bubbles
 * cannot consume the canvas. Large tiles keep the authored pixel values; the
 * visual never silently enlarges them beyond the author's chosen maximum. */
export const RESPONSIVE_RADIUS_BASE_SIDE = 600;
export const RESPONSIVE_RADIUS_MIN_SCALE = 0.35;
/** Automatic default-range sizing is anchored to the approved Top-500 view:
 * untouched 4–40px settings become an effective 1–5px range at 500 nodes. */
export const NODE_COUNT_RADIUS_ANCHOR_COUNT = 500;
export const NODE_COUNT_RADIUS_ANCHOR_SCALE = 0.125;
export const NODE_COUNT_RADIUS_MIN_SCALE = 0.025;

/** Responsive multiplier for authored node radii. The shorter viewport side is
 * the limiting dimension because the graph fit preserves its aspect ratio. */
export function responsiveNodeRadiusScale(width: number, height: number): number {
    const w = Number.isFinite(width) ? Math.max(0, width) : RESPONSIVE_RADIUS_BASE_SIDE;
    const h = Number.isFinite(height) ? Math.max(0, height) : RESPONSIVE_RADIUS_BASE_SIDE;
    return clampN(
        Math.min(w, h) / RESPONSIVE_RADIUS_BASE_SIDE,
        RESPONSIVE_RADIUS_MIN_SCALE,
        1,
    );
}

/** Count-driven radius multiplier for the untouched default range. The square
 * root keeps aggregate node area roughly stable while anchoring 500 nodes at
 * 0.125× (default 4–40px becomes 1–5px after the 1px safety floor). */
export function nodeCountRadiusScale(visibleNodeCount: number): number {
    const count = Number.isFinite(visibleNodeCount)
        ? Math.max(1, visibleNodeCount)
        : NODE_COUNT_RADIUS_ANCHOR_COUNT;
    return clampN(
        NODE_COUNT_RADIUS_ANCHOR_SCALE * Math.sqrt(NODE_COUNT_RADIUS_ANCHOR_COUNT / count),
        NODE_COUNT_RADIUS_MIN_SCALE,
        1,
    );
}

/** Whether labels should draw at all, given the base toggle, size, and zoom. */
export function lodShowLabels(baseShow: boolean, nodeCount: number, zoomK: number): boolean {
    if (!baseShow) return false;
    if (nodeCount <= LABEL_LOD_LIMIT) return true;
    return zoomK >= 1.6; // zoomed in enough to read a subset
}

/** One top-left status card for ranking and edge-budget messages. Keeping the
 * lines in a shared background prevents independently-rendered notices from
 * occupying the same y coordinate. Returns the card's bottom edge. */
export function renderGraphStatus(
    overlay: G, lines: readonly string[], w: number, surface: Surface,
): number {
    if (!lines.length) return 8;
    const x = 8, y = 8, lineHeight = 16;
    const height = 10 + lines.length * lineHeight;
    // Reserve the right side for the information glyph so even the longest
    // status line cannot run underneath it.
    const estimated = 40 + Math.max(...lines.map((line) => Array.from(line).length)) * 6.4;
    const width = Math.max(0, Math.min(Math.max(210, estimated), w - 16));
    const group = overlay.append("g").classed("zx-graph-status", true)
        .attr("pointer-events", "none")
        .attr("role", "status");
    group.append("rect")
        .attr("x", x).attr("y", y).attr("width", width).attr("height", height)
        .attr("rx", 6).attr("fill", surface.bg).attr("fill-opacity", 0.92)
        .attr("stroke", surface.edge);
    lines.forEach((line, index) => {
        group.append("text")
            .attr("x", x + 8).attr("y", y + 15 + index * lineHeight)
            .attr("font-family", fontFamily).attr("font-size", 11)
            .attr("font-weight", index === 0 ? 600 : 400)
            .attr("fill", index === 0 ? surface.fg : surface.muted)
            .text(line);
    });

    // Robust SVG information icon (rather than a font glyph whose appearance
    // varies by host). The group alone accepts pointer events so its native title
    // is reachable without making the status card intercept graph interaction.
    const infoX = x + width - 15;
    const infoY = y + 14;
    const info = group.append("g").classed("zx-graph-status-info", true)
        .attr("pointer-events", "all")
        .attr("cursor", "help")
        .attr("role", "img")
        .attr("aria-label", "About graph limits");
    info.append("title").text(
        "Filter controls which nodes are shown. All available relationships are retained by default; "
        + "set a positive Max edges value in Scale only when you want a performance cap.",
    );
    info.append("circle")
        .attr("cx", infoX).attr("cy", infoY).attr("r", 6.5)
        .attr("fill", "none").attr("stroke", surface.muted).attr("stroke-width", 1.4);
    info.append("circle")
        .attr("cx", infoX).attr("cy", infoY - 2.4).attr("r", 0.9)
        .attr("fill", surface.muted);
    info.append("path")
        .attr("d", `M${infoX},${infoY}v4`)
        .attr("fill", "none").attr("stroke", surface.muted)
        .attr("stroke-width", 1.5).attr("stroke-linecap", "round");
    return y + height;
}

/**
 * Minimap overview: all nodes as dots in a small box, with a rectangle marking
 * the currently-visible region (derived from the zoom transform). Node positions
 * are in the pre-zoom fit space (≈ the viewport rect at k=1).
 */
export function renderMinimap(
    overlay: G, positionsPx: Vec2[], zoom: ZoomState, w: number, h: number, surface: Surface,
): void {
    if (!positionsPx.length) return;
    const MW = 96, MH = 72, PAD = 8;
    const mx = w - MW - 10;
    const my = h - MH - 62; // sit ABOVE the bottom-right gear so they never overlap

    // Fit space is ≈ [0,w]×[0,h]; map it into the minimap box.
    const sx = (x: number) => mx + PAD + (x / w) * (MW - 2 * PAD);
    const sy = (y: number) => my + PAD + (y / h) * (MH - 2 * PAD);

    const g = overlay.append("g").attr("pointer-events", "none");
    g.append("rect")
        .attr("x", mx).attr("y", my).attr("width", MW).attr("height", MH)
        .attr("rx", 5).attr("fill", surface.bg).attr("fill-opacity", 0.9).attr("stroke", surface.edge);

    for (const p of positionsPx) {
        g.append("circle").attr("cx", sx(p.x)).attr("cy", sy(p.y)).attr("r", 1)
            .attr("fill", surface.muted);
    }

    // Visible world rect = inverse zoom of the screen [0,0,w,h].
    const vx0 = (0 - zoom.tx) / zoom.k;
    const vy0 = (0 - zoom.ty) / zoom.k;
    const vx1 = (w - zoom.tx) / zoom.k;
    const vy1 = (h - zoom.ty) / zoom.k;
    g.append("rect")
        .attr("x", sx(clampN(vx0, 0, w))).attr("y", sy(clampN(vy0, 0, h)))
        .attr("width", Math.max(2, (clampN(vx1, 0, w) - clampN(vx0, 0, w)) / w * (MW - 2 * PAD)))
        .attr("height", Math.max(2, (clampN(vy1, 0, h) - clampN(vy0, 0, h)) / h * (MH - 2 * PAD)))
        .attr("fill", "none").attr("stroke", surface.fg).attr("stroke-width", 1);
}

function clampN(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}
