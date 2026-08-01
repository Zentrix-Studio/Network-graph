"use strict";

/**
 * Summary-table alternate view (C14 → R7 → NG-097, redesigned NG-113 to the
 * analytics-dashboard look): the graph as an accessible node-metrics dashboard.
 *  - a stat-card row (Nodes / Edges / Σ edge weight / Avg degree / Most connected)
 *    with big serif numerals,
 *  - a "Node metrics" strip with a live "N of M shown" count, search box,
 *    per-category Filter popover, and CSV Export,
 *  - a ranked, sortable metrics table: DEGREE and WEIGHTED render as proportional
 *    bars (accent / category colour), CATEGORY as a colour dot + name; monospace
 *    numerals, zebra rows, sticky header.
 * Built with createElement/createElementNS + textContent — never innerHTML.
 */

import { GraphModel } from "../model/graphTypes";
import { NodeAttr } from "../types";
import { Surface, fontFamily, accent } from "../theme/zentrixTokens";

const MONO = "'SF Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";
const SVG_NS = "http://www.w3.org/2000/svg";

export interface SummaryTableOptions {
    /** Per-node colour (category/cluster driven) for the WEIGHTED bars + CATEGORY dots. */
    colorOf?: (i: number) => string;
    /** Distinct category labels (for the Nodes card subtitle + the Filter popover). */
    categories?: string[];
    /** CSV export hook (host downloadService); button hidden when absent. */
    onExport?: () => void;
    /** High contrast: flat fg/bg styling, no tints/shadows. */
    hc?: boolean;
    /** Lazy, memoized provider for the opt-in analytical columns (NG-253):
     *  "betweenness" | "closeness" | "pagerank" | "community" → number[]; "critical"
     *  → boolean[]; null when not computable. Only called for a column the reader has
     *  switched on, so nothing heavy runs unless it's needed. */
    metricFor?: (key: string) => number[] | boolean[] | null;
    /** Whether the analytical columns are computable now (premium + within the node
     *  cap). Drives the Columns picker without forcing a compute (NG-253). */
    analyticsAvailable?: boolean;
}

interface Column {
    /** Stable id — sort tracks this (not a positional index), so toggling columns
     *  in the picker can never point the sort at the wrong column (NG-253). */
    key: string;
    label: string;
    numeric: boolean;
    value: (i: number) => string;
    sortKey: (i: number) => number | string;
    /** Bar renderer: fraction 0..1 + bar colour (accent or per-node category). */
    bar?: { frac: (i: number) => number; color: (i: number) => string };
    /** Colour-dot prefix (category column). */
    dot?: (i: number) => string;
    /** Offered in the Columns picker (NG-253). Non-optional columns are always shown. */
    optional?: boolean;
    /** Initial visibility. Existing columns stay on; the analytical columns are opt-in. */
    defaultOn?: boolean;
}

/** Chrome palette derived from the surface (no new tokens needed). */
function chrome(surface: Surface, hc: boolean) {
    const light = surface.bg === "#FFFFFF";
    if (hc) {
        return {
            pageBg: surface.bg, cardBg: surface.bg, border: surface.fg,
            zebra: "transparent", track: "transparent",
            shadow: "none", barFallback: surface.fg,
        };
    }
    return light
        ? {
            pageBg: "#F0F1F7", cardBg: "#FFFFFF", border: "#E8EAF2",
            zebra: "#F7F8FC", track: "#EDEFF6",
            shadow: "0 2px 10px rgba(11,16,32,0.06)", barFallback: accent,
        }
        : {
            pageBg: surface.bg, cardBg: "#15161E", border: "#2A2B36",
            zebra: "rgba(255,255,255,0.03)", track: "rgba(255,255,255,0.10)",
            shadow: "0 2px 10px rgba(0,0,0,0.45)", barFallback: accent,
        };
}

/** 14px stroked icon (currentColor) built via DOM — cert-safe, no innerHTML. */
function icon(paths: string[], size = 14): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(size));
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const d of paths) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
    }
    return s;
}
const SEARCH_ICON = ["M21 21l-4.8-4.8", "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"];
const FILTER_ICON = ["M4 5h16l-6.5 8v5.5L10 21v-8L4 5z"];
const EXPORT_ICON = ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"];
const COLUMNS_ICON = ["M4 5h16v14H4z", "M11 5v14", "M15.5 5v14"];

export function renderSummaryTable(
    host: HTMLElement,
    model: GraphModel,
    attrs: NodeAttr[],
    hasCategory: boolean,
    surface: Surface,
    opts: SummaryTableOptions = {},
): HTMLDivElement {
    const hc = Boolean(opts.hc);
    const c = chrome(surface, hc);
    const colorOf = opts.colorOf ?? ((): string => c.barFallback);
    const categories = hasCategory ? (opts.categories ?? []) : [];

    // --- headline aggregates -------------------------------------------------
    const n = model.nodes.length;
    const e = model.links.length;
    let sumW = 0;
    for (const l of model.links) sumW += l.weight;
    let maxDeg = 1, maxDegI = 0, maxWeighted = 1;
    for (const node of model.nodes) {
        if (node.degree > model.nodes[maxDegI].degree) maxDegI = node.index;
        if (node.degree > maxDeg) maxDeg = node.degree;
        if (node.weightedDegree > maxWeighted) maxWeighted = node.weightedDegree;
    }
    const avgDeg = n ? (2 * e) / n : 0;

    // Lazy, memoized (by the caller) analytical arrays — only fetched when a column is
    // actually shown, so the O(V·E) passes never run for the default table (NG-253).
    const numArr = (key: string): number[] | null => {
        const r = opts.metricFor ? opts.metricFor(key) : null;
        return Array.isArray(r) && typeof r[0] !== "boolean" ? (r as number[]) : (r && r.length === 0 ? [] : null);
    };
    const critArr = (): boolean[] | null => {
        const r = opts.metricFor ? opts.metricFor("critical") : null;
        return Array.isArray(r) ? (r as boolean[]) : null;
    };
    // Relative centrality values (normalised to the top node) → 3 decimals; "—" when
    // the metric isn't available (above the perf cap / non-premium).
    const fmt3 = (v: number | undefined): string => (v == null ? "—" : (Math.round(v * 1000) / 1000).toFixed(3));

    const allColumns: Column[] = [
        { key: "node", label: "Node", numeric: false, value: (i) => model.nodes[i].label, sortKey: (i) => model.nodes[i].label },
        {
            key: "degree", label: "Degree", numeric: true, value: (i) => String(model.nodes[i].degree), sortKey: (i) => model.nodes[i].degree,
            bar: { frac: (i) => model.nodes[i].degree / maxDeg, color: () => (hc ? surface.fg : accent) },
        },
        { key: "in", label: "In", numeric: true, value: (i) => String(model.nodes[i].inDegree), sortKey: (i) => model.nodes[i].inDegree },
        { key: "out", label: "Out", numeric: true, value: (i) => String(model.nodes[i].outDegree), sortKey: (i) => model.nodes[i].outDegree },
        {
            key: "weighted", label: "Weighted", numeric: true, value: (i) => String(round(model.nodes[i].weightedDegree)), sortKey: (i) => model.nodes[i].weightedDegree,
            bar: { frac: (i) => model.nodes[i].weightedDegree / maxWeighted, color: (i) => (hc ? surface.fg : colorOf(i)) },
        },
        { key: "component", label: "Component", numeric: true, value: (i) => String(model.nodes[i].component), sortKey: (i) => model.nodes[i].component },
    ];
    if (hasCategory) {
        allColumns.push({
            key: "category", label: "Category", numeric: false,
            value: (i) => attrs[i]?.category ?? "", sortKey: (i) => attrs[i]?.category ?? "",
            dot: (i) => (hc ? surface.fg : colorOf(i)),
        });
    }
    // Opt-in analytical columns (NG-253) — hidden by default, added via the Columns
    // picker. Betweenness (the broker metric) gets a bar; the rest are plain values.
    allColumns.push(
        {
            key: "betweenness", label: "Betweenness", numeric: true, optional: true, defaultOn: false,
            value: (i) => fmt3(numArr("betweenness")?.[i]),
            sortKey: (i) => numArr("betweenness")?.[i] ?? -1,
            bar: { frac: (i) => numArr("betweenness")?.[i] ?? 0, color: () => (hc ? surface.fg : accent) },
        },
        {
            key: "closeness", label: "Closeness", numeric: true, optional: true, defaultOn: false,
            value: (i) => fmt3(numArr("closeness")?.[i]), sortKey: (i) => numArr("closeness")?.[i] ?? -1,
        },
        {
            key: "pagerank", label: "PageRank", numeric: true, optional: true, defaultOn: false,
            value: (i) => fmt3(numArr("pagerank")?.[i]), sortKey: (i) => numArr("pagerank")?.[i] ?? -1,
        },
        {
            key: "community", label: "Community", numeric: true, optional: true, defaultOn: false,
            value: (i) => { const a = numArr("community"); return a ? String(a[i]) : "—"; },
            sortKey: (i) => numArr("community")?.[i] ?? -1,
        },
        {
            key: "critical", label: "Critical", numeric: true, optional: true, defaultOn: false,
            value: (i) => { const a = critArr(); return a ? (a[i] ? "Yes" : "No") : "—"; },
            sortKey: (i) => { const a = critArr(); return a ? (a[i] ? 1 : 0) : -1; },
        },
    );

    // Visible-column state (session-local). Sort tracks a column KEY, so toggling
    // columns never mis-points the sort.
    const visible = new Set<string>(allColumns.filter((col) => col.defaultOn !== false).map((col) => col.key));
    const visibleCols = (): Column[] => allColumns.filter((col) => visible.has(col.key));
    // Sort state: default Degree desc. Tracks a column KEY (not an index), so toggling
    // columns in the picker can never mis-point the sort (NG-253).
    let sortColKey = "degree";
    let sortDesc = true;

    /** Free-text used to match a row (node key + category), lower-cased once. */
    const searchText = (i: number): string =>
        (model.nodes[i].label + " " + (attrs[i]?.category ?? "")).toLowerCase();

    const wrap = document.createElement("div");
    wrap.className = "zx-summary";
    wrap.style.cssText = `position:absolute;inset:0;overflow:auto;background:${c.pageBg};` +
        `color:${surface.fg};font:13px ${fontFamily};padding:18px;box-sizing:border-box`;

    // --- stat cards ----------------------------------------------------------
    const cards = document.createElement("div");
    cards.className = "zx-sum-cards";
    cards.style.cssText = "display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap";
    const statCard = (title: string, big: string, sub: string): void => {
        const card = document.createElement("div");
        card.className = "zx-sum-card";
        card.style.cssText = `flex:1 1 120px;min-width:120px;background:${c.cardBg};border-radius:12px;` +
            `padding:16px 20px;box-shadow:${c.shadow};border:1px solid ${c.border}`;
        const t = document.createElement("div");
        t.textContent = title;
        t.style.cssText = `font:13px ${fontFamily};color:${surface.fg};opacity:0.85;margin-bottom:8px;white-space:nowrap`;
        const b = document.createElement("div");
        b.textContent = big;
        b.style.cssText = `font:600 32px ${SERIF};color:${surface.fg};letter-spacing:0.5px;margin-bottom:6px;` +
            `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
        const s2 = document.createElement("div");
        s2.textContent = sub;
        s2.style.cssText = `font:12px ${fontFamily};color:${surface.muted};white-space:nowrap`;
        card.appendChild(t); card.appendChild(b); card.appendChild(s2);
        cards.appendChild(card);
    };
    statCard("Nodes", String(n), hasCategory && categories.length
        ? `${categories.length} categories`
        : `${model.componentCount} component${model.componentCount === 1 ? "" : "s"}`);
    statCard("Edges", String(e), "directed links");
    statCard("Σ Edge weight", String(round(sumW)), "sum of weights");
    statCard("Avg degree", (Math.round(avgDeg * 10) / 10).toFixed(1), "links per node");
    statCard("Most connected", n ? model.nodes[maxDegI].label : "—", n ? `${model.nodes[maxDegI].degree} links` : "no nodes");
    wrap.appendChild(cards);

    // --- toolbar strip: title + count · search · filter · export -------------
    const strip = document.createElement("div");
    strip.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap";

    const title = document.createElement("span");
    title.textContent = "Node metrics";
    title.style.cssText = `font:700 17px ${SERIF};white-space:nowrap`;
    strip.appendChild(title);

    const countEl = document.createElement("span");
    countEl.className = "zx-sum-count";
    countEl.style.cssText = `font:12px ${MONO};color:${surface.muted};white-space:nowrap`;
    strip.appendChild(countEl);

    const spacer = document.createElement("span");
    spacer.style.cssText = "flex:1 1 auto";
    strip.appendChild(spacer);

    // Search box (with a magnifier icon inside).
    const searchWrap = document.createElement("span");
    searchWrap.style.cssText = "position:relative;display:inline-flex;align-items:center";
    const searchIco = icon(SEARCH_ICON);
    searchIco.style.cssText = `position:absolute;left:10px;pointer-events:none;color:${surface.muted}`;
    const search = document.createElement("input");
    search.type = "text";
    search.className = "zx-summary-search";
    search.placeholder = "Search nodes…";
    search.setAttribute("aria-label", "Search nodes");
    search.style.cssText = `width:190px;height:32px;padding:0 10px 0 32px;border-radius:9px;` +
        `border:1px solid ${c.border};background:${c.cardBg};color:${surface.fg};` +
        `font:400 12px ${fontFamily};outline:none;box-sizing:border-box`;
    let query = "";
    search.oninput = () => { query = search.value.trim().toLowerCase(); renderBody(); };
    // Keep clicks/keys inside the box (don't bubble to canvas handlers).
    search.onclick = (ev) => ev.stopPropagation();
    searchWrap.appendChild(searchIco);
    searchWrap.appendChild(search);
    strip.appendChild(searchWrap);

    const chromeBtn = (label: string, ico: SVGSVGElement, cls: string): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.appendChild(ico);
        const t = document.createElement("span");
        t.textContent = label;
        b.appendChild(t);
        b.style.cssText = `display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;` +
            `border-radius:9px;border:1px solid ${c.border};background:${c.cardBg};color:${surface.fg};` +
            `font:600 12px ${fontFamily};cursor:pointer`;
        return b;
    };

    // Per-category filter (popover with one toggle per category). Only offered
    // when a Category role is bound — there is nothing else to filter by here.
    const activeCats = new Set<string>();
    if (hasCategory && categories.length) {
        const holder = document.createElement("span");
        holder.style.cssText = "position:relative;display:inline-flex";
        const filterBtn = chromeBtn("Filter", icon(FILTER_ICON), "zx-sum-filter");
        const pop = document.createElement("div");
        pop.className = "zx-sum-filterpop";
        pop.style.cssText = `display:none;position:absolute;top:38px;right:0;z-index:20;min-width:170px;` +
            `background:${c.cardBg};border:1px solid ${c.border};border-radius:10px;box-shadow:${c.shadow};` +
            `padding:8px;max-height:240px;overflow:auto`;
        for (const cat of categories) {
            const row = document.createElement("label");
            row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:7px;` +
                `font:12px ${fontFamily};color:${surface.fg};cursor:pointer;white-space:nowrap`;
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.onchange = () => {
                if (cb.checked) activeCats.add(cat); else activeCats.delete(cat);
                filterBtn.style.borderColor = activeCats.size ? accent : c.border;
                filterBtn.style.color = activeCats.size ? accent : surface.fg;
                renderBody();
            };
            const t = document.createElement("span");
            t.textContent = cat;
            row.appendChild(cb); row.appendChild(t);
            row.onclick = (ev) => ev.stopPropagation();
            pop.appendChild(row);
        }
        filterBtn.onclick = (ev) => {
            ev.stopPropagation();
            pop.style.display = pop.style.display === "none" ? "block" : "none";
        };
        holder.appendChild(filterBtn);
        holder.appendChild(pop);
        strip.appendChild(holder);
    }

    // Columns picker (NG-253) — toggle the optional/analytical columns, session-local.
    // Mirrors the Filter popover. Offered whenever any column is optional.
    const optionalCols = allColumns.filter((col) => col.optional);
    if (optionalCols.length) {
        const holder = document.createElement("span");
        holder.style.cssText = "position:relative;display:inline-flex";
        const colsBtn = chromeBtn("Columns", icon(COLUMNS_ICON), "zx-sum-columns");
        const pop = document.createElement("div");
        pop.className = "zx-sum-colspop";
        pop.style.cssText = `display:none;position:absolute;top:38px;right:0;z-index:20;min-width:190px;` +
            `background:${c.cardBg};border:1px solid ${c.border};border-radius:10px;box-shadow:${c.shadow};` +
            `padding:8px;max-height:280px;overflow:auto`;
        const analyticsKeys = new Set(["betweenness", "closeness", "pagerank", "community", "critical"]);
        for (const col of optionalCols) {
            const disabled = analyticsKeys.has(col.key) && !opts.analyticsAvailable;
            const row = document.createElement("label");
            row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:7px;` +
                `font:12px ${fontFamily};color:${disabled ? surface.muted : surface.fg};cursor:${disabled ? "default" : "pointer"};white-space:nowrap`;
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = visible.has(col.key);
            cb.disabled = disabled;
            cb.onchange = () => {
                if (cb.checked) visible.add(col.key); else visible.delete(col.key);
                // If the sorted column was just hidden, fall back to Degree.
                if (!visible.has(sortColKey)) { sortColKey = "degree"; sortDesc = true; }
                colsBtn.style.borderColor = analyticsShown() ? accent : c.border;
                colsBtn.style.color = analyticsShown() ? accent : surface.fg;
                renderHead();
                renderBody();
            };
            const t = document.createElement("span");
            t.textContent = col.label + (disabled ? " (≤2000 nodes)" : "");
            row.appendChild(cb); row.appendChild(t);
            row.onclick = (ev) => ev.stopPropagation();
            pop.appendChild(row);
        }
        colsBtn.onclick = (ev) => {
            ev.stopPropagation();
            pop.style.display = pop.style.display === "none" ? "block" : "none";
        };
        holder.appendChild(colsBtn);
        holder.appendChild(pop);
        strip.appendChild(holder);
    }
    /** Any optional column currently shown → the Columns button reads active. */
    function analyticsShown(): boolean {
        return optionalCols.some((col) => visible.has(col.key));
    }

    if (opts.onExport) {
        const exportBtn = chromeBtn("Export", icon(EXPORT_ICON), "zx-sum-export");
        exportBtn.onclick = (ev) => { ev.stopPropagation(); opts.onExport!(); };
        strip.appendChild(exportBtn);
    }
    wrap.appendChild(strip);

    // --- the metrics table ---------------------------------------------------
    const tableCard = document.createElement("div");
    tableCard.style.cssText = `background:${c.cardBg};border-radius:12px;border:1px solid ${c.border};` +
        `box-shadow:${c.shadow};overflow:hidden`;
    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%";
    table.setAttribute("role", "table");
    table.setAttribute("aria-label", "Node metrics");

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");

    const thBase = `padding:11px 14px;position:sticky;top:0;background:${c.cardBg};` +
        `border-bottom:2px solid ${c.border};font:700 11px ${fontFamily};letter-spacing:0.8px;` +
        `text-transform:uppercase;color:${surface.muted};user-select:none;white-space:nowrap;z-index:2`;

    // Leading rank column ("#") — not sortable, mirrors the current order.
    const rankTh = document.createElement("th");
    rankTh.textContent = "#";
    rankTh.style.cssText = `${thBase};text-align:left;width:1%`;

    // Header cells are rebuilt whenever the visible-column set changes (NG-253).
    let headerCells: { col: Column; th: HTMLTableCellElement }[] = [];
    function renderHead(): void {
        while (hr.firstChild) hr.removeChild(hr.firstChild);
        hr.appendChild(rankTh);
        headerCells = [];
        for (const col of visibleCols()) {
            const th = document.createElement("th");
            th.style.cssText = `${thBase};text-align:${col.numeric ? "right" : "left"};cursor:pointer`;
            th.title = "Click to sort";
            th.onclick = () => {
                if (sortColKey === col.key) sortDesc = !sortDesc;
                else { sortColKey = col.key; sortDesc = col.numeric; }
                renderBody();
                updateHeaderArrows();
            };
            hr.appendChild(th);
            headerCells.push({ col, th });
        }
        updateHeaderArrows();
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tableCard.appendChild(table);
    wrap.appendChild(tableCard);
    host.appendChild(wrap);

    function updateHeaderArrows(): void {
        for (const { col, th } of headerCells) {
            const active = col.key === sortColKey;
            th.textContent = col.label + (active ? (sortDesc ? " ▼" : " ▲") : "");
            th.style.color = active ? (hc ? surface.fg : accent) : surface.muted;
        }
    }

    /** A proportional bar + value, right-aligned (DEGREE / WEIGHTED columns). */
    function barCell(td: HTMLTableCellElement, frac: number, color: string, value: string): void {
        const box = document.createElement("span");
        box.style.cssText = "display:inline-flex;align-items:center;gap:10px;justify-content:flex-end";
        const track = document.createElement("span");
        track.style.cssText = `display:inline-block;width:86px;height:6px;border-radius:3px;` +
            `background:${c.track};overflow:hidden;flex:0 0 auto`;
        const fill = document.createElement("span");
        const pct = Math.max(0, Math.min(1, frac)) * 100;
        fill.style.cssText = `display:block;height:100%;border-radius:3px;background:${color};` +
            `width:${Math.round(pct * 10) / 10}%`;
        track.appendChild(fill);
        const num = document.createElement("span");
        num.textContent = value;
        num.style.cssText = `font:600 12.5px ${MONO};min-width:26px;text-align:right`;
        box.appendChild(track);
        box.appendChild(num);
        td.appendChild(box);
    }

    function renderBody(): void {
        const cols = visibleCols();
        const col = cols.find((cc) => cc.key === sortColKey) ?? cols[0];
        const order = model.nodes
            .map((node) => node.index)
            .filter((i) => query === "" || searchText(i).indexOf(query) !== -1)
            .filter((i) => !activeCats.size || activeCats.has(attrs[i]?.category ?? ""))
            .sort((a, b) => {
                const ka = col.sortKey(a), kb = col.sortKey(b);
                const cmp = typeof ka === "number" && typeof kb === "number"
                    ? ka - kb : String(ka).localeCompare(String(kb));
                return sortDesc ? -cmp : cmp;
            });

        // The count reads honestly against the full node total.
        countEl.textContent = `${order.length} of ${model.nodes.length} shown`;

        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

        if (order.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = cols.length + 1;
            td.textContent = "No nodes match your search.";
            td.style.cssText = `padding:18px 14px;text-align:center;font:12px ${fontFamily};` +
                `color:${surface.muted}`;
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        order.forEach((i, row) => {
            const tr = document.createElement("tr");
            tr.style.background = row % 2 ? c.zebra : "transparent";

            const tdBase = `padding:9px 14px;border-bottom:1px solid ${c.border};white-space:nowrap`;

            const rankTd = document.createElement("td");
            rankTd.textContent = String(row + 1);
            rankTd.style.cssText = `${tdBase};text-align:left;font:12px ${MONO};color:${surface.muted}`;
            tr.appendChild(rankTd);

            cols.forEach((cdef) => {
                const td = document.createElement("td");
                td.style.cssText = `${tdBase};text-align:${cdef.numeric ? "right" : "left"}`;
                const v = cdef.value(i);
                if (cdef.bar) {
                    barCell(td, cdef.bar.frac(i), cdef.bar.color(i), v);
                } else if (cdef.dot) {
                    const dot = document.createElement("span");
                    dot.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;` +
                        `background:${cdef.dot(i)};margin-right:8px;vertical-align:0`;
                    td.appendChild(dot);
                    const t = document.createElement("span");
                    t.textContent = v;
                    t.style.cssText = `font:12.5px ${fontFamily};color:${surface.fg}`;
                    td.appendChild(t);
                } else if (cdef.label === "Node") {
                    td.textContent = v;
                    td.style.font = `700 12.5px ${MONO}`;
                } else {
                    td.textContent = v;
                    td.style.font = `12.5px ${MONO}`;
                    // Zeros read as structure, not signal — mute them.
                    if (v === "0") td.style.color = surface.muted;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    renderHead();
    renderBody();
    return wrap;
}

function round(v: number): number {
    return Math.round(v * 100) / 100;
}
