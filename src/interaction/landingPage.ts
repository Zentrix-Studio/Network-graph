"use strict";

/**
 * Landing / onboarding page — shown when the visual is loaded with no fields
 * bound. It follows the Calendar Heatmap onboarding pattern: a responsive,
 * theme-aware carousel pairing live, deterministic product illustrations with
 * concise setup guidance.
 *
 * Mounted from the visual constructor because Power BI does not call update()
 * until a role is bound. Cert-safe: createElement/textContent/inline SVG only;
 * no innerHTML, external assets, network access, or non-deterministic motion.
 */

import { Surface, accent, categoryPalette } from "../theme/zentrixTokens";
import { VERSION } from "../version";

const NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "zx-network-landing-style";
type Cleanup = () => void;

interface Point { x: number; y: number; r?: number; color?: string; label?: string; }
interface Link { a: number; b: number; width?: number; dash?: string; color?: string; }
interface SceneContext { dark: boolean; surface: Surface; }

function svgNode(viewBox: string, width: number, height: number): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");
    return svg;
}

function rectNode(x: number, y: number, width: number, height: number, radius: number, fill: string): SVGRectElement {
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", String(radius));
    rect.setAttribute("fill", fill);
    return rect;
}

function circleNode(x: number, y: number, radius: number, fill: string): SVGCircleElement {
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", fill);
    return circle;
}

function lineNode(
    x1: number, y1: number, x2: number, y2: number,
    stroke: string, width = 2, dash?: string,
): SVGLineElement {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", String(width));
    line.setAttribute("stroke-linecap", "round");
    if (dash) line.setAttribute("stroke-dasharray", dash);
    return line;
}

function textNode(
    x: number, y: number, value: string,
    options: { size?: number; fill?: string; weight?: number; anchor?: string } = {},
): SVGTextElement {
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("font-family", "Segoe UI, system-ui, sans-serif");
    text.setAttribute("font-size", String(options.size ?? 11));
    text.setAttribute("fill", options.fill ?? "#64647A");
    if (options.weight) text.setAttribute("font-weight", String(options.weight));
    if (options.anchor) text.setAttribute("text-anchor", options.anchor);
    text.textContent = value;
    return text;
}

function network(
    width: number, height: number, points: Point[], links: Link[], context: SceneContext,
): SVGSVGElement {
    const svg = svgNode(`0 0 ${width} ${height}`, width, height);
    const edgeColor = context.dark ? "#70707F" : "#A7A8B5";
    const labelColor = context.dark ? "#D7D7E0" : "#343545";

    links.forEach((link, index) => {
        const a = points[link.a], b = points[link.b];
        const line = lineNode(a.x, a.y, b.x, b.y, link.color ?? edgeColor, link.width ?? 2, link.dash);
        line.setAttribute("class", "zx-lp-edge");
        (line as unknown as SVGElement).style.animationDelay = `${index * 35}ms`;
        svg.appendChild(line);
    });

    points.forEach((point, index) => {
        const radius = point.r ?? 11;
        const halo = circleNode(point.x, point.y, radius + 4, context.dark ? "#15151F" : "#FFFFFF");
        halo.setAttribute("opacity", "0.92");
        svg.appendChild(halo);
        const node = circleNode(point.x, point.y, radius, point.color ?? categoryPalette[index % categoryPalette.length]);
        node.setAttribute("class", "zx-lp-node");
        (node as unknown as SVGElement).style.animationDelay = `${120 + index * 45}ms`;
        svg.appendChild(node);
        if (point.label) {
            svg.appendChild(textNode(point.x, point.y + radius + 17, point.label, {
                size: 10, fill: labelColor, weight: 600, anchor: "middle",
            }));
        }
    });
    return svg;
}

function sceneWelcome(context: SceneContext): SVGSVGElement {
    const points: Point[] = [
        { x: 220, y: 145, r: 19, color: accent, label: "Core" },
        { x: 118, y: 78, r: 13, color: categoryPalette[1], label: "Sales" },
        { x: 335, y: 76, r: 15, color: categoryPalette[3], label: "Ops" },
        { x: 350, y: 206, r: 12, color: categoryPalette[2], label: "Supply" },
        { x: 104, y: 222, r: 14, color: categoryPalette[5], label: "Digital" },
        { x: 45, y: 137, r: 8, color: categoryPalette[1] },
        { x: 179, y: 45, r: 9, color: categoryPalette[4] },
        { x: 407, y: 133, r: 9, color: categoryPalette[3] },
        { x: 275, y: 253, r: 10, color: categoryPalette[2] },
        { x: 41, y: 256, r: 7, color: categoryPalette[5] },
        { x: 409, y: 260, r: 8, color: categoryPalette[6] },
    ];
    const links: Link[] = [
        { a: 0, b: 1, width: 4 }, { a: 0, b: 2, width: 5 }, { a: 0, b: 3, width: 3 },
        { a: 0, b: 4, width: 4 }, { a: 1, b: 5 }, { a: 1, b: 6 }, { a: 2, b: 7 },
        { a: 3, b: 8 }, { a: 3, b: 10 }, { a: 4, b: 5 }, { a: 4, b: 9 },
        { a: 2, b: 3, dash: "5 5" }, { a: 1, b: 4, dash: "5 5" },
    ];
    return network(450, 300, points, links, context);
}

function pill(
    svg: SVGSVGElement, x: number, y: number, width: number, label: string,
    tone: string, context: SceneContext,
): void {
    const bg = rectNode(x, y, width, 34, 9, context.dark ? "#1D1D2A" : "#FFFFFF");
    bg.setAttribute("class", "zx-lp-pill");
    bg.setAttribute("stroke", context.dark ? "rgba(255,255,255,.14)" : "rgba(20,23,50,.10)");
    svg.appendChild(bg);
    svg.appendChild(circleNode(x + 17, y + 17, 4, tone));
    // SVG text does not wrap automatically. Fit the label arithmetically inside
    // the pill so font/platform differences cannot spill into the next card.
    const maxLabelWidth = Math.max(24, width - 38);
    const fittedSize = Math.min(11, maxLabelWidth / Math.max(1, label.length * 0.58));
    const labelNode = textNode(x + 30, y + 22, label, {
        size: fittedSize, weight: 650, fill: context.dark ? "#E8E8F0" : "#303142",
    });
    labelNode.setAttribute("class", "zx-lp-pill-label");
    labelNode.setAttribute("data-max-width", String(maxLabelWidth));
    svg.appendChild(labelNode);
}

function sceneMeasures(context: SceneContext): SVGSVGElement {
    const svg = svgNode("0 0 450 300", 450, 300);
    const text = context.dark ? "#E8E8F0" : "#303142";
    const muted = context.dark ? "#A6A6B5" : "#646579";
    const edge = context.dark ? "#666678" : "#B0B1BE";

    svg.appendChild(textNode(22, 28, "THREE LIVE RULE PREVIEWS", { size: 10, fill: accent, weight: 800 }));
    [
        { x: 20, field: "PageRank", rule: "> 0.25", result: "HUB", tone: accent, hot: 0 },
        { x: 161, field: "Name", rule: "contains “Risk”", result: "RISK", tone: categoryPalette[2], hot: 2 },
        { x: 302, field: "Degree", rule: "Top 10", result: "TOP N", tone: categoryPalette[1], hot: 1 },
    ].forEach((item) => {
        const card = rectNode(item.x, 44, 128, 210, 13, context.dark ? "#1D1D2A" : "#FFFFFF");
        card.setAttribute("stroke", context.dark ? "rgba(255,255,255,.12)" : "rgba(20,23,50,.09)");
        card.setAttribute("class", "zx-lp-rule-preview");
        svg.appendChild(card);
        svg.appendChild(textNode(item.x + 13, 65, item.field, { size: 10, fill: muted, weight: 650 }));
        svg.appendChild(textNode(item.x + 13, 82, item.rule, { size: 10, fill: text, weight: 750 }));

        const pts: Array<[number, number]> = [
            [item.x + 64, 132], [item.x + 30, 168], [item.x + 98, 168], [item.x + 64, 205],
        ];
        [[0, 1], [0, 2], [0, 3], [1, 3], [2, 3]].forEach(([a, b]) => {
            svg.appendChild(lineNode(pts[a][0], pts[a][1], pts[b][0], pts[b][1], edge, 1.5));
        });
        pts.forEach(([x, y], index) => {
            const active = index === item.hot;
            if (active) {
                const halo = circleNode(x, y, 15, item.tone);
                halo.setAttribute("opacity", ".16");
                svg.appendChild(halo);
            }
            svg.appendChild(circleNode(x, y, active ? 9 : 6, active ? item.tone : (context.dark ? "#767687" : "#C8C9D2")));
        });
        const tag = rectNode(item.x + 31, 224, 66, 20, 10, item.tone);
        tag.setAttribute("opacity", ".94");
        svg.appendChild(tag);
        svg.appendChild(textNode(item.x + 64, 238, item.result, {
            size: 9, fill: "#FFFFFF", weight: 800, anchor: "middle",
        }));
    });
    svg.appendChild(textNode(225, 282, "Rules can use computed metrics or text—no extra DAX", {
        size: 11, fill: muted, weight: 600, anchor: "middle",
    }));
    return svg;
}

function sceneSummaryInsights(context: SceneContext): SVGSVGElement {
    const svg = svgNode("0 0 450 300", 450, 300);
    const text = context.dark ? "#E8E8F0" : "#303142";
    const muted = context.dark ? "#A6A6B5" : "#696A7C";
    const cardFill = context.dark ? "#1B1B25" : "#FFFFFF";
    const soft = context.dark ? "#272733" : "#F2F2F7";
    const border = context.dark ? "rgba(255,255,255,.11)" : "rgba(20,23,50,.09)";

    // Summary view — faithful miniaturisation of the real stat cards, search,
    // sortable metrics table, and export action.
    const summary = rectNode(13, 14, 270, 272, 14, cardFill);
    summary.setAttribute("class", "zx-lp-summary-preview");
    summary.setAttribute("stroke", border);
    svg.appendChild(summary);
    svg.appendChild(textNode(29, 37, "SUMMARY TABLE", { size: 9, fill: accent, weight: 800 }));
    svg.appendChild(textNode(29, 58, "Every node, ranked", { size: 14, fill: text, weight: 750 }));

    [
        { x: 29, title: "NODES", value: "128", tone: categoryPalette[3] },
        { x: 106, title: "EDGES", value: "246", tone: accent },
        { x: 183, title: "AVG DEGREE", value: "3.8", tone: categoryPalette[1] },
    ].forEach((stat) => {
        const statCard = rectNode(stat.x, 72, 68, 48, 8, soft);
        statCard.setAttribute("class", "zx-lp-summary-stat");
        svg.appendChild(statCard);
        svg.appendChild(textNode(stat.x + 8, 87, stat.title, { size: 6.5, fill: muted, weight: 750 }));
        svg.appendChild(textNode(stat.x + 8, 108, stat.value, { size: 14, fill: stat.tone, weight: 800 }));
    });

    const search = rectNode(29, 132, 151, 25, 7, soft);
    search.setAttribute("stroke", border);
    svg.appendChild(search);
    svg.appendChild(circleNode(41, 144, 4, "none"));
    const magnifier = svg.lastChild as SVGCircleElement;
    magnifier.setAttribute("stroke", muted);
    magnifier.setAttribute("stroke-width", "1.3");
    svg.appendChild(lineNode(44, 147, 48, 151, muted, 1.3));
    svg.appendChild(textNode(55, 149, "Search nodes…", { size: 8, fill: muted }));
    const exportBtn = rectNode(188, 132, 67, 25, 7, accent);
    svg.appendChild(exportBtn);
    svg.appendChild(textNode(221.5, 149, "Export CSV", {
        size: 8, fill: "#FFFFFF", weight: 750, anchor: "middle",
    }));

    const columns = [
        { x: 31, label: "#", anchor: "start" },
        { x: 55, label: "Node", anchor: "start" },
        { x: 180, label: "Degree", anchor: "end" },
        { x: 250, label: "PageRank", anchor: "end" },
    ];
    columns.forEach((column) => svg.appendChild(textNode(column.x, 176, column.label, {
        size: 7.5, fill: muted, weight: 750, anchor: column.anchor,
    })));
    [
        ["1", "Core", "12", "0.31"],
        ["2", "Gateway", "9", "0.22"],
        ["3", "Account", "7", "0.16"],
        ["4", "Vendor", "5", "0.11"],
    ].forEach((row, index) => {
        const y = 188 + index * 22;
        const rowBg = rectNode(25, y, 234, 19, 5, index % 2 ? soft : "transparent");
        rowBg.setAttribute("class", "zx-lp-summary-row");
        svg.appendChild(rowBg);
        svg.appendChild(textNode(31, y + 13, row[0], { size: 8, fill: muted }));
        svg.appendChild(circleNode(50, y + 9.5, 3, categoryPalette[index % 4]));
        svg.appendChild(textNode(58, y + 13, row[1], { size: 8, fill: text, weight: 650 }));
        svg.appendChild(textNode(180, y + 13, row[2], { size: 8, fill: text, anchor: "end" }));
        svg.appendChild(textNode(250, y + 13, row[3], { size: 8, fill: text, anchor: "end" }));
    });

    // Insight view — the real visual's plain-English headline and metric-card pattern.
    const insight = rectNode(294, 14, 143, 272, 14, cardFill);
    insight.setAttribute("class", "zx-lp-insight-preview");
    insight.setAttribute("stroke", border);
    svg.appendChild(insight);
    svg.appendChild(textNode(309, 37, "NETWORK INSIGHT", { size: 9, fill: accent, weight: 800 }));
    svg.appendChild(textNode(309, 59, "Core leads a", { size: 12, fill: text, weight: 750 }));
    svg.appendChild(textNode(309, 75, "connected network", { size: 12, fill: text, weight: 750 }));
    svg.appendChild(textNode(309, 92, "128 nodes · 246 links", { size: 7.5, fill: muted }));

    [
        { y: 108, label: "COMMUNITIES", value: "3", sub: "clear groups", tone: categoryPalette[3] },
        { y: 161, label: "TOP HUB", value: "Core", sub: "12 relationships", tone: accent },
        { y: 214, label: "DENSITY", value: "0.42", sub: "well connected", tone: categoryPalette[1] },
    ].forEach((metric) => {
        const metricCard = rectNode(307, metric.y, 117, 44, 8, soft);
        metricCard.setAttribute("class", "zx-lp-insight-card");
        svg.appendChild(metricCard);
        svg.appendChild(textNode(318, metric.y + 13, metric.label, { size: 6.5, fill: muted, weight: 750 }));
        svg.appendChild(textNode(318, metric.y + 31, metric.value, { size: 13, fill: metric.tone, weight: 800 }));
        svg.appendChild(textNode(414, metric.y + 30, metric.sub, {
            size: 6.5, fill: muted, anchor: "end",
        }));
    });
    return svg;
}

function sceneLayoutGallery(context: SceneContext): SVGSVGElement {
    const svg = svgNode("0 0 450 300", 450, 300);
    const text = context.dark ? "#E8E8F0" : "#303142";
    const muted = context.dark ? "#A6A6B5" : "#646579";
    const edge = context.dark ? "#68687A" : "#B0B1BE";
    const cardFill = context.dark ? "#181821" : "rgba(255,255,255,.82)";

    const addCard = (x: number, y: number, label: string, geo = false) => {
        const card = rectNode(x, y, 202, 128, 13, cardFill);
        card.setAttribute("stroke", geo ? accent : (context.dark ? "rgba(255,255,255,.10)" : "rgba(20,23,50,.09)"));
        card.setAttribute("stroke-width", geo ? "2.5" : "1");
        card.setAttribute("class", "zx-lp-layout-preview");
        svg.appendChild(card);
        svg.appendChild(textNode(x + 12, y + 113, label, {
            size: 10, fill: geo ? accent : text, weight: 750,
        }));
        if (geo) {
            const badge = rectNode(x + 126, y + 8, 64, 18, 9, accent);
            svg.appendChild(badge);
            svg.appendChild(textNode(x + 158, y + 21, "GEO MODE", {
                size: 8, fill: "#FFFFFF", weight: 800, anchor: "middle",
            }));
        }
    };

    addCard(14, 14, "Force · communities");
    const forcePts: Array<[number, number]> = [[112, 62], [55, 43], [162, 38], [158, 82], [53, 83], [105, 28]];
    [[0, 1], [0, 2], [0, 3], [0, 4], [2, 5]].forEach(([a, b]) =>
        svg.appendChild(lineNode(14 + forcePts[a][0], 14 + forcePts[a][1], 14 + forcePts[b][0], 14 + forcePts[b][1], edge, 1.5)));
    forcePts.forEach(([x, y], index) => svg.appendChild(circleNode(
        14 + x, 14 + y, index === 0 ? 8 : 5, categoryPalette[index % 5],
    )));

    addCard(234, 14, "Concentric · core / periphery");
    const concentricCenter: [number, number] = [335, 72];
    const inner: Array<[number, number]> = [];
    const outer: Array<[number, number]> = [];
    for (let index = 0; index < 4; index++) {
        const angle = (Math.PI * 2 * index) / 4 - Math.PI / 2;
        inner.push([
            concentricCenter[0] + Math.cos(angle) * 24,
            concentricCenter[1] + Math.sin(angle) * 16,
        ]);
    }
    for (let index = 0; index < 8; index++) {
        const angle = (Math.PI * 2 * index) / 8 - Math.PI / 2 + Math.PI / 8;
        outer.push([
            concentricCenter[0] + Math.cos(angle) * 55,
            concentricCenter[1] + Math.sin(angle) * 36,
        ]);
    }
    inner.forEach(([x, y]) =>
        svg.appendChild(lineNode(concentricCenter[0], concentricCenter[1], x, y, edge, 1.3)));
    outer.forEach(([x, y], index) =>
        svg.appendChild(lineNode(inner[Math.floor(index / 2)][0], inner[Math.floor(index / 2)][1], x, y, edge, 1.1)));
    inner.forEach(([x, y], index) => svg.appendChild(circleNode(x, y, 5, categoryPalette[(index + 1) % 6])));
    outer.forEach(([x, y], index) => svg.appendChild(circleNode(x, y, 3.5, categoryPalette[(index + 2) % 6])));
    svg.appendChild(circleNode(concentricCenter[0], concentricCenter[1], 9, accent));

    addCard(14, 158, "Hierarchy · parent paths");
    const treePts: Array<[number, number]> = [
        [115, 180], [74, 210], [156, 210], [50, 242], [95, 242], [135, 242], [178, 242],
    ];
    [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]].forEach(([a, b]) =>
        svg.appendChild(lineNode(treePts[a][0], treePts[a][1], treePts[b][0], treePts[b][1], edge, 1.5)));
    treePts.forEach(([x, y], index) => svg.appendChild(circleNode(x, y, index === 0 ? 8 : 5, categoryPalette[index % 5])));

    addCard(234, 158, "Geo routes · latitude / longitude", true);
    const land = context.dark ? "#343445" : "#E4E5EC";
    const worldA = document.createElementNS(NS, "path");
    worldA.setAttribute("d", "M252 204 C270 180 302 180 316 195 C325 204 313 217 296 218 C278 220 269 238 252 230 Z");
    worldA.setAttribute("fill", land);
    svg.appendChild(worldA);
    const worldB = document.createElementNS(NS, "path");
    worldB.setAttribute("d", "M330 188 C352 176 397 185 419 202 C407 212 385 209 375 222 C361 239 337 234 329 217 Z");
    worldB.setAttribute("fill", land);
    svg.appendChild(worldB);
    const geoPts: Array<[number, number]> = [[273, 205], [308, 221], [351, 201], [396, 218], [371, 237]];
    [[0, 1], [1, 2], [2, 3], [2, 4]].forEach(([a, b]) => {
        const route = lineNode(geoPts[a][0], geoPts[a][1], geoPts[b][0], geoPts[b][1], accent, 2);
        route.setAttribute("class", "zx-lp-edge");
        svg.appendChild(route);
    });
    geoPts.forEach(([x, y], index) => svg.appendChild(circleNode(x, y, 5, categoryPalette[(index + 2) % 6])));
    svg.appendChild(textNode(225, 297, "Four layout previews · Geo works without external map tiles", {
        size: 10, fill: muted, weight: 650, anchor: "middle",
    }));
    return svg;
}

function sceneStyleGallery(context: SceneContext): SVGSVGElement {
    const svg = svgNode("0 0 450 300", 450, 300);
    const text = context.dark ? "#E8E8F0" : "#303142";
    const muted = context.dark ? "#A6A6B5" : "#646579";
    const edge = context.dark ? "#68687A" : "#B0B1BE";
    const cardFill = context.dark ? "#181821" : "rgba(255,255,255,.82)";

    const defs = document.createElementNS(NS, "defs");
    const stripes = document.createElementNS(NS, "pattern");
    stripes.setAttribute("id", "zx-lp-stripes");
    stripes.setAttribute("width", "8"); stripes.setAttribute("height", "8");
    stripes.setAttribute("patternUnits", "userSpaceOnUse");
    const stripeBg = rectNode(0, 0, 8, 8, 0, context.dark ? "#29243D" : "#EAE4FF");
    stripes.appendChild(stripeBg);
    const stripe = lineNode(0, 8, 8, 0, accent, 3);
    stripes.appendChild(stripe);
    defs.appendChild(stripes);
    const dots = document.createElementNS(NS, "pattern");
    dots.setAttribute("id", "zx-lp-dots");
    dots.setAttribute("width", "8"); dots.setAttribute("height", "8");
    dots.setAttribute("patternUnits", "userSpaceOnUse");
    dots.appendChild(rectNode(0, 0, 8, 8, 0, context.dark ? "#16312E" : "#DDF8F3"));
    dots.appendChild(circleNode(4, 4, 1.7, categoryPalette[1]));
    defs.appendChild(dots);
    svg.appendChild(defs);

    const addCard = (x: number, y: number, label: string, sub: string) => {
        const card = rectNode(x, y, 202, 128, 13, cardFill);
        card.setAttribute("stroke", context.dark ? "rgba(255,255,255,.10)" : "rgba(20,23,50,.09)");
        card.setAttribute("class", "zx-lp-style-preview");
        svg.appendChild(card);
        svg.appendChild(textNode(x + 12, y + 103, label, { size: 10, fill: text, weight: 750 }));
        svg.appendChild(textNode(x + 12, y + 118, sub, { size: 8.5, fill: muted, weight: 550 }));
    };

    addCard(14, 14, "Pattern fills", "Non-color grouping");
    svg.appendChild(lineNode(65, 65, 166, 65, edge, 2));
    svg.appendChild(circleNode(72, 65, 22, "url(#zx-lp-stripes)"));
    svg.appendChild(circleNode(159, 65, 22, "url(#zx-lp-dots)"));

    addCard(234, 14, "Icons", "Recognizable entities");
    svg.appendChild(lineNode(285, 66, 387, 66, edge, 2));
    svg.appendChild(circleNode(292, 66, 23, categoryPalette[3]));
    svg.appendChild(circleNode(380, 66, 23, categoryPalette[4]));
    svg.appendChild(textNode(292, 74, "✈", { size: 23, fill: "#FFFFFF", weight: 700, anchor: "middle" }));
    svg.appendChild(textNode(380, 74, "★", { size: 23, fill: "#FFFFFF", weight: 700, anchor: "middle" }));

    addCard(14, 158, "Halo depth", "Soft emphasis + glow");
    svg.appendChild(lineNode(66, 211, 166, 211, edge, 3));
    [[73, categoryPalette[5]], [158, accent]].forEach(([x, color]) => {
        const haloOuter = circleNode(Number(x), 211, 31, String(color));
        haloOuter.setAttribute("opacity", ".10"); svg.appendChild(haloOuter);
        const haloInner = circleNode(Number(x), 211, 24, String(color));
        haloInner.setAttribute("opacity", ".22"); svg.appendChild(haloInner);
        svg.appendChild(circleNode(Number(x), 211, 16, String(color)));
    });

    addCard(234, 158, "Flat nodes", "Clean, compact, precise");
    svg.appendChild(lineNode(286, 211, 387, 211, edge, 2));
    svg.appendChild(circleNode(293, 211, 17, categoryPalette[1]));
    const diamond = document.createElementNS(NS, "polygon");
    diamond.setAttribute("points", "380,192 399,211 380,230 361,211");
    diamond.setAttribute("fill", categoryPalette[2]);
    svg.appendChild(diamond);

    svg.appendChild(textNode(225, 297, "Two appearance pairs · pattern/icon and halo/flat", {
        size: 10, fill: muted, weight: 650, anchor: "middle",
    }));
    return svg;
}

function sceneExplore(context: SceneContext): SVGSVGElement {
    const points: Point[] = [
        { x: 205, y: 142, r: 20, color: accent },
        { x: 92, y: 72, r: 12, color: categoryPalette[1] },
        { x: 327, y: 65, r: 13, color: categoryPalette[3] },
        { x: 345, y: 220, r: 14, color: categoryPalette[2] },
        { x: 89, y: 226, r: 11, color: categoryPalette[5] },
        { x: 405, y: 136, r: 8, color: categoryPalette[3] },
    ];
    const svg = network(450, 300, points, [
        { a: 0, b: 1, width: 3 }, { a: 0, b: 2, width: 4 }, { a: 0, b: 3, width: 5 },
        { a: 0, b: 4, width: 3 }, { a: 2, b: 5, width: 2 }, { a: 2, b: 3, dash: "5 5" },
    ], context);
    const selected = circleNode(205, 142, 29, "none");
    selected.setAttribute("stroke", accent);
    selected.setAttribute("stroke-width", "3");
    selected.setAttribute("class", "zx-lp-pulse");
    svg.appendChild(selected);
    const tooltip = rectNode(230, 111, 135, 65, 11, context.dark ? "#20202C" : "#FFFFFF");
    tooltip.setAttribute("stroke", context.dark ? "rgba(255,255,255,.14)" : "rgba(20,23,50,.10)");
    svg.appendChild(tooltip);
    svg.appendChild(textNode(245, 134, "Core account", {
        size: 12, fill: context.dark ? "#F4F4F6" : "#222331", weight: 700,
    }));
    svg.appendChild(textNode(245, 154, "Degree  ·  4", {
        size: 10, fill: context.dark ? "#A6A6B5" : "#646579",
    }));
    svg.appendChild(textNode(245, 168, "Weight  ·  126", {
        size: 10, fill: context.dark ? "#A6A6B5" : "#646579",
    }));
    pill(svg, 18, 14, 126, "Deterministic", accent, context);
    pill(svg, 154, 14, 104, "Pin layout", categoryPalette[1], context);
    pill(svg, 268, 14, 146, "Refresh-safe", categoryPalette[3], context);
    return svg;
}

function sceneInsights(context: SceneContext): SVGSVGElement {
    const svg = sceneWelcome(context);
    const muted = context.dark ? "#A6A6B5" : "#646579";
    const card = rectNode(18, 14, 154, 91, 13, context.dark ? "#1D1D2A" : "#FFFFFF");
    card.setAttribute("stroke", context.dark ? "rgba(255,255,255,.14)" : "rgba(20,23,50,.10)");
    svg.appendChild(card);
    svg.appendChild(textNode(32, 36, "NETWORK INSIGHTS", { size: 9, fill: accent, weight: 800 }));
    svg.appendChild(textNode(32, 60, "3 communities", {
        size: 13, fill: context.dark ? "#F4F4F6" : "#222331", weight: 700,
    }));
    svg.appendChild(textNode(32, 79, "Core is the top hub", { size: 10, fill: muted }));
    svg.appendChild(textNode(32, 94, "Density  0.42", { size: 10, fill: muted }));
    pill(svg, 282, 242, 135, "Shortest path", categoryPalette[2], context);
    return svg;
}

function sceneTrust(context: SceneContext): SVGSVGElement {
    const svg = svgNode("0 0 450 300", 450, 300);
    const text = context.dark ? "#E8E8F0" : "#303142";
    const muted = context.dark ? "#A6A6B5" : "#646579";

    const shield = document.createElementNS(NS, "path");
    shield.setAttribute("d", "M225 35 L304 62 V127 C304 177 274 214 225 238 C176 214 146 177 146 127 V62 Z");
    shield.setAttribute("fill", context.dark ? "#1B1633" : "#F1EDFF");
    shield.setAttribute("stroke", accent);
    shield.setAttribute("stroke-width", "3");
    svg.appendChild(shield);
    const check = document.createElementNS(NS, "path");
    check.setAttribute("d", "M191 132 L216 157 L264 105");
    check.setAttribute("fill", "none");
    check.setAttribute("stroke", accent);
    check.setAttribute("stroke-width", "9");
    check.setAttribute("stroke-linecap", "round");
    check.setAttribute("stroke-linejoin", "round");
    svg.appendChild(check);

    pill(svg, 20, 45, 113, "Keyboard", categoryPalette[3], context);
    pill(svg, 20, 96, 113, "High contrast", categoryPalette[4], context);
    pill(svg, 20, 147, 113, "CVD-safe", categoryPalette[1], context);
    pill(svg, 317, 45, 113, "In-sandbox", accent, context);
    pill(svg, 317, 96, 113, "No web data", categoryPalette[5], context);
    pill(svg, 317, 147, 113, "Deterministic", categoryPalette[2], context);
    svg.appendChild(textNode(225, 271, "Report data stays inside the Power BI visual sandbox", {
        size: 11, fill: text, weight: 700, anchor: "middle",
    }));
    svg.appendChild(textNode(225, 289, "User-opened help links never include report data", {
        size: 10, fill: muted, anchor: "middle",
    }));
    return svg;
}

interface PageDefinition {
    eyebrow: string;
    title: string;
    lines: string[];
    scene: (context: SceneContext) => SVGSVGElement;
}

const PAGES: PageDefinition[] = [
    {
        eyebrow: "Zentrix Network Graph",
        title: "The network graph that stays put",
        scene: sceneWelcome,
        lines: [
            "Keep every node where it belongs—even after refresh—so your team never loses its mental map.",
            "Discover communities, hubs, bridges, and paths directly inside Power BI, without exporting the network to another tool.",
            "Deterministic. Analyst-ready. Built for enterprise trust.",
        ],
    },
    {
        eyebrow: "MVP 1 · Durable geometry",
        title: "Your mental map survives refresh",
        scene: sceneExplore,
        lines: [
            "• Hash-seeded, fixed-pass layout returns the same coordinates for the same data.",
            "• Drag and pin the exact arrangement that tells your story.",
            "• Saved geometry survives refresh and ranking changes.",
            "The graph stops dancing, so users can reason from a stable view.",
        ],
    },
    {
        eyebrow: "MVP 2 · Layout modes",
        title: "Six layouts. One interaction model.",
        scene: sceneLayoutGallery,
        lines: [
            "• Force reveals communities; Concentric separates core from periphery; Circular and Grid give tidy, stable arrangements; Hierarchy follows parent paths.",
            "• Geo mode places nodes from Latitude and Longitude on a bundled world outline.",
            "• Routes, typed edges, selection, tooltips, and labels behave consistently in every mode.",
            "Switch the structure without rebuilding the report.",
        ],
    },
    {
        eyebrow: "MVP 3 · Node appearance",
        title: "Pattern, icon, halo, or flat",
        scene: sceneStyleGallery,
        lines: [
            "• Pattern fills add a non-color signal for groups and accessibility.",
            "• Icons and safe data-URI images turn abstract nodes into recognizable entities.",
            "• Halo depth emphasizes important nodes; Flat mode stays clean and compact.",
            "Mix shape, pattern, icon, color, and depth without changing the data model.",
        ],
    },
    {
        eyebrow: "MVP 4 · Network intelligence",
        title: "It analyzes—not just draws",
        scene: sceneInsights,
        lines: [
            "• Rank hubs with degree, weighted degree, betweenness, closeness, or PageRank.",
            "• Detect real communities from connectivity—not only a category field.",
            "• Trace shortest paths, neighborhoods, bridges, and disconnected groups.",
            "A deterministic insight engine explains density and fragmentation in plain language.",
        ],
    },
    {
        eyebrow: "MVP 5 · Summary + insight",
        title: "Summary table and insights, built in",
        scene: sceneSummaryInsights,
        lines: [
            "• Switch to Summary for sortable node metrics: degree, centrality, component, category, and more.",
            "• Search, filter, rank, and export the current node table to CSV.",
            "• Insight turns structure into plain language—top hub, communities, density, and fragmentation.",
            "Graph, Summary, and Insight stay aligned to the same report data and selection.",
        ],
    },
    {
        eyebrow: "MVP 6 · Rule-driven analysis",
        title: "Rules that understand the graph",
        scene: sceneMeasures,
        lines: [
            "• Highlight PageRank hubs, flag risky names, or isolate Top-N degree nodes.",
            "• Build unlimited visual rules from computed metrics or text—without extra DAX.",
            "• Search, ranking, notes, neighborhood focus, and report cross-filtering stay available.",
            "Rules turn graph intelligence into an immediate visual decision.",
        ],
    },
    {
        eyebrow: "MVP 7 · Enterprise trust",
        title: "Governed reports deserve a trustworthy graph",
        scene: sceneTrust,
        lines: [
            "• Full keyboard navigation, focus rings, and high-contrast support.",
            "• Colorblind-safe defaults and deterministic output for repeatable review.",
            "• Report data stays in the Power BI sandbox—no external tiles, images, or analytics calls.",
            "Built for finance, healthcare, government, security, and other governed environments.",
        ],
    },
];

interface LandingActions {
    onSupport?: () => void;
    onLinkedIn?: () => void;
}

export class LandingPage {
    private root: HTMLElement;
    private host?: HTMLElement;
    private page = 0;
    private surface: Surface = {
        bg: "#FFFFFF", fg: "#15161E", muted: "#54566B",
        nodeDefault: "#6344E0", edge: "#8A8C9E",
    };
    private cleanups: Cleanup[] = [];

    constructor(root: HTMLElement, private actions: LandingActions = {}) {
        this.root = root;
        this.injectStyle();
    }

    setTheme(surface: Surface): void {
        this.surface = surface;
        if (this.host) {
            this.applyTheme();
            this.render();
        }
    }

    show(): void {
        if (this.host) {
            this.render();
            return;
        }
        if (getComputedStyle(this.root).position === "static") this.root.style.position = "relative";
        const host = document.createElement("div");
        host.className = "zx-lp";
        host.setAttribute("role", "region");
        host.setAttribute("aria-label", "Getting started with Zentrix Network Graph");
        host.tabIndex = 0;
        this.root.appendChild(host);
        this.host = host;
        this.applyTheme();

        const onKey = (event: KeyboardEvent) => {
            if (event.key === "ArrowRight") { this.go(1); event.preventDefault(); }
            else if (event.key === "ArrowLeft") { this.go(-1); event.preventDefault(); }
        };
        host.addEventListener("keydown", onKey);
        this.cleanups.push(() => host.removeEventListener("keydown", onKey));

        this.page = 0;
        this.render();
    }

    hide(): void {
        for (const cleanup of this.cleanups) cleanup();
        this.cleanups = [];
        if (this.host) {
            this.host.remove();
            this.host = undefined;
        }
    }

    private applyTheme(): void {
        if (!this.host) return;
        const dark = isDark(this.surface.bg);
        this.host.setAttribute("data-theme", dark ? "dark" : "light");
        this.host.style.setProperty("--lp-fg", this.surface.fg);
        this.host.style.setProperty("--lp-muted", this.surface.muted);
        this.host.style.setProperty("--lp-canvas", this.surface.bg);
    }

    private go(delta: number): void {
        const next = this.page + delta;
        if (next < 0 || next >= PAGES.length) return;
        this.page = next;
        this.render();
    }

    private render(): void {
        if (!this.host) return;
        const host = this.host;
        while (host.firstChild) host.removeChild(host.firstChild);
        const page = PAGES[this.page];
        const context: SceneContext = { dark: isDark(this.surface.bg), surface: this.surface };

        const card = el("div", "zx-lp-card");
        const art = el("div", "zx-lp-art");
        const artInner = el("div", "zx-lp-art-inner");
        let scene: SVGSVGElement;
        try { scene = page.scene(context); } catch { scene = sceneWelcome(context); }
        artInner.appendChild(scene);
        art.appendChild(artInner);
        card.appendChild(art);

        const content = el("div", "zx-lp-content");
        const brand = el("div", "zx-lp-brand");
        brand.appendChild(brandGlyph(context.dark));
        brand.appendChild(textEl("span", "zx-lp-brandname", "ZENTRIX"));
        brand.appendChild(textEl("span", "zx-lp-ver", "v" + VERSION));
        content.appendChild(brand);
        content.appendChild(textEl("div", "zx-lp-eyebrow", page.eyebrow));
        content.appendChild(textEl("h2", "zx-lp-title", page.title));

        const body = el("div", "zx-lp-body");
        page.lines.forEach((line) => {
            if (line.startsWith("• ")) {
                const row = el("div", "zx-lp-bullet");
                row.appendChild(textEl("span", "zx-lp-tick", "✓"));
                row.appendChild(textEl("span", "zx-lp-bulltext", line.slice(2)));
                body.appendChild(row);
            } else {
                body.appendChild(textEl("p", "zx-lp-line", line));
            }
        });
        content.appendChild(body);

        if (this.page === 0) {
            const actions = el("div", "zx-lp-cta-row");
            const support = actionButton(
                "zx-lp-cta zx-lp-cta-primary",
                "Contact us",
                "support@zentrixstudio.in",
                () => this.actions.onSupport?.(),
            );
            support.setAttribute("data-action", "support");
            support.setAttribute("aria-label", "Contact Zentrix support at support@zentrixstudio.in");
            actions.appendChild(support);
            const linkedIn = actionButton(
                "zx-lp-cta",
                "Follow us",
                "LinkedIn",
                () => this.actions.onLinkedIn?.(),
            );
            linkedIn.setAttribute("data-action", "linkedin");
            linkedIn.setAttribute("aria-label", "Follow Zentrix Studio on LinkedIn; opens a new tab");
            actions.appendChild(linkedIn);
            content.appendChild(actions);
        }

        const footer = el("div", "zx-lp-footer");
        const previous = button("zx-lp-nav", "‹ Back", () => this.go(-1));
        previous.disabled = this.page === 0;
        footer.appendChild(previous);

        const dots = el("div", "zx-lp-dots");
        PAGES.forEach((_, index) => {
            const dot = el("button", "zx-lp-pip" + (index === this.page ? " is-on" : ""));
            dot.setAttribute("aria-label", `Page ${index + 1} of ${PAGES.length}`);
            dot.addEventListener("click", () => { this.page = index; this.render(); });
            dots.appendChild(dot);
        });
        footer.appendChild(dots);

        const last = this.page === PAGES.length - 1;
        const next = button(
            "zx-lp-nav zx-lp-next",
            last ? "Add fields to begin" : "Next ›",
            () => { if (!last) this.go(1); },
        );
        next.disabled = last;
        footer.appendChild(next);
        content.appendChild(footer);

        card.appendChild(content);
        host.appendChild(card);
    }

    private injectStyle(): void {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = LANDING_CSS;
        (document.head || document.documentElement).appendChild(style);
    }
}

function isDark(color: string): boolean {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) return false;
    const value = match[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function el(tag: string, className: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    return element;
}

function textEl(tag: string, className: string, text: string): HTMLElement {
    const element = el(tag, className);
    element.textContent = text;
    return element;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = className;
    element.type = "button";
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
}

function actionButton(
    className: string, label: string, detail: string, onClick: () => void,
): HTMLButtonElement {
    const element = document.createElement("button");
    element.className = className;
    element.type = "button";
    element.appendChild(textEl("span", "zx-lp-cta-label", label));
    element.appendChild(textEl("span", "zx-lp-cta-detail", detail));
    element.addEventListener("click", onClick);
    return element;
}

/** Zentrix Network Graph brand mark — the hub-and-satellites logo, matched to the
 *  visual icon (assets/icon.svg) and the 300×300 store logo. Multi-colour; the hub
 *  tint adapts to the theme so it reads on both the light and dark landing cards. */
function brandGlyph(dark: boolean): SVGSVGElement {
    const svg = svgNode("0 0 24 24", 18, 18);
    // [x, y, r, colour] — six satellites around a central hub (logo geometry, /12.5 scale)
    const sat: Array<[number, number, number, string]> = [
        [8.4, 6.5, 2.1, "#48C9A3"],   // teal
        [15.8, 6.1, 1.95, "#F2CB4E"], // gold
        [18.2, 12, 1.95, "#F0925C"],  // orange
        [15.2, 17.3, 2.1, "#D95B93"], // magenta
        [9.0, 17.4, 1.8, "#5FB86A"],  // green
        [5.8, 12.2, 1.95, "#5B9BE5"], // blue
    ];
    const edge = dark ? "#6E7488" : "#9AA0B4";
    sat.forEach(([x, y]) => svg.appendChild(lineNode(12, 12, x, y, edge, 1.3)));
    // perimeter links (blue→teal, orange→magenta) matching the logo
    svg.appendChild(lineNode(5.8, 12.2, 8.4, 6.5, edge, 1.3));
    svg.appendChild(lineNode(18.2, 12, 15.2, 17.3, edge, 1.3));
    sat.forEach(([x, y, r, color]) => svg.appendChild(circleNode(x, y, r, color)));
    svg.appendChild(circleNode(12, 12, 3.1, dark ? "#8B6EF7" : "#6A4BE0"));
    return svg;
}

const LANDING_CSS = `
.zx-lp{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:18px;box-sizing:border-box;overflow:auto;z-index:5;
  font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
  --lp-fg:#15161E;--lp-muted:#54566B;--lp-sub:#8A8C9E;--lp-accent:#7C5CFF;
  --lp-soft:rgba(124,92,255,.12);--lp-border:rgba(20,23,50,.09);--lp-card:#FFFFFF;
  --lp-art-a:#F3EFFE;--lp-art-b:#E3EAFD;--lp-canvas:#FFFFFF;
  background:radial-gradient(120% 120% at 100% 0%,rgba(124,92,255,.10),transparent 55%),
             radial-gradient(120% 120% at 0% 100%,rgba(77,163,255,.08),transparent 55%),var(--lp-canvas);}
.zx-lp[data-theme="dark"]{--lp-sub:#70707F;--lp-soft:rgba(124,92,255,.20);
  --lp-border:rgba(255,255,255,.10);--lp-card:#15151F;--lp-art-a:#1B1633;--lp-art-b:#101827;
  background:radial-gradient(120% 120% at 100% 0%,rgba(124,92,255,.16),transparent 55%),
             radial-gradient(120% 120% at 0% 100%,rgba(77,163,255,.10),transparent 55%),var(--lp-canvas);}
.zx-lp-card{width:min(960px,100%);height:min(520px,100%);min-height:0;display:flex;
  background:var(--lp-card);border:1px solid var(--lp-border);border-radius:20px;overflow:hidden;
  box-shadow:0 24px 60px -24px rgba(16,24,64,.34);box-sizing:border-box;}
.zx-lp-art{flex:1 1 46%;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;
  padding:26px 24px;box-sizing:border-box;overflow:hidden;
  background:linear-gradient(150deg,var(--lp-art-a),var(--lp-art-b));}
.zx-lp-art-inner{flex:1;min-width:0;min-height:0;align-self:stretch;display:flex;
  align-items:center;justify-content:center;}
.zx-lp-art-inner svg{width:100%!important;height:100%!important;
  filter:drop-shadow(0 10px 22px rgba(80,50,180,.16));}
.zx-lp-content{flex:1 1 54%;min-width:0;min-height:0;display:flex;flex-direction:column;
  padding:26px 30px 18px;box-sizing:border-box;overflow:hidden;}
@media (max-width:560px){.zx-lp-art{display:none}.zx-lp-content{flex:1 1 100%}}
.zx-lp-brand{display:flex;align-items:center;gap:7px;color:var(--lp-accent);margin-bottom:16px;}
.zx-lp-brandname{font-size:11px;font-weight:700;letter-spacing:2.5px;}
.zx-lp-ver{font-size:10px;font-weight:600;letter-spacing:.5px;opacity:.5;}
.zx-lp-eyebrow{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--lp-accent);margin-bottom:7px;}
.zx-lp-title{font-size:25px;font-weight:800;color:var(--lp-fg);margin:0 0 16px;line-height:1.18;
  letter-spacing:-.3px;}
.zx-lp-body{flex:1;min-height:0;overflow-y:auto;}
.zx-lp-line{font-size:14px;line-height:1.55;color:var(--lp-muted);margin:0 0 10px;}
.zx-lp-bullet{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;}
.zx-lp-tick{flex:none;width:18px;height:18px;border-radius:50%;background:var(--lp-soft);
  color:var(--lp-accent);font-size:11px;font-weight:800;display:grid;place-items:center;margin-top:1px;}
.zx-lp-bulltext{font-size:13.5px;line-height:1.5;color:var(--lp-muted);}
.zx-lp-cta-row{display:flex;gap:9px;align-items:stretch;margin-top:5px;}
.zx-lp-cta{appearance:none;flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;
  gap:2px;padding:9px 11px;border:1px solid var(--lp-border);border-radius:10px;background:transparent;
  color:var(--lp-fg);font-family:inherit;cursor:pointer;text-align:left;transition:.15s;}
.zx-lp-cta:hover,.zx-lp-cta:focus-visible{border-color:var(--lp-accent);background:var(--lp-soft);outline:none;}
.zx-lp-cta-primary{background:var(--lp-accent);border-color:var(--lp-accent);color:#FFF;
  box-shadow:0 6px 16px -7px rgba(124,92,255,.7);}
.zx-lp-cta-primary:hover,.zx-lp-cta-primary:focus-visible{background:var(--lp-accent);filter:brightness(1.06);}
.zx-lp-cta-label{font-size:12px;font-weight:750;line-height:1.2;}
.zx-lp-cta-detail{max-width:100%;font-size:9.5px;font-weight:550;line-height:1.25;opacity:.74;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.zx-lp-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-top:18px;padding-top:16px;border-top:1px solid var(--lp-border);}
.zx-lp-nav{appearance:none;border:1px solid var(--lp-border);background:transparent;
  color:var(--lp-muted);font:600 12.5px inherit;padding:8px 14px;border-radius:10px;
  cursor:pointer;transition:.15s;white-space:nowrap;}
.zx-lp-nav:hover:not(:disabled),.zx-lp-nav:focus-visible{color:var(--lp-fg);border-color:var(--lp-accent);outline:none;}
.zx-lp-nav:disabled{opacity:0;pointer-events:none;}
.zx-lp-next{background:var(--lp-accent);border-color:var(--lp-accent);color:#FFF;
  box-shadow:0 6px 16px -6px rgba(124,92,255,.7);}
.zx-lp-next:hover:not(:disabled){filter:brightness(1.07);color:#FFF;}
.zx-lp-next:disabled{opacity:.6;background:var(--lp-soft);border-color:transparent;
  color:var(--lp-accent);box-shadow:none;}
.zx-lp-dots{display:flex;gap:7px;align-items:center;}
.zx-lp-pip{width:7px;height:7px;border-radius:50%;border:0;padding:0;cursor:pointer;
  background:var(--lp-border);transition:.2s;}
.zx-lp-pip:focus-visible{outline:2px solid var(--lp-accent);outline-offset:3px;}
.zx-lp-pip.is-on{background:var(--lp-accent);width:22px;border-radius:4px;}
@media (prefers-reduced-motion:no-preference){
  .zx-lp-node{transform-box:fill-box;transform-origin:center;
    animation:zxLpNode .42s cubic-bezier(.2,.7,.3,1) backwards;}
  .zx-lp-edge{animation:zxLpEdge .4s ease backwards;}
  .zx-lp-pulse{animation:zxLpPulse 1.8s ease-in-out infinite;}
  .zx-lp-card{animation:zxLpCard .4s cubic-bezier(.2,.7,.3,1);}
  @keyframes zxLpNode{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
  @keyframes zxLpEdge{from{opacity:0}to{opacity:1}}
  @keyframes zxLpPulse{0%,100%{opacity:.55}50%{opacity:1}}
  @keyframes zxLpCard{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
}
`;
