"use strict";

/**
 * Induced-subgraph layout for the Top/Bottom-N filter (feature R-rank).
 *
 * The ranking filter keeps N nodes and hides the rest. Masking them in place is
 * wrong for the user: the kept nodes (usually the highest-degree hubs) stay frozen
 * at their full-graph coordinates — scattered far apart — and every edge that
 * connected them ran to a now-hidden neighbour, so the result reads as N lonely
 * dots. This module instead lays the kept nodes out as their OWN graph: the induced
 * subgraph (kept nodes + the edges whose BOTH endpoints are kept), solved with the
 * currently-selected layout and fitted to its own extent, so the filtered view
 * behaves like a real N-node network instead of silently reverting every mode to Force.
 *
 * Pure and Power-BI-free. Deterministic: positions are seeded from node keys, so the
 * same kept set always lays out identically (same guarantee as the full layout).
 *
 * The returned `positions` array is FULL-LENGTH — indexed by the ORIGINAL node index,
 * so the caller's per-node accessors (colour, radius, selection ids, tooltips) keep
 * working unchanged. Hidden (non-kept) nodes are parked at the subgraph centroid; they
 * are removed from view by the ranking mask, so their position is never seen and never
 * expands the fit bounds.
 */

import { GraphEdge, GraphModel, LayoutResult, Vec2 } from "./graphTypes";
import { buildGraphModel } from "./graphModel";
import { computeForceLayout, ForceLayoutConfig } from "./forceLayout";
import { resolveLayout, ResolveLayoutInput } from "./resolveLayout";

/** Resolve an induced kept-node graph with the selected layout, then map its
 * positions back to the original full-model indices used by the render pipeline. */
export function inducedSubgraphLayout(
    model: GraphModel,
    kept: Set<number>,
    input: ResolveLayoutInput,
): LayoutResult {
    // Edges internal to the kept set (both endpoints kept) → the induced subgraph.
    const edges: GraphEdge[] = [];
    for (const l of model.links) {
        if (kept.has(l.source) && kept.has(l.target)) {
            edges.push({ source: model.nodes[l.source].key, target: model.nodes[l.target].key, weight: l.weight });
        }
    }
    const sub = buildGraphModel(edges);

    // buildGraphModel only interns nodes that appear on an edge, so kept nodes with no
    // internal edge (an isolated hub, or a hub all of whose neighbours were filtered
    // out) would vanish. Add them back — every kept node must show, connected or not.
    for (const i of kept) {
        const key = model.nodes[i].key;
        if (!sub.indexByKey.has(key)) {
            const idx = sub.nodes.length;
            sub.indexByKey.set(key, idx);
            sub.nodes.push({ key, label: model.nodes[i].label, index: idx, degree: 0, inDegree: 0, outDegree: 0, weightedDegree: 0, component: -1 });
        }
    }

    const originalIndexBySub = sub.nodes.map((node) => model.indexByKey.get(node.key) ?? -1);
    const subInput: ResolveLayoutInput = {
        ...input,
        treeParents: input.treeParents
            ? originalIndexBySub.map((i) => {
                const parent = i >= 0 ? input.treeParents![i] : null;
                const pi = parent == null ? undefined : model.indexByKey.get(parent);
                return pi !== undefined && kept.has(pi) ? parent : null;
            })
            : undefined,
        geoCoords: input.geoCoords
            ? originalIndexBySub.map((i) => i >= 0 ? input.geoCoords![i] : null)
            : undefined,
        community: input.community
            ? originalIndexBySub.map((i) => i >= 0 ? input.community![i] : -1)
            : undefined,
        nodeRadii: input.nodeRadii
            ? originalIndexBySub.map((i) => i >= 0 ? input.nodeRadii![i] : 12)
            : undefined,
        labelWidths: input.labelWidths
            ? originalIndexBySub.map((i) => i >= 0 ? input.labelWidths![i] : 0)
            : undefined,
        ringGroups: input.ringGroups
            ? originalIndexBySub.map((i) => i >= 0 ? input.ringGroups![i] : null)
            : undefined,
    };
    const subLayout = resolveLayout(sub, subInput);

    // Map the subgraph positions back onto a full-length array (original indices).
    const cx = (subLayout.bounds.minX + subLayout.bounds.maxX) / 2;
    const cy = (subLayout.bounds.minY + subLayout.bounds.maxY) / 2;
    const positions: Vec2[] = model.nodes.map((n, i) => {
        if (!kept.has(i)) return { x: cx, y: cy }; // parked; hidden by the mask
        const si = sub.indexByKey.get(n.key);
        return si !== undefined ? subLayout.positions[si] : { x: cx, y: cy };
    });

    // Fit to the kept extent only, so the N nodes fill the viewport.
    return { positions, bounds: subLayout.bounds, iterations: subLayout.iterations };
}

/** Backward-compatible force-only entry point used by the pure model tests and
 * callers that do not need a selectable layout mode. */
export function inducedForceLayout(
    model: GraphModel,
    kept: Set<number>,
    config: Partial<ForceLayoutConfig>,
): LayoutResult {
    return inducedSubgraphLayout(model, kept, {
        mode: "force",
        pinned: false,
        storedPositions: null,
        charge: config.charge ?? -30,
        linkDistance: config.linkDistance ?? 30,
        community: config.community,
        clusterStrength: config.clusterStrength,
    });
}
