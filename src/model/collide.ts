"use strict";

/**
 * Deterministic circle-collision relaxation — the "avoid overlap" pass (NG-112).
 * The force layout spaces nodes by charge alone and knows nothing about render
 * radii, so growing the radius range (or a size measure skew) overlaps nodes.
 * This pass separates overlapping circles AFTER positions are mapped to pixel
 * space, where radii live.
 *
 * Determinism rules (same as forceLayout): fixed iteration cap, index-ordered
 * pair processing, no Math.random / wall-clock — coincident nodes are separated
 * along an angle hashed from their indices. Same positions + radii ⇒ identical
 * output. Pure: no DOM, no Power BI imports.
 */

import { Vec2 } from "./graphTypes";

export interface CollideConfig {
    /** Max relaxation sweeps. Iteration stops early once a sweep moves nothing
     *  (a function of the input state only, so still deterministic). */
    iterations?: number;
    /** Extra clearance (px) enforced between circle edges. */
    padding?: number;
    /** Node indices that must NOT move (e.g. the node the user just dropped);
     *  their overlap partners take the full correction instead. */
    fixed?: ReadonlySet<number>;
    /** Optional clamp rect so separation never pushes nodes off-viewport. */
    bounds?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const DEFAULT_COLLIDE_ITERATIONS = 24;
/** Default edge-to-edge clearance in fitted screen pixels. Kept independent of
 *  node radius so larger default nodes gain breathing room without being inflated. */
export const DEFAULT_COLLIDE_PADDING = 10;

/**
 * Separate overlapping circles in place. Returns true if anything moved.
 * Bigger circles move less (mass ∝ r²), fixed circles not at all. Uses a
 * uniform spatial grid (cell = max diameter) so each sweep is O(n · local
 * density), fine at the 2k-node budget.
 */
export function resolveCollisions(
    positions: Vec2[],
    radiusOf: (i: number) => number,
    config: CollideConfig = {},
): boolean {
    const n = positions.length;
    if (n < 2) return false;
    const iterations = Math.max(1, config.iterations ?? DEFAULT_COLLIDE_ITERATIONS);
    const padding = config.padding ?? DEFAULT_COLLIDE_PADDING;
    const fixed = config.fixed;
    const bounds = config.bounds ?? null;

    const radii = new Array<number>(n);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
        radii[i] = Math.max(0, radiusOf(i));
        if (radii[i] > maxR) maxR = radii[i];
    }
    if (maxR <= 0) return false;

    // Any overlapping pair is within (2·maxR + padding), so with this cell size
    // the 3×3 neighbourhood of a node's cell contains every possible partner.
    const cell = 2 * maxR + padding;
    let movedAny = false;

    for (let iter = 0; iter < iterations; iter++) {
        // Grid rebuilt each sweep in index order → deterministic bucket order.
        const grid = new Map<string, number[]>();
        for (let i = 0; i < n; i++) {
            const key = `${Math.floor(positions[i].x / cell)}:${Math.floor(positions[i].y / cell)}`;
            const bucket = grid.get(key);
            if (bucket) bucket.push(i); else grid.set(key, [i]);
        }

        let movedThisSweep = false;
        for (let i = 0; i < n; i++) {
            const p = positions[i];
            const cx = Math.floor(p.x / cell);
            const cy = Math.floor(p.y / cell);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const bucket = grid.get(`${cx + dx}:${cy + dy}`);
                    if (!bucket) continue;
                    for (const j of bucket) {
                        if (j <= i) continue; // each unordered pair once, index-ordered
                        if (separatePair(positions, radii, padding, fixed, i, j)) {
                            movedThisSweep = true;
                        }
                    }
                }
            }
        }
        if (movedThisSweep && bounds) clampAll(positions, radii, fixed, bounds);
        if (!movedThisSweep) break;
        movedAny = true;
    }
    return movedAny;
}

/**
 * Separate circles without repeatedly pinning individual nodes to the four
 * viewport edges. The free collision pass runs first, then the whole result is
 * translated and (only when necessary) uniformly scaled back into the bounds.
 * A single similarity transform preserves the layout's angles and aspect ratio,
 * avoiding the rectangular rows/columns produced by per-node clamping.
 */
export function resolveCollisionsPreservingShape(
    positions: Vec2[],
    radiusOf: (i: number) => number,
    config: CollideConfig & { bounds: { x0: number; y0: number; x1: number; y1: number } },
): boolean {
    const moved = resolveCollisions(positions, radiusOf, { ...config, bounds: null, fixed: undefined });
    if (moved) fitCircleCentersToBounds(positions, radiusOf, config.bounds);
    return moved;
}

/**
 * Fit circle centres into a rectangle with one uniform scale + translation.
 * Radii stay in screen pixels; only the centre geometry is transformed.
 * Returns the applied centre scale (1 when translation alone was sufficient).
 */
export function fitCircleCentersToBounds(
    positions: Vec2[],
    radiusOf: (i: number) => number,
    bounds: { x0: number; y0: number; x1: number; y1: number },
): number {
    if (!positions.length) return 1;
    const radii = positions.map((_, i) => Math.max(0, radiusOf(i)));
    let cx = 0, cy = 0;
    for (const p of positions) { cx += p.x; cy += p.y; }
    cx /= positions.length;
    cy /= positions.length;

    const interval = (
        scale: number,
        axis: "x" | "y",
        lo: number,
        hi: number,
        center: number,
    ): [number, number] => {
        let lower = -Infinity, upper = Infinity;
        for (let i = 0; i < positions.length; i++) {
            const delta = positions[i][axis] - center;
            lower = Math.max(lower, lo + radii[i] - delta * scale);
            upper = Math.min(upper, hi - radii[i] - delta * scale);
        }
        return [lower, upper];
    };
    const feasible = (scale: number): boolean => {
        const ix = interval(scale, "x", bounds.x0, bounds.x1, cx);
        const iy = interval(scale, "y", bounds.y0, bounds.y1, cy);
        return ix[0] <= ix[1] && iy[0] <= iy[1];
    };

    // If even coincident centres cannot fit (a node is larger than the viewport),
    // retain the established defensive per-node clamp rather than emit NaNs.
    if (!feasible(0)) {
        clampAll(positions, radii, undefined, bounds);
        return 1;
    }

    let scale = 1;
    if (!feasible(scale)) {
        let lo = 0, hi = 1;
        // Fixed iteration count keeps the result deterministic across renders.
        for (let k = 0; k < 48; k++) {
            const mid = (lo + hi) / 2;
            if (feasible(mid)) lo = mid; else hi = mid;
        }
        scale = lo;
    }

    const ix = interval(scale, "x", bounds.x0, bounds.x1, cx);
    const iy = interval(scale, "y", bounds.y0, bounds.y1, cy);
    const tx = clampN(cx, ix[0], ix[1]);
    const ty = clampN(cy, iy[0], iy[1]);
    for (const p of positions) {
        p.x = tx + (p.x - cx) * scale;
        p.y = ty + (p.y - cy) * scale;
    }
    return scale;
}

function clampN(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Push circles i and j apart to exactly touching (+padding). Mass-weighted:
 *  the bigger circle moves less; a fixed circle not at all. */
function separatePair(
    positions: Vec2[],
    radii: number[],
    padding: number,
    fixed: ReadonlySet<number> | undefined,
    i: number,
    j: number,
): boolean {
    const fi = fixed?.has(i) ?? false;
    const fj = fixed?.has(j) ?? false;
    if (fi && fj) return false;

    const a = positions[i];
    const b = positions[j];
    const target = radii[i] + radii[j] + padding;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= target * target) return false;

    let dist = Math.sqrt(distSq);
    if (dist < 1e-6) {
        // Coincident centres: separate along a deterministic index-hashed angle.
        const angle = ((i * 2654435761 + j * 40503) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
    } else {
        dx /= dist;
        dy /= dist;
    }

    const overlap = target - Math.min(dist, target);
    // Mass ∝ r² (area) with a floor so zero-radius nodes still split the push.
    const mi = fj ? 1 : Math.max(1, radii[i] * radii[i]);
    const mj = fi ? 1 : Math.max(1, radii[j] * radii[j]);
    const wi = fi ? 0 : mj / (mi + mj);
    const wj = fj ? 0 : mi / (mi + mj);
    a.x -= dx * overlap * wi;
    a.y -= dy * overlap * wi;
    b.x += dx * overlap * wj;
    b.y += dy * overlap * wj;
    return true;
}

/** Keep every free node's centre inside the rect (inset by its radius when it fits). */
function clampAll(
    positions: Vec2[],
    radii: number[],
    fixed: ReadonlySet<number> | undefined,
    b: { x0: number; y0: number; x1: number; y1: number },
): void {
    for (let i = 0; i < positions.length; i++) {
        if (fixed?.has(i)) continue;
        // Inset by the radius only while the rect can hold the circle; otherwise
        // fall back to the raw rect so lo ≤ hi always holds.
        const rx = Math.min(radii[i], (b.x1 - b.x0) / 2);
        const ry = Math.min(radii[i], (b.y1 - b.y0) / 2);
        const p = positions[i];
        p.x = p.x < b.x0 + rx ? b.x0 + rx : p.x > b.x1 - rx ? b.x1 - rx : p.x;
        p.y = p.y < b.y0 + ry ? b.y0 + ry : p.y > b.y1 - ry ? b.y1 - ry : p.y;
    }
}
