"use strict";

/**
 * Cluster → meta-node collapse (NG-078, Enterprise E2). Collapses each detected
 * community into a single super-node and produces a *consistent* (GraphModel,
 * GraphData) pair for the aggregated graph, so the entire render pipeline
 * (layout, colour, selection, insights) runs on it unchanged — no special-casing
 * downstream. Super-node size = member count; a super-node's selection rows are the
 * union of its members' rows (so clicking a meta-node cross-filters to the whole
 * community). Inter-community edges are summed; intra-community edges become a
 * self-loop on the super-node. Pure & deterministic. No Power BI deps.
 */

import { GraphModel, GraphEdge } from "./graphTypes";
import { buildGraphModel } from "./graphModel";
import { GraphData, NodeAttr } from "../types";

export interface ClusterGraph {
    model: GraphModel;
    data: GraphData;
    /** Original node indices per super-node (parallel to model.nodes). */
    membersBySuper: number[][];
}

const superKey = (s: number): string => `Cluster ${s + 1}`;

export function buildClusterGraph(model: GraphModel, community: number[], data: GraphData): ClusterGraph {
    const k = community.length ? Math.max(...community) + 1 : 0;

    // Members of each community (original node indices).
    const members: number[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < community.length; i++) members[community[i]].push(i);

    // Aggregate directed edge weights between communities (self = intra-community).
    const agg = new Map<string, { cs: number; ct: number; w: number }>();
    for (const l of model.links) {
        const cs = community[l.source], ct = community[l.target];
        const key = `${cs}->${ct}`;
        const e = agg.get(key);
        if (e) e.w += l.weight;
        else agg.set(key, { cs, ct, w: l.weight });
    }
    const edges: GraphEdge[] = [...agg.values()].map((e) => ({
        source: superKey(e.cs), target: superKey(e.ct), weight: e.w, type: null,
    }));

    const cgModel = buildGraphModel(edges);

    // Synthetic attrs aligned to cgModel node order (buildGraphModel may reorder by
    // first edge appearance). A community with no edges at all can't appear as a node
    // here — a documented edge case for fully-isolated singletons.
    const superOfKey = new Map<string, number>();
    for (let s = 0; s < k; s++) superOfKey.set(superKey(s), s);

    const attrs: NodeAttr[] = cgModel.nodes.map((n) => {
        const s = superOfKey.get(n.key) ?? 0;
        const rowIndices = members[s].flatMap((orig) => data.attrs[orig]?.rowIndices ?? []);
        return {
            category: n.key, size: members[s].length,
            parent: null, lat: null, lon: null, image: null, icon: null,
            rowIndices, tooltips: [{ name: "Members", value: String(members[s].length) }],
        };
    });

    const categories = cgModel.nodes.map((n) => n.key);

    const cgData: GraphData = {
        edges,
        attrs,
        hasWeight: data.hasWeight,
        hasCategory: true,   // colour super-nodes by cluster
        hasSize: true,       // size super-nodes by member count
        hasParent: false,
        hasIcon: false,
        hasTooltips: data.hasTooltips,
        hasEdgeType: false,
        categories,
        edgeTypes: [],
        edgeRowIndex: [],    // aggregated edges map to no single row (no edge cross-filter here)
        edgeTime: [],        // aggregated edges are timeless (temporal is inert here)
        hasTime: false,
        truncated: null,
        // Super-nodes are synthetic (no bound column names them) — keep the original
        // role names only where the aggregated value still means the same thing.
        roleNames: { ...data.roleNames, source: null, target: null, category: null, size: null },
    };

    const membersBySuper = cgModel.nodes.map((n) => members[superOfKey.get(n.key) ?? 0]);
    return { model: cgModel, data: cgData, membersBySuper };
}
