"use strict";

/**
 * Graph centrality metrics (Enterprise moat). NO Power BI network visual in the
 * field ships these — they are the standard "who matters in this network" measures
 * from Gephi / Neo4j / KeyLines. Pure, deterministic (fixed iteration counts, index
 * order, never Math.random), Power-BI-free. Values feed node size, colour, ranking,
 * and tooltips.
 *
 *   • degree      — normalised connection count (fast, local importance)
 *   • betweenness — Brandes' algorithm; how often a node is on shortest paths
 *                   (bridges / brokers)
 *   • closeness   — inverse mean distance to all reachable nodes (reach)
 *   • pagerank    — power-iteration eigenvector-style influence (respects direction)
 */

import { GraphModel } from "./graphTypes";

export type CentralityMetric = "none" | "degree" | "betweenness" | "closeness" | "pagerank";

/** Undirected adjacency (self-loops dropped) — for betweenness/closeness/degree. */
function undirectedAdjacency(model: GraphModel): number[][] {
    const adj: number[][] = model.nodes.map(() => []);
    for (const l of model.links) {
        if (l.source === l.target) continue;
        adj[l.source].push(l.target);
        adj[l.target].push(l.source);
    }
    return adj;
}

/** Degree centrality, normalised by (n-1) so it is comparable across graph sizes. */
export function degreeCentrality(model: GraphModel): number[] {
    const n = model.nodes.length;
    const denom = n > 1 ? n - 1 : 1;
    return model.nodes.map((nd) => nd.degree / denom);
}

/**
 * Betweenness centrality via Brandes' algorithm (unweighted, undirected). O(V·E).
 * Deterministic: sources and neighbours are visited in index order. Result is
 * normalised to [0,1] by the max (0 when the graph has no paths).
 */
export function betweennessCentrality(model: GraphModel): number[] {
    const n = model.nodes.length;
    const adj = undirectedAdjacency(model);
    const cb = new Array<number>(n).fill(0);

    for (let s = 0; s < n; s++) {
        const stack: number[] = [];
        const pred: number[][] = model.nodes.map(() => []);
        const sigma = new Array<number>(n).fill(0); sigma[s] = 1;
        const dist = new Array<number>(n).fill(-1); dist[s] = 0;
        const queue: number[] = [s];
        for (let h = 0; h < queue.length; h++) {
            const v = queue[h];
            stack.push(v);
            for (const w of adj[v]) {
                if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
                if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; pred[w].push(v); }
            }
        }
        const delta = new Array<number>(n).fill(0);
        for (let i = stack.length - 1; i >= 0; i--) {
            const w = stack[i];
            for (const v of pred[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
            if (w !== s) cb[w] += delta[w];
        }
    }
    for (let i = 0; i < n; i++) cb[i] /= 2; // each undirected pair counted twice
    return normalise(cb);
}

/**
 * Closeness centrality: (reachable-1) / (sum of distances to reachable nodes),
 * scaled by the reachable fraction so disconnected graphs stay fair. Deterministic
 * BFS from each node. Normalised to [0,1].
 */
export function closenessCentrality(model: GraphModel): number[] {
    const n = model.nodes.length;
    const adj = undirectedAdjacency(model);
    const out = new Array<number>(n).fill(0);

    for (let s = 0; s < n; s++) {
        const dist = new Array<number>(n).fill(-1); dist[s] = 0;
        const queue: number[] = [s];
        let sum = 0, reachable = 0;
        for (let h = 0; h < queue.length; h++) {
            const v = queue[h];
            for (const w of adj[v]) {
                if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); sum += dist[w]; reachable++; }
            }
        }
        if (sum > 0) out[s] = (reachable / sum) * (reachable / (n > 1 ? n - 1 : 1));
    }
    return normalise(out);
}

/**
 * PageRank via power iteration (directed — respects source→target). Fixed damping
 * 0.85 and iteration count for strict determinism; dangling mass is redistributed.
 * Normalised to [0,1] by the max.
 */
export function pageRank(model: GraphModel, damping = 0.85, iterations = 100): number[] {
    const n = model.nodes.length;
    if (n === 0) return [];
    const out: number[][] = model.nodes.map(() => []);
    const outDeg = new Array<number>(n).fill(0);
    for (const l of model.links) {
        if (l.source === l.target) continue;
        out[l.source].push(l.target);
        outDeg[l.source]++;
    }

    let pr = new Array<number>(n).fill(1 / n);
    for (let it = 0; it < iterations; it++) {
        const next = new Array<number>(n).fill((1 - damping) / n);
        let dangling = 0;
        for (let i = 0; i < n; i++) if (outDeg[i] === 0) dangling += pr[i];
        const danglingShare = (damping * dangling) / n;
        for (let i = 0; i < n; i++) {
            if (outDeg[i] === 0) continue;
            const share = (damping * pr[i]) / outDeg[i];
            for (const w of out[i]) next[w] += share;
        }
        for (let i = 0; i < n; i++) next[i] += danglingShare;
        pr = next;
    }
    return normalise(pr);
}

/** Scale a vector to [0,1] by its max (all-zero → unchanged). */
function normalise(v: number[]): number[] {
    let max = 0;
    for (const x of v) if (x > max) max = x;
    if (max <= 0) return v;
    return v.map((x) => x / max);
}

/** Dispatch: compute the requested centrality (null when metric is "none"). */
export function computeCentrality(model: GraphModel, metric: CentralityMetric): number[] | null {
    switch (metric) {
        case "degree": return degreeCentrality(model);
        case "betweenness": return betweennessCentrality(model);
        case "closeness": return closenessCentrality(model);
        case "pagerank": return pageRank(model);
        default: return null;
    }
}

/**
 * Edge betweenness centrality (N13 metrics-on-edges): the share of shortest paths
 * running along each link. Brandes' edge-accumulation variant over undirected BFS,
 * normalised to [0,1] by the max. Self-loops score 0 (never on a shortest path).
 * Deterministic. Returns null above the node cap — O(V·E) would freeze the visual
 * on huge graphs, and an honest "not computed" beats a frozen canvas (perf budget).
 */
export function edgeBetweenness(model: GraphModel, maxNodes = 2000): number[] | null {
    const n = model.nodes.length;
    if (n > maxNodes) return null;
    const m = model.links.length;
    // Adjacency carrying the link index, self-loops excluded.
    const adj: { to: number; li: number }[][] = model.nodes.map(() => []);
    model.links.forEach((l, li) => {
        if (l.source === l.target) return;
        adj[l.source].push({ to: l.target, li });
        adj[l.target].push({ to: l.source, li });
    });

    const ce = new Array<number>(m).fill(0);
    for (let s = 0; s < n; s++) {
        const stack: number[] = [];
        const pred: { v: number; li: number }[][] = model.nodes.map(() => []);
        const sigma = new Array<number>(n).fill(0); sigma[s] = 1;
        const dist = new Array<number>(n).fill(-1); dist[s] = 0;
        const queue: number[] = [s];
        for (let h = 0; h < queue.length; h++) {
            const v = queue[h];
            stack.push(v);
            for (const e of adj[v]) {
                if (dist[e.to] < 0) { dist[e.to] = dist[v] + 1; queue.push(e.to); }
                if (dist[e.to] === dist[v] + 1) { sigma[e.to] += sigma[v]; pred[e.to].push({ v, li: e.li }); }
            }
        }
        const delta = new Array<number>(n).fill(0);
        for (let i = stack.length - 1; i >= 0; i--) {
            const w = stack[i];
            for (const p of pred[w]) {
                const c = (sigma[p.v] / sigma[w]) * (1 + delta[w]);
                delta[p.v] += c;
                ce[p.li] += c;
            }
        }
    }
    const max = ce.reduce((a, b) => (b > a ? b : a), 0);
    if (max > 0) for (let i = 0; i < m; i++) ce[i] /= max;
    return ce;
}
