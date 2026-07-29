"use strict";

/**
 * Full node information shown only when Nodes → On click → Show full info is enabled.
 * DOM is built with createElement + textContent so report-authored values never reach
 * an HTML sink.
 */

import { GraphModel } from "../model/graphTypes";
import { NeighborConnection } from "../model/graphModel";
import { NodeInfoField } from "../types";
import { Surface, fontFamily, accent } from "../theme/zentrixTokens";

export class DetailPanel {
    private el: HTMLDivElement;
    private open = false;

    constructor(host: HTMLElement, private onClose: () => void) {
        this.el = document.createElement("div");
        this.el.className = "zx-detail";
        this.el.setAttribute("role", "region");
        this.el.setAttribute("aria-label", "Node details");
        const style = this.el.style;
        style.position = "absolute";
        style.top = "0";
        style.right = "0";
        style.bottom = "0";
        style.width = "320px";
        style.maxWidth = "92%";
        style.zIndex = "18";
        style.display = "none";
        style.padding = "0";
        style.boxSizing = "border-box";
        style.font = `12px ${fontFamily}`;
        style.overflowY = "auto";
        style.boxShadow = "-10px 0 28px rgba(20,22,36,0.12)";
        host.appendChild(this.el);
    }

    setTheme(surface: Surface): void {
        this.el.style.background = surface.bg;
        this.el.style.color = surface.fg;
        this.el.style.borderLeft = `1px solid ${surface.edge}`;
    }

    isOpen(): boolean { return this.open; }

    show(
        model: GraphModel,
        i: number,
        connections: NeighborConnection[],
        businessFields: NodeInfoField[],
        surface: Surface,
    ): void {
        this.clear();
        const node = model.nodes[i];
        const panelAccent = surface.selected || (surface.edge === surface.fg ? surface.fg : accent);

        const accentBar = document.createElement("div");
        accentBar.className = "zx-detail-accent";
        accentBar.style.height = "5px";
        accentBar.style.background = panelAccent;
        this.el.appendChild(accentBar);

        const body = document.createElement("div");
        body.style.padding = "22px 20px 24px";
        this.el.appendChild(body);

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "flex-start";
        header.style.gap = "16px";

        const heading = document.createElement("div");
        const eyebrow = document.createElement("div");
        eyebrow.textContent = "NODE DETAILS";
        eyebrow.style.color = surface.muted;
        eyebrow.style.fontSize = "10px";
        eyebrow.style.fontWeight = "700";
        eyebrow.style.letterSpacing = "1.4px";
        const title = document.createElement("div");
        title.className = "zx-detail-title";
        title.style.marginTop = "5px";
        title.style.fontWeight = "750";
        title.style.fontSize = "22px";
        title.style.lineHeight = "1.15";
        title.style.overflowWrap = "anywhere";
        title.textContent = node.label;
        heading.appendChild(eyebrow);
        heading.appendChild(title);

        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.setAttribute("aria-label", "Close details");
        close.style.cursor = "pointer";
        close.style.width = "30px";
        close.style.height = "30px";
        close.style.flex = "0 0 30px";
        close.style.border = `1px solid ${surface.edge}`;
        close.style.borderRadius = "8px";
        close.style.background = "transparent";
        close.style.color = surface.muted;
        close.style.fontSize = "22px";
        close.style.lineHeight = "24px";
        close.onclick = (event) => { event.stopPropagation(); this.onClose(); };
        header.appendChild(heading);
        header.appendChild(close);
        body.appendChild(header);

        if (businessFields.length) {
            this.sectionHeading(body, "Business details", surface);
            const fields = document.createElement("div");
            fields.className = "zx-detail-business";
            fields.style.border = `1px solid ${surface.edge}`;
            fields.style.borderRadius = "12px";
            fields.style.overflow = "hidden";
            businessFields.forEach((field) => this.fieldRow(fields, field.name, field.value, surface));
            body.appendChild(fields);
        }

        this.sectionHeading(body, "Network overview", surface);
        const grid = document.createElement("div");
        grid.className = "zx-detail-metrics";
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
        grid.style.border = `1px solid ${surface.edge}`;
        grid.style.borderRadius = "12px";
        grid.style.overflow = "hidden";
        this.stat(grid, "Connections", String(node.degree), surface);
        this.stat(grid, "Incoming", String(node.inDegree), surface);
        this.stat(grid, "Outgoing", String(node.outDegree), surface);
        body.appendChild(grid);

        const strength = document.createElement("div");
        strength.className = "zx-detail-strength";
        strength.style.display = "flex";
        strength.style.justifyContent = "space-between";
        strength.style.alignItems = "baseline";
        strength.style.marginTop = "10px";
        strength.style.padding = "12px 14px";
        strength.style.border = `1px solid ${surface.edge}`;
        strength.style.borderRadius = "10px";
        const strengthLabel = document.createElement("span");
        strengthLabel.textContent = "Connection strength";
        strengthLabel.style.color = surface.muted;
        const strengthValue = document.createElement("strong");
        strengthValue.textContent = round(node.weightedDegree);
        strengthValue.style.fontSize = "18px";
        strength.appendChild(strengthLabel);
        strength.appendChild(strengthValue);
        body.appendChild(strength);

        if (connections.length) {
            this.sectionHeading(body, "Top connections", surface);
            const list = document.createElement("div");
            list.className = "zx-detail-connections";
            for (const connection of connections) {
                const row = document.createElement("div");
                row.className = "zx-detail-connection";
                row.style.display = "grid";
                row.style.gridTemplateColumns = "minmax(0, 1fr) auto";
                row.style.gap = "12px";
                row.style.padding = "10px 0";
                row.style.borderBottom = `1px solid ${surface.edge}`;

                const copy = document.createElement("div");
                copy.style.minWidth = "0";
                const name = document.createElement("div");
                name.style.fontSize = "13px";
                name.style.fontWeight = "700";
                name.style.overflowWrap = "anywhere";
                name.textContent = connection.label;
                const phrase = document.createElement("div");
                phrase.className = "zx-relationship-phrase";
                phrase.style.marginTop = "3px";
                phrase.style.color = surface.muted;
                phrase.style.lineHeight = "1.35";
                phrase.style.overflowWrap = "anywhere";
                phrase.textContent = connection.phrase;
                copy.appendChild(name);
                copy.appendChild(phrase);

                const weight = document.createElement("strong");
                weight.style.color = panelAccent;
                weight.style.fontSize = "14px";
                weight.textContent = round(connection.weight);
                row.appendChild(copy);
                row.appendChild(weight);
                list.appendChild(row);
            }
            body.appendChild(list);
        }

        this.setTheme(surface);
        this.el.style.display = "block";
        this.open = true;
    }

    hide(): void {
        this.el.style.display = "none";
        this.open = false;
    }

    private clear(): void {
        while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    }

    private sectionHeading(parent: HTMLElement, text: string, surface: Surface): void {
        const heading = document.createElement("div");
        heading.textContent = text.toUpperCase();
        heading.style.margin = "24px 0 9px";
        heading.style.color = surface.muted;
        heading.style.fontSize = "10px";
        heading.style.fontWeight = "700";
        heading.style.letterSpacing = "1.3px";
        parent.appendChild(heading);
    }

    private fieldRow(parent: HTMLElement, label: string, value: string, surface: Surface): void {
        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "minmax(90px, .8fr) minmax(0, 1fr)";
        row.style.gap = "12px";
        row.style.padding = "10px 12px";
        if (parent.childElementCount) row.style.borderTop = `1px solid ${surface.edge}`;
        const name = document.createElement("span");
        name.style.color = surface.muted;
        name.textContent = label;
        const fieldValue = document.createElement("strong");
        fieldValue.style.textAlign = "right";
        fieldValue.style.overflowWrap = "anywhere";
        fieldValue.textContent = value;
        row.appendChild(name);
        row.appendChild(fieldValue);
        parent.appendChild(row);
    }

    private stat(parent: HTMLElement, label: string, value: string, surface: Surface): void {
        const cell = document.createElement("div");
        cell.style.padding = "12px 8px";
        cell.style.textAlign = "center";
        if (parent.childElementCount) cell.style.borderLeft = `1px solid ${surface.edge}`;
        const name = document.createElement("div");
        name.style.color = surface.muted;
        name.style.fontSize = "9px";
        name.style.fontWeight = "700";
        name.style.letterSpacing = ".8px";
        name.textContent = label.toUpperCase();
        const statValue = document.createElement("strong");
        statValue.style.display = "block";
        statValue.style.marginTop = "7px";
        statValue.style.fontSize = "22px";
        statValue.textContent = value;
        cell.appendChild(name);
        cell.appendChild(statValue);
        parent.appendChild(cell);
    }
}

function round(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
