"use strict";

/**
 * Deterministic force-directed layout — the highest-risk piece of the whole
 * visual, spiked here in isolation. The build spec makes determinism a HARD
 * requirement: the same DataView must produce byte-identical positions, so that
 *   (a) pinned-layout mode can freeze a graph that never "dances" on refresh
 *       (feature-reference.md wedge #1 — the leader ZoomCharts cannot do this), and
 *   (b) the settings-sweep snapshot tests are stable.
 *
 * How determinism is guaranteed:
 *   - initial positions are seeded from a hash of each node's natural key
 *     (rng.seedPosition) — never Math.random / Date.now / wall-clock;
 *   - a FIXED iteration count runs (no time-based or convergence-based early
 *     exit that could vary run to run);
 *   - all ticks are synchronous and integer-index-ordered;
 *   - repulsion uses a Barnes-Hut quadtree (O(n log n)) whose build/traversal
 *     order is fixed by node index.
 *
 * No Power BI dependencies. No DOM. Pure and unit-testable.
 */

import { GraphModel, LayoutResult, Vec2 } from "./graphTypes";
import { seedPosition } from "./rng";
import { accumulateRepulsion, buildQuadtree } from "./quadtree";

export interface ForceLayoutConfig {
    /** Fixed number of simulation ticks. Determinism depends on this being fixed. */
    iterations: number;
    /** Repulsive charge (negative). More negative = nodes spread further apart. */
    charge: number;
    /** Ideal edge length (spring rest length) in layout units. */
    linkDistance: number;
    /** Spring stiffness in [0, 1]. */
    linkStrength: number;
    /** Pull toward the origin, keeps disconnected pieces from drifting away. */
    gravity: number;
    /** Barnes-Hut opening threshold (smaller = more accurate, slower). */
    theta: number;
    /** Initial alpha and its per-tick multiplicative decay (cooling schedule). */
    alpha: number;
    alphaDecay: number;
    /** Velocity damping per tick in [0, 1]. */
    velocityDecay: number;
    /** Radius of the seed disk for initial placement. */
    seedRadius: number;
    /**
     * Cluster grouping (E2 "Group by cluster"). When `community` is supplied and
     * `clusterStrength` > 0, an extra per-tick force pulls each node toward its
     * community's live centroid, so communities condense into readable islands and
     * their hulls stop interpenetrating. Deterministic (centroids are a pure function
     * of positions); off by default so ordinary layouts are byte-identical.
     */
    community?: number[];
    clusterStrength: number;
}

export const DEFAULT_FORCE_CONFIG: ForceLayoutConfig = {
    iterations: 300,
    charge: -30,
    linkDistance: 30,
    linkStrength: 0.5,
    gravity: 0.08,
    theta: 0.9,
    alpha: 1,
    alphaDecay: 0.0228, // ≈ 1 - 0.001^(1/300): cools to ~0 over 300 ticks
    velocityDecay: 0.4,
    seedRadius: 200,
    clusterStrength: 0,
};

/**
 * Iteration budget as a function of node count. Each tick is O(n log n) + O(edges),
 * so a fixed 300 ticks makes a 10k-node graph take tens of seconds. We hold the full
 * 300 for graphs up to 800 nodes (so small graphs — every test, every normal report —
 * are byte-identical to before), then scale ticks down on a ~n·iterations budget with
 * a 90-tick floor so a large graph still settles into a readable shape in ~1s instead
 * of freezing the visual. Deterministic: a function of node count only, so the pinned
 * layout and snapshot stability are preserved (same DataView ⇒ same n ⇒ same ticks).
 */
export function adaptiveIterations(n: number): number {
    if (n <= 800) return DEFAULT_FORCE_CONFIG.iterations; // unchanged for the common case
    const budget = 240000; // ≈ 800 · 300, held roughly constant as n grows
    return Math.max(90, Math.min(DEFAULT_FORCE_CONFIG.iterations, Math.round(budget / n)));
}

/**
 * Run the deterministic simulation and return final positions + bounds.
 * `config` is merged over the defaults, so callers override only what they need.
 * When `iterations` is not explicitly set, it scales with node count (see
 * `adaptiveIterations`) so large graphs stay within an interactive time budget.
 */
export function computeForceLayout(
    model: GraphModel,
    config: Partial<ForceLayoutConfig> = {},
): LayoutResult {
    const iterations = config.iterations ?? adaptiveIterations(model.nodes.length);
    const cfg = { ...DEFAULT_FORCE_CONFIG, ...config, iterations };
    const n = model.nodes.length;

    const positions: Vec2[] = new Array(n);
    const velocities: Vec2[] = new Array(n);
    for (let i = 0; i < n; i++) {
        positions[i] = seedPosition(model.nodes[i].key, cfg.seedRadius);
        velocities[i] = { x: 0, y: 0 };
    }

    // Per-link effective stiffness is dampened by the degree of its endpoints
    // (Fruchterman-Reingold-style), so hubs don't get yanked around by every leaf.
    const bias = model.links.map((l) => {
        const ds = model.nodes[l.source].degree;
        const dt = model.nodes[l.target].degree;
        const denom = Math.min(ds, dt) || 1;
        return cfg.linkStrength / denom;
    });

    // Cluster grouping (optional): resolve dense community ids + their count once.
    const grouping = cfg.clusterStrength > 0 && cfg.community != null && cfg.community.length === n;
    const community = grouping ? cfg.community! : null;
    const clusterCount = community ? (community.length ? Math.max(...community) + 1 : 0) : 0;

    let alpha = cfg.alpha;
    for (let iter = 0; iter < cfg.iterations; iter++) {
        const tree = buildQuadtree(positions);
        const forces: Vec2[] = new Array(n);

        // Live community centroids for the grouping force (recomputed each tick).
        let cenX: number[] | null = null, cenY: number[] | null = null;
        if (community) {
            cenX = new Array<number>(clusterCount).fill(0);
            cenY = new Array<number>(clusterCount).fill(0);
            const cc = new Array<number>(clusterCount).fill(0);
            for (let i = 0; i < n; i++) { const c = community[i]; cenX[c] += positions[i].x; cenY[c] += positions[i].y; cc[c]++; }
            for (let c = 0; c < clusterCount; c++) { const d = cc[c] || 1; cenX[c] /= d; cenY[c] /= d; }
        }

        // Repulsion (Barnes-Hut) + gravity toward origin.
        for (let i = 0; i < n; i++) {
            const f: Vec2 = { x: 0, y: 0 };
            accumulateRepulsion(tree, i, positions[i], cfg.charge, cfg.theta, f);
            f.x += -positions[i].x * cfg.gravity;
            f.y += -positions[i].y * cfg.gravity;
            // Pull toward the node's community centroid (spring-like, cooled by alpha).
            if (community && cenX && cenY) {
                const c = community[i];
                f.x += (cenX[c] - positions[i].x) * cfg.clusterStrength;
                f.y += (cenY[c] - positions[i].y) * cfg.clusterStrength;
            }
            forces[i] = f;
        }

        // Spring attraction along edges (skip self-loops — they exert no pull).
        for (let li = 0; li < model.links.length; li++) {
            const l = model.links[li];
            if (l.source === l.target) continue;
            const a = positions[l.source];
            const b = positions[l.target];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) dist = 1e-6;
            const displacement = (dist - cfg.linkDistance) / dist;
            const k = bias[li] * alpha;
            const fx = dx * displacement * k;
            const fy = dy * displacement * k;
            forces[l.source].x += fx;
            forces[l.source].y += fy;
            forces[l.target].x -= fx;
            forces[l.target].y -= fy;
        }

        // Integrate: velocity Verlet-ish with damping, scaled by the cooling alpha.
        for (let i = 0; i < n; i++) {
            velocities[i].x = (velocities[i].x + forces[i].x * alpha) * (1 - cfg.velocityDecay);
            velocities[i].y = (velocities[i].y + forces[i].y * alpha) * (1 - cfg.velocityDecay);
            positions[i].x += velocities[i].x;
            positions[i].y += velocities[i].y;
        }

        alpha *= 1 - cfg.alphaDecay;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) {
        minX = minY = 0;
        maxX = maxY = 0;
    }

    return { positions, bounds: { minX, minY, maxX, maxY }, iterations: cfg.iterations };
}
