"use strict";

/**
 * Canvas render path for LARGE graphs (scale mode). The SVG path in `graph.ts` gives
 * one DOM element per node/edge — great for interaction, but a browser stalls past a
 * few thousand elements. Beyond a threshold the visual draws the bulk (edges + node
 * discs) to a single <canvas> instead, so 10k+ nodes / 50k+ edges paint in one pass
 * with no DOM cost. Labels, the hovered/selected ring, and overlays stay in SVG on top
 * (computed, never `getBBox`), and node hit-testing is arithmetic (`pickNodeAt`).
 *
 * Pure w.r.t. the drawing surface: it takes a minimal 2D-context interface, so it is
 * unit-tested with a recording mock (jsdom has no real canvas). No Power BI / DOM deps.
 */

import { GraphModel, Vec2 } from "../model/graphTypes";
import { edgeOffsetPx, edgeOpacityFor, edgeRanks, pairPerp } from "./graph";
import { getSemanticIcon } from "../interaction/iconCatalog";

/** The subset of CanvasRenderingContext2D we use — real ctx satisfies it structurally. */
export interface Ctx2D {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo?(cpx: number, cpy: number, x: number, y: number): void;
    arc(x: number, y: number, r: number, start: number, end: number): void;
    fill(): void;
    stroke(): void;
    fillText(text: string, x: number, y: number): void;
    strokeStyle: string;
    fillStyle: string;
    lineWidth: number;
    globalAlpha: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
}

/** Screen transform: world → screen is `screen = world · k + t`. */
export interface ViewTransform { k: number; tx: number; ty: number; }

export interface CanvasDrawParams {
    /** Node positions in WORLD (post-fit) coordinates, parallel to model.nodes. */
    px: Vec2[];
    radiusOf: (i: number) => number;
    colorOf: (i: number) => string;
    /** Node fill opacity 0..1 (R1). Undefined = fully opaque. Multiplies the dim alpha. */
    nodeOpacity?: number;
    /** Base edge colour, and an optional per-edge override (typed edges). */
    edgeColor: string;
    edgeColorOf?: (li: number) => string | null;
    /** Per-edge stroke width (already weight-scaled, as in the SVG path). */
    edgeWidthOf: (li: number) => number;
    /** Global edge curvature 0..100. Tree passes 100 automatically. */
    edgeCurve?: number;
    nodeStroke: string;
    /** CSS pixel viewport. */
    width: number;
    height: number;
    /** Device-pixel ratio for crisp lines on HiDPI (1 in tests / SSR). */
    dpr: number;
    view: ViewTransform;
    /** Optional dimming (selection): dimmed items draw faint but stay on canvas. */
    isDimNode?: (i: number) => boolean;
    isDimEdge?: (li: number) => boolean;
    /** Contextual non-tree relationship in Tree mode. */
    edgeSecondaryOf?: (li: number) => boolean;
    /** Optional hard hide (Top-N ranking / ego mask / collapsed subtree): hidden
     *  items are skipped entirely, matching the SVG path's `display:none`. */
    isHiddenNode?: (i: number) => boolean;
    isHiddenEdge?: (li: number) => boolean;
    /** Per-node border override (parent-node emphasis); null = the default stroke. */
    strokeOf?: (i: number) => { color: string; width: number } | null;
    /** Optional symbol painted instead of the coloured node disc. */
    iconOf?: (i: number) => string | null;
    /** Hide all edges (req 1: links off / hover-only). Nodes still draw. Canvas has no
     *  per-edge DOM, so hover-reveal is handled by the SVG overlay, not here. */
    hideEdges?: boolean;
}

const DIM_ALPHA = 0.06;

/** World-space rectangle currently visible on screen, expanded by `margin` world units. */
export function visibleWorldRect(view: ViewTransform, width: number, height: number, margin: number):
    { minX: number; minY: number; maxX: number; maxY: number } {
    const { k, tx, ty } = view;
    const kk = k || 1;
    return {
        minX: (0 - tx) / kk - margin,
        minY: (0 - ty) / kk - margin,
        maxX: (width - tx) / kk + margin,
        maxY: (height - ty) / kk + margin,
    };
}

const inRect = (p: Vec2, r: { minX: number; minY: number; maxX: number; maxY: number }): boolean =>
    p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/**
 * Draw the whole graph to a canvas context. Returns how many nodes/edges were actually
 * painted (after viewport culling) so the caller can post an honest "showing N of M".
 * Edges are batched into one path per distinct stroke colour to keep state changes O(colours)
 * rather than O(edges) — the difference between smooth and janky at 50k edges.
 */
export function drawGraph(ctx: Ctx2D, model: GraphModel, p: CanvasDrawParams): { nodes: number; edges: number } {
    const { view, width, height, dpr } = p;
    // Clear in device space, then map world → device (zoom · dpr) so we draw in world coords.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(view.k * dpr, 0, 0, view.k * dpr, view.tx * dpr, view.ty * dpr);

    let maxR = 1;
    for (let i = 0; i < model.nodes.length; i++) maxR = Math.max(maxR, p.radiusOf(i));
    const rect = visibleWorldRect(view, width, height, maxR + 2);

    // --- Edges (under nodes), batched by colour; self-loops skipped (rare, drawn in SVG) ---
    const byStyle = new Map<string, { color: string; alpha: number; links: number[] }>();
    let dimEdges: number[] | null = null;
    for (let li = 0; li < model.links.length; li++) {
        if (p.hideEdges) break; // req 1: links hidden — draw nodes only
        const l = model.links[li];
        if (l.source === l.target) continue;
        if (p.isHiddenEdge && p.isHiddenEdge(li)) continue; // ranking / ego / collapse mask
        const a = p.px[l.source], b = p.px[l.target];
        if (!inRect(a, rect) && !inRect(b, rect)) continue; // both endpoints off-screen
        if (p.isDimEdge && p.isDimEdge(li)) { (dimEdges ??= []).push(li); continue; }
        const col = (p.edgeColorOf && p.edgeColorOf(li)) || p.edgeColor;
        const alpha = p.edgeSecondaryOf?.(li) ? 0.22 : -1;
        const key = `${col}\u0000${alpha}`;
        const bucket = byStyle.get(key);
        if (bucket) bucket.links.push(li);
        else byStyle.set(key, { color: col, alpha, links: [li] });
    }

    let edgeCount = 0;
    const curveFrac = Math.max(0, Math.min(100, p.edgeCurve ?? 0)) / 100;
    const curveRanks = curveFrac > 0 ? edgeRanks(model) : null;
    const strokeBucket = (lis: number[], color: string, alpha: number): void => {
        // Group by width within a colour so lineWidth changes stay minimal.
        const byWidth = new Map<number, number[]>();
        for (const li of lis) {
            const w = Math.round(p.edgeWidthOf(li) * 2) / 2; // 0.5px buckets
            const g = byWidth.get(w); if (g) g.push(li); else byWidth.set(w, [li]);
        }
        ctx.strokeStyle = color;
        for (const [w, group] of byWidth) {
            ctx.lineWidth = w;
            ctx.globalAlpha = alpha < 0 ? edgeOpacityFor(w) : alpha;
            ctx.beginPath();
            for (const li of group) {
                const l = model.links[li];
                const a = p.px[l.source], b = p.px[l.target];
                ctx.moveTo(a.x, a.y);
                if (curveFrac > 0 && ctx.quadraticCurveTo) {
                    const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                    const [px, py] = pairPerp(p.px[lo], p.px[hi]);
                    const off = edgeOffsetPx(curveRanks?.[li] ?? 0, curveFrac);
                    ctx.quadraticCurveTo(
                        (a.x + b.x) / 2 + px * off,
                        (a.y + b.y) / 2 + py * off,
                        b.x,
                        b.y,
                    );
                } else {
                    ctx.lineTo(b.x, b.y);
                }
                edgeCount++;
            }
            ctx.stroke();
        }
    };
    for (const bucket of byStyle.values()) {
        strokeBucket(bucket.links, bucket.color, bucket.alpha);
    }
    if (dimEdges) strokeBucket(dimEdges, p.edgeColor, DIM_ALPHA);

    // --- Nodes (discs) on top of edges ---
    let nodeCount = 0;
    ctx.globalAlpha = 1;
    for (let i = 0; i < model.nodes.length; i++) {
        if (p.isHiddenNode && p.isHiddenNode(i)) continue; // ranking / ego / collapse mask
        const c = p.px[i];
        if (!inRect(c, rect)) continue;
        const r = p.radiusOf(i);
        ctx.globalAlpha = (p.isDimNode && p.isDimNode(i) ? DIM_ALPHA : 1) * (p.nodeOpacity ?? 1);
        const glyph = p.iconOf?.(i);
        if (glyph) {
            const semantic = getSemanticIcon(glyph);
            const real = ctx as unknown as CanvasRenderingContext2D;
            if (semantic && typeof Path2D !== "undefined" && typeof real.save === "function") {
                real.save();
                real.translate(c.x - r, c.y - r);
                real.scale(r / 12, r / 12);
                real.strokeStyle = p.colorOf(i);
                real.lineWidth = 1.8;
                real.lineCap = "round";
                real.lineJoin = "round";
                for (const d of semantic.paths) real.stroke(new Path2D(d));
                real.restore();
            } else if (semantic) {
                // Recording/test contexts deliberately implement only the tiny Ctx2D
                // contract. Preserve a visible marker without leaking the persisted id.
                ctx.fillStyle = p.colorOf(i);
                ctx.beginPath();
                ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Legacy data/report glyph compatibility.
                ctx.fillStyle = p.colorOf(i);
                ctx.font = `700 ${Math.max(8, r * 1.7)}px 'Segoe UI Symbol','Arial Unicode MS',sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(glyph, c.x, c.y);
            }
            nodeCount++;
            continue;
        }
        ctx.fillStyle = p.colorOf(i);
        const stroke = p.strokeOf ? p.strokeOf(i) : null; // parent-node border override
        ctx.strokeStyle = stroke ? stroke.color : p.nodeStroke;
        ctx.lineWidth = stroke ? stroke.width : 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        nodeCount++;
    }
    ctx.globalAlpha = 1;
    return { nodes: nodeCount, edges: edgeCount };
}

/**
 * Arithmetic node hit-test for canvas mode (no DOM). Returns the index of the topmost
 * node under a WORLD-space point (nodes drawn later paint on top, so scan back-to-front),
 * or -1. Screen→world is `world = (screen - t) / k`, done by the caller.
 */
export function pickNodeAt(
    px: Vec2[],
    radiusOf: (i: number) => number,
    wx: number,
    wy: number,
    isHiddenNode?: (i: number) => boolean,
): number {
    for (let i = px.length - 1; i >= 0; i--) {
        if (isHiddenNode?.(i)) continue;
        const c = px[i];
        const r = radiusOf(i);
        const dx = wx - c.x, dy = wy - c.y;
        if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
}
