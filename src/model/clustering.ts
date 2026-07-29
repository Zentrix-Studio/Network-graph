"use strict";

/**
 * Deterministic community detection (Enterprise feature E2) — the headline
 * capability absent across the entire surveyed field. Turns a hairball into
 * readable structure. This is the **full multi-level** Louvain modularity-
 * optimisation method (local-moving + community aggregation, repeated), made
 * fully deterministic:
 *   - nodes are visited in fixed index order,
 *   - modularity-gain ties break to the lowest community id,
 *   - a fixed maximum pass/level count (no time/convergence-based variability).
 * Level 0 alone reproduces the historical single-pass behaviour exactly (the
 * top graph has no aggregated self-loops); further levels merge communities
 * only when doing so raises modularity, yielding coarser, cleaner structure on
 * larger graphs. Same DataView ⇒ identical community assignment — a hard
 * requirement so cluster colours and hull shading don't flicker between
 * refreshes. No Power BI deps.
 */

import { GraphModel } from "./graphTypes";

export interface ClusterResult {
    /** Community id per node index (dense 0..count-1). */
    community: number[];
    count: number;
}

/** A weighted graph for one Louvain level: inter-node weights + per-node self-loop weight. */
interface LevelGraph {
    n: number;
    adj: Map<number, number>[]; // symmetric, self excluded
    self: number[];             // intra-node (aggregated) weight, counted once
}

/**
 * One local-moving optimisation over a level graph. Returns a community id per
 * node (not yet densified). Deterministic: fixed visit order, lowest-id tie-break.
 *
 * `gamma` is the modularity resolution (Reichardt–Bornholdt): it scales the
 * expected-weight (null-model) term, so γ > 1 penalises large communities → more,
 * smaller clusters; γ < 1 → fewer, coarser clusters. γ = 1 is classic modularity
 * and reproduces the historical assignment byte-for-byte.
 */
function localMoving(g: LevelGraph, maxPasses: number, gamma: number): number[] {
    const { n, adj, self } = g;
    const k = new Array<number>(n).fill(0);
    let m2 = 0;
    for (let i = 0; i < n; i++) {
        let deg = 2 * self[i]; // a self-loop contributes twice to weighted degree
        for (const w of adj[i].values()) deg += w;
        k[i] = deg;
        m2 += deg;
    }
    const comm = new Array<number>(n);
    for (let i = 0; i < n; i++) comm[i] = i;
    if (m2 === 0) return comm;

    const sumTot = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) sumTot[comm[i]] += k[i];

    for (let pass = 0; pass < maxPasses; pass++) {
        let improved = false;
        for (let i = 0; i < n; i++) {
            const ci = comm[i];
            sumTot[ci] -= k[i];
            comm[i] = -1;

            // Sum of edge weights from i to each candidate community.
            const wTo = new Map<number, number>();
            for (const [j, w] of adj[i]) {
                const cj = comm[j] === -1 ? ci : comm[j];
                wTo.set(cj, (wTo.get(cj) ?? 0) + w);
            }
            if (!wTo.has(ci)) wTo.set(ci, 0); // staying put is always a candidate

            // Maximise ΔQ ∝ w(i→C) − k[i]·Σtot[C]/2m. Ties → lowest community id.
            let best = ci;
            let bestVal = -Infinity;
            for (const C of [...wTo.keys()].sort((a, b) => a - b)) {
                const val = (wTo.get(C) ?? 0) - (gamma * k[i] * sumTot[C]) / m2;
                if (val > bestVal + 1e-12) { bestVal = val; best = C; }
            }

            comm[i] = best;
            sumTot[best] += k[i];
            if (best !== ci) improved = true;
        }
        if (!improved) break;
    }
    return comm;
}

/** Build the top-level graph directly from the model (self-loops excluded, as before). */
function baseLevel(model: GraphModel): LevelGraph {
    const n = model.nodes.length;
    const adj: Map<number, number>[] = model.nodes.map(() => new Map<number, number>());
    for (const l of model.links) {
        if (l.source === l.target) continue;
        adj[l.source].set(l.target, (adj[l.source].get(l.target) ?? 0) + l.weight);
        adj[l.target].set(l.source, (adj[l.target].get(l.source) ?? 0) + l.weight);
    }
    return { n, adj, self: new Array<number>(n).fill(0) };
}

/** Collapse each community into one super-node, summing weights (E2 aggregation). */
function aggregate(g: LevelGraph, comm: number[], superCount: number): LevelGraph {
    const adj: Map<number, number>[] = Array.from({ length: superCount }, () => new Map<number, number>());
    const self = new Array<number>(superCount).fill(0);
    for (let i = 0; i < g.n; i++) {
        const ci = comm[i];
        self[ci] += g.self[i];               // carry intra-node weight forward
        for (const [j, w] of g.adj[i]) {
            if (j <= i) continue;            // each undirected pair once
            const cj = comm[j];
            if (ci === cj) { self[ci] += w; } // edge now internal to the super-node
            else {
                adj[ci].set(cj, (adj[ci].get(cj) ?? 0) + w);
                adj[cj].set(ci, (adj[cj].get(ci) ?? 0) + w);
            }
        }
    }
    return { n: superCount, adj, self };
}

/**
 * `resolution` (default 1) is the Louvain modularity resolution γ. > 1 yields more,
 * smaller communities; < 1 yields fewer, coarser ones. The default is exactly the
 * classic algorithm, so pinned assignments and snapshots are unchanged.
 */
export function detectCommunities(model: GraphModel, maxPasses = 20, maxLevels = 10, resolution = 1): ClusterResult {
    const base = baseLevel(model);
    if (base.n === 0) return { community: [], count: 0 };
    const gamma = resolution > 0 ? resolution : 1;

    // node → its community at the current (coarsest-so-far) level.
    let comm = model.nodes.map((_, i) => i);
    let level = base;

    for (let lvl = 0; lvl < maxLevels; lvl++) {
        const moved = localMoving(level, maxPasses, gamma);
        const { dense, count } = densify(moved);
        if (count === level.n) break;        // no community merged → converged

        // Fold this level's assignment into the node→community mapping.
        for (let i = 0; i < comm.length; i++) comm[i] = dense[comm[i]];
        if (count === 1) break;              // everything in one community
        level = aggregate(level, dense, count);
    }

    return relabel(comm);
}

/** Densify raw community ids to 0..count-1 by ascending first-appearance. */
function densify(raw: number[]): { dense: number[]; count: number } {
    const label = new Map<number, number>();
    let next = 0;
    const dense = new Array<number>(raw.length);
    for (let i = 0; i < raw.length; i++) {
        let id = label.get(raw[i]);
        if (id === undefined) { id = next++; label.set(raw[i], id); }
        dense[i] = id;
    }
    return { dense, count: next };
}

/** Relabel community ids to dense 0..k-1 by ascending first-appearance (node order). */
function relabel(comm: number[]): ClusterResult {
    const label = new Map<number, number>();
    let next = 0;
    const out = new Array<number>(comm.length);
    for (let i = 0; i < comm.length; i++) {
        let id = label.get(comm[i]);
        if (id === undefined) { id = next++; label.set(comm[i], id); }
        out[i] = id;
    }
    return { community: out, count: next };
}
