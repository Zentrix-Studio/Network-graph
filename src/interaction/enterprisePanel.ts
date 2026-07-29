"use strict";

/**
 * Enterprise control panel — houses Explore (E3) and Path analysis (E5). A
 * left-side DOM overlay with node pickers, shown only when those features are on
 * and the premium gate is active. Built with createElement + textContent —
 * never innerHTML.
 */

import { Surface, accent, fontFamily } from "../theme/zentrixTokens";

export interface EnterprisePanelCallbacks {
    onExploreFocus: (key: string | null) => void;
    onExploreHops: (hops: number) => void;
    onPathChange: (source: string | null, target: string | null) => void;
    onSearch: (term: string) => void;
    onClosePanel: () => void;
}

export class EnterprisePanel {
    private el: HTMLDivElement;
    private findSection!: HTMLDivElement;
    private searchInput!: HTMLInputElement;
    private exploreSection!: HTMLDivElement;
    private pathSection!: HTMLDivElement;
    private focusSelect!: HTMLSelectElement;
    private hopsInput!: HTMLInputElement;
    private breadcrumb!: HTMLDivElement;
    private srcSelect!: HTMLSelectElement;
    private tgtSelect!: HTMLSelectElement;
    private pathResult!: HTMLDivElement;
    private head!: HTMLDivElement;
    private body!: HTMLDivElement;
    private closePanel!: HTMLButtonElement;
    private nodeKeys: string[] = [];
    /** Last configure() request, replayed when focus mode exits (NG-118). */
    private cfg = { find: false, explore: false, path: false };
    /** Force-hidden by focus mode, independent of which sections are enabled. */
    private chromeHidden = false;
    /** Find / Explore / Path operate on graph geometry and are meaningless in
     * Table or Insight, so alternate views suppress the card without losing state. */
    private graphViewActive = true;

    constructor(host: HTMLElement, private cb: EnterprisePanelCallbacks) {
        this.el = document.createElement("div");
        this.el.className = "zx-enterprise";
        const s = this.el.style;
        s.position = "absolute";
        s.left = "10px";
        s.top = "10px";
        s.width = "248px";
        s.maxWidth = "calc(100% - 20px)";
        s.maxHeight = "calc(100% - 20px)";
        s.zIndex = "18";
        s.display = "none";
        s.padding = "0";
        s.borderRadius = "13px";
        s.boxSizing = "border-box";
        s.font = `12px ${fontFamily}`;
        s.boxShadow = "0 12px 32px -12px rgba(20,23,50,.28)";
        s.overflowX = "hidden";
        s.overflowY = "auto";
        s.overscrollBehavior = "contain";
        this.el.onclick = (e) => e.stopPropagation();
        this.el.setAttribute("role", "region");
        this.el.setAttribute("aria-label", "Analysis tools");
        host.appendChild(this.el);
        this.build();
    }

    private build(): void {
        this.head = document.createElement("div");
        this.head.className = "zx-enterprise-head";

        const identity = document.createElement("div");
        identity.className = "zx-enterprise-identity";
        const mark = document.createElement("span");
        mark.className = "zx-enterprise-mark";
        mark.appendChild(panelIcon("analysis"));
        const title = document.createElement("span");
        title.className = "zx-enterprise-title";
        title.textContent = "Analysis tools";
        identity.append(mark, title);
        this.head.appendChild(identity);

        // One close action owns the entire Enterprise overlay, regardless of which
        // combination of Find / Explore / Path sections is currently visible.
        this.closePanel = document.createElement("button");
        this.closePanel.type = "button";
        this.closePanel.className = "zx-enterprise-close";
        this.closePanel.setAttribute("aria-label", "Close enterprise panel");
        this.closePanel.title = "Close enterprise panel";
        this.closePanel.appendChild(panelIcon("close"));
        this.closePanel.onclick = () => {
            this.searchInput.value = "";
            this.focusSelect.value = "";
            this.hopsInput.value = "1";
            this.breadcrumb.textContent = "Pick a focus node to explore.";
            this.srcSelect.value = "";
            this.tgtSelect.value = "";
            this.pathResult.textContent = "";
            this.configure(false, false, false);
            this.cb.onClosePanel();
        };
        this.head.appendChild(this.closePanel);
        this.el.appendChild(this.head);

        this.body = document.createElement("div");
        this.body.className = "zx-enterprise-body";
        this.el.appendChild(this.body);

        // Find section — search/highlight nodes by name.
        this.findSection = section("Find", "search");
        const searchWrap = document.createElement("div");
        searchWrap.className = "zx-enterprise-search";
        const searchIcon = document.createElement("span");
        searchIcon.className = "zx-enterprise-search-icon";
        searchIcon.appendChild(panelIcon("search"));
        this.searchInput = document.createElement("input");
        this.searchInput.type = "search";
        this.searchInput.placeholder = "Search nodes…";
        this.searchInput.className = "zx-enterprise-control";
        this.searchInput.setAttribute("aria-label", "Search nodes");
        this.searchInput.oninput = () => this.cb.onSearch(this.searchInput.value.trim());
        searchWrap.append(searchIcon, this.searchInput);
        this.findSection.appendChild(searchWrap);
        this.body.appendChild(this.findSection);

        // Explore section.
        this.exploreSection = section("Explore", "explore");
        this.focusSelect = document.createElement("select");
        this.focusSelect.className = "zx-enterprise-control";
        this.focusSelect.onchange = () => this.cb.onExploreFocus(this.focusSelect.value || null);
        this.exploreSection.appendChild(labeled("Focus node", this.focusSelect));

        this.hopsInput = document.createElement("input");
        this.hopsInput.type = "number";
        this.hopsInput.min = "1";
        this.hopsInput.value = "1";
        this.hopsInput.className = "zx-enterprise-control";
        this.hopsInput.onchange = () => this.cb.onExploreHops(Math.max(1, Number(this.hopsInput.value) || 1));
        this.exploreSection.appendChild(labeled("Hops", this.hopsInput));

        this.breadcrumb = document.createElement("div");
        this.breadcrumb.className = "zx-enterprise-status";
        this.exploreSection.appendChild(this.breadcrumb);

        // Path section.
        this.pathSection = section("Shortest path", "path");
        this.srcSelect = document.createElement("select");
        this.tgtSelect = document.createElement("select");
        this.srcSelect.className = "zx-enterprise-control";
        this.tgtSelect.className = "zx-enterprise-control";
        this.srcSelect.onchange = () => this.emitPath();
        this.tgtSelect.onchange = () => this.emitPath();
        this.pathSection.appendChild(labeled("From", this.srcSelect));
        this.pathSection.appendChild(labeled("To", this.tgtSelect));
        this.pathResult = document.createElement("div");
        this.pathResult.className = "zx-enterprise-status";
        this.pathSection.appendChild(this.pathResult);

        this.body.appendChild(this.exploreSection);
        this.body.appendChild(this.pathSection);
    }

    private emitPath(): void {
        this.cb.onPathChange(this.srcSelect.value || null, this.tgtSelect.value || null);
    }

    setTheme(surface: Surface): void {
        const selected = surface.selected || accent;
        const dark = isDark(surface.bg);
        const separator = rgba(surface.edge, dark ? .42 : .25);
        const fieldBorder = rgba(surface.edge, dark ? .68 : .45);
        const fieldBg = dark ? "rgba(255,255,255,.045)" : "#F8F8FC";
        this.el.style.background = surface.bg;
        this.el.style.color = surface.fg;
        this.el.style.border = `1px solid ${rgba(surface.edge, dark ? .72 : .52)}`;
        this.el.style.boxShadow = dark
            ? "0 16px 38px -12px rgba(0,0,0,.58)"
            : "0 16px 38px -14px rgba(20,23,50,.30)";
        this.el.style.setProperty("--zx-ep-accent", selected);
        this.el.style.setProperty("--zx-ep-accent-soft", rgba(selected, dark ? .20 : .10));
        this.el.style.setProperty("--zx-ep-border", fieldBorder);
        this.el.style.setProperty("--zx-ep-separator", separator);
        this.el.style.setProperty("--zx-ep-field", fieldBg);
        this.el.style.setProperty("--zx-ep-text", surface.fg);
        this.el.style.setProperty("--zx-ep-muted", surface.muted);
        this.el.style.setProperty("--zx-ep-card", surface.bg);
    }

    /** Populate the node pickers (preserving current selections when still valid). */
    setNodes(keys: string[]): void {
        this.nodeKeys = keys;
        fill(this.focusSelect, keys, "Select node");
        fill(this.srcSelect, keys, "Select start");
        fill(this.tgtSelect, keys, "Select end");
    }

    /** Show the panel with the requested sections; hide entirely when none is on. */
    configure(find: boolean, explore: boolean, path: boolean): void {
        this.cfg = { find, explore, path };
        this.findSection.style.display = find ? "block" : "none";
        this.exploreSection.style.display = explore ? "block" : "none";
        this.pathSection.style.display = path ? "block" : "none";
        this.el.style.display = !this.chromeHidden && this.graphViewActive && (find || explore || path) ? "block" : "none";
    }

    /** Graph-only context gate. Returning to Graph restores the configured card
     * and its session state; Table/Insight never mutate the author settings. */
    setGraphViewActive(active: boolean): void {
        this.graphViewActive = active;
        this.configure(this.cfg.find, this.cfg.explore, this.cfg.path);
    }

    /** Record constrained-tile state for responsive styling. The card remains
     * operable (sticky close + vertical scroll) instead of overflowing the visual. */
    setViewport(width: number, height: number): void {
        this.el.dataset.narrow = String(width < 360);
        this.el.dataset.short = String(height < 340);
    }

    /** Focus mode (NG-118): hide the panel, then restore its configured state on exit. */
    setChromeHidden(hidden: boolean): void {
        this.chromeHidden = hidden;
        this.configure(this.cfg.find, this.cfg.explore, this.cfg.path);
    }

    setExploreState(focus: string | null, hops: number, trail: string[]): void {
        if (focus != null && this.focusSelect.value !== focus) this.focusSelect.value = focus;
        this.hopsInput.value = String(hops);
        this.breadcrumb.textContent = trail.length ? `Trail: ${trail.join(" › ")}` : "Pick a focus node to explore.";
    }

    setPathResult(text: string): void {
        this.pathResult.textContent = text;
    }

    hide(): void { this.el.style.display = "none"; }
}

type PanelIcon = "analysis" | "search" | "explore" | "path" | "close";

function section(title: string, iconName: PanelIcon): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "zx-enterprise-section";
    const header = document.createElement("div");
    header.className = "zx-enterprise-section-head";
    const icon = document.createElement("span");
    icon.className = "zx-enterprise-section-icon";
    icon.appendChild(panelIcon(iconName));
    const h = document.createElement("div");
    h.textContent = title;
    h.className = "zx-enterprise-section-title";
    header.append(icon, h);
    d.appendChild(header);
    return d;
}

function labeled(label: string, input: HTMLElement): HTMLLabelElement {
    const row = document.createElement("label");
    row.className = "zx-enterprise-row";
    const l = document.createElement("span");
    l.textContent = label;
    l.className = "zx-enterprise-label";
    row.appendChild(l);
    row.appendChild(input);
    return row;
}

/** Fill a node picker with a descriptive empty-state option. */
function fill(sel: HTMLSelectElement, keys: string[], placeholder: string): void {
    const prev = sel.value;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = placeholder;
    sel.appendChild(blank);
    for (const k of keys) {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = k;
        sel.appendChild(o);
    }
    if (keys.indexOf(prev) >= 0) sel.value = prev; // keep selection if still valid
}

function panelIcon(name: PanelIcon): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", name === "close" ? "16" : "15");
    svg.setAttribute("height", name === "close" ? "16" : "15");
    svg.setAttribute("aria-hidden", "true");
    svg.style.display = "block";
    svg.style.fill = "none";
    svg.style.stroke = "currentColor";
    svg.style.strokeWidth = "1.8";
    svg.style.strokeLinecap = "round";
    svg.style.strokeLinejoin = "round";
    const path = (d: string): void => {
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
    };
    if (name === "close") {
        path("M6 6l12 12M18 6L6 18");
    } else if (name === "search") {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", "10.5"); circle.setAttribute("cy", "10.5"); circle.setAttribute("r", "5.5");
        svg.appendChild(circle); path("M15 15l4.25 4.25");
    } else if (name === "explore") {
        const circles = [["6", "12"], ["18", "6"], ["18", "18"]];
        circles.forEach(([cx, cy]) => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", "2.25");
            svg.appendChild(c);
        });
        path("M8.1 10.95l7.8-3.9M8.1 13.05l7.8 3.9");
    } else if (name === "path") {
        path("M5 18c1.5-7 4.5-11 9-12h4M15 3l3 3-3 3");
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", "5"); c.setAttribute("cy", "18"); c.setAttribute("r", "2");
        svg.appendChild(c);
    } else {
        const circles = [["5", "12"], ["12", "5"], ["19", "12"], ["12", "19"]];
        circles.forEach(([cx, cy]) => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", "1.8");
            svg.appendChild(c);
        });
        path("M6.5 10.5l4-4M13.5 6.5l4 4M17.5 13.5l-4 4M10.5 17.5l-4-4");
    }
    return svg;
}

function isDark(color: string): boolean {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return false;
    const n = Number.parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function rgba(color: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = Number.parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
