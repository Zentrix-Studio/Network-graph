"use strict";

/**
 * Value-on-node labels — a formatted number for every node that has a value. Big nodes
 * carry it *inside* the glyph (the "labeled bubble" pattern, contrast text over the fill);
 * nodes too small to hold legible text carry it *below* the glyph instead, so no value is
 * ever silently dropped just because a node is small. Drawn into a dedicated layer above
 * the nodes. Arithmetic width estimate (no getBBox). Tagged with data-ni/dx/dy so a live
 * drag carries the value with its node.
 */

import { Selection } from "d3";
import { GraphModel, Vec2 } from "../model/graphTypes";

type G = Selection<SVGGElement, unknown, null, undefined>;

export interface NodeValueOptions {
    valueOf: (i: number) => number | null;
    radiusOf: (i: number) => number;
    /** Contrast colour for the text over node i's fill (used when it sits inside). */
    textColorOf: (i: number) => string;
    /** Foreground colour for text placed outside/below a small node, over the canvas. */
    outsideColor: string;
    decimals: number;
    displayUnits: ValueDisplayUnits;
    font: string;
    /** Preferred size. Inside text may shrink to fit its node. */
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

export function drawNodeValues(group: G, model: GraphModel, px: Vec2[], opts: NodeValueOptions): void {
    group.selectAll("*").remove();
    for (let i = 0; i < model.nodes.length; i++) {
        const v = opts.valueOf(i);
        if (v == null || !Number.isFinite(v)) continue;
        const r = opts.radiusOf(i);
        const text = formatValue(v, opts.decimals, opts.displayUnits);
        const preferredFont = Math.max(6, Math.min(40, opts.fontSize));
        const insideFont = Math.min(r * 0.95, preferredFont);
        const fitsInside = r >= 7 && text.length * insideFont * 0.6 <= r * 2.1;

        let cx: number, cy: number, dy: number, fontSize: number, fill: string, weight: number;
        if (fitsInside) {
            fontSize = insideFont;
            dy = fontSize * 0.34;
            cx = px[i].x; cy = px[i].y + dy;
            fill = opts.textColorOf(i); weight = opts.bold ? 700 : 400;
        } else {
            // Too small to hold the value inside — place it just below the node so even
            // the smallest nodes still show their value.
            fontSize = preferredFont;
            dy = r + fontSize;
            cx = px[i].x; cy = px[i].y + dy;
            fill = opts.outsideColor; weight = opts.bold ? 600 : 400;
        }
        group.append("text")
            .attr("x", cx).attr("y", cy)
            .attr("data-ni", i).attr("data-dx", 0).attr("data-dy", dy)
            .attr("text-anchor", "middle")
            .attr("font-family", opts.font).attr("font-size", fontSize).attr("font-weight", weight)
            .attr("font-style", opts.italic ? "italic" : null)
            .attr("text-decoration", opts.underline ? "underline" : null)
            .attr("fill", fill)
            .attr("pointer-events", "none")
            .text(text);
    }
}

export type ValueDisplayUnits = "auto" | "none" | "thousands" | "millions" | "billions";

/** Number formatting shared by inner and outer node labels. */
export function formatValue(n: number, decimals: number, displayUnits: ValueDisplayUnits = "auto"): string {
    const d = Math.max(0, Math.min(4, decimals));
    const abs = Math.abs(n);
    const units = displayUnits === "auto"
        ? (abs >= 1e9 ? "billions" : abs >= 1e6 ? "millions" : abs >= 1e3 ? "thousands" : "none")
        : displayUnits;
    if (units === "billions") return trimZeros((n / 1e9).toFixed(d)) + "B";
    if (units === "millions") return trimZeros((n / 1e6).toFixed(d)) + "M";
    if (units === "thousands") return trimZeros((n / 1e3).toFixed(d)) + "K";
    return n.toFixed(d);
}

function trimZeros(s: string): string {
    return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s;
}
