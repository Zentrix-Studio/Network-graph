"use strict";

/**
 * Lasso / rubber-band multi-select (NG-083). Shift-drag on empty canvas sweeps a
 * rectangle; every node whose centre falls inside is selected (Ctrl/Cmd extends).
 * Shift gates it so it never fights the enterprise pan-drag, and it never starts on
 * a node or edge mark (those keep their own drag/click). The rectangle is drawn
 * INSIDE the zoom group, in the same local space as the node positions, so it lines
 * up under any pan/zoom without inverse-transform math.
 *
 * `nodesInRect` is pure & deterministic (ascending index) — the testable core.
 */

import { pointer, Selection } from "d3";

export interface LassoRect { x0: number; y0: number; x1: number; y1: number; }

/** Indices of nodes whose centre lies within the (normalised) rectangle. */
export function nodesInRect(points: { x: number; y: number }[], rect: LassoRect): number[] {
    const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
    const out: number[] = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(i);
    }
    return out;
}

type G = Selection<SVGGElement, unknown, null, undefined>;
type Svg = Selection<SVGSVGElement, unknown, null, undefined>;

export interface LassoOptions {
    /** Live node positions (zoom-group local space), read at gesture start. */
    points: { x: number; y: number }[];
    /** Group to draw the marquee into (must be the zoom group for correct alignment). */
    drawInto: G;
    /** The zoom group's DOM node — the reference frame for d3.pointer. */
    frame: SVGGElement;
    /** Marquee colours. */
    stroke: string;
    fill: string;
    /** Called on release with the enclosed node indices; `additive` = Ctrl/Cmd held. */
    onSelect: (indices: number[], additive: boolean) => void;
}

/**
 * Bind (or, on repaint, rebind) the lasso to the svg. Re-invoking with a fresh
 * `points`/frame replaces the previous handler (namespaced `.lasso`).
 */
export function enableLasso(svg: Svg, opts: LassoOptions): void {
    svg.on("mousedown.lasso", (event: MouseEvent) => {
        if (!event.shiftKey) return; // shift-drag only
        const tgt = event.target as Element;
        if (tgt.closest(".node") || tgt.closest(".edge")) return; // not on a mark
        event.preventDefault();

        const [sx, sy] = pointer(event, opts.frame);
        const rect = opts.drawInto.append("rect").classed("zx-lasso", true)
            .attr("fill", opts.fill).attr("stroke", opts.stroke)
            .attr("stroke-dasharray", "4 3").attr("pointer-events", "none")
            .attr("x", sx).attr("y", sy).attr("width", 0).attr("height", 0);

        const move = (e: MouseEvent): void => {
            const [x, y] = pointer(e, opts.frame);
            rect.attr("x", Math.min(sx, x)).attr("y", Math.min(sy, y))
                .attr("width", Math.abs(x - sx)).attr("height", Math.abs(y - sy));
        };
        const up = (e: MouseEvent): void => {
            window.removeEventListener("mousemove", move, true);
            window.removeEventListener("mouseup", up, true);
            const [x, y] = pointer(e, opts.frame);
            rect.remove();
            opts.onSelect(nodesInRect(opts.points, { x0: sx, y0: sy, x1: x, y1: y }), e.ctrlKey || e.metaKey);
        };
        window.addEventListener("mousemove", move, true);
        window.addEventListener("mouseup", up, true);
    });
}
