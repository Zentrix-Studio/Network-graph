"use strict";

/**
 * Domain contract shared across the visual's layers. The pure graph math types
 * live in `model/graphTypes.ts`; this file re-exports them and adds the
 * Power-BI-facing types (node attributes, empty-state reasons) the render and
 * interaction layers agree on.
 */

export * from "./model/graphTypes";

/** Why the visual is showing guidance instead of a graph. */
export type EmptyReason = "noData" | "needSource" | "needTarget";

/**
 * Per-node presentation attributes resolved from the DataView, indexed parallel
 * to `GraphModel.nodes`. Attributes are bound from the rows where the node is a
 * SOURCE (first-seen wins); target-only nodes get nulls and fall back to neutral
 * colour / degree-based size. (MVP simplification — see dataTransform.ts.)
 */
export interface NodeAttr {
    /** Category value (drives colour), or null. */
    category: string | null;
    /** Node-size measure value, or null. */
    size: number | null;
    /** Parent key for org-chart/tree mode (Enterprise), or null. */
    parent: string | null;
    /** Latitude / longitude for geo-route layout (from the Lat/Long roles), or null. */
    lat: number | null;
    lon: number | null;
    /** Per-node image (base64 data: URI) from the Node image role, or null. */
    image: string | null;
    /** Per-node emoji/glyph from the Node icon role, or null. */
    icon: string | null;
    /** Row indices (into the DataView table) incident to this node — used to
     *  build the selection that cross-filters the report by this node. */
    rowIndices: number[];
    /** Extra fields bound to the Tooltips data role, shown in the node tooltip.
     *  Bound from the row where the node is first seen as SOURCE. */
    tooltips: { name: string; value: string }[];
}

/** Which information fills the node hover card. */
export type NodeInfoMode = "business" | "combined" | "network";

/** A report-authored business field prepared for node information surfaces. */
export interface NodeInfoField {
    name: string;
    value: string;
}

/** Assembled, presentation-ready graph handed from the model layer to render. */
export interface GraphData {
    edges: import("./model/graphTypes").GraphEdge[];
    attrs: NodeAttr[];
    /** Present only when identity was split by source/target role (merge off): maps
     *  each compound identity key to its bare display name. Passed to `buildGraphModel`
     *  so nodes resolve a human label; absent in the common case, where a node's label
     *  is its key. */
    labelByKey?: Map<string, string>;
    /** True when the optional Edge weight data role is bound. */
    hasWeight: boolean;
    hasCategory: boolean;
    hasSize: boolean;
    hasParent: boolean;
    /** True when the Icon data role is bound (drives "By field value" UI). */
    hasIcon: boolean;
    /** True when at least one field is bound to the Tooltips data role. */
    hasTooltips: boolean;
    hasEdgeType: boolean;
    /** Distinct category values in first-seen order (for the colour scale). */
    categories: string[];
    /** Distinct edge-type values in first-seen order (for edge colour/dash + legend). */
    edgeTypes: string[];
    /** DataView row index for each edge (parallel to `edges` / `model.links`), so an
     *  edge can carry its own selection id for cross-filtering (NG-076). */
    edgeRowIndex: number[];
    /** Per-edge time value (parallel to `edges`), or null when unbound/unparseable (NG-077). */
    edgeTime: (number | null)[];
    /** True when a Time role is bound with at least one parseable value. */
    hasTime: boolean;
    /** Non-null when the row window was capped — drives the "showing N of M" note. */
    truncated: { shownRows: number; totalRows: number } | null;
    /** Display names of the bound columns, per role (null when the role is unbound
     *  or the column has no name). Native tooltips label rows with these so the
     *  card reads "field name : value", not a generic "Node : value" (NG-111). */
    roleNames: RoleDisplayNames;
}

/** Column display name per data role, for user-facing labels. */
export interface RoleDisplayNames {
    source: string | null;
    target: string | null;
    weight: string | null;
    category: string | null;
    size: string | null;
    edgeType: string | null;
    time: string | null;
}
