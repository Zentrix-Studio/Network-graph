"use strict";

/**
 * Graph traversal primitives — shortest path (Enterprise E5) and k-hop ego sets
 * (Enterprise E3, explore mode). Pure, deterministic (neighbours visited in
 * ascending index order), no Power BI deps.
 */

import { GraphModel } from "./graphTypes";
import { neighborIndex } from "./graphModel";

/**
 * Unweighted shortest path (fewest hops) between two node indices, inclusive of
 * both endpoints. Returns null when the target is unreachable. Deterministic:
 * BFS explores neighbours in ascending index order, so ties resolve identically.
 */
export function shortestPath(model: GraphModel, srcIdx: number, tgtIdx: number, adj?: number[][]): number[] | null {
    const n = model.nodes.length;
    if (srcIdx < 0 || tgtIdx < 0 || srcIdx >= n || tgtIdx >= n) return null;
    if (srcIdx === tgtIdx) return [srcIdx];

    const neighbors = adj ?? neighborIndex(model);
    const prev = new Array<number>(n).fill(-1);
    const seen = new Array<boolean>(n).fill(false);
    const queue: number[] = [srcIdx];
    seen[srcIdx] = true;

    for (let head = 0; head < queue.length; head++) {
        const u = queue[head];
        if (u === tgtIdx) break;
        for (const v of neighbors[u]) {
            if (!seen[v]) {
                seen[v] = true;
                prev[v] = u;
                queue.push(v);
            }
        }
    }

    if (!seen[tgtIdx]) return null; // unreachable
    const path: number[] = [];
    for (let at = tgtIdx; at !== -1; at = prev[at]) path.push(at);
    return path.reverse();
}

/**
 * Weighted shortest path (lowest total edge cost) between two node indices,
 * inclusive of both endpoints — the cost-aware companion to `shortestPath`.
 * Edge weight is read as a **cost/distance** (higher weight = longer route), so
 * the returned path minimises the summed weight, not the hop count. Returns null
 * when the target is unreachable. Deterministic Dijkstra: among equal tentative
 * distances the lowest node index is settled first and the lower-index
 * predecessor wins, so ties resolve identically every run. No priority queue —
 * an O(n²) linear scan keeps it allocation-light and order-stable under jsdom.
 */
export function weightedShortestPath(model: GraphModel, srcIdx: number, tgtIdx: number): number[] | null {
    const n = model.nodes.length;
    if (srcIdx < 0 || tgtIdx < 0 || srcIdx >= n || tgtIdx >= n) return null;
    if (srcIdx === tgtIdx) return [srcIdx];

    // Weighted undirected adjacency; a non-positive weight is clamped to a tiny
    // positive cost so Dijkstra's non-negativity assumption always holds.
    const wadj: Map<number, number>[] = model.nodes.map(() => new Map<number, number>());
    for (const l of model.links) {
        if (l.source === l.target) continue;
        const c = l.weight > 0 ? l.weight : 1e-6;
        // Keep the cheapest cost for parallel edges between the same pair.
        const cur = wadj[l.source].get(l.target);
        if (cur === undefined || c < cur) { wadj[l.source].set(l.target, c); wadj[l.target].set(l.source, c); }
    }

    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    dist[srcIdx] = 0;

    for (let iter = 0; iter < n; iter++) {
        // Settle the closest unsettled node; ties → lowest index (first found).
        let u = -1, best = Infinity;
        for (let i = 0; i < n; i++) {
            if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        }
        if (u === -1) break;          // remaining nodes unreachable
        if (u === tgtIdx) break;      // target settled — path is final
        done[u] = true;
        for (const [v, c] of wadj[u]) {
            if (done[v]) continue;
            const nd = dist[u] + c;
            if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
        }
    }

    if (dist[tgtIdx] === Infinity) return null; // unreachable
    const path: number[] = [];
    for (let at = tgtIdx; at !== -1; at = prev[at]) path.push(at);
    return path.reverse();
}

/**
 * All node indices within `hops` steps of `srcIdx` (inclusive of src). `hops <= 0`
 * yields just the source. Used by explore mode to render an ego network.
 */
export function kHopSet(model: GraphModel, srcIdx: number, hops: number, adj?: number[][]): Set<number> {
    const result = new Set<number>();
    if (srcIdx < 0 || srcIdx >= model.nodes.length) return result;
    const neighbors = adj ?? neighborIndex(model);
    result.add(srcIdx);
    let frontier = [srcIdx];
    for (let h = 0; h < Math.max(0, hops); h++) {
        const next: number[] = [];
        for (const u of frontier) {
            for (const v of neighbors[u]) {
                if (!result.has(v)) { result.add(v); next.push(v); }
            }
        }
        if (!next.length) break;
        frontier = next;
    }
    return result;
}
