"use strict";

/**
 * Cluster-assignment resolver (Enterprise E2). Decides which nodes share a cluster,
 * from one of three sources, then applies size post-processing. Pure: graph math +
 * a `categoryOf` accessor, no Power BI imports — the analog of the other `model/`
 * modules and unit-testable in isolation.
 *
 *   mode "auto"      → deterministic Louvain community detection (with resolution γ).
 *   mode "category"  → group by the bound Node-category value (nulls share one bucket).
 *   mode "component" → group by connected component (already on the model).
 *
 * Post-processing (both optional, applied after detection):
 *   minClusterSize   → clusters below N nodes are folded into a shared "Other" bucket.
 *   maxClusters      → keep the K largest clusters; the rest fold into "Other".
 *
 * Determinism: every step is order-stable (ascending id / ascending first-member),
 * so the same DataView always yields the same assignment — hulls and cluster colours
 * never flicker between refreshes.
 */

import { GraphModel } from "./graphTypes";
import { detectCommunities } from "./clustering";

export type ClusterMode = "auto" | "category" | "component";

export interface ClusterOptions {
    mode: ClusterMode;
    /** Louvain resolution γ (auto mode only). Default 1 = classic modularity. */
    resolution?: number;
    /** Fold clusters smaller than this into a single "Other" bucket. Default 1 = off. */
    minClusterSize?: number;
    /** Keep only the K largest clusters; fold the rest into "Other". 0 = unlimited. */
    maxClusters?: number;
}

/** Raw (pre-post-processing) community id per node index for the chosen mode. */
function rawAssignment(
    model: GraphModel,
    categoryOf: (i: number) => string | null,
    opts: ClusterOptions,
): number[] {
    const n = model.nodes.length;
    if (opts.mode === "component") {
        return model.nodes.map((nd) => nd.component);
    }
    if (opts.mode === "category") {
        // First-seen category value → dense id; nulls collapse into one shared bucket.
        const byValue = new Map<string, number>();
        let next = 0;
        let nullId = -1;
        const out = new Array<number>(n);
        for (let i = 0; i < n; i++) {
            const c = categoryOf(i);
            if (c == null) {
                if (nullId === -1) nullId = next++;
                out[i] = nullId;
            } else {
                let id = byValue.get(c);
                if (id === undefined) { id = next++; byValue.set(c, id); }
                out[i] = id;
            }
        }
        return out;
    }
    // "auto"
    return detectCommunities(model, undefined, undefined, opts.resolution ?? 1).community;
}

/** Dense-relabel by ascending first-appearance so ids are 0..count-1, order-stable. */
function densify(raw: number[]): number[] {
    const label = new Map<number, number>();
    let next = 0;
    return raw.map((r) => {
        let id = label.get(r);
        if (id === undefined) { id = next++; label.set(r, id); }
        return id;
    });
}

/**
 * Resolve the final cluster id per node index (dense 0..count-1), applying the
 * detection mode and the min-size / max-clusters folding. Returns [] for an empty
 * model.
 */
export function resolveClusters(
    model: GraphModel,
    categoryOf: (i: number) => string | null,
    opts: ClusterOptions,
): number[] {
    const n = model.nodes.length;
    if (n === 0) return [];

    const raw = densify(rawAssignment(model, categoryOf, opts));
    const count = raw.length ? Math.max(...raw) + 1 : 0;

    // Sizes per cluster.
    const size = new Array<number>(count).fill(0);
    for (const c of raw) size[c]++;

    // Decide which clusters survive. A cluster is kept if it meets the min size AND
    // (when a max is set) ranks among the K largest. Ties break to the lower id so
    // the choice is deterministic.
    const minSize = Math.max(1, Math.floor(opts.minClusterSize ?? 1));
    const maxK = Math.max(0, Math.floor(opts.maxClusters ?? 0));

    let eligible: number[] = [];
    for (let c = 0; c < count; c++) if (size[c] >= minSize) eligible.push(c);
    if (maxK > 0 && eligible.length > maxK) {
        eligible = eligible
            .slice()
            .sort((a, b) => (size[b] - size[a]) || (a - b))
            .slice(0, maxK);
    }
    const keep = new Set<number>(eligible);

    // If nothing survives (e.g. every cluster below minSize), keep them all — an
    // all-"Other" graph is useless, so degrade gracefully to the raw assignment.
    if (keep.size === 0) return raw;
    // If everything survives, no folding needed.
    if (keep.size === count) return raw;

    // Fold non-kept nodes into one shared "Other" bucket, then dense-relabel so the
    // kept clusters and the single Other bucket get contiguous ids.
    const OTHER = count; // sentinel above all real ids
    const folded = raw.map((c) => (keep.has(c) ? c : OTHER));
    return densify(folded);
}
