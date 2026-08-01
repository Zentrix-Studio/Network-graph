"use strict";

/**
 * DataView → graph data. Reads the `table` dataViewMapping (one row per edge)
 * and produces the raw edge list plus per-node presentation attributes. This is
 * the ONLY module that touches Power BI types on the model side; the graph math
 * (adjacency, layout) downstream is pure and Power-BI-free.
 *
 * Node attributes (category / size / parent) are edge-level in the DataView but
 * node-level in the graph, so we bind them from the row where a node first
 * appears as SOURCE. Target-only nodes get nulls and fall back to neutral colour
 * / degree-based size. (MVP simplification — a later pass can add an explicit
 * node table role.)
 */

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

import { GraphEdge } from "./graphTypes";
import { GraphData, NodeAttr, EmptyReason, RoleDisplayNames } from "../types";

/** Map each bound data role to its column index in the table. */
interface RoleIndex {
    source: number;
    target: number;
    weight: number;
    nodeCategory: number;
    nodeSize: number;
    nodeParent: number;
    latitude: number;
    longitude: number;
    edgeType: number;
    nodeImage: number;
    nodeIcon: number;
    time: number;
    /** Column indices bound to the Tooltips role (can be several), with their names. */
    tooltips: { index: number; name: string }[];
}

/**
 * DataView normalization (NG-228). The visual now uses a `categorical`
 * dataViewMapping so Power BI delivers inbound cross-highlight (`supportsHighlight`);
 * the jsdom harness and the test suite still build `table` DataViews. Both are
 * flattened to the SAME row/column shape here so all downstream logic is unchanged,
 * and the categorical path additionally captures the per-row highlight mask.
 */
interface NormalizedColumn { roles: Record<string, boolean> | undefined; displayName: string; }
interface NormalizedTable {
    columns: NormalizedColumn[];
    rows: powerbi.PrimitiveValue[][];
    /** Per-row inbound-highlight flag (true = highlighted / kept, false = dimmed).
     *  All-true when no inbound highlight is active. */
    highlights: boolean[];
    /** True when a categorical highlights array is present (cross-highlight active). */
    hasHighlight: boolean;
}

function fromTable(table: powerbi.DataViewTable): NormalizedTable {
    const columns: NormalizedColumn[] = (table.columns ?? []).map((c) => ({
        roles: c.roles as Record<string, boolean> | undefined,
        displayName: c.displayName ?? "",
    }));
    const rows = (table.rows ?? []) as powerbi.PrimitiveValue[][];
    return { columns, rows, highlights: rows.map(() => true), hasHighlight: false };
}

function fromCategorical(cat: powerbi.DataViewCategorical): NormalizedTable {
    const cats = cat.categories ?? [];
    const vals = cat.values ?? [];
    const n = cats.length ? (cats[0].values?.length ?? 0)
        : (vals.length ? (vals[0].values?.length ?? 0) : 0);
    const columns: NormalizedColumn[] = [
        ...cats.map((c) => ({ roles: c.source.roles as Record<string, boolean> | undefined, displayName: c.source.displayName ?? "" })),
        ...vals.map((v) => ({ roles: v.source.roles as Record<string, boolean> | undefined, displayName: v.source.displayName ?? "" })),
    ];
    const rows: powerbi.PrimitiveValue[][] = [];
    for (let i = 0; i < n; i++) {
        const row: powerbi.PrimitiveValue[] = [];
        for (const c of cats) row.push(c.values ? c.values[i] : null);
        for (const v of vals) row.push(v.values ? v.values[i] : null);
        rows.push(row);
    }
    // Inbound highlight: value columns carry a parallel `highlights` array when another
    // visual cross-highlights this one. A row is in the highlighted set if ANY measure's
    // highlight for that row is non-null (null = filtered out / dimmed).
    const highlightCols = vals.filter((v) => v.highlights);
    const hasHighlight = highlightCols.length > 0;
    const highlights: boolean[] = [];
    for (let i = 0; i < n; i++) {
        highlights.push(hasHighlight ? highlightCols.some((v) => v.highlights![i] != null) : true);
    }
    return { columns, rows, highlights, hasHighlight };
}

/** Flatten either dataView mapping to the common normalized shape, or null if neither is present. */
function normalize(dataView: DataView | undefined): NormalizedTable | null {
    if (!dataView) return null;
    const cat = dataView.categorical;
    if (cat && ((cat.categories?.length ?? 0) || (cat.values?.length ?? 0))) return fromCategorical(cat);
    if (dataView.table) return fromTable(dataView.table);
    return null;
}

function roleIndices(nt: NormalizedTable): RoleIndex {
    const cols = nt.columns;
    const find = (role: string) => cols.findIndex((c) => c.roles && c.roles[role]);
    const tooltips: { index: number; name: string }[] = [];
    cols.forEach((c, i) => {
        if (c.roles && c.roles["tooltips"]) tooltips.push({ index: i, name: c.displayName || `Field ${i}` });
    });
    return {
        source: find("source"),
        target: find("target"),
        weight: find("weight"),
        nodeCategory: find("nodeCategory"),
        nodeSize: find("nodeSize"),
        nodeParent: find("nodeParent"),
        latitude: find("latitude"),
        longitude: find("longitude"),
        edgeType: find("edgeType"),
        nodeImage: find("nodeImage"),
        nodeIcon: find("nodeIcon"),
        time: find("time"),
        tooltips,
    };
}

/** Coerce a bound time cell (number / Date / date-string) to a sortable number, or null. */
export function asTime(v: unknown): number | null {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v instanceof Date) { const t = v.getTime(); return Number.isNaN(t) ? null : t; }
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return t;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** True when both required roles (source, target) are bound. */
export function hasRequiredRoles(dataView: DataView | undefined): boolean {
    const nt = normalize(dataView);
    if (!nt) return false;
    const r = roleIndices(nt);
    return r.source >= 0 && r.target >= 0;
}

/**
 * The empty-state reason for a DataView, or null when both required roles are
 * bound and the visual can render. Drives per-missing-role guidance.
 */
export function missingRequiredRole(dataView: DataView | undefined): EmptyReason | null {
    const nt = normalize(dataView);
    if (!nt || !nt.columns.length) return "noData";
    const r = roleIndices(nt);
    if (r.source < 0) return "needSource";
    if (r.target < 0) return "needTarget";
    return null;
}

function asText(v: powerbi.PrimitiveValue): string | null {
    if (v == null) return null;
    return String(v);
}

function asNumber(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Build the presentation-ready graph from the DataView. Assumes `hasRequiredRoles`
 * already passed. Deterministic: rows are consumed in order, node indices are
 * first-seen, so the same DataView always yields identical structure.
 *
 * `maxEdges` is the honest render budget (scale mode, E1): edges beyond it are
 * dropped and reported via `truncated` — the "showing N of M" contract. Never a
 * silent truncation, never a frozen visual. Deterministic: the first `maxEdges`
 * valid edges (in row order) are kept.
 */
export function buildGraphData(
    dataView: DataView, maxEdges = Infinity,
    opts?: {
        /** Merge duplicate nodes (N9): identity becomes whitespace-collapsed,
         *  case-insensitive — "Acme Corp", " acme  corp " and "ACME CORP" are one
         *  node. The FIRST-SEEN spelling stays the display/natural key, so pin
         *  blobs and annotations anchored before the merge keep matching it. */
        mergeDuplicates?: boolean;
    },
): GraphData {
    const nt = normalize(dataView) ?? { columns: [], rows: [], highlights: [], hasHighlight: false };
    const r = roleIndices(nt);
    const rows = nt.rows;

    // Merge is ON unless explicitly disabled — mirrors the product default (settings.ts)
    // so direct callers and the live visual agree on the standard "one node per name" view.
    const merge = opts?.mergeDuplicates ?? true;

    // Canonicalize a raw node string to its merged identity (first-seen spelling).
    const canonByNorm = new Map<string, string>();
    const canon = (raw: string): string => {
        if (!merge) return raw;
        const norm = raw.trim().replace(/\s+/g, " ").toLowerCase();
        const seen = canonByNorm.get(norm);
        if (seen != null) return seen;
        const display = raw.trim().replace(/\s+/g, " ");
        canonByNorm.set(norm, display);
        return display;
    };

    // Direction split (N9, inverse of merge): with merge OFF, a node's *outgoing*
    // role (as a source) and *incoming* role (as a target) become two distinct
    // vertices. A name that is both a hub of out-edges and a sink of in-edges then
    // renders as two hubs - the raw, un-collapsed directed view ("London" as an
    // origin vs "London" as a destination, each with its own out-total / in-total).
    // Merge ON puts both roles back on one node (the analysis default). The display
    // label always stays the bare name; a NUL + role marker separates identity from
    // name so a compound key can never collide with a real node name.
    const SEP = "\u0000";
    const labelByKey = new Map<string, string>(); // compound key -> bare display name
    const roleKey = (rawName: string, outgoing: boolean): string => {
        const base = canon(rawName);
        if (merge) return base;
        const key = base + SEP + (outgoing ? ">" : "<");
        if (!labelByKey.has(key)) labelByKey.set(key, base);
        return key;
    };

    const edges: GraphEdge[] = [];
    const edgeRowIndex: number[] = []; // DataView row per edge (NG-076 edge selection)
    const edgeHighlight: boolean[] = []; // per-edge inbound highlight flag (NG-228)
    const edgeTime: (number | null)[] = []; // per-edge time value (NG-077 temporal)
    // key → provisional attribute record, plus incident row indices.
    const attrByKey = new Map<string, NodeAttr>();
    const orderByKey = new Map<string, number>(); // first-seen index for stable ordering
    const categorySeen = new Set<string>();
    const categories: string[] = [];
    const edgeTypeSeen = new Set<string>();
    const edgeTypes: string[] = [];

    const ensure = (key: string): NodeAttr => {
        let a = attrByKey.get(key);
        if (!a) {
            a = { category: null, size: null, parent: null, lat: null, lon: null, image: null, icon: null, rowIndices: [], tooltips: [] };
            attrByKey.set(key, a);
            orderByKey.set(key, orderByKey.size);
        }
        return a;
    };

    let validEdges = 0;
    let overBudget = false;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rawSrc = asText(row[r.source]);
        const rawTgt = asText(row[r.target]);
        if (rawSrc == null || rawTgt == null) continue; // an edge needs both endpoints
        // The row's category is read once, for the node colour/cluster attribute below.
        const rawCat = r.nodeCategory >= 0 ? asText(row[r.nodeCategory]) : null;
        // Identity by role when unmerged: the source endpoint is this name's outgoing
        // vertex, the target endpoint its incoming vertex (they collapse to one node
        // when merge is on).
        const src = roleKey(rawSrc, true);
        const tgt = roleKey(rawTgt, false);

        validEdges++;
        if (edges.length >= maxEdges) { overBudget = true; continue; } // honest render cap

        const weight = r.weight >= 0 ? asNumber(row[r.weight]) ?? 1 : 1;
        const etype = r.edgeType >= 0 ? asText(row[r.edgeType]) : null;
        edges.push({ source: src, target: tgt, weight, type: etype });
        edgeRowIndex.push(i);
        edgeHighlight.push(nt.highlights[i] ?? true);
        edgeTime.push(r.time >= 0 ? asTime(row[r.time]) : null);
        if (etype != null && !edgeTypeSeen.has(etype)) { edgeTypeSeen.add(etype); edgeTypes.push(etype); }

        const sa = ensure(src);
        const ta = ensure(tgt);
        sa.rowIndices.push(i);
        if (tgt !== src) ta.rowIndices.push(i);

        // Bind node attributes from the SOURCE row (first-seen wins).
        if (r.nodeCategory >= 0 && sa.category == null) {
            sa.category = rawCat;
            if (rawCat != null && !categorySeen.has(rawCat)) {
                categorySeen.add(rawCat);
                categories.push(rawCat);
            }
        }
        // When unmerged, the incoming-role vertex is its own node that may never appear
        // as a source, so bind its category from this row too — otherwise a pure sink
        // (a leaf) would stay uncoloured.
        if (!merge && r.nodeCategory >= 0 && tgt !== src && ta.category == null) ta.category = rawCat;
        if (r.nodeSize >= 0 && sa.size == null) sa.size = asNumber(row[r.nodeSize]);
        if (r.nodeParent >= 0 && sa.parent == null) {
            // Parent references merge through the same canonical identity, or the
            // hierarchy would silently split across spelling variants.
            const rawParent = asText(row[r.nodeParent]);
            sa.parent = rawParent == null ? null : canon(rawParent);
        }
        // Geo coords describe the row's SOURCE node (like category/size), bound once
        // from where the node is first seen as a source. A node that is only ever a
        // target stays un-geocoded and falls to the centroid (documented limitation;
        // a dedicated node table is the future fix).
        if (r.latitude >= 0 && sa.lat == null) sa.lat = asNumber(row[r.latitude]);
        if (r.longitude >= 0 && sa.lon == null) sa.lon = asNumber(row[r.longitude]);
        if (r.nodeImage >= 0 && sa.image == null) sa.image = asText(row[r.nodeImage]);
        if (r.nodeIcon >= 0 && sa.icon == null) sa.icon = asText(row[r.nodeIcon]);
        // Tooltip fields bound from the node's first-seen SOURCE row (once per node).
        if (r.tooltips.length && sa.tooltips.length === 0) {
            for (const t of r.tooltips) {
                const v = asText(row[t.index]);
                if (v != null) sa.tooltips.push({ name: t.name, value: v });
            }
        }
    }

    // Emit attrs in first-seen key order — the SAME order buildGraphModel assigns
    // node indices, so `attrs[i]` lines up with `model.nodes[i]`.
    const attrs: NodeAttr[] = new Array(orderByKey.size);
    for (const [key, order] of orderByKey) attrs[order] = attrByKey.get(key)!;

    const truncated = overBudget ? { shownRows: edges.length, totalRows: validEdges } : null;
    // Inbound highlight is "active" only when the host actually differentiated rows
    // (some kept, some dimmed) — an all-highlighted mask dims nothing.
    const hasInboundHighlight = nt.hasHighlight && edgeHighlight.some((h) => !h);

    return {
        edges,
        attrs,
        edgeHighlight: hasInboundHighlight ? edgeHighlight : undefined,
        hasInboundHighlight,
        labelByKey: labelByKey.size ? labelByKey : undefined,
        hasWeight: r.weight >= 0,
        hasCategory: r.nodeCategory >= 0,
        hasSize: r.nodeSize >= 0,
        hasParent: r.nodeParent >= 0,
        hasIcon: r.nodeIcon >= 0,
        hasTooltips: r.tooltips.length > 0,
        hasEdgeType: r.edgeType >= 0,
        categories,
        edgeTypes,
        edgeRowIndex,
        edgeTime,
        hasTime: r.time >= 0 && edgeTime.some((t) => t != null),
        truncated,
        roleNames: roleDisplayNames(nt, r),
    };
}

/** Display name of each bound role's column (NG-111) — labels for native tooltips. */
function roleDisplayNames(nt: NormalizedTable, r: RoleIndex): RoleDisplayNames {
    const cols = nt.columns;
    const name = (i: number): string | null => (i >= 0 ? (cols[i]?.displayName || null) : null);
    return {
        source: name(r.source),
        target: name(r.target),
        weight: name(r.weight),
        category: name(r.nodeCategory),
        size: name(r.nodeSize),
        edgeType: name(r.edgeType),
        time: name(r.time),
    };
}
