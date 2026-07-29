"use strict";

/**
 * Rich node hover card plus compact edge tooltip. Node information uses business-
 * readable names, author-bound fields, and directional relationship phrases.
 */

import { GraphModel } from "../model/graphTypes";
import { NeighborConnection } from "../model/graphModel";
import { NodeInfoField, NodeInfoMode } from "../types";
import { ZentrixOverlayTooltip, OverlayTheme, OverlayContent } from "./zentrixOverlayTooltip";
import { Surface, fontFamily, accent, accentStrong, posSafe, negSafe } from "../theme/zentrixTokens";

const TOOLTIP_SANS = "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif";
const TOOLTIP_DISPLAY = "Georgia, 'Times New Roman', serif";
const TOOLTIP_LABEL = "ui-monospace, 'SFMono-Regular', Consolas, monospace";

export class GraphTooltip {
    private tip: ZentrixOverlayTooltip;
    private nodeTip: HTMLDivElement;
    private surface = defaultSurface();
    private dark = false;
    private brandingOn = true;

    constructor(root: HTMLElement) {
        // Create the rich card first so generic fixed-overlay discovery also resolves the
        // primary node card. The shared primitive remains the compact edge tooltip.
        this.nodeTip = document.createElement("div");
        this.nodeTip.className = "zx-node-tooltip";
        this.nodeTip.style.cssText =
            "position:fixed;pointer-events:none;z-index:1000;display:none;" +
            "width:266px;max-width:calc(100vw - 16px);box-sizing:border-box;" +
            "overflow:hidden;border-radius:12px;box-shadow:0 8px 28px rgba(20,22,36,.14);";
        root.appendChild(this.nodeTip);
        this.tip = new ZentrixOverlayTooltip(root, { theme: theme(this.surface, false) });
    }

    setTheme(surface: Surface, dark: boolean, brandingOn: boolean): void {
        this.surface = surface;
        this.dark = dark;
        this.brandingOn = brandingOn;
        this.tip.setTheme(theme(surface, dark));
        this.tip.setBranding(brandingOn);
    }

    show(
        model: GraphModel,
        i: number,
        clientX: number,
        clientY: number,
        centrality: { label: string; value: number } | null,
        businessFields: NodeInfoField[],
        mode: NodeInfoMode,
        connections: NeighborConnection[],
        context?: {
            accentColor?: string;
            category?: string | null;
            connectionColor?: (key: string) => string;
            showClickHint?: boolean;
        },
    ): void {
        this.tip.hide();
        clear(this.nodeTip);
        const t = this.surface;
        const n = model.nodes[i];
        const hasBusiness = businessFields.length > 0;
        const showBusiness = mode !== "network" && hasBusiness;
        const showNetwork = mode !== "business" || !hasBusiness;
        const cardAccent = context?.accentColor || accent;
        const category = String(context?.category ?? "").trim();
        const line = separator(t);

        this.nodeTip.style.background = t.bg;
        this.nodeTip.style.color = t.fg;
        this.nodeTip.style.fontFamily = TOOLTIP_SANS;
        this.nodeTip.style.border = `1px solid ${line}`;

        const bar = div("height:4px");
        bar.className = "zx-node-tooltip-accent";
        bar.style.background = cardAccent;
        this.nodeTip.appendChild(bar);

        const header = div("padding:13px 16px 12px;display:flex;justify-content:space-between;gap:10px;align-items:center");
        const heading = div("min-width:0");
        const title = div(`font-family:${TOOLTIP_DISPLAY};font-size:18px;font-weight:700;line-height:1.1;overflow-wrap:anywhere`, n.label);
        title.className = "zx-node-tooltip-title";
        heading.appendChild(title);
        if (showBusiness && businessFields[0]) {
            const subtitle = div(`margin-top:4px;font-size:11px;line-height:1.25;color:${t.muted}`);
            subtitle.appendChild(span(
                "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0",
                businessFields[0].name,
            ));
            subtitle.appendChild(span("", businessFields[0].value));
            heading.appendChild(subtitle);
        } else {
            heading.appendChild(div(`margin-top:4px;font-size:11px;line-height:1.25;color:${t.muted}`, "Network entity"));
        }
        header.appendChild(heading);
        if (category) {
            const badge = div(
                `padding:5px 8px;border:1px solid ${line};border-radius:999px;` +
                `font-size:10px;font-weight:650;color:${t.muted};white-space:nowrap;` +
                "display:flex;align-items:center;gap:6px",
            );
            badge.className = "zx-node-tooltip-category";
            badge.appendChild(span(`width:8px;height:8px;border-radius:2px;background:${cardAccent};display:inline-block`, ""));
            badge.appendChild(span("", category));
            header.appendChild(badge);
        }
        this.nodeTip.appendChild(header);

        if (showNetwork) {
            const grid = div(`display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid ${line};border-bottom:1px solid ${line}`);
            grid.className = "zx-node-tooltip-metrics";
            this.metricCell(grid, "Connections", String(n.degree), t);
            this.metricCell(grid, "Incoming", String(n.inDegree), t);
            this.metricCell(grid, "Outgoing", String(n.outDegree), t);
            this.nodeTip.appendChild(grid);

            const strength = div("padding:11px 16px 10px");
            const strengthRow = div("display:flex;align-items:baseline;justify-content:space-between;gap:8px");
            const label = div(`font-family:${TOOLTIP_LABEL};font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${t.muted}`,
                "Connection strength");
            const value = div(`font-family:${TOOLTIP_DISPLAY};font-size:18px;font-weight:700;color:${this.dark ? t.fg : cardAccent}`, round(n.weightedDegree));
            strengthRow.appendChild(label);
            strengthRow.appendChild(value);
            strength.appendChild(strengthRow);
            const rank = rankByConnections(model, i);
            const rankLine = centrality
                ? `${centrality.label}: ${round(centrality.value)} · ${rank}`
                : rank;
            strength.appendChild(div(`margin-top:1px;font-size:10px;text-align:right;color:${t.muted}`, rankLine));
            const maxStrength = model.nodes.reduce((max, node) => Math.max(max, node.weightedDegree), 0);
            const fill = maxStrength > 0 ? Math.max(4, Math.min(100, (n.weightedDegree / maxStrength) * 100)) : 0;
            const track = div(`height:6px;margin-top:7px;border-radius:999px;background:${alpha(cardAccent, .16)};overflow:hidden`);
            track.className = "zx-node-tooltip-strength-track";
            const progress = div(`width:${fill}%;height:100%;border-radius:inherit;background:${cardAccent}`);
            progress.className = "zx-node-tooltip-strength-fill";
            track.appendChild(progress);
            strength.appendChild(track);
            this.nodeTip.appendChild(strength);
        }

        if (showBusiness) {
            const remainingFields = businessFields.slice(1, 5).filter((field) => field.value !== category);
            if (remainingFields.length) {
                const section = div(`padding:10px 16px 11px;border-top:1px solid ${line}`);
                section.appendChild(sectionLabel("Business details", t));
                const fields = div("margin-top:5px");
                remainingFields.forEach((field) => {
                    const row = div("display:grid;grid-template-columns:minmax(72px,.75fr) minmax(0,1fr);gap:9px;padding:3px 0");
                    row.className = "zx-node-tooltip-business-row";
                    row.appendChild(div(`font-size:10px;color:${t.muted}`, field.name));
                    row.appendChild(div("font-size:10px;font-weight:650;text-align:right;overflow-wrap:anywhere", field.value));
                    fields.appendChild(row);
                });
                section.appendChild(fields);
                this.nodeTip.appendChild(section);
            }
        }

        if (connections.length) {
            const section = div(`padding:10px 16px 11px;border-top:1px solid ${line}`);
            section.appendChild(sectionLabel("Top connections", t));
            const list = div("margin-top:5px");
            for (const connection of connections.slice(0, 3)) {
                const row = div(
                    "display:grid;grid-template-columns:8px minmax(0,1fr) auto;" +
                    "column-gap:8px;padding:4px 0;align-items:start",
                );
                row.className = "zx-node-tooltip-connection";
                const dot = span(
                    `width:8px;height:8px;margin-top:2px;border-radius:50%;display:block;` +
                    `background:${context?.connectionColor?.(connection.key) || cardAccent}`,
                    "",
                );
                dot.className = "zx-node-tooltip-connection-dot";
                row.appendChild(dot);
                const copy = div("min-width:0");
                copy.appendChild(div("font-size:11px;font-weight:700", connection.label));
                const phrase = div(`margin-top:1px;font-size:9.5px;line-height:1.25;color:${t.muted};overflow-wrap:anywhere`, connection.phrase);
                phrase.className = "zx-relationship-phrase";
                copy.appendChild(phrase);
                row.appendChild(copy);
                row.appendChild(div(`font-family:${TOOLTIP_DISPLAY};font-size:12px;font-weight:700;color:${this.dark ? t.fg : cardAccent}`, round(connection.weight)));
                list.appendChild(row);
            }
            if (n.degree > connections.slice(0, 3).length) {
                list.appendChild(div(`margin-top:3px;font-size:10px;color:${t.muted}`,
                    `+ ${Math.max(0, n.degree - connections.slice(0, 3).length)} more connections`));
            }
            section.appendChild(list);
            this.nodeTip.appendChild(section);
        }

        if (context?.showClickHint || this.brandingOn) {
            const footer = div(
                `padding:9px 16px;border-top:1px solid ${line};background:${alpha(t.edge, .07)};display:flex;` +
                `justify-content:${context?.showClickHint && this.brandingOn ? "space-between" : context?.showClickHint ? "flex-start" : "flex-end"};` +
                `align-items:center;font-size:9.5px;color:${t.muted}`,
            );
            if (context?.showClickHint) footer.appendChild(div("", "Click node for full details"));
            if (this.brandingOn) footer.appendChild(div("font-weight:650;opacity:.75", "Zentrix"));
            this.nodeTip.appendChild(footer);
        }

        this.nodeTip.style.display = "block";
        this.moveNode(clientX, clientY);
    }

    /** Edge/link tooltip — compact because the relationship itself is the subject. */
    showEdge(
        edge: { source: string; target: string; weight: number; type?: string | null },
        clientX: number, clientY: number,
        extra?: { name: string; value: string }[],
    ): void {
        this.nodeTip.style.display = "none";
        const rows: NonNullable<OverlayContent["rows"]> = [
            { name: "Source", value: edge.source },
            { name: "Target", value: edge.target },
            { name: "Connection strength", value: round(edge.weight) },
        ];
        if (edge.type != null && edge.type !== "") rows.push({ name: "Relationship", value: String(edge.type) });
        if (extra) for (const r of extra) rows.push(r);
        this.tip.show({ title: edgePhrase(edge), rows }, clientX, clientY);
    }

    move(clientX: number, clientY: number): void {
        this.moveNode(clientX, clientY);
        this.tip.move(clientX, clientY);
    }

    hide(): void {
        this.nodeTip.style.display = "none";
        this.tip.hide();
    }

    private metricCell(parent: HTMLElement, label: string, value: string, surface: Surface): void {
        const divider = parent.childElementCount < 2 ? `border-right:1px solid ${separator(surface)}` : "";
        const cell = div(`padding:10px 5px 9px;text-align:center;${divider}`);
        const name = div(`font-family:${TOOLTIP_LABEL};font-size:8px;font-weight:700;letter-spacing:.85px;text-transform:uppercase;color:${surface.muted}`, label);
        const val = div(`margin-top:4px;font-family:${TOOLTIP_DISPLAY};font-size:19px;font-weight:700`, value);
        cell.appendChild(name);
        cell.appendChild(val);
        parent.appendChild(cell);
    }

    private moveNode(clientX: number, clientY: number): void {
        if (this.nodeTip.style.display !== "block") return;
        const pad = 14;
        const rect = this.nodeTip.getBoundingClientRect();
        let left = clientX + pad, top = clientY + pad;
        if (left + rect.width > window.innerWidth) left = clientX - rect.width - pad;
        if (top + rect.height > window.innerHeight) top = clientY - rect.height - pad;
        this.nodeTip.style.left = Math.max(2, left) + "px";
        this.nodeTip.style.top = Math.max(2, top) + "px";
    }
}

function sectionLabel(text: string, surface: Surface): HTMLDivElement {
    return div(`font-family:${TOOLTIP_LABEL};font-size:8.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${surface.muted}`, text);
}

function separator(surface: Surface): string {
    return surface.edge === surface.fg && surface.muted === surface.fg
        ? surface.edge
        : alpha(surface.edge, .22);
}

function alpha(color: string, opacity: number): string {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (!hex) return color;
    const a = Math.max(0, Math.min(255, Math.round(opacity * 255))).toString(16).padStart(2, "0");
    return `#${hex[1]}${a}`;
}

function edgePhrase(edge: { source: string; target: string; type?: string | null }): string {
    const type = String(edge.type ?? "").trim();
    if (!type) return `${edge.source} connects to ${edge.target}`;
    if (["report", "reports", "reports to"].includes(type.toLowerCase())) {
        return `${edge.source} reports to ${edge.target}`;
    }
    return `${edge.source} relates to ${edge.target} as ${type}`;
}

function rankByConnections(model: GraphModel, i: number): string {
    const sorted = model.nodes.map((n, idx) => ({ idx, degree: n.degree }))
        .sort((a, b) => (b.degree - a.degree) || (a.idx - b.idx));
    const rank = sorted.findIndex((entry) => entry.idx === i) + 1;
    return `#${rank} of ${model.nodes.length} by connections`;
}

function theme(s: Surface, dark: boolean): OverlayTheme {
    return {
        dark,
        bg: s.bg, fg: s.fg, muted: s.muted, strong: dark ? s.fg : accentStrong,
        accent, pos: posSafe, neg: negSafe, fontFamily, radius: 10,
    };
}

function defaultSurface(): Surface {
    return { bg: "#FFFFFF", fg: "#15161E", muted: "#54566B", nodeDefault: "#6344E0", edge: "#8A8C9E" };
}

function div(style: string, text?: string): HTMLDivElement {
    const el = document.createElement("div");
    if (style) el.style.cssText = style;
    if (text != null) el.textContent = text;
    return el;
}

function span(style: string, text: string): HTMLSpanElement {
    const el = document.createElement("span");
    if (style) el.style.cssText = style;
    el.textContent = text;
    return el;
}

function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function round(n: number): string {
    return String(Math.round(n * 100) / 100);
}
