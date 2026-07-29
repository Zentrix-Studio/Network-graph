"use strict";

/**
 * Convex-hull shading for clusters (Enterprise feature E2). Draws a soft padded
 * polygon behind each community so the graph's structure reads at a glance.
 * Pure geometry (Andrew's monotone chain) — deterministic, no getBBox, no deps.
 *
 * Coverage (NG-135): the outline is the *Minkowski offset* of the convex hull —
 * every edge is pushed out along its own normal and corners are rounded — so the
 * boundary sits a uniform `pad` away from ALL hull nodes, not just the corners.
 * Radial-from-centroid padding under-inflated long edges, leaving the mid-edge
 * nodes (e.g. a fanned-out bottom row) poking through. `pad` folds in the node
 * radius so node glyphs are fully enclosed, not just their centres.
 */

import { Selection } from "d3";
import { Vec2 } from "../model/graphTypes";

type G = Selection<SVGGElement, unknown, null, undefined>;
type PathSel = Selection<SVGPathElement, unknown, null, undefined>;

/** Convex hull (counter-clockwise) of a point set via Andrew's monotone chain. */
export function convexHull(points: Vec2[]): Vec2[] {
    const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    if (pts.length <= 2) return pts;
    const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Vec2[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Vec2[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

/**
 * Outline the convex hull outset by `pad` on every side (Minkowski sum with a
 * disc of radius `pad`): each edge is offset along its outward normal and the
 * gaps at corners are filled with short arc polylines. Guarantees every input
 * point lies at least `pad` inside the returned path. Deterministic, no getBBox.
 */
export function hullPath(points: Vec2[], pad: number): string {
    if (!points.length) return "";
    if (points.length === 1) {
        const p = points[0];
        const r = pad;
        return `M ${p.x - r} ${p.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    const hull = convexHull(points);
    if (hull.length === 2) {
        // Degenerate (collinear) hull → a capsule around the segment.
        return capsulePath(hull[0], hull[1], pad);
    }
    // Orientation sign: >0 CCW, <0 CW (in whatever y-convention the points use).
    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        area2 += a.x * b.y - b.x * a.y;
    }
    const ccw = area2 > 0;

    const n = hull.length;
    const out: Vec2[] = [];
    for (let i = 0; i < n; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Outward normal: to the right of the edge direction for CCW, left for CW.
        const nx = ccw ? dy / len : -dy / len;
        const ny = ccw ? -dx / len : dx / len;
        const a2 = { x: a.x + nx * pad, y: a.y + ny * pad };
        const b2 = { x: b.x + nx * pad, y: b.y + ny * pad };
        if (i > 0) {
            // Round the corner at `a`: arc on the disc of radius `pad` centred at `a`,
            // from the previous edge's endpoint to this edge's start point.
            const prev = out[out.length - 1];
            arcTo(out, a, prev, a2, pad, ccw);
        }
        out.push(a2, b2);
    }
    // Close the final corner back to the very first offset point.
    arcTo(out, hull[0], out[out.length - 1], out[0], pad, ccw);

    return out.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ") + " Z";
}

/** Append a short arc (polylined) around centre `c` from point `from` to `to`. */
function arcTo(out: Vec2[], c: Vec2, from: Vec2, to: Vec2, r: number, ccw: boolean): void {
    let a0 = Math.atan2(from.y - c.y, from.x - c.x);
    let a1 = Math.atan2(to.y - c.y, to.x - c.x);
    let d = a1 - a0;
    // Shortest sweep in the polygon's winding direction (exterior angle < π).
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    // Convex corner sweeps the same sign as the winding; guard against tiny arcs.
    const steps = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 8)));
    for (let s = 1; s < steps; s++) {
        const a = a0 + (d * s) / steps;
        out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    out.push(to);
    void ccw;
}

/** Rounded capsule around a segment (for degenerate 2-point hulls). */
function capsulePath(a: Vec2, b: Vec2, r: number): string {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;
    const pts: Vec2[] = [];
    pts.push({ x: a.x + nx * r, y: a.y + ny * r });
    pts.push({ x: b.x + nx * r, y: b.y + ny * r });
    arcTo(pts, b, pts[pts.length - 1], { x: b.x - nx * r, y: b.y - ny * r }, r, true);
    arcTo(pts, a, pts[pts.length - 1], { x: a.x + nx * r, y: a.y + ny * r }, r, true);
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ") + " Z";
}

/** Visual options for the cluster hulls. All optional; defaults preserve NG-135. */
export interface HullStyle {
    /** Gap left around node *centres* before the radius inflation is added. */
    pad?: number;
    /** "rounded" = Minkowski offset (soft, guaranteed-cover); "convex" = sharp hull. */
    shape?: "rounded" | "convex";
    fillOpacity?: number;
    strokeOpacity?: number;
    strokeWidth?: number;
    /** When set, every hull uses this single tint instead of its per-cluster colour. */
    tint?: string | null;
    /** Called per cluster once its path is drawn — lets the caller wire interaction. */
    onEach?: (path: PathSel, cluster: number) => void;
}

/**
 * Draw one shaded hull per cluster into `hullGroup`. Pass a `radiusOf` accessor so
 * the gap grows to cover the node glyph (the widest node on each hull sets that
 * cluster's inflation). `style` tunes shape/opacity/border/tint.
 */
export function renderHulls(
    hullGroup: G,
    positionsPx: Vec2[],
    community: number[],
    colorOf: (c: number) => string,
    style: HullStyle = {},
    radiusOf?: (i: number) => number,
): void {
    hullGroup.selectAll("*").remove();
    const pad = style.pad ?? 14;
    const rounded = (style.shape ?? "rounded") === "rounded";
    const byCluster = new Map<number, { p: Vec2; r: number }[]>();
    for (let i = 0; i < positionsPx.length; i++) {
        const c = community[i];
        const r = radiusOf ? radiusOf(i) : 0;
        (byCluster.get(c) ?? byCluster.set(c, []).get(c)!).push({ p: positionsPx[i], r });
    }
    for (const [c, items] of [...byCluster.entries()].sort((a, b) => a[0] - b[0])) {
        const pts = items.map((it) => it.p);
        // Inflate by the widest node so glyphs are enclosed, not just their centres.
        const maxR = items.reduce((m, it) => Math.max(m, it.r), 0);
        const inflate = pad + maxR;
        const col = style.tint || colorOf(c);
        const path = hullGroup.append("path")
            .attr("d", rounded ? hullPath(pts, inflate) : convexHullPath(pts, inflate))
            .attr("fill", col)
            .attr("fill-opacity", style.fillOpacity ?? 0.12)
            .attr("stroke", col)
            .attr("stroke-opacity", style.strokeOpacity ?? 0.35)
            .attr("stroke-width", style.strokeWidth ?? 1.5)
            .attr("stroke-linejoin", "round")
            .attr("pointer-events", "none") as PathSel;
        style.onEach?.(path, c);
    }
}

/**
 * Sharp convex-hull outline, padded radially from the centroid (the classic look).
 * Kept for the "convex" style option; the rounded `hullPath` is the coverage-safe
 * default. Single/degenerate cases fall back to the rounded path.
 */
export function convexHullPath(points: Vec2[], pad: number): string {
    if (points.length <= 2) return hullPath(points, pad);
    const hull = convexHull(points);
    let cx = 0, cy = 0;
    for (const p of hull) { cx += p.x; cy += p.y; }
    cx /= hull.length; cy /= hull.length;
    const expanded = hull.map((p) => {
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
    });
    return expanded.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ") + " Z";
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
