"use strict";

/**
 * Node → report cross-filter (feature C9). Clicking a node selects every edge
 * row incident to it, so the rest of the report filters to that node's
 * relationships. Ctrl/Cmd-click multi-selects. Selection state dims unselected
 * nodes/edges (host highlight semantics).
 */

import powerbi from "powerbi-visuals-api";
import { Selection } from "d3";
import { GraphModel } from "../model/graphTypes";
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

type NodeSel = Selection<SVGGraphicsElement, number, SVGGElement, unknown>;
type G = Selection<SVGGElement, unknown, null, undefined>;
interface ArrowheadDatum { edge: number }

export interface SelectionContext {
    /** For each node index, the selection ids of its incident rows. */
    idsByNode: ISelectionId[][];
    selectionManager: ISelectionManager;
    nodeGroup: G;
    edgeGroup: G;
    /** node index → true when selected (or empty = nothing selected). */
    onChange: () => void;
    /** Return true when the click was consumed by a node-local action such as
     *  hierarchy folding; consumed clicks must not also cross-filter. */
    activate?: (event: MouseEvent, nodeIndex: number) => boolean;
}

/** Bind click selection to the node circles. */
export function bindNodeSelection(nodeSel: NodeSel, ctx: SelectionContext): void {
    nodeSel.on("click", (event: MouseEvent, i: number) => {
        event.stopPropagation();
        if (ctx.activate?.(event, i)) return;
        const ids = ctx.idsByNode[i] ?? [];
        if (!ids.length) return;
        const multi = event.ctrlKey || event.metaKey;
        ctx.selectionManager.select(ids, multi).then(() => ctx.onChange());
    });
}

/**
 * Right-click → the host context menu (Power BI native feature: Drill through,
 * Include/Exclude, Show as table, Summarize…). Power BI requires the visual to
 * call `showContextMenu` itself — without this, right-clicking a custom visual
 * does nothing at all.
 *
 * `preventDefault` stops the browser menu; the coordinates must be relative to
 * the visual's own bounding box, not the page, or the menu opens off-target.
 *
 * `dataPoint` is the selection id of the right-clicked node (so the menu offers
 * data-point actions), or `{}` for empty canvas (report-level actions only).
 */
export function bindContextMenu(
    nodeSel: NodeSel,
    idsByNode: ISelectionId[][],
    selectionManager: ISelectionManager,
    originOf: (event: MouseEvent) => { x: number; y: number },
): void {
    nodeSel.on("contextmenu", (event: MouseEvent, i: number) => {
        event.preventDefault();
        event.stopPropagation();
        // One id per node is what the menu acts on (a node maps to many edge rows;
        // the first is the representative data point).
        const id = (idsByNode[i] ?? [])[0];
        selectionManager.showContextMenu(id ?? {}, originOf(event));
    });
}

/** Empty-canvas right-click → the report-level context menu. */
export function bindCanvasContextMenu(
    root: Selection<Element, unknown, null, undefined>,
    selectionManager: ISelectionManager,
    originOf: (event: MouseEvent) => { x: number; y: number },
): void {
    root.on("contextmenu", (event: MouseEvent) => {
        event.preventDefault();
        selectionManager.showContextMenu({}, originOf(event));
    });
}

/**
 * Dim nodes/edges that are not part of the current selection. With nothing
 * selected, everything returns to full opacity. `isSelectedNode(i)` is derived
 * by the visual from the selection manager's current ids.
 */
export function applySelectionDim(
    nodeGroup: G,
    edgeGroup: G,
    anySelected: boolean,
    isSelectedNode: (i: number) => boolean,
    linkEndpoints: (li: number) => [number, number],
    /** High-contrast `foregroundSelected`. When set, selection is carried by an
     *  outline rather than by opacity alone — opacity is a colour-only cue and
     *  reads poorly (or is stripped) under forced colours. */
    hcSelected?: string,
): void {
    // `opacity` (not fill-opacity) so it dims every marker type uniformly — circles,
    // shape paths, AND <image> nodes (fill-opacity has no effect on a raster image).
    // In HC the dim floor is raised (0.15 → 0.4) so unselected nodes stay legible.
    const dimTo = hcSelected ? 0.4 : 0.15;
    // The node type "halo" is a CSS drop-shadow ON the marker, so dimming its
    // opacity fades the glow with it — no separate halo element to manage.
    nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
        .attr("opacity", (i) => (!anySelected || isSelectedNode(i) ? 1 : dimTo));
    if (hcSelected) {
        nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
            .attr("stroke", (i) => (anySelected && isSelectedNode(i) ? hcSelected : null))
            .attr("stroke-width", (i) => (anySelected && isSelectedNode(i) ? 3 : 1));
    }
    edgeGroup.selectAll<SVGPathElement, number>("path.edge")
        .attr("stroke-opacity", function (li) {
            // Restore the edge's thickness-based base opacity (G2-002), not a flat 0.7,
            // for undimmed edges; deselected edges still fade to the dim value.
            // `?? 0.7` (not `|| 0.7`) so an intentional 0 base (hover-hide mode, req 1)
            // is honoured instead of springing the hidden edge back to visible.
            const raw = (this as SVGLineElement).getAttribute("data-op");
            const base = raw == null ? 0.7 : Number(raw);
            if (!anySelected) return base;
            const [s, t] = linkEndpoints(li);
            const on = isSelectedNode(s) && isSelectedNode(t);
            return on ? base : (hcSelected ? 0.25 : 0.08);
        });
    edgeGroup.selectAll<SVGPathElement, ArrowheadDatum>("path.arrowhead")
        .attr("fill-opacity", function (h) {
            const raw = this.getAttribute("data-op");
            const base = raw == null ? 0.7 : Number(raw);
            if (!anySelected) return base;
            const [s, t] = linkEndpoints(h.edge);
            return isSelectedNode(s) && isSelectedNode(t) ? base : (hcSelected ? 0.25 : 0.08);
        });
}

/**
 * Explore mode (E3): show only the ego subgraph. Nodes/labels outside `visible`
 * are hidden; an edge shows only when both endpoints are visible. Returns nothing
 * — it mutates display so the graph reads as the focused neighbourhood.
 */
export function applyExploreMask(
    nodeGroup: G,
    edgeGroup: G,
    labelGroup: G,
    model: GraphModel,
    visible: Set<number>,
    decorGroups: G[] = [],
): void {
    nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
        .style("display", (i) => (visible.has(i) ? null : "none"));
    // Hide the label of any masked-out node too (G2-005). Labels are drawn for the
    // highest-degree nodes BEFORE this mask runs, so without gating them a Top-N /
    // ego filter leaves the excluded nodes' names floating as orphaned text with no
    // circle beneath. Each label carries its node index in `data-ni` (labels are
    // appended individually, not data-joined, so read the attribute, not a datum).
    labelGroup.selectAll<SVGGraphicsElement, unknown>("text, rect")
        .style("display", function () {
            const ni = Number((this as SVGGraphicsElement).getAttribute("data-ni"));
            return visible.has(ni) ? null : "none";
        });
    // Node values and any future node-anchored decoration live in separate SVG
    // groups. They must follow the same hard-visibility mask as circles and labels;
    // Top-N parks excluded nodes at the induced-subgraph centroid, so an unmasked
    // value layer otherwise stacks every excluded value at the centre of the graph.
    for (const group of decorGroups) {
        group.selectAll<SVGGraphicsElement, unknown>("[data-ni]")
            .style("display", function () {
                const ni = Number((this as SVGGraphicsElement).getAttribute("data-ni"));
                return visible.has(ni) ? null : "none";
            });
    }
    edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
        .style("display", (li) => {
            const l = model.links[li];
            return visible.has(l.source) && visible.has(l.target) ? null : "none";
        });
    edgeGroup.selectAll<SVGPathElement, ArrowheadDatum>("path.arrowhead")
        .style("display", (h) => {
            const l = model.links[h.edge];
            return l && visible.has(l.source) && visible.has(l.target) ? null : "none";
        });
}

/**
 * Path emphasis (E5): highlight the nodes/edges on a shortest path, dim the rest.
 * `pathNodes` is the set of node indices on the path; `pathEdge(li)` says whether
 * link `li` is a consecutive step on the path.
 */
export function applyPathEmphasis(
    nodeGroup: G,
    edgeGroup: G,
    accent: string,
    pathNodes: Set<number>,
    pathEdge: (li: number) => boolean,
): void {
    nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
        .attr("opacity", (i) => (pathNodes.has(i) ? 1 : 0.12));
    edgeGroup.selectAll<SVGPathElement, number>("path.edge")
        .attr("stroke", (li) => (pathEdge(li) ? accent : null))
        .attr("stroke-width", function (li) {
            const base = this.getAttribute("data-w") || this.getAttribute("stroke-width") || "1";
            return pathEdge(li) ? String(Math.max(2.5, Number(base))) : base;
        })
        .attr("stroke-opacity", (li) => (pathEdge(li) ? 1 : 0.06));
    edgeGroup.selectAll<SVGPathElement, ArrowheadDatum>("path.arrowhead")
        .attr("fill-opacity", (h) => (pathEdge(h.edge) ? 1 : 0.06));
}

/**
 * Search/ranking highlight: enlarge + accent-ring matching nodes and dim the
 * rest. Search keeps an edge emphasized when either endpoint matches; ranking
 * can require both endpoints to match so half-active relationships stay dim.
 * `matches(i)` is precomputed by the caller.
 */
export function applySearchHighlight(
    nodeGroup: G,
    edgeGroup: G,
    model: GraphModel,
    accent: string,
    matches: (i: number) => boolean,
    edgeMatch: "any" | "both" = "any",
): void {
    const related = (li: number): boolean => {
        const l = model.links[li];
        if (!l) return false;
        return edgeMatch === "both"
            ? matches(l.source) && matches(l.target)
            : matches(l.source) || matches(l.target);
    };
    nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
        .attr("opacity", (i) => (matches(i) ? 1 : 0.12))
        .attr("stroke", (i) => (matches(i) ? accent : null))
        .attr("stroke-width", (i) => (matches(i) ? 3 : 1));
    edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.selfloop")
        .attr("stroke-opacity", function (li) {
            const raw = this.getAttribute("data-op");
            const base = raw == null ? 0.7 : Number(raw);
            return related(li) ? base : base * 0.12;
        });
    edgeGroup.selectAll<SVGPathElement, ArrowheadDatum>("path.arrowhead")
        .attr("fill-opacity", function (h) {
            const raw = this.getAttribute("data-op");
            const base = raw == null ? 1 : Number(raw);
            return related(h.edge) ? base : base * 0.12;
        });
    edgeGroup.selectAll<SVGTextElement, number>("text.edge-label")
        .attr("opacity", (li) => (related(li) ? 1 : 0.12));
}

/**
 * Hover neighbourhood emphasis (feature C8). Highlights the hovered node and its
 * 1-hop neighbours, dimming everything else, so a dense graph becomes legible on
 * hover without a mode switch. Restored to the selection dim state on mouse-out.
 */
export function applyHoverEmphasis(
    nodeGroup: G,
    edgeGroup: G,
    model: GraphModel,
    hovered: number,
    neighbors: number[][],
    /** Links are hidden (req 1: "show links on hover"): non-incident edges stay fully
     *  invisible instead of the usual faint dim, so only the hovered node's links show. */
    edgesHidden = false,
): void {
    const keep = new Set<number>([hovered, ...(neighbors[hovered] ?? [])]);
    nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
        .attr("opacity", (i) => (keep.has(i) ? 1 : 0.12));
    edgeGroup.selectAll<SVGPathElement, number>("path.edge")
        .attr("stroke-opacity", (li) => {
            const l = model.links[li];
            const incident = l.source === hovered || l.target === hovered;
            if (incident) return 0.9;
            return edgesHidden ? 0 : 0.05;
        });
    edgeGroup.selectAll<SVGPathElement, ArrowheadDatum>("path.arrowhead")
        .attr("fill-opacity", (h) => {
            const l = model.links[h.edge];
            const incident = l && (l.source === hovered || l.target === hovered);
            if (incident) return 0.9;
            return edgesHidden ? 0 : 0.05;
        });
}
