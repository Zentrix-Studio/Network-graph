"use strict";

/**
 * Pure graph assembly: an edge list → a `GraphModel` with degree metrics and
 * connected-component ids. No Power BI dependencies. Everything here is
 * order-deterministic: nodes are indexed in first-seen order over the edge
 * list, and components are numbered by ascending minimum member index, so the
 * same DataView always yields byte-identical structure (a prerequisite for the
 * layout determinism the whole visual depends on).
 *
 * Self-loops, parallel edges, and disconnected components are all first-class
 * here — never errors — per the build spec's data-role contract.
 */

import { GraphEdge, GraphModel, GraphNode } from "./graphTypes";

/**
 * Build the adjacency-backed model from raw edges (source/target = natural keys).
 * `labelByKey` optionally maps an identity key to its display name — supplied when
 * "Merge duplicate nodes" is off and the source/target-role split made the key a
 * compound value; absent, a node's label is its key (the common case).
 */
export function buildGraphModel(edges: GraphEdge[], labelByKey?: Map<string, string>): GraphModel {
    const indexByKey = new Map<string, number>();
    const nodes: GraphNode[] = [];

    const intern = (key: string): number => {
        let idx = indexByKey.get(key);
        if (idx === undefined) {
            idx = nodes.length;
            indexByKey.set(key, idx);
            nodes.push({
                key,
                label: labelByKey?.get(key) ?? key,
                index: idx,
                degree: 0,
                inDegree: 0,
                outDegree: 0,
                weightedDegree: 0,
                component: -1,
            });
        }
        return idx;
    };

    const links: GraphModel["links"] = [];
    const seenPairs = new Set<string>();
    let hasSelfLoops = false;
    let hasParallelEdges = false;

    for (const e of edges) {
        const s = intern(e.source);
        const t = intern(e.target);
        const w = Number.isFinite(e.weight) ? e.weight : 1;

        if (s === t) hasSelfLoops = true;

        // Parallel-edge detection on the unordered pair (min-max keeps A-B == B-A).
        const pairKey = s < t ? `${s}-${t}` : `${t}-${s}`;
        if (seenPairs.has(pairKey)) hasParallelEdges = true;
        else seenPairs.add(pairKey);

        links.push(e.type === undefined
            ? { source: s, target: t, weight: w }
            : { source: s, target: t, weight: w, type: e.type });

        // Degree accounting. Self-loops count once for undirected degree but
        // contribute to both in and out for directed metrics.
        nodes[s].outDegree += 1;
        nodes[t].inDegree += 1;
        nodes[s].weightedDegree += w;
        if (s !== t) nodes[t].weightedDegree += w;
        nodes[s].degree += 1;
        if (s !== t) nodes[t].degree += 1;
    }

    const componentCount = assignComponents(nodes, links);

    return {
        nodes,
        links,
        indexByKey,
        componentCount,
        hasSelfLoops,
        hasParallelEdges,
    };
}

/**
 * Undirected neighbour lists per node index (deduped, self-loops excluded).
 * Used by hover neighbourhood emphasis (feature C8) and, later, clustering.
 * Deterministic: neighbours appear in ascending index order.
 */
export function neighborIndex(model: GraphModel): number[][] {
    const sets = model.nodes.map(() => new Set<number>());
    for (const l of model.links) {
        if (l.source === l.target) continue;
        sets[l.source].add(l.target);
        sets[l.target].add(l.source);
    }
    return sets.map((s) => [...s].sort((a, b) => a - b));
}

export interface NeighborConnection {
    key: string;
    label: string;
    weight: number;
    /** Complete, readable relationship description with explicit direction. */
    phrase: string;
}

interface ConnectionAccumulator {
    weight: number;
    incomingTypes: string[];
    outgoingTypes: string[];
    incoming: boolean;
    outgoing: boolean;
}

/**
 * Top-k connections of node `i` by summed incident edge weight. The legacy function
 * name is retained for API compatibility, but each result now includes a complete
 * directional phrase for business-readable tooltip/detail UI. Deterministic: ties
 * break by ascending node index. Self-loops excluded.
 */
export function topNeighbors(model: GraphModel, i: number, k: number): NeighborConnection[] {
    const byNode = new Map<number, ConnectionAccumulator>();
    const addType = (types: string[], type?: string | null): void => {
        const value = String(type ?? "").trim();
        if (value && !types.includes(value)) types.push(value);
    };
    for (const l of model.links) {
        if (l.source === l.target) continue;
        const other = l.source === i ? l.target : l.target === i ? l.source : -1;
        if (other < 0) continue;
        const acc = byNode.get(other) ?? {
            weight: 0, incomingTypes: [], outgoingTypes: [], incoming: false, outgoing: false,
        };
        acc.weight += l.weight;
        if (l.source === i) {
            acc.outgoing = true;
            addType(acc.outgoingTypes, l.type);
        } else {
            acc.incoming = true;
            addType(acc.incomingTypes, l.type);
        }
        byNode.set(other, acc);
    }
    return [...byNode.entries()]
        .sort((a, b) => (b[1].weight - a[1].weight) || (a[0] - b[0]))
        .slice(0, k)
        .map(([idx, acc]) => {
            const selected = model.nodes[i].label;
            const other = model.nodes[idx].label;
            let phrase: string;
            if (acc.incoming && acc.outgoing) {
                phrase = `${selected} and ${other} connect in both directions`;
            } else if (acc.outgoing) {
                phrase = acc.outgoingTypes.length
                    ? relationshipPhrase(selected, other, acc.outgoingTypes)
                    : `${selected} connects to ${other}`;
            } else if (acc.incoming) {
                phrase = acc.incomingTypes.length
                    ? relationshipPhrase(other, selected, acc.incomingTypes)
                    : `${other} connects to ${selected}`;
            } else {
                phrase = `${selected} connects with ${other}`;
            }
            return { key: model.nodes[idx].key, label: other, weight: acc.weight, phrase };
        });
}

/** Turn a relationship type into a complete source→target phrase. */
function relationshipPhrase(source: string, target: string, types: string[]): string {
    if (types.length > 1) return `${source} connects to ${target} via ${types.join(", ")}`;
    const type = types[0].trim();
    switch (type.toLowerCase()) {
        case "report":
        case "reports":
        case "reports to":
            return `${source} reports to ${target}`;
        case "manage":
        case "manages":
            return `${source} manages ${target}`;
        case "supply":
        case "supplies":
            return `${source} supplies ${target}`;
        default:
            return `${source} relates to ${target} as ${type}`;
    }
}

/**
 * Union-Find over undirected connectivity, then relabel components by ascending
 * minimum member index so numbering is deterministic regardless of edge order.
 * Isolated nodes (degree 0) each form their own component. Returns the count.
 */
function assignComponents(
    nodes: GraphNode[],
    links: { source: number; target: number }[],
): number {
    const parent = nodes.map((_, i) => i);
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]]; // path halving
            x = parent[x];
        }
        return x;
    };
    const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };

    for (const l of links) union(l.source, l.target);

    // Relabel roots to dense 0..k-1 ids in ascending-root order (== ascending
    // minimum member index, since union always points the larger root at the
    // smaller). This is what makes component ids reproducible.
    const label = new Map<number, number>();
    let next = 0;
    for (let i = 0; i < nodes.length; i++) {
        const root = find(i);
        let id = label.get(root);
        if (id === undefined) {
            id = next++;
            label.set(root, id);
        }
        nodes[i].component = id;
    }
    return next;
}

/**
 * Directed weighted flow per node (N4 label-content modes): inflow = Σ weights of
 * incoming links, outflow = Σ weights of outgoing links. Self-loops count on both
 * sides (the flow leaves and re-enters the node). Pure, O(E), deterministic.
 */
export function nodeFlows(model: GraphModel): { inflow: number[]; outflow: number[] } {
    const n = model.nodes.length;
    const inflow = new Array<number>(n).fill(0);
    const outflow = new Array<number>(n).fill(0);
    for (const l of model.links) {
        const w = Number.isFinite(l.weight) ? l.weight : 1;
        outflow[l.source] += w;
        inflow[l.target] += w;
    }
    return { inflow, outflow };
}
