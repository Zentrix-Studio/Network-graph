"use strict";

/**
 * Cluster captions (Enterprise E2). One text label per cluster, placed just above
 * the cluster's node cloud so the shaded hulls read as named regions. Pure geometry
 * — the anchor is the arithmetic mean X and the cluster's top EDGE (min of each node's
 * `y − radius`, so the caption clears the topmost node instead of landing on it, NG-246);
 * no `getBBox`, so the jsdom sweep still drives the real render path.
 */

import { Selection } from "d3";
import { Vec2 } from "../model/graphTypes";

type G = Selection<SVGGElement, unknown, null, undefined>;

export interface ClusterLabelStyle {
    font?: string;
    fontSize?: number;
    /** Flat caption colour. Ignored when `colorOf` is supplied. */
    color?: string;
    /** Per-cluster caption colour (NG-247). Used for "Auto" mode so each caption matches
     *  its cluster's colour; falls back to `color` when omitted. */
    colorOf?: (cluster: number) => string;
    bold?: boolean;
    italic?: boolean;
    /** Gap (px) above the cluster's topmost node EDGE where the caption baseline sits. */
    offset?: number;
}

/**
 * Draw one caption per cluster into `group`. `labelOf(cluster)` supplies the text
 * (empty string → skipped). Clusters with no nodes are skipped. `radiusOf` lets the
 * caption clear the actual node glyph (defaults to point nodes when omitted).
 */
export function renderClusterLabels(
    group: G,
    positionsPx: Vec2[],
    community: number[],
    labelOf: (cluster: number) => string,
    style: ClusterLabelStyle = {},
    radiusOf: (i: number) => number = () => 0,
): void {
    group.selectAll("*").remove();
    const fontSize = style.fontSize ?? 12;
    const offset = style.offset ?? 10;

    // Per-cluster centroid X + top EDGE (y − radius), in one pass. Using the node's top
    // edge — not its centre — keeps the caption off a large topmost node (NG-246).
    const sumX = new Map<number, number>();
    const cnt = new Map<number, number>();
    const minEdgeY = new Map<number, number>();
    for (let i = 0; i < positionsPx.length; i++) {
        const c = community[i];
        const p = positionsPx[i];
        sumX.set(c, (sumX.get(c) ?? 0) + p.x);
        cnt.set(c, (cnt.get(c) ?? 0) + 1);
        minEdgeY.set(c, Math.min(minEdgeY.get(c) ?? Infinity, p.y - Math.max(0, radiusOf(i))));
    }

    for (const c of [...cnt.keys()].sort((a, b) => a - b)) {
        const text = labelOf(c);
        if (!text) continue;
        const cx = (sumX.get(c) ?? 0) / (cnt.get(c) || 1);
        const top = (minEdgeY.get(c) ?? 0) - offset;
        group.append("text")
            .attr("x", round(cx))
            .attr("y", round(top))
            .attr("text-anchor", "middle")
            .attr("font-family", style.font ?? "Segoe UI, sans-serif")
            .attr("font-size", fontSize)
            .attr("font-weight", style.bold === false ? 400 : 700)
            .attr("font-style", style.italic ? "italic" : null)
            .attr("fill", style.colorOf ? style.colorOf(c) : (style.color ?? "#3b4149"))
            .attr("pointer-events", "none")
            .text(text);
    }
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
