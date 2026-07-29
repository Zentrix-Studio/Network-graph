"use strict";

/**
 * Top/Bottom-N ranking (feature R-rank). Only Powerviz and Inforiver expose native
 * node ranking in the Power BI field — and none rank by a *computed* graph metric.
 * This pure module selects the kept node set; the visual masks the rest (an honest
 * "showing top N of M" filter, deterministic and Power-BI-free).
 */

import { GraphModel } from "./graphTypes";

export type RankMode = "off" | "top" | "bottom";
export type RankBy = "degree" | "weighted" | "size" | "centrality";

export interface RankOptions {
    mode: RankMode;
    by: RankBy;
    count: number;
    /** Per-node centrality (0..1), used when `by === "centrality"`. */
    centralityOf?: (i: number) => number | null;
}

/**
 * @param sizeOf node-size-measure accessor (null → falls back to summed Edge weight).
 * @returns the set of kept node indices, or null when ranking is inactive (off, or
 * the count covers the whole graph). Deterministic: ties break by node index.
 */
export function rankedNodeSet(model: GraphModel, sizeOf: (i: number) => number | null, opts: RankOptions): Set<number> | null {
    const n = model.nodes.length;
    if (opts.mode === "off" || opts.count <= 0 || opts.count >= n) return null;

    const metric = (i: number): number => {
        if (opts.by === "weighted") return model.nodes[i].weightedDegree;
        if (opts.by === "size") { const s = sizeOf(i); return s == null ? model.nodes[i].weightedDegree : s; }
        if (opts.by === "centrality") { const c = opts.centralityOf?.(i); return c == null ? model.nodes[i].degree : c; }
        return model.nodes[i].degree;
    };

    const order = model.nodes.map((_, i) => i).sort((a, b) => {
        const d = metric(b) - metric(a); // highest first
        return d !== 0 ? d : a - b;       // deterministic tie-break
    });

    const kept = opts.mode === "top" ? order.slice(0, opts.count) : order.slice(n - opts.count);
    return new Set(kept);
}
