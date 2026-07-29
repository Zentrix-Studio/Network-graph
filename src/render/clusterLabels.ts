"use strict";

/**
 * Cluster captions (Enterprise E2). One text label per cluster, placed just above
 * the cluster's node cloud so the shaded hulls read as named regions. Pure geometry
 * — the anchor is the arithmetic mean X and the top (min Y) of each cluster's node
 * positions; no `getBBox`, so the jsdom sweep still drives the real render path.
 */

import { Selection } from "d3";
import { Vec2 } from "../model/graphTypes";

type G = Selection<SVGGElement, unknown, null, undefined>;

export interface ClusterLabelStyle {
    font?: string;
    fontSize?: number;
    color?: string;
    /** Gap (px) above the cluster's topmost node where the caption baseline sits. */
    offset?: number;
}

/**
 * Draw one caption per cluster into `group`. `labelOf(cluster)` supplies the text
 * (empty string → skipped). Clusters with no nodes are skipped.
 */
export function renderClusterLabels(
    group: G,
    positionsPx: Vec2[],
    community: number[],
    labelOf: (cluster: number) => string,
    style: ClusterLabelStyle = {},
): void {
    group.selectAll("*").remove();
    const fontSize = style.fontSize ?? 12;
    const offset = style.offset ?? 10;

    // Per-cluster centroid X + top Y, in one pass.
    const sumX = new Map<number, number>();
    const cnt = new Map<number, number>();
    const minY = new Map<number, number>();
    for (let i = 0; i < positionsPx.length; i++) {
        const c = community[i];
        const p = positionsPx[i];
        sumX.set(c, (sumX.get(c) ?? 0) + p.x);
        cnt.set(c, (cnt.get(c) ?? 0) + 1);
        minY.set(c, Math.min(minY.get(c) ?? Infinity, p.y));
    }

    for (const c of [...cnt.keys()].sort((a, b) => a - b)) {
        const text = labelOf(c);
        if (!text) continue;
        const cx = (sumX.get(c) ?? 0) / (cnt.get(c) || 1);
        const top = (minY.get(c) ?? 0) - offset;
        group.append("text")
            .attr("x", round(cx))
            .attr("y", round(top))
            .attr("text-anchor", "middle")
            .attr("font-family", style.font ?? "Segoe UI, sans-serif")
            .attr("font-size", fontSize)
            .attr("font-weight", 600)
            .attr("fill", style.color ?? "#3b4149")
            .attr("pointer-events", "none")
            .text(text);
    }
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
