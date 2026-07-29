"use strict";

/**
 * Domain contract for the graph model — the types every layer agrees on.
 * No Power BI dependencies; fully unit-testable. This is the network-graph
 * analog of the calendar heatmap's `types.ts`.
 *
 * A `key` is the node's *natural key* — the source/target category value from
 * the DataView. It is stable across refreshes (unlike a positional index or a
 * host `selectionId`), which is why layout seeding, pinned positions, and node
 * annotations all anchor on it. See feature-reference.md wedges #1 (pinned
 * layout) and the annotation anchoring rule.
 */

/** A 2-D point. Layout works in an abstract unit space; the renderer scales it. */
export interface Vec2 {
    x: number;
    y: number;
}

/** An input edge as read from the DataView (source/target are natural keys). */
export interface GraphEdge {
    source: string;
    target: string;
    /** Edge weight (defaults to 1 when the Edge-weight role is unbound). */
    weight: number;
    /** Edge type/category (from the Edge type role) — drives colour + line style. */
    type?: string | null;
}

/** A node after adjacency is built. Degrees are split so directed data keeps in/out. */
export interface GraphNode {
    /** Node *identity* — stable across refreshes; anchors layout seeding, pins,
     *  annotations, and selection. When "Merge duplicate nodes" is off, this is a
     *  compound key (name + source/target role marker) so a name that is both a source
     *  and a target stays two vertices; the human-readable name lives on `label`. */
    key: string;
    /** Node *display* text — the bare name shown in labels, tooltips, tables. Equal
     *  to `key` unless a compound identity split it (see `key`). Never anchor on this. */
    label: string;
    /** Insertion index — stable, assigned in first-seen order over the edge list. */
    index: number;
    degree: number;
    inDegree: number;
    outDegree: number;
    /** Sum of incident edge weights (in + out). */
    weightedDegree: number;
    /** 0-based connected-component id (assigned deterministically). */
    component: number;
}

/** The assembled graph: nodes + edges resolved to node indices, plus metrics. */
export interface GraphModel {
    nodes: GraphNode[];
    /** Edges resolved to node indices into `nodes` (source/target collapsed). */
    links: { source: number; target: number; weight: number; type?: string | null }[];
    /** key → index into `nodes`, for O(1) lookup. */
    indexByKey: Map<string, number>;
    componentCount: number;
    /** True when at least one self-loop (source === target) was present. */
    hasSelfLoops: boolean;
    /** True when the same unordered pair appears more than once (parallel edges). */
    hasParallelEdges: boolean;
}

/** Result of a layout run: a position per node, indexed to `GraphModel.nodes`. */
export interface LayoutResult {
    positions: Vec2[];
    /** Axis-aligned bounds of the laid-out positions (pre-scale). */
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    /** Iterations actually run (may be < requested if converged early — but the
     * spike runs a fixed count for strict determinism). */
    iterations: number;
}
