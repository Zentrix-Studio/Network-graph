"use strict";

/**
 * Pure-ish D3 graph drawer: edges + nodes + labels from a computed layout. It
 * never measures text (no `getBBox`) — label placement uses arithmetic width
 * estimates so the whole render path stays runnable under jsdom (the test
 * harness depends on this, exactly like the heatmap's grid drawer).
 *
 * The drawer owns geometry only. Colour/radius/label decisions are passed in as
 * accessors so the visual keeps policy (theme, category palette, gating) in one
 * place.
 */

import { Selection, select } from "d3";
import { GraphModel, LayoutResult, Vec2 } from "../model/graphTypes";
import { getSemanticIcon } from "../interaction/iconCatalog";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Minimum screen-space width of an invisible link interaction path. The visible
 *  stroke remains unchanged; this gives thin links a forgiving 7px target on
 *  either side of their centreline. */
export const EDGE_HIT_MIN_WIDTH = 14;

type G = Selection<SVGGElement, unknown, null, undefined>;
type DefsSel = Selection<SVGDefsElement, unknown, null, undefined>;

export type LabelSide = "left" | "right" | "top" | "bottom";
export type LabelPosition = "auto" | LabelSide;
export type LabelWrap = "off" | "on" | "auto";
/** Background shape drawn behind an outer node label.
 *  card = tight rounded rectangle · highlight = outline stroke around the glyphs (no box) · pill = capsule ends. */
export type LabelBgType = "card" | "highlight" | "pill";
export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "hexagon" | "donut";

/** Any node marker element (circle for the default shape, path for the rest). */
type NodeSel = Selection<SVGGraphicsElement, number, SVGGElement, unknown>;

export interface GraphRenderOptions {
    width: number;
    height: number;
    /** Reserved band (px) at the top of the viewport that the layout must not fill,
     *  e.g. for the insights band (NG-119). 0 = fit the full height (default). */
    padTop?: number;
    /** Fill colour for node i. */
    colorOf: (i: number) => string;
    /** Node fill opacity 0..1 (R1). Omitted / 1 = fully opaque (no attribute emitted). */
    nodeOpacity?: number;
    /** Radius (px) for node i. */
    radiusOf: (i: number) => number;
    /** Label text for node i (the node key). */
    labelOf: (i: number) => string;
    /** Node marker shape (circle default). Non-circle shapes render as SVG paths. */
    nodeShape?: NodeShape;
    /** Per-node base64 data: image URI to render in place of the marker, or null.
     *  MUST be a data: URI — the visual guards this so it never fetches externally. */
    imageOf?: (i: number) => string | null;
    /** Per-node semantic icon id or legacy glyph rendered in place of the marker.
     *  A base64 image still wins over the icon. */
    iconOf?: (i: number) => string | null;
    /** Node fill pattern ("none" = solid). Rendered as a per-colour SVG pattern. */
    nodeFillPattern?: string;
    /** Optional per-node fill pattern. When present it overrides `nodeFillPattern` and
     *  enables hierarchy-level texture assignment. */
    nodeFillPatternOf?: (i: number) => string;
    /** Node type "halo": a soft coloured glow behind each marker, drawn as a CSS
     *  drop-shadow ON the marker element (no extra elements). SVG path only — the
     *  canvas scale path keeps flat discs (halos at 10k nodes are mush). */
    nodeHalo?: boolean;
    /** Per-node border override (parent-node emphasis); null = use the default stroke. */
    parentStrokeOf?: (i: number) => { color: string; width: number } | null;
    edgeColor: string;
    /** Per-edge colour override (typed edges / colour mode); falls back to edgeColor when absent.
     *  In gradient mode this is the SOURCE-side colour (the gradient's first stop). */
    edgeColorOf?: (i: number) => string | null;
    /** Target-side colour, used only in gradient mode (paired with `edgeGradient`). */
    edgeColorEndOf?: (i: number) => string | null;
    /** Per-edge source→target gradient stroke (NG-133). Needs `edgeColorEndOf`. */
    edgeGradient?: boolean;
    /** Link visibility (req 1). "show" = normal · "hover" = drawn invisible, revealed
     *  around the hovered node · "off" = not drawn at all. Default "show". */
    edgeRenderMode?: "show" | "hover" | "off";
    /** Per-edge dash pattern (typed edges), e.g. "6 4"; null = solid. */
    edgeDashOf?: (i: number) => string | null;
    /** Two-way edge (a reverse edge exists): gets an arrowhead at BOTH ends. */
    bidirectionalOf?: (i: number) => boolean;
    /** Reciprocal edge records consolidated into another representative link. */
    edgeSuppressedOf?: (i: number) => boolean;
    /** Non-tree relationship shown as contextual structure in Tree mode. */
    edgeSecondaryOf?: (i: number) => boolean;
    /** Optional per-edge midpoint label (weight / edge-type); null = no label. */
    edgeLabelOf?: (i: number) => string | null;
    edgeThickness: number;
    /** Global edge curvature 0..100 (NG-075); 0 = straight. Parallel edges always fan. */
    edgeCurve?: number;
    nodeStroke: string;
    labelColor: string;
    font: string;
    showArrows: boolean;
    showLabels: boolean;
    maxLabels: number;
    labelBold: boolean;
    /** Label point size (px). Defaults to 11 when omitted. */
    labelSize?: number;
    labelItalic?: boolean;
    labelUnderline?: boolean;
    /** Where the label sits relative to its node. "auto" = best-fit side. */
    labelPosition?: LabelPosition;
    /** off = one line · on = one word per line · auto = single line unless it won't fit. */
    labelWrap?: LabelWrap;
    /** Draw a filled halo behind each outer node label (keeps it legible over edges). */
    labelBg?: boolean;
    /** Halo shape: card (rounded rect) · highlight (snug marker) · pill (capsule). Default "card". */
    labelBgType?: LabelBgType;
    /** Halo fill colour (used only when labelBg). */
    labelBgColor?: string;
    /** Halo padding (px) around the label box — the "width" of the background. */
    labelBgPadding?: number;
    /** R2 flow: animate a dashed flow from source→target along each edge. */
    flow: boolean;
    /** Flow speed 1..10 (higher = faster); per-edge duration also scales with weight. */
    flowSpeed: number;
    /** Post-fit hook run on the pixel geometry before anything is drawn — the
     *  collision-avoidance pass mutates geo.px here (NG-112). Must be pure &
     *  deterministic; the caller owns the policy (setting gate, layout-mode gate). */
    postFit?: (geo: GraphGeometry) => void;
}

export interface GraphGeometry {
    /** Node positions in pixel space (computed, never measured). */
    px: Vec2[];
    scale: number;
    /** Fit transform: pixel = world*scale + t. */
    tx: number;
    ty: number;
}


/** Map world (layout) coordinates into the viewport, preserving aspect ratio. */
export function fitTransform(layout: LayoutResult, w: number, h: number, pad: number, padTop = 0): GraphGeometry {
    const { minX, minY, maxX, maxY } = layout.bounds;
    const gw = Math.max(maxX - minX, 1e-6);
    const gh = Math.max(maxY - minY, 1e-6);
    // A reserved top band shrinks the usable height and pushes the fit down by padTop,
    // so nodes never land under the insights band on the default fit view.
    const availH = Math.max(h - padTop, 2 * pad + 1);
    let scale = Math.min((w - 2 * pad) / gw, (availH - 2 * pad) / gh);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    const tx = pad - minX * scale + (w - 2 * pad - gw * scale) / 2;
    const ty = padTop + pad - minY * scale + (availH - 2 * pad - gh * scale) / 2;
    const px = layout.positions.map((p) => ({ x: p.x * scale + tx, y: p.y * scale + ty }));
    return { px, scale, tx, ty };
}

/**
 * Draw the graph. `edgeGroup`, `nodeGroup`, `labelGroup` are pre-created, fixed-
 * order layers cleared by the caller. Returns the node <circle> selection (bound
 * to node index) so the visual can attach interaction, plus the pixel geometry.
 */
export function renderGraph(
    defs: DefsSel,
    edgeGroup: G,
    nodeGroup: G,
    labelGroup: G,
    model: GraphModel,
    layout: LayoutResult,
    opts: GraphRenderOptions,
): { nodeSel: NodeSel; geo: GraphGeometry } {
    let maxR = 4;
    for (let i = 0; i < model.nodes.length; i++) maxR = Math.max(maxR, opts.radiusOf(i));
    const geo = fitTransform(layout, opts.width, opts.height, maxR + 10, opts.padTop ?? 0);
    if (opts.postFit) opts.postFit(geo);

    const edgeWidthOf = makeEdgeWidth(model, opts.edgeThickness);
    const edgeWidth = (w: number): number => edgeWidthOf(-1, w); // by-weight (SVG call sites)

    // Link visibility (req 1). "off" clears every edge; "hover" draws them but with a
    // 0 base opacity (data-op) so the hover handler can reveal a node's incident links.
    const edgeMode = opts.edgeRenderMode ?? "show";
    // Base stroke-opacity per edge, cached in data-op so the selection/hover passes
    // restore THIS value. In hover-hide mode every edge starts fully transparent.
    const edgeBaseOp = (i: number): number =>
        edgeMode === "hover" ? 0 : edgeOpacityFor(edgeWidth(model.links[i].weight))
            * (opts.edgeSecondaryOf?.(i) ? 0.34 : 1);

    // --- Self-loops (source === target): a small arc bulging off the node ---
    const selfLoops = edgeMode === "off" ? [] : model.links
        .map((_, i) => i)
        .filter((i) => model.links[i].source === model.links[i].target);
    const selfLoopOp = edgeMode === "hover" ? 0 : edgeOpacityFor(Math.max(0.5, opts.edgeThickness));
    const selfLoopGeometry = (i: number) => {
        const p = geo.px[model.links[i].source];
        const r = opts.radiusOf(model.links[i].source);
        const s = r + 6;
        return {
            p, r, s,
            start: { x: p.x, y: p.y - r },
            control2: { x: p.x + s * 1.8, y: p.y + s * 0.6 },
            end: { x: p.x + r, y: p.y },
        };
    };
    const selfLoopSel = edgeGroup
        .selectAll<SVGPathElement, number>("path.selfloop")
        .data(selfLoops)
        .join("path")
        .classed("selfloop", true)
        .attr("d", (i) => selfLoopPath(geo.px[model.links[i].source], opts.radiusOf(model.links[i].source)))
        .attr("fill", "none")
        .attr("stroke", (i) => (opts.edgeColorOf && opts.edgeColorOf(i)) || opts.edgeColor)
        .attr("stroke-width", Math.max(0.5, opts.edgeThickness))
        .attr("stroke-opacity", selfLoopOp)
        .attr("data-op", selfLoopOp)
        .classed("flow", opts.flow)
        .style("stroke-dasharray", opts.flow ? "6 5" : null)
        .style("animation-duration", opts.flow
            ? (i) => `${Math.max(0.35, 3 / (opts.flowSpeed * Math.sqrt(model.links[i].weight || 1)))}s`
            : null);

    // --- Edges (under nodes) — curved/fanned paths, self-loops excluded (NG-075) ---
    // With Curvature=0, parallel edges are true offset straight lines. Curvature > 0
    // intentionally switches them to bowed paths. Cached offsets let live drag keep
    // the exact same geometry without re-deriving ranks.
    const baseCurveFrac = Math.max(0, Math.min(100, opts.edgeCurve ?? 0)) / 100;
    const curveFracOf = (i: number): number =>
        opts.edgeSecondaryOf?.(i) ? Math.max(baseCurveFrac, 0.34) : baseCurveFrac;
    const ranks = edgeRanks(model, opts.edgeSuppressedOf);
    // Edges always terminate at the node SURFACE, never the centre — otherwise a link
    // run to the centre shows through any node that isn't fully opaque (low fill opacity,
    // donut hole, etc.). Trimming both endpoints back to the node's outer radius makes the
    // link meet the node cleanly for every shape/opacity (NG- inner-link fix, generalised).
    // Arrowhead footprint tracks the link's OWN width so the head always covers the line
    // end (a thin fixed head let a thick link flare past the tip). `headWidth` = the base
    // width (≥ line width), `headLen` = how far it juts toward the node. The line is
    // retracted by exactly `headLen`, and the head is a triangle built from the SAME
    // retracted endpoint + tangent — so the head is a seamless, centred continuation of
    // the line, never a marker offset from it (fixes the off-centre head on curves).
    const headWidthOf = (i: number): number => Math.max(7, edgeWidth(model.links[i].weight) * 2);
    // Head LENGTH doubles as the target retraction: the line stops at the head base and the
    // head bridges the rest of the way to the node surface, so its TIP must reach the node.
    // Floor at 9px so even a thin link keeps the line clear of the node (room for the head)
    // while the tip still lands on the node — no floating gap between arrow and node.
    const headLenOf = (i: number): number => (opts.showArrows ? Math.max(9, headWidthOf(i)) : 0);
    const twoWayOf = (i: number): boolean => !!(opts.showArrows && opts.bidirectionalOf && opts.bidirectionalOf(i));

    // Unified end geometry: the trimmed endpoints (retracted to the arrow base when arrows
    // are on) plus the outward unit tangents (straight → segment dir; curved → the
    // quadratic's end derivative P1−C). Line AND heads read from this one call, so they
    // can never drift apart. When arrows are off the target runs to centre (unchanged).
    const edgeGeom = (i: number): { sx: number; sy: number; ex: number; ey: number; off: number; parallel: number;
        etx: number; ety: number; stx: number; sty: number } => {
        const l = model.links[i];
        const s = geo.px[l.source], t = geo.px[l.target];
        const hl = headLenOf(i);
        const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
        const [px, py] = pairPerp(geo.px[lo], geo.px[hi]);
        const baseRs = opts.radiusOf(l.source);
        const baseRt = opts.radiusOf(l.target);
        const curveFrac = curveFracOf(i);
        // A parallel line is translated as a whole. Clamp to the smaller node radius
        // so its arrow tip can still meet both node surfaces.
        const rawParallel = curveFrac <= 0 ? ranks[i] * PARALLEL_GAP : 0;
        const maxParallel = Math.max(0, Math.min(baseRs, baseRt) - 1);
        const parallel = Math.sign(rawParallel) * Math.min(Math.abs(rawParallel), maxParallel);
        const sourceSurfaceInset = Math.sqrt(Math.max(0, baseRs * baseRs - parallel * parallel));
        const targetSurfaceInset = Math.sqrt(Math.max(0, baseRt * baseRt - parallel * parallel));
        // Base insets: always trim to the node's outer radius so the link stops at the node
        // surface. An arrow retracts the target (and, for two-way, the source) end by an extra
        // headLen so the line stops at the head base and the head bridges the rest of the way —
        // its TIP landing on the node surface (no +pad, so the arrow touches the node).
        const rs = sourceSurfaceInset + (twoWayOf(i) ? hl : 0);
        // Arrows off: stop at the target surface. Arrows on: radius + headLen retract → tip on surface.
        const rt = targetSurfaceInset + (opts.showArrows ? hl : 0);
        const trimmed = trimEdgeEnds(s.x, s.y, t.x, t.y, rs, rt);
        const sx = trimmed.sx + px * parallel, sy = trimmed.sy + py * parallel;
        const ex = trimmed.ex + px * parallel, ey = trimmed.ey + py * parallel;
        // Parallel separation is linear at zero curvature. Once curvature is requested,
        // the prior bowed/fanned geometry remains available.
        const off = curveFrac > 0 ? edgeOffsetPx(ranks[i], curveFrac) : 0;
        // End tangent (toward target) and start tangent (toward source).
        let etx = ex - sx, ety = ey - sy, stx = sx - ex, sty = sy - ey;
        if (Math.abs(off) >= 0.01) {
            const mx = (sx + ex) / 2 + px * off, my = (sy + ey) / 2 + py * off;
            etx = ex - mx; ety = ey - my; stx = sx - mx; sty = sy - my;
        }
        return { sx, sy, ex, ey, off, parallel, etx, ety, stx, sty };
    };
    const edgeDOf = (i: number): string => {
        const l = model.links[i];
        const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
        const [px, py] = pairPerp(geo.px[lo], geo.px[hi]);
        const g = edgeGeom(i);
        return edgeCurvePath(g.sx, g.sy, g.ex, g.ey, px, py, g.off);
    };
    // Triangle head: base centred on `(px,py)` (the line end) across the tangent, tip
    // `len` forward toward the node. Base width ≥ line width covers the flat cap, so the
    // stroke never shows past the head and the head is centred on the link's centreline.
    const arrowTri = (px: number, py: number, tx: number, ty: number, len: number, halfW: number): string => {
        const d = Math.hypot(tx, ty) || 1;
        const ux = tx / d, uy = ty / d;         // toward the node
        const nx = -uy, ny = ux;                 // perpendicular
        const tipX = px + ux * len, tipY = py + uy * len;
        const b1x = px + nx * halfW, b1y = py + ny * halfW;
        const b2x = px - nx * halfW, b2y = py - ny * halfW;
        return `M${r2(b1x)},${r2(b1y)}L${r2(tipX)},${r2(tipY)}L${r2(b2x)},${r2(b2y)}Z`;
    };
    const edgeIdx = edgeMode === "off"
        ? []
        : model.links.map((_, i) => i).filter((i) =>
            model.links[i].source !== model.links[i].target && !opts.edgeSuppressedOf?.(i));
    // Gradient mode (NG-133): one userSpaceOnUse linearGradient per edge, source→target.
    // Cleared and rebuilt each paint so it follows drag/zoom; only built when requested.
    defs.selectAll("linearGradient.zx-edge-grad").remove();
    const gradientMode = edgeMode !== "off" && !!opts.edgeGradient && !!opts.edgeColorEndOf;
    if (gradientMode) {
        for (const i of [...edgeIdx, ...selfLoops]) {
            const l = model.links[i];
            const loop = l.source === l.target ? selfLoopGeometry(i) : null;
            const a = loop?.start ?? geo.px[l.source];
            const b = loop?.end ?? geo.px[l.target];
            const g = defs.append("linearGradient").classed("zx-edge-grad", true)
                .attr("id", `zx-eg-${i}`).attr("gradientUnits", "userSpaceOnUse")
                .attr("x1", r2(a.x)).attr("y1", r2(a.y)).attr("x2", r2(b.x)).attr("y2", r2(b.y));
            g.append("stop").attr("offset", "0%")
                .attr("stop-color", (opts.edgeColorOf && opts.edgeColorOf(i)) || opts.edgeColor);
            g.append("stop").attr("offset", "100%")
                .attr("stop-color", (opts.edgeColorEndOf && opts.edgeColorEndOf(i)) || opts.edgeColor);
        }
    }
    const edgeStroke = (i: number): string =>
        gradientMode ? `url(#zx-eg-${i})` : ((opts.edgeColorOf && opts.edgeColorOf(i)) || opts.edgeColor);
    selfLoopSel.attr("stroke", (i) => edgeStroke(i));
    edgeGroup
        .selectAll<SVGPathElement, number>("path.edge")
        .data(edgeIdx)
        .join("path")
        .classed("edge", true)
        .attr("fill", "none")
        .attr("d", (i) => edgeDOf(i))
        .attr("data-off", (i) => edgeGeom(i).off)
        .attr("data-parallel", (i) => edgeGeom(i).parallel)
        .attr("stroke", (i) => edgeStroke(i))
        .attr("stroke-width", (i) => edgeWidth(model.links[i].weight))
        // Base opacity fades with thickness (G2-002); stored in data-op so the selection/
        // hover passes restore THIS value (0 in hover-hide mode) for undimmed edges.
        .attr("stroke-opacity", (i) => edgeBaseOp(i))
        .attr("data-op", (i) => edgeBaseOp(i))
        // Arrowheads are NOT marker-end on the line — a marker paints inline with its
        // path, so a later thick edge would paint over an earlier edge's head ("link
        // visible after the arrow"). They're drawn in a dedicated top layer below.
        // R2 flow: a marching-ants dash animated source→target by CSS (see visual.less).
        .classed("flow", opts.flow)
        // Flow's marching-ants dash wins; otherwise a typed edge may set its own dash.
        .style("stroke-dasharray", (i) => (opts.flow
            ? "6 5"
            : ((opts.edgeDashOf ? opts.edgeDashOf(i) : null)
                || (opts.edgeSecondaryOf?.(i) ? "4 5" : null))))
        .style("animation-duration", opts.flow
            ? (i) => `${Math.max(0.35, 3 / (opts.flowSpeed * Math.sqrt(model.links[i].weight || 1)))}s`
            : null);

    // Edge (link) labels follow the relationship instead of staying horizontal over it.
    // They sit just beside the stroke, remain upright, and follow the midpoint of curved
    // / fanned links. The join is capped so a dense graph doesn't drown in text.
    // The join runs even when labels are off (empty data) so toggling off clears them.
    const edgeLabels = (opts.edgeLabelOf && edgeMode === "show"
        ? model.links.map((_, i) => i).filter((i) =>
            !opts.edgeSuppressedOf?.(i)
            && !!opts.edgeLabelOf!(i))
        : []).slice(0, 80);
    const edgeLabelPlace = (i: number): EdgeLabelPlacement => {
        const l = model.links[i];
        if (l.source === l.target) {
            const loop = selfLoopGeometry(i);
            return {
                x: loop.p.x + loop.s * 1.42,
                y: loop.p.y - loop.s * 0.72,
                angle: 0,
                transform: "rotate(0)",
            };
        }
        const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
        const [px, py] = pairPerp(geo.px[lo], geo.px[hi]);
        const g = edgeGeom(i);
        return edgeLabelPlacement(
            { x: g.sx, y: g.sy }, { x: g.ex, y: g.ey }, px, py, g.off,
        );
    };
    edgeGroup.selectAll<SVGTextElement, number>("text.edge-label")
        .data(edgeLabels)
        .join("text")
        .classed("edge-label", true)
        .attr("data-off", (i) => model.links[i].source === model.links[i].target ? 0 : edgeGeom(i).off)
        .attr("data-parallel", (i) => model.links[i].source === model.links[i].target ? 0 : edgeGeom(i).parallel)
        .attr("x", (i) => edgeLabelPlace(i).x)
        .attr("y", (i) => edgeLabelPlace(i).y)
        .attr("transform", (i) => edgeLabelPlace(i).transform)
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-family", opts.font).attr("font-size", Math.max(7, (opts.labelSize || 11) - 2))
        .attr("fill", opts.labelColor).attr("pointer-events", "none")
        .text((i) => opts.edgeLabelOf!(i)!);

    // --- Arrowheads (top layer) — explicit colour-matched triangles drawn ABOVE every
    //     edge line so no link paints over a head, built from the SAME retracted endpoint
    //     + tangent as the line (via `edgeGeom`), so each head is a seamless, centred
    //     continuation of its link — no marker tip/tangent drift on curves, and it stays
    //     on the centreline as the width shrinks. NG-133 (colour + no line past head +
    //     centred head). ---
    // Head colour = the link colour at the head end: the target-side colour in gradient
    // mode, otherwise the edge's own stroke colour.
    const arrowColorOf = (i: number): string =>
        (gradientMode && opts.edgeColorEndOf ? (opts.edgeColorEndOf(i) || opts.edgeColor)
            : ((opts.edgeColorOf && opts.edgeColorOf(i)) || opts.edgeColor));
    // Keep the owning link index on every head. Arrowheads live in their own top
    // layer, so visibility/emphasis passes cannot inherit display/opacity from the
    // corresponding path.edge; they need this identity to follow the same filter.
    interface Head { edge: number; end: "source" | "target"; d: string; color: string; opacity: number }
    const heads: Head[] = [];
    if (opts.showArrows) {
        for (const i of edgeIdx) {
            if (edgeBaseOp(i) <= 0) continue; // hidden (hover-hide) links carry no visible head
            const g = edgeGeom(i);
            const col = arrowColorOf(i), len = headLenOf(i), halfW = headWidthOf(i) / 2;
            const opacity = opts.edgeSecondaryOf?.(i) ? 0.34 : 1;
            heads.push({ edge: i, end: "target", d: arrowTri(g.ex, g.ey, g.etx, g.ety, len, halfW), color: col, opacity });
            if (twoWayOf(i)) {
                heads.push({ edge: i, end: "source", d: arrowTri(g.sx, g.sy, g.stx, g.sty, len, halfW), color: col, opacity });
            }
        }
        for (const i of selfLoops) {
            if (selfLoopOp <= 0) continue;
            const loop = selfLoopGeometry(i);
            const tx = loop.end.x - loop.control2.x;
            const ty = loop.end.y - loop.control2.y;
            const d = Math.hypot(tx, ty) || 1;
            const len = headLenOf(i);
            const baseX = loop.end.x - (tx / d) * len;
            const baseY = loop.end.y - (ty / d) * len;
            heads.push({
                edge: i,
                end: "target",
                d: arrowTri(baseX, baseY, tx, ty, len, headWidthOf(i) / 2),
                color: arrowColorOf(i),
                opacity: 1,
            });
        }
        const arrowLayer = edgeGroup.selectAll<SVGGElement, number>("g.arrowlayer").data([0]).join("g").classed("arrowlayer", true);
        arrowLayer.raise(); // ensure the heads sit above every edge line
        arrowLayer.selectAll<SVGPathElement, Head>("path.arrowhead")
            .data(heads, (h) => `${h.edge}:${h.end}`)
            .join("path")
            .classed("arrowhead", true)
            .attr("stroke", "none").attr("pointer-events", "none")
            .attr("data-li", (h) => h.edge)
            .attr("data-op", (h) => h.opacity)
            .attr("d", (h) => h.d)
            .attr("fill", (h) => h.color)
            .attr("fill-opacity", (h) => h.opacity);
    } else {
        edgeGroup.selectAll("g.arrowlayer").remove();
    }

    // --- Link interaction overlay ---
    // A 1px visible link is needlessly difficult to hit precisely. Mirror every
    // link with a transparent, screen-space-stable path that owns pointer events
    // without changing the rendered thickness. Keeping a distinct class also
    // prevents selection/hover opacity passes from ever making the hit path visible.
    const hitWidth = (visibleWidth: number): number =>
        Math.max(EDGE_HIT_MIN_WIDTH, visibleWidth + 10);
    edgeGroup.selectAll<SVGPathElement, number>("path.edge-hit")
        .data(edgeIdx)
        .join("path")
        .classed("edge-hit", true)
        .attr("fill", "none")
        .attr("d", (i) => edgeDOf(i))
        .attr("data-off", (i) => edgeGeom(i).off)
        .attr("data-parallel", (i) => edgeGeom(i).parallel)
        .attr("stroke", "transparent")
        .attr("stroke-width", (i) => hitWidth(edgeWidth(model.links[i].weight)))
        .attr("vector-effect", "non-scaling-stroke")
        .attr("pointer-events", "stroke");
    edgeGroup.selectAll<SVGPathElement, number>("path.selfloop-hit")
        .data(selfLoops)
        .join("path")
        .classed("selfloop-hit", true)
        .attr("fill", "none")
        .attr("d", (i) => selfLoopPath(geo.px[model.links[i].source], opts.radiusOf(model.links[i].source)))
        .attr("stroke", "transparent")
        .attr("stroke-width", hitWidth(Math.max(0.5, opts.edgeThickness)))
        .attr("vector-effect", "non-scaling-stroke")
        .attr("pointer-events", "stroke");
    // Heads remain visually above the overlay while deliberately ignoring pointer
    // input, allowing the wider owning-link path to handle the whole gesture.
    edgeGroup.select("g.arrowlayer").raise();

    // --- Nodes --- one marker per node, its element type chosen per node: <image> for
    // a base64 node image, <text> for an icon, <circle> for the default shape, and
    // <path> for other shapes. Icons replace the shape/pattern marker completely.
    // The circle path keeps cx/cy/r exactly as before (zero regression). Each layer is
    // cleared before paint, so join is always a fresh enter.
    const shape: NodeShape = opts.nodeShape ?? "circle";
    const imageOf = opts.imageOf;
    const iconOf = opts.iconOf;
    // Fill patterns: clear last render's pattern defs, then create tinted ones on demand.
    defs.selectAll("pattern.zx-fill").remove();
    const applyFill = (el: Selection<SVGGraphicsElement, unknown, null, undefined>, i: number): void => {
        const col = opts.colorOf(i);
        const rawPattern = opts.nodeFillPatternOf ? opts.nodeFillPatternOf(i) : opts.nodeFillPattern;
        const fillPattern = rawPattern && rawPattern !== "none" ? rawPattern : null;
        // Parent-node emphasis: a distinct border overrides the default node stroke.
        const ps = opts.parentStrokeOf ? opts.parentStrokeOf(i) : null;
        if (fillPattern) {
            el.attr("fill", `url(#${ensureFillPattern(defs, fillPattern, col)})`)
                .attr("stroke", ps ? ps.color : col).attr("stroke-width", ps ? ps.width : 1.4);
        } else {
            el.attr("fill", col).attr("stroke", ps ? ps.color : opts.nodeStroke).attr("stroke-width", ps ? ps.width : 1);
        }
    };
    // Node type "halo" (NG-113): a soft coloured glow behind each marker, drawn as a
    // CSS drop-shadow ON the marker element itself — so it costs no extra elements,
    // never disturbs DOM order / node counts, and moves + dims with its node for
    // free (drag carries it; opacity/display dim it). No getBBox. Colour is the
    // node's own fill at ~40% alpha (an 8-digit-hex suffix on a #rrggbb fill).
    const haloFilter = (i: number): string | null => {
        if (!opts.nodeHalo) return null;
        const r = opts.radiusOf(i);
        const col = withAlpha(opts.colorOf(i), 0.42);
        return `drop-shadow(0 0 ${r2(Math.max(3, r * 0.7))}px ${col})`;
    };
    const tagFor = (i: number): string => {
        if (imageOf && imageOf(i)) return "image";
        if (iconOf && getSemanticIcon(iconOf(i))) return "g";
        if (iconOf && iconOf(i)) return "text"; // legacy report glyph
        return shape === "circle" ? "circle" : "path";
    };
    const nodeSel = nodeGroup
        .selectAll<SVGGraphicsElement, number>(".node")
        .data(model.nodes.map((n) => n.index))
        .join((enter) => enter.append(function (i) {
            return document.createElementNS(SVG_NS, tagFor(i)) as SVGGraphicsElement;
        })) as NodeSel;
    nodeSel
        .classed("node", true)
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", (i) => `${opts.labelOf(i)}, degree ${model.nodes[i].degree}`)
        .attr("fill-opacity", opts.nodeOpacity != null && opts.nodeOpacity < 1 ? opts.nodeOpacity : null)
        .style("filter", (i) => haloFilter(i))
        .each(function (i) {
            const el = select(this as SVGGraphicsElement);
            const p = geo.px[i], r = opts.radiusOf(i);
            const t = (this as Element).tagName.toLowerCase();
            if (t === "image") {
                el.attr("href", imageOf!(i)!) // guaranteed a data: URI by the caller
                    .attr("x", -r).attr("y", -r).attr("width", 2 * r).attr("height", 2 * r)
                    .attr("transform", `translate(${p.x},${p.y})`)
                    .attr("preserveAspectRatio", "xMidYMid slice")
                    .style("clip-path", "circle(50%)");
            } else if (t === "g") {
                const semantic = getSemanticIcon(iconOf!(i));
                if (!semantic) return;
                const parentStroke = opts.parentStrokeOf ? opts.parentStrokeOf(i) : null;
                el.attr("transform", `translate(${p.x},${p.y}) scale(${r / 12}) translate(-12,-12)`)
                    .attr("fill", "none")
                    .attr("stroke", parentStroke ? parentStroke.color : opts.colorOf(i))
                    .attr("stroke-width", parentStroke ? parentStroke.width : 1.8)
                    .attr("stroke-linecap", "round")
                    .attr("stroke-linejoin", "round")
                    .style("user-select", "none");
                for (const d of semantic.paths) {
                    const path = document.createElementNS(SVG_NS, "path");
                    path.setAttribute("d", d);
                    this.appendChild(path);
                }
            } else if (t === "text") {
                el.text(iconOf!(i)!)
                    .attr("transform", `translate(${p.x},${p.y})`)
                    .attr("text-anchor", "middle").attr("dominant-baseline", "central")
                    .attr("font-size", r * 1.7).attr("fill", opts.colorOf(i))
                    .style("user-select", "none");
            } else if (t === "circle") {
                el.attr("cx", p.x).attr("cy", p.y).attr("r", r);
                applyFill(el, i);
            } else {
                el.attr("transform", `translate(${p.x},${p.y})`)
                    .attr("d", shapePath(shape, r))
                    .attr("fill-rule", shape === "donut" ? "evenodd" : null);
                applyFill(el, i);
            }
        });

    // --- Labels (degree-ranked, arithmetically thinned — no getBBox) ---
    labelGroup.selectAll("*").remove();
    if (opts.showLabels) drawLabels(labelGroup, model, geo, opts);

    return { nodeSel, geo };
}

/**
 * Label the highest-degree nodes first, up to `maxLabels`, skipping any whose
 * estimated box would collide with one already placed. Width is estimated as
 * ~0.6·fontSize per char — a deliberate arithmetic stand-in for measurement so
 * the render path never calls getBBox.
 */
interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

interface Placement { x: number; y: number; anchor: "start" | "middle" | "end"; box: Box; lines: string[] }

export function drawLabels(labelGroup: G, model: GraphModel, geo: GraphGeometry, opts: GraphRenderOptions): void {
    const fontSize = Math.max(6, opts.labelSize || 11);
    const lineH = fontSize * 1.15;
    const charW = fontSize * 0.6; // arithmetic advance stand-in (never getBBox)
    const margin = 4;
    const W = opts.width, H = opts.height;
    const wrapMode: LabelWrap = opts.labelWrap ?? "off";
    const posMode: LabelPosition = opts.labelPosition ?? "auto";
    const sides: LabelSide[] = posMode === "auto" ? ["right", "left", "top", "bottom"] : [posMode];
    const order = model.nodes.map((n) => n.index).sort((a, b) => model.nodes[b].degree - model.nodes[a].degree);

    // Seed collisions with every node's circle so labels never sit ON a node.
    const placed: Box[] = model.nodes.map((_, i) => {
        const r = opts.radiusOf(i);
        return { x0: geo.px[i].x - r, y0: geo.px[i].y - r, x1: geo.px[i].x + r, y1: geo.px[i].y + r };
    });
    // Edge segments (self-loops excluded) for auto-fit link avoidance — precomputed once.
    // "Auto (best fit)" must not park a label on top of a link; scoring each candidate by
    // the number of edges it crosses lets us pick a link-free side when one exists, and the
    // least-crossed side otherwise (a dense hub where every side meets a link — the halo helps).
    const segs = edgeSegments(model, geo);
    let count = 0;

    for (const i of order) {
        if (count >= opts.maxLabels) break;
        const variants = lineVariants(opts.labelOf(i), wrapMode);
        const nx = geo.px[i].x, ny = geo.px[i].y, r = opts.radiusOf(i);

        // "auto" scores every in-view, clash-free candidate by how many links it crosses and
        // keeps the fewest-crossing one (ties break on side order right→left→top→bottom, so a
        // clean right label still wins); an explicit side is honoured, skipping only on collision.
        let chosen: Placement | null = null;
        if (posMode === "auto") {
            let bestCross = Infinity;
            for (const side of sides) {
                for (const lines of variants) { // auto-wrap tries the single line before wrapping
                    const p = placeLabel(side, lines, nx, ny, r, fontSize, lineH, charW);
                    const inView = p.box.x0 >= margin && p.box.x1 <= W - margin && p.box.y0 >= margin && p.box.y1 <= H - margin;
                    if (!inView || placed.some((q) => overlaps(p.box, q))) continue;
                    const cross = countEdgeCrossings(segs, p.box);
                    if (cross < bestCross) { bestCross = cross; chosen = p; }
                    if (bestCross === 0) break; // link-free slot on this side — keep side preference
                }
                if (bestCross === 0) break;
            }
        } else {
            for (const lines of variants) {
                const p = placeLabel(posMode, lines, nx, ny, r, fontSize, lineH, charW);
                if (!placed.some((q) => overlaps(p.box, q))) { chosen = p; break; }
            }
        }

        // Over-long fallback: a label wider than any placement can hold — a very long
        // name, or an unbroken run with no spaces to wrap on (Wrap on/auto only break
        // on whitespace) — otherwise fails every side and is dropped entirely, silently
        // losing it under EVERY Wrap setting (G2-003). Rather than omit it, truncate to
        // an ellipsis that fits the available width and place THAT; the full name stays
        // available in the node tooltip. Guarded so it fires ONLY for genuinely over-wide labels —
        // a label that fits width-wise but lost its slot to a neighbour is left to the
        // normal collision-thinning, unchanged.
        if (!chosen) {
            const full = opts.labelOf(i);
            for (const side of sides) {
                const budget = Math.floor(sideWidth(side, nx, r, W, margin) / charW);
                if (budget < 3 || full.length <= budget) continue;
                const p = placeLabel(side, [ellipsize(full, budget)], nx, ny, r, fontSize, lineH, charW);
                const inView = p.box.x0 >= margin && p.box.x1 <= W - margin && p.box.y0 >= margin && p.box.y1 <= H - margin;
                const clash = placed.some((q) => overlaps(p.box, q));
                const fits = posMode === "auto" ? (inView && !clash) : !clash;
                if (fits) { chosen = p; break; }
            }
        }
        if (!chosen) continue; // no acceptable placement — drop rather than crop/overlap
        placed.push(chosen.box);
        count++;

        // Label decoration. Two families, chosen by "Bg style":
        //  · card / pill → a filled halo RECT behind the text (appended first so glyphs
        //    paint on top), sized arithmetically from the text box (never getBBox).
        //  · highlight    → an OUTLINE around the glyphs themselves (a stroke halo, like a
        //    map label), NOT a box. `paint-order:stroke` lays the stroke behind the fill so
        //    the outline hugs each letter; "background width" is the outline thickness and
        //    "background colour" is the outline colour. Off by default (unchanged look).
        const bgType = opts.labelBgType ?? "card";
        const isOutline = opts.labelBg && bgType === "highlight";
        if (opts.labelBg && !isOutline) {
            const g = labelBgGeometry(bgType, chosen.box, fontSize, Math.max(0, opts.labelBgPadding ?? 3));
            labelGroup.append("rect")
                .attr("x", r2(g.x)).attr("y", r2(g.y))
                .attr("width", r2(g.w)).attr("height", r2(g.h))
                .attr("rx", r2(g.rx)).attr("ry", r2(g.rx))
                .attr("data-ni", i)
                .attr("data-dx", g.x - nx).attr("data-dy", g.y - ny)
                .attr("fill", opts.labelBgColor || "#FFFFFF")
                .attr("fill-opacity", g.opacity)
                .attr("pointer-events", "none");
        }

        const t = labelGroup
            .append("text")
            .attr("x", chosen.x)
            .attr("y", chosen.y)
            // Tag with node index + offset so a live drag can move the label with it.
            .attr("data-ni", i)
            .attr("data-dx", chosen.x - nx)
            .attr("data-dy", chosen.y - ny)
            .attr("text-anchor", chosen.anchor)
            .attr("font-family", opts.font)
            .attr("font-size", fontSize)
            .attr("font-weight", opts.labelBold ? 600 : 400)
            .attr("font-style", opts.labelItalic ? "italic" : null)
            .attr("text-decoration", opts.labelUnderline ? "underline" : null)
            .attr("fill", opts.labelColor)
            .attr("pointer-events", "none");
        if (isOutline) {
            // A glyph outline must stay THIN — a stroke is drawn centred on the letter edge,
            // so a wide one balloons each letter until neighbours merge into a white cloud
            // and the label is unreadable. Cap at ~a third of the font size (a few px) so
            // even the max "Background width" reads as a crisp halo, never a blob. w=0 → none.
            const w = Math.max(0, opts.labelBgPadding ?? 3);
            const sw = Math.min(w, Math.max(2, fontSize * 0.35));
            t.attr("stroke", opts.labelBgColor || "#FFFFFF")
                .attr("stroke-width", r2(sw))
                .attr("stroke-linejoin", "round")
                .attr("paint-order", "stroke");
        }
        const cx = chosen.x;
        if (chosen.lines.length === 1) {
            t.text(chosen.lines[0]);
        } else {
            chosen.lines.forEach((line, li) => {
                t.append("tspan").attr("x", cx).attr("dy", li === 0 ? 0 : lineH).text(line);
            });
        }
    }
}

/**
 * The line sets to try for a wrap mode, in preference order:
 *  - off  → single line only.
 *  - on   → one word per line (a 3-word label → 3 lines); a single word stays 1 line.
 *  - auto → single line first, then one-word-per-line if the single line won't fit.
 */
function lineVariants(text: string, mode: LabelWrap): string[][] {
    const words = text.split(/\s+/).filter(Boolean);
    const perWord = words.length > 1 ? words : [text];
    if (mode === "on") return [perWord];
    if (mode === "auto") return words.length > 1 ? [[text], perWord] : [[text]];
    return [[text]]; // off
}

/**
 * Available in-viewport width (px) for a single-line label on a given side of a node.
 * Right/left extend outward from the node to the near margin; top/bottom are centred
 * (middle-anchored) so the usable width is twice the nearer horizontal margin. Pure
 * arithmetic — the truncation budget the over-long fallback ellipsizes to.
 */
function sideWidth(side: LabelSide, nx: number, r: number, W: number, margin: number): number {
    if (side === "right") return (W - margin) - (nx + r + 3);
    if (side === "left") return (nx - r - 3) - margin;
    return 2 * Math.min(nx - margin, (W - margin) - nx); // top / bottom (centred)
}

/** Code-point-safe truncation to `maxChars` glyphs with a trailing ellipsis (counts
 *  as one), so a surrogate pair (emoji, some CJK) is never split mid-character. */
function ellipsize(text: string, maxChars: number): string {
    const cps = Array.from(text);
    if (cps.length <= maxChars) return text;
    if (maxChars <= 1) return "…";
    return cps.slice(0, maxChars - 1).join("") + "…";
}

/**
 * Overlap-legible edge opacity. Thicker strokes fade toward a floor so a dense bundle
 * at high thickness stays translucent — individual edges and the nodes / arrowheads
 * beneath remain readable instead of merging into one opaque grey mass (G2-002). Thin
 * edges keep the full 0.7; by the documented max thickness (12 → ~0.45, and the
 * weight-scaled extreme → the 0.35 floor) overlaps read as layered, not solid.
 */
export function edgeOpacityFor(width: number): number {
    return Math.max(0.35, Math.min(0.7, 0.7 - (width - 3) * 0.028));
}

/**
 * Edge stroke width scaler, shared by the SVG and canvas render paths so both draw
 * identical thickness. `edgeThickness` (the "Width" slider) is the UPPER limit — the
 * width of the heaviest link — NOT a base that weight multiplies (that let Width=12 blow
 * heavy links into ~84px slabs, NG-133d). Weight interpolates linearly (sqrt-normalised)
 * between a small fixed lower limit and that upper limit, so a huge Edge-weight measure
 * can never exceed the Width the user set. Uniform weights → every link at the set Width.
 * Returns `(li, w?)`: pass a link index, or `w` directly (li = -1) for by-weight callers.
 */
export function makeEdgeWidth(model: GraphModel, edgeThickness: number): (li: number, w?: number) => number {
    let minW = Infinity, maxW = 0;
    for (const l of model.links) {
        if (l.source === l.target) continue;
        if (l.weight < minW) minW = l.weight;
        if (l.weight > maxW) maxW = l.weight;
    }
    const sMin = Math.sqrt(Math.max(0, Number.isFinite(minW) ? minW : 1));
    const sMax = Math.sqrt(Math.max(0, maxW));
    const maxPx = Math.max(0.5, edgeThickness);        // Width = the thickest link
    const minPx = Math.max(0.75, maxPx * 0.2);         // thinnest = 20% of Width (kept visible)
    return (li: number, w?: number): number => {
        const weight = li >= 0 ? model.links[li].weight : (w ?? 1);
        if (!(sMax > sMin)) return maxPx;              // no weight spread → the set Width for all
        const t = (Math.sqrt(Math.max(0, weight)) - sMin) / (sMax - sMin);
        return minPx + (maxPx - minPx) * Math.max(0, Math.min(1, t));
    };
}

// --- Curved / parallel edges (NG-075) --------------------------------------
/** Pixel gap between fanned parallel edges, and the max bow for the curve setting. */
export const PARALLEL_GAP = 15;
export const CURVE_BOW_MAX = 46;

/**
 * Signed fan rank per edge (self-loops excluded elsewhere). Edges sharing the same
 * unordered node pair are fanned apart symmetrically around 0 (spacing 1): a lone
 * edge → 0, a mutual pair → −0.5/+0.5, a triple → −1/0/+1. Pure & deterministic
 * (grouped in link order). The rank is applied in a per-pair normalised frame
 * (low→high node index) so both directions of a mutual edge bow to opposite sides.
 */
export function edgeRanks(model: GraphModel, suppressedOf?: (i: number) => boolean): number[] {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < model.links.length; i++) {
        const l = model.links[i];
        if (l.source === l.target || suppressedOf?.(i)) continue;
        const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
        const key = `${lo}-${hi}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
    }
    const rank = new Array<number>(model.links.length).fill(0);
    for (const idxs of groups.values()) {
        const k = idxs.length;
        idxs.forEach((li, j) => { rank[li] = j - (k - 1) / 2; });
    }
    return rank;
}

/** Signed perpendicular offset (px) for edge `li`: parallel fan + global curve bow. */
export function edgeOffsetPx(rank: number, curveFrac: number): number {
    return rank * PARALLEL_GAP + (curveFrac > 0 ? curveFrac * CURVE_BOW_MAX : 0);
}

/**
 * Minimum visible link length (px) kept between two node surfaces. Below this a
 * link would be swallowed by the nodes' radii and disappear.
 */
export const MIN_EDGE_PX = 10;

/**
 * Trim an edge from source centre (sx0,sy0) to target centre (ex0,ey0) back by the
 * source/target insets `rs`/`rt`, but never let the visible segment shrink below
 * `MIN_EDGE_PX`. When the two insets would consume the whole edge (large or close
 * nodes), keep a `MIN_EDGE_PX` stub centred on the gap so *some* link is always
 * visible no matter how big a node is (NG- big-node-link fix). Endpoints stay on
 * the source→target centre line, so the caller's perpendicular bow still applies.
 */
export function trimEdgeEnds(
    sx0: number, sy0: number, ex0: number, ey0: number, rs: number, rt: number,
): { sx: number; sy: number; ex: number; ey: number } {
    const dx = ex0 - sx0, dy = ey0 - sy0;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let a = rs, b = d - rt; // visible band [a, b] measured from the source centre
    if (b - a < MIN_EDGE_PX) {
        const c = (a + b) / 2;
        a = c - MIN_EDGE_PX / 2;
        b = c + MIN_EDGE_PX / 2;
    }
    return { sx: sx0 + ux * a, sy: sy0 + uy * a, ex: sx0 + ux * b, ey: sy0 + uy * b };
}

/**
 * `d` for an edge from (sx,sy)→(ex,ey), bowed by `offPx` along the supplied unit
 * perpendicular (perpx,perpy). Near-zero offset → a straight line (zero regression
 * for the default un-curved, non-parallel case). A quadratic Bézier otherwise.
 */
export function edgeCurvePath(sx: number, sy: number, ex: number, ey: number, perpx: number, perpy: number, offPx: number): string {
    if (Math.abs(offPx) < 0.01) return `M${r2(sx)},${r2(sy)}L${r2(ex)},${r2(ey)}`;
    const mx = (sx + ex) / 2 + perpx * offPx, my = (sy + ey) / 2 + perpy * offPx;
    return `M${r2(sx)},${r2(sy)}Q${r2(mx)},${r2(my)} ${r2(ex)},${r2(ey)}`;
}

/** Unit perpendicular for a node pair in the normalised (low→high index) frame. */
export function pairPerp(lo: { x: number; y: number }, hi: { x: number; y: number }): [number, number] {
    const dx = hi.x - lo.x, dy = hi.y - lo.y;
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
}

export interface EdgeLabelPlacement {
    x: number;
    y: number;
    angle: number;
    transform: string;
}

/** Place a link label along the path while keeping the text upright.
 *
 * For a quadratic edge, its visual midpoint is the chord midpoint plus half of the
 * control-point offset. `clearance` then moves the label to the readable side of the
 * stroke, so the line no longer runs through the glyphs.
 */
export function edgeLabelPlacement(
    source: { x: number; y: number },
    target: { x: number; y: number },
    curvePerpX: number,
    curvePerpY: number,
    curveOffset: number,
    clearance = 7,
): EdgeLabelPlacement {
    const dx = target.x - source.x, dy = target.y - source.y;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle < -90) angle += 180;

    const radians = angle * Math.PI / 180;
    const pathX = (source.x + target.x) / 2 + curvePerpX * curveOffset / 2;
    const pathY = (source.y + target.y) / 2 + curvePerpY * curveOffset / 2;
    // In SVG's y-down coordinate system this is the visually upper normal of the
    // readable text direction (horizontal links therefore move straight upward).
    const x = pathX + Math.sin(radians) * clearance;
    const y = pathY - Math.cos(radians) * clearance;
    const roundedAngle = r2(angle), roundedX = r2(x), roundedY = r2(y);
    return {
        x,
        y,
        angle,
        transform: `rotate(${roundedAngle} ${roundedX} ${roundedY})`,
    };
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

/** Append an alpha byte to a #rrggbb colour (→ #rrggbbaa). Non-hex colours pass
 *  through unchanged (the halo just renders at full colour). Used for the node glow. */
function withAlpha(color: string, alpha: number): string {
    if (color[0] !== "#" || color.length !== 7) return color;
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, "0");
    return color + a;
}

/** Anchor point + bounding box for a label on a given side of its node. */
function placeLabel(
    side: LabelSide, lines: string[], nx: number, ny: number, r: number,
    fontSize: number, lineH: number, charW: number,
): Placement {
    const w = Math.max(...lines.map((l) => l.length)) * charW;
    const n = lines.length;
    let x: number, y: number, anchor: "start" | "middle" | "end", x0: number, x1: number;

    if (side === "right" || side === "left") {
        y = ny - ((n - 1) * lineH) / 2 + fontSize * 0.35; // vertically centre the block on the node
        if (side === "right") { anchor = "start"; x = nx + r + 3; x0 = x; x1 = x + w; }
        else { anchor = "end"; x = nx - r - 3; x0 = x - w; x1 = x; }
    } else {
        anchor = "middle"; x = nx; x0 = nx - w / 2; x1 = nx + w / 2;
        if (side === "bottom") y = ny + r + fontSize + 2;   // first baseline just below the node
        else y = ny - r - 4 - (n - 1) * lineH;              // top: last baseline sits above the node
    }
    return { x, y, anchor, box: { x0, y0: y - fontSize, x1, y1: y + (n - 1) * lineH }, lines };
}

interface BgGeom { x: number; y: number; w: number; h: number; rx: number; opacity: number }

/**
 * Geometry for a label background of a given `type`, derived arithmetically from the text
 * `box` (never getBBox). `pad` is the user "background width". The text box's height already
 * spans cap→last-baseline; a small descender allowance is added so glyph tails aren't clipped.
 *  - card → tight rounded rectangle (padded both axes; the "improved current" look).
 *  - pill → capsule with fully-rounded ends (extra horizontal pad, rx = half height).
 * ("highlight" is not a box — it renders as a glyph outline stroke on the text, so it
 *  never reaches this function.)
 */
function labelBgGeometry(type: LabelBgType, box: Box, fontSize: number, pad: number): BgGeom {
    const textW = box.x1 - box.x0;
    const textH = (box.y1 - box.y0) + fontSize * 0.2; // + descender allowance
    if (type === "pill") {
        const padX = pad + fontSize * 0.35, padY = pad * 0.5 + 1;
        const h = textH + 2 * padY;
        return { x: box.x0 - padX, y: box.y0 - padY - fontSize * 0.05, w: textW + 2 * padX, h, rx: h / 2, opacity: 1 };
    }
    // card (default) — tighter than a plain box: full horizontal pad, ~60% vertical.
    const padX = pad, padY = pad * 0.6 + 1;
    const h = textH + 2 * padY;
    return { x: box.x0 - padX, y: box.y0 - padY - fontSize * 0.05, w: textW + 2 * padX, h, rx: Math.min(5, padX + 2), opacity: 1 };
}

// --- Auto-fit link avoidance (label boxes vs edge segments) -----------------
interface Seg { x1: number; y1: number; x2: number; y2: number; minx: number; maxx: number; miny: number; maxy: number }

/** Straight edge segments in pixel space (self-loops excluded), with cached AABBs. */
function edgeSegments(model: GraphModel, geo: GraphGeometry): Seg[] {
    const out: Seg[] = [];
    for (const l of model.links) {
        if (l.source === l.target) continue;
        const a = geo.px[l.source], b = geo.px[l.target];
        out.push({
            x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            minx: Math.min(a.x, b.x), maxx: Math.max(a.x, b.x),
            miny: Math.min(a.y, b.y), maxy: Math.max(a.y, b.y),
        });
    }
    return out;
}

/** How many edge segments cross a label box (AABB quick-reject, then segment/rect test).
 *  Counting is capped so a hub surrounded by links doesn't dominate the render budget. */
function countEdgeCrossings(segs: Seg[], b: Box): number {
    let c = 0;
    for (const s of segs) {
        if (s.maxx < b.x0 || s.minx > b.x1 || s.maxy < b.y0 || s.miny > b.y1) continue; // AABB reject
        if (segIntersectsBox(s, b)) { c++; if (c >= 8) break; }
    }
    return c;
}

const inBox = (x: number, y: number, b: Box): boolean => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** True if segment `s` intersects axis-aligned box `b` (endpoint inside, or crosses a side). */
function segIntersectsBox(s: Seg, b: Box): boolean {
    if (inBox(s.x1, s.y1, b) || inBox(s.x2, s.y2, b)) return true;
    return (
        segSeg(s.x1, s.y1, s.x2, s.y2, b.x0, b.y0, b.x1, b.y0) || // top
        segSeg(s.x1, s.y1, s.x2, s.y2, b.x1, b.y0, b.x1, b.y1) || // right
        segSeg(s.x1, s.y1, s.x2, s.y2, b.x1, b.y1, b.x0, b.y1) || // bottom
        segSeg(s.x1, s.y1, s.x2, s.y2, b.x0, b.y1, b.x0, b.y0)    // left
    );
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (by - ay) * (cx - bx) - (bx - ax) * (cy - by);

/** Proper segment/segment intersection (collinear-touch counts as no crossing — good enough here). */
function segSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const d1 = orient(cx, cy, dx, dy, ax, ay);
    const d2 = orient(cx, cy, dx, dy, bx, by);
    const d3 = orient(ax, ay, bx, by, cx, cy);
    const d4 = orient(ax, ay, bx, by, dx, dy);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Create (once per colour) a tiled SVG fill pattern tinted to the node colour;
 *  returns its id. Patterns are cleared and rebuilt each render. Cert-safe (pure SVG). */
function ensureFillPattern(defs: DefsSel, type: string, color: string): string {
    const id = `zx-fill-${type}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
    if (!defs.select(`#${id}`).empty()) return id;
    const p = defs.append("pattern").attr("id", id).classed("zx-fill", true)
        .attr("patternUnits", "userSpaceOnUse").attr("width", 10).attr("height", 10);
    const sw = 1.2;
    switch (type) {
        case "dots": p.append("circle").attr("cx", 5).attr("cy", 5).attr("r", 1.6).attr("fill", color); break;
        case "rings": p.append("circle").attr("cx", 5).attr("cy", 5).attr("r", 3).attr("fill", "none").attr("stroke", color).attr("stroke-width", sw); break;
        case "diagonal": p.append("path").attr("d", "M0 10 L10 0").attr("stroke", color).attr("stroke-width", sw); break;
        case "crosshatch": p.append("path").attr("d", "M0 10 L10 0 M0 0 L10 10").attr("stroke", color).attr("stroke-width", sw); break;
        case "grid": p.append("path").attr("d", "M0 0 H10 M0 0 V10").attr("stroke", color).attr("stroke-width", 1); break;
        case "horizontal": p.append("path").attr("d", "M0 2.5 H10 M0 7.5 H10").attr("stroke", color).attr("stroke-width", sw); break;
        case "vertical": p.append("path").attr("d", "M2.5 0 V10 M7.5 0 V10").attr("stroke", color).attr("stroke-width", sw); break;
        case "checker":
            p.append("rect").attr("x", 0).attr("y", 0).attr("width", 5).attr("height", 5).attr("fill", color);
            p.append("rect").attr("x", 5).attr("y", 5).attr("width", 5).attr("height", 5).attr("fill", color);
            break;
        case "diamonds": p.append("path").attr("d", "M5 0 L10 5 L5 10 L0 5 Z").attr("fill", "none").attr("stroke", color).attr("stroke-width", sw); break;
        case "zigzag": p.append("path").attr("d", "M0 3 L2.5 1 L5 3 L7.5 1 L10 3 M0 8 L2.5 6 L5 8 L7.5 6 L10 8").attr("fill", "none").attr("stroke", color).attr("stroke-width", sw); break;
        case "waves": p.append("path").attr("d", "M0 3 Q2.5 0 5 3 T10 3 M0 8 Q2.5 5 5 8 T10 8").attr("fill", "none").attr("stroke", color).attr("stroke-width", sw); break;
        default: break;
    }
    return id;
}

/** SVG path (centred at 0,0, positioned by a translate transform) for a node shape. */
function shapePath(shape: NodeShape, r: number): string {
    switch (shape) {
        case "square": {
            const s = r * 0.9;
            return `M ${-s} ${-s} L ${s} ${-s} L ${s} ${s} L ${-s} ${s} Z`;
        }
        case "diamond":
            return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
        case "triangle": {
            const w = r * 0.92, h = r; // pointing up, roughly circle-sized
            return `M 0 ${-h} L ${w} ${h * 0.72} L ${-w} ${h * 0.72} Z`;
        }
        case "hexagon": {
            const a = r, b = r * 0.5, c = r * 0.866;
            return `M ${a} 0 L ${b} ${c} L ${-b} ${c} L ${-a} 0 L ${-b} ${-c} L ${b} ${-c} Z`;
        }
        case "donut": {
            const ro = r, ri = r * 0.55; // ring; inner hole via fill-rule evenodd
            return `M ${ro} 0 A ${ro} ${ro} 0 1 1 ${-ro} 0 A ${ro} ${ro} 0 1 1 ${ro} 0 Z`
                + ` M ${ri} 0 A ${ri} ${ri} 0 1 1 ${-ri} 0 A ${ri} ${ri} 0 1 1 ${ri} 0 Z`;
        }
        default: { // circle drawn as a path (only used if a circle ever routes here)
            return `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;
        }
    }
}

/** A small loop arc leaving the top of a node and returning to its right edge. */
export function selfLoopPath(p: Vec2, r: number): string {
    const s = r + 6;
    return `M ${p.x} ${p.y - r} C ${p.x + s * 1.8} ${p.y - s * 1.8}, ${p.x + s * 1.8} ${p.y + s * 0.6}, ${p.x + r} ${p.y}`;
}
