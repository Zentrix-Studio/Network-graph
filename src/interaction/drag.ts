"use strict";

/**
 * Manual node drag (feature C-drag). Lets the author grab a node and place it by
 * hand — the missing half of the pinned-layout wedge: pin freezes the *computed*
 * layout, drag lets you *author* one. On drop we convert the pixel positions back
 * to layout (world) space and hand them to the caller, which persists them as the
 * pinned positions blob so the arrangement survives refresh.
 *
 * Coordinate space: the node circles live inside the (possibly zoomed) `zoomGroup`,
 * so d3-drag's `event.x/​event.y` — computed in the parent group's local space —
 * already account for pan/zoom. No manual CTM math needed. Pure geometry; no Power
 * BI deps. Under jsdom the behavior simply attaches listeners and never fires, so
 * the settings sweep is unaffected.
 */

import { select, drag as d3drag, D3DragEvent, Selection } from "d3";
import { GraphModel, Vec2 } from "../model/graphTypes";
import { Hierarchy, subtreeSet } from "../model/hierarchy";
import { edgeCurvePath, edgeLabelPlacement, pairPerp, trimEdgeEnds } from "../render/graph";

type Circle = Selection<SVGGraphicsElement, number, SVGGElement, unknown>;
type G = Selection<SVGGElement, unknown, null, undefined>;

export interface DragHooks {
    /** Live pixel geometry — MUTATED in place as the node moves. */
    geo: { px: Vec2[]; scale: number; tx: number; ty: number };
    model: GraphModel;
    /** Bound Node-parent hierarchy. While a parent is held, descendants stay at
     *  their visible positions; on release they receive the parent's final delta
     *  as their animated target. A leaf still moves alone. */
    hierarchy?: Hierarchy;
    edgeGroup: G;
    labelGroup: G;
    /** Extra decoration layers whose text[data-ni] should follow the node (e.g. value-in-node). */
    decorGroups?: G[];
    /** Donut nodes are hollow, so incident edges are trimmed to the node's outer
     *  radius (never run to centre) — mirror that here so a live drag doesn't briefly
     *  expose the inner link. Omitted / false = run edges to centre as before. */
    donut?: boolean;
    /** Outer radius (px) for node i — only needed when `donut` is set. */
    radiusOf?: (i: number) => number;
    /** Called once per gesture when the node actually moves (to hide the tooltip). */
    onDragStart?: () => void;
    /** Toggle drag state on the visual (e.g. to suppress the R3 easing while dragging). */
    setDragging?: (on: boolean) => void;
    /** Called on drop with the full key→[worldX, worldY] map to persist + repaint
     *  and every node translated by the gesture. The caller can keep that complete
     *  group fixed while settling surrounding nodes (NG-112). */
    onDrop: (
        worldByKey: Record<string, [number, number]>,
        draggedIndices: number[],
    ) => void;
}

/** Attach drag-to-reposition to the node selection. */
export function enableNodeDrag(nodeSel: Circle, h: DragHooks): void {
    let moved = false;
    let travel = 0;
    let gestureIndices: number[] = [];
    let gestureStart: Vec2 = { x: 0, y: 0 };
    let gestureStartPositions: Vec2[] = [];
    let releaseDelta: Vec2 = { x: 0, y: 0 };
    /** Matches d3-drag's clickDistance below: under this, the gesture is a click,
     *  so we must not treat it as a hand-authored layout (which would auto-pin). */
    const DRAG_SLOP = 5;

    const behavior = d3drag<SVGGraphicsElement, number>()
        // NG-025 — cross-filter was dead because of this. d3-drag defaults
        // `clickDistance` to 0: on mouseup it calls dragEnable(view, moved) and,
        // when the pointer travelled ANY distance at all (one sub-pixel of hand
        // jitter is enough), installs a capture-phase listener that swallows the
        // following `click`. Every node handler — selection, notes, explore —
        // hangs off `click`, so a normal "click a node to cross-filter"
        // silently did nothing unless the user's hand was perfectly still.
        // A 5px slop makes a click a click and still starts a real drag promptly.
        .clickDistance(5)
        .on("start", (_event, i: number) => {
            moved = false;
            travel = 0;
            gestureStart = { ...h.geo.px[i] };
            releaseDelta = { x: 0, y: 0 };
            gestureIndices = h.hierarchy
                ? [...subtreeSet(h.hierarchy, i)].sort((a, b) => a - b)
                : [i];
            gestureStartPositions = h.geo.px.map((p) => ({ ...p }));
            const moving = new Set([i]);
            nodeSel
                .classed("zx-drag-root", (d) => d === i)
                .classed("zx-drag-member", (d) => moving.has(d));
            h.edgeGroup.classed("zx-drag-edges-active", true);
            h.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.selfloop")
                .classed("zx-drag-edge", (li) => {
                    const l = h.model.links[li];
                    return !!l && (moving.has(l.source) || moving.has(l.target));
                });
            h.setDragging?.(true);
        })
        .on("drag", (event: D3DragEvent<SVGGraphicsElement, number, unknown>, i: number) => {
            travel += Math.abs(event.dx) + Math.abs(event.dy);
            if (!moved && travel < DRAG_SLOP) return; // still a click, not a drag
            if (!moved) { moved = true; h.onDragStart?.(); }
            // event.x/y is the grabbed node's absolute position. Descendants
            // deliberately remain at their visible start positions until release.
            releaseDelta = {
                x: event.x - gestureStart.x,
                y: event.y - gestureStart.y,
            };
            const moving = [i];
            const movingSet = new Set(moving);

            // Only the grabbed parent follows the pointer. Parent-child edges stretch
            // toward the stationary children, making the pending adjustment explicit.
            h.geo.px[i] = { x: event.x, y: event.y };
            const dragged = nodeSel.filter((d) => d === i);
            const draggedNode = dragged.node();
            if (draggedNode && draggedNode.tagName.toLowerCase() === "circle") {
                dragged.attr("cx", event.x).attr("cy", event.y);
            } else {
                dragged.attr("transform", `translate(${event.x},${event.y})`);
            }

            // …re-anchor every edge incident to any translated node, rebuilding its
            // curved/fanned path from the cached offset (self-loops redraw on drop).
            h.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit").each(function (li) {
                const l = h.model.links[li];
                if (!movingSet.has(l.source) && !movingSet.has(l.target)) return;
                const sel = select(this);
                const off = +sel.attr("data-off") || 0;
                const parallel = +sel.attr("data-parallel") || 0;
                const sp = h.geo.px[l.source], tp = h.geo.px[l.target];
                const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                const [px, py] = pairPerp(h.geo.px[lo], h.geo.px[hi]);
                // Donut: pull each endpoint back to the outer radius so nothing shows
                // through the hole, but keep a MIN_EDGE_PX stub so a big node never
                // swallows its link (matches renderGraph's edgeDOf trimming).
                let s = sp, t = tp;
                if (h.donut && h.radiusOf) {
                    const { sx, sy, ex, ey } =
                        trimEdgeEnds(sp.x, sp.y, tp.x, tp.y, h.radiusOf(l.source), h.radiusOf(l.target));
                    s = { x: sx, y: sy }; t = { x: ex, y: ey };
                }
                sel.attr("d", edgeCurvePath(
                    s.x + px * parallel, s.y + py * parallel,
                    t.x + px * parallel, t.y + py * parallel,
                    px, py, off,
                ));
            });
            // Link labels remain attached to and aligned with the moving relationship.
            h.edgeGroup.selectAll<SVGTextElement, number>("text.edge-label").each(function (li) {
                const l = h.model.links[li];
                if (!movingSet.has(l.source) && !movingSet.has(l.target)) return;
                const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                const [px, py] = pairPerp(h.geo.px[lo], h.geo.px[hi]);
                const label = select(this);
                const parallel = +(label.attr("data-parallel") || 0);
                const place = edgeLabelPlacement(
                    { x: h.geo.px[l.source].x + px * parallel, y: h.geo.px[l.source].y + py * parallel },
                    { x: h.geo.px[l.target].x + px * parallel, y: h.geo.px[l.target].y + py * parallel },
                    px, py,
                    +(label.attr("data-off") || 0),
                );
                label.attr("x", place.x).attr("y", place.y).attr("transform", place.transform);
            });
            // …and carry every translated node's label + decoration text
            // (value-in-node) along; each holds its own centre-relative offset.
            for (const ni of moving) {
                const p = h.geo.px[ni];
                for (const grp of [h.labelGroup, ...(h.decorGroups ?? [])]) {
                    // The label's halo rect (if any) carries its own top-left offset —
                    // move it first so it stays behind the glyphs.
                    const bg = grp.select<SVGRectElement>(`rect[data-ni="${ni}"]`);
                    if (!bg.empty()) {
                        bg.attr("x", p.x + (+bg.attr("data-dx") || 0))
                            .attr("y", p.y + (+bg.attr("data-dy") || 0));
                    }
                    const t = grp.select<SVGTextElement>(`text[data-ni="${ni}"]`);
                    if (t.empty()) continue;
                    const nx = p.x + (+t.attr("data-dx") || 0);
                    const ny = p.y + (+t.attr("data-dy") || 0);
                    t.attr("x", nx).attr("y", ny);
                    t.selectAll("tspan").attr("x", nx); // wrapped lines share the x
                }
            }
        })
        .on("end", (_event: D3DragEvent<SVGGraphicsElement, number, unknown>, i: number) => {
            h.setDragging?.(false);
            nodeSel.classed("zx-drag-root", false).classed("zx-drag-member", false);
            h.edgeGroup.classed("zx-drag-edges-active", false)
                .selectAll("path").classed("zx-drag-edge", false);
            if (!moved) return; // a plain click, not a drag — leave selection alone
            // The DOM descendants are intentionally untouched. Mutate only the
            // target geometry now, so the repaint snapshots their old visible
            // positions and animates them to parentDelta-adjusted targets.
            for (const ni of gestureIndices) {
                if (ni === i) continue;
                const start = gestureStartPositions[ni] ?? h.geo.px[ni];
                h.geo.px[ni] = {
                    x: start.x + releaseDelta.x,
                    y: start.y + releaseDelta.y,
                };
            }
            const worldByKey: Record<string, [number, number]> = {};
            for (let k = 0; k < h.model.nodes.length; k++) {
                const wx = (h.geo.px[k].x - h.geo.tx) / (h.geo.scale || 1);
                const wy = (h.geo.px[k].y - h.geo.ty) / (h.geo.scale || 1);
                worldByKey[h.model.nodes[k].key] = [round2(wx), round2(wy)];
            }
            h.onDrop(worldByKey, gestureIndices.length ? gestureIndices : [i]);
        });

    nodeSel.call(behavior);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
