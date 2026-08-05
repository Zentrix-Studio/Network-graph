"use strict";

/**
 * View toggle (feature C14, redesigned NG-113, extended NG-125). A SEGMENTED pill —
 * [Graph | Table | Insight] with icons — that flips the canvas between the network,
 * the node-metrics table, and the plain-English insight read-out; the active segment
 * fills with the brand accent. Sits beside the settings gear by default. Session-local
 * (not persisted) so it works for report READERS in Reading view, where a
 * persistProperties write would not survive. Built with createElement/createElementNS
 * + textContent — never innerHTML.
 *
 * The Table and Insight segments are individually gated (summaryTable.show /
 * insights.show): a disabled segment is removed from the pill and the cycle. When
 * only Graph remains the visual hides the pill entirely.
 *
 * Placement (NG-125) is author-controlled (summaryTable.position): an explicit
 * corner (tl/tr/bl/br) pins the pill there; "auto" keeps the legacy bottom-right
 * dodge — LEFT of the gear when it anchors bottom-right, ABOVE the Zentrix
 * watermark when branding owns the corner, else flush in the corner.
 */

import { Surface, fontFamily, accent } from "../theme/zentrixTokens";
import { cornerInset, Corner } from "./chromePlacement";

export type ViewKind = "graph" | "table" | "insight";
export type ViewCorner = "auto" | "tl" | "tr" | "bl" | "br";

/** Fixed segment order; a container-level click advances to the next ENABLED view. */
const ORDER: ViewKind[] = ["graph", "table", "insight"];

const SVG_NS = "http://www.w3.org/2000/svg";

/** 14px stroked icon (currentColor) built via DOM — cert-safe, no innerHTML. */
function segIcon(kind: ViewKind): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", "14");
    s.setAttribute("height", "14");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    const path = (d: string): void => {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
    };
    const circle = (cx: number, cy: number, r: number): void => {
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy)); c.setAttribute("r", String(r));
        s.appendChild(c);
    };
    if (kind === "graph") {
        // A tiny network: three nodes joined by two links.
        circle(5, 6, 2.4); circle(19, 8, 2.4); circle(11, 18, 2.4);
        path("M7.2 6.8 16.7 7.7"); path("M6.3 8.1 9.9 15.9"); path("M17.6 10 12.4 16.2");
    } else if (kind === "table") {
        // A tiny table: outer frame, header rule, column rule.
        path("M4 5h16v14H4z"); path("M4 10h16"); path("M11 10v9");
    } else {
        // A lightbulb — the "insight" read-out.
        path("M9 18h6"); path("M10 21h4");
        path("M12 3a6 6 0 0 0-3.7 10.7c.5.4.7.9.7 1.5v.3h6v-.3c0-.6.2-1.1.7-1.5A6 6 0 0 0 12 3z");
    }
    return s;
}

export class ViewToggle {
    private root: HTMLDivElement;
    private segs: Record<ViewKind, HTMLButtonElement>;
    private kind: ViewKind = "graph";
    private surface: Surface | null = null;
    /** Which non-graph segments are currently offered (graph is always on). */
    private enabled: Record<ViewKind, boolean> = { graph: true, table: true, insight: false };
    /** PER-SEGMENT capability lock (NG-274): a locked segment stays VISIBLE but greyed and
     *  can't be selected or cycled to — clicking it fires `onLockedClick` (the upgrade
     *  banner). Used to show Insight as a disabled Pro teaser on the free tier while Table
     *  (a free feature) stays fully usable. Graph is never locked. */
    private locked: Record<ViewKind, boolean> = { graph: false, table: false, insight: false };
    /** Hover-tooltip text shown on a locked segment ("… is a Pro feature — start your free
     *  30-day trial …"). The predefined host banner (`notifyFeatureBlocked`) is invisible in
     *  Desktop and no-ops on fail-open, so this in-visual tooltip is what the user actually
     *  sees explaining WHY the segment is disabled. */
    private lockReason = "";
    /** Fired when a locked (Pro-gated) non-graph segment is clicked. Set by the visual. */
    onLockedClick: (() => void) | null = null;

    constructor(host: HTMLElement, private onToggle: (next: ViewKind) => void) {
        this.root = document.createElement("div");
        this.root.className = "zx-view";
        this.root.setAttribute("role", "group");
        this.root.setAttribute("aria-label", "Canvas view");
        const s = this.root.style;
        s.position = "absolute";
        s.right = "10px";
        s.bottom = "10px";
        s.zIndex = "16";
        s.display = "none";
        s.alignItems = "center";
        s.gap = "2px";
        s.height = "36px";
        s.padding = "3px";
        s.borderRadius = "999px";
        s.boxSizing = "border-box";
        s.font = `600 12px ${fontFamily}`;
        // A click on the pill itself (not a segment) advances the cycle — keeps the
        // old one-button toggle semantics for keyboard/automation callers.
        this.root.onclick = (e) => {
            e.stopPropagation();
            // Advance to the next SELECTABLE view (locked teasers are skipped by cycle()).
            this.select(this.nextEnabled(this.kind));
        };

        this.segs = {
            graph: this.makeSeg("graph", "Graph"),
            table: this.makeSeg("table", "Table"),
            insight: this.makeSeg("insight", "Insight"),
        };
        host.appendChild(this.root);
        this.reflect();
    }

    private makeSeg(kind: ViewKind, label: string): HTMLButtonElement {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "zx-view-seg";
        b.setAttribute("data-kind", kind);
        b.setAttribute("aria-label", `Switch to ${kind} view`);
        const s = b.style;
        s.display = "flex";
        s.alignItems = "center";
        s.gap = "6px";
        s.height = "30px";
        s.padding = "0 12px";
        s.border = "none";
        s.borderRadius = "999px";
        s.background = "transparent";
        s.cursor = "pointer";
        s.font = "inherit";
        b.appendChild(segIcon(kind));
        const t = document.createElement("span");
        t.textContent = label;
        b.appendChild(t);
        b.onclick = (e) => {
            e.stopPropagation();
            if (this.locked[kind]) { this.onLockedClick?.(); return; }
            this.select(kind);
        };
        this.root.appendChild(b);
        return b;
    }

    /** Ordered list of the currently-SELECTABLE kinds (enabled and not locked; graph
     *  always first). Locked teasers are visible but never cycled to. */
    private cycle(): ViewKind[] { return ORDER.filter((k) => this.enabled[k] && !this.locked[k]); }

    /** The next enabled view after `from`, wrapping around. */
    private nextEnabled(from: ViewKind): ViewKind {
        const c = this.cycle();
        const i = c.indexOf(from);
        return c[(i + 1) % c.length];
    }

    /**
     * Declare which non-graph segments are available. Segments that turn off are
     * removed from the pill and the cycle; if the active view was one of them the
     * pill falls back to Graph (the visual re-syncs its own viewMode via `set`).
     */
    setSegments(opts: { table: boolean; insight: boolean }): void {
        this.enabled = { graph: true, table: opts.table, insight: opts.insight };
        this.segs.table.style.display = opts.table ? "flex" : "none";
        this.segs.insight.style.display = opts.insight ? "flex" : "none";
        if (!this.enabled[this.kind]) this.kind = "graph";
        this.reflect();
    }

    /** Per-segment capability lock (NG-274): keep the named segments VISIBLE but grey them
     *  and block selection (a click fires `onLockedClick`); omitted segments stay usable.
     *  Graph is never locked. */
    setLocked(locked: Partial<Record<ViewKind, boolean>>, reason = ""): void {
        this.locked = { graph: false, table: !!locked.table, insight: !!locked.insight };
        this.lockReason = reason;
        // If the active view just became locked (e.g. a mid-session downgrade), fall back.
        if (this.locked[this.kind]) this.kind = "graph";
        this.reflect();
    }

    /** True when at least one non-graph segment is offered (else the pill is pointless). */
    hasAlternateView(): boolean { return this.enabled.table || this.enabled.insight; }

    /** Activate a segment, reflecting + firing onToggle only on a real change. */
    private select(kind: ViewKind): void {
        if (!this.enabled[kind] || this.locked[kind] || kind === this.kind) return;
        this.kind = kind;
        this.reflect();
        this.onToggle(this.kind);
    }

    setTheme(surface: Surface): void {
        this.surface = surface;
        const dark = surface.bg !== "#FFFFFF";
        this.root.style.background = surface.bg;
        this.root.style.border = `1px solid ${surface.edge}${dark ? "" : "33"}`;
        this.root.style.boxShadow = dark
            ? "0 4px 14px rgba(0,0,0,0.45)"
            : "0 4px 14px rgba(11,16,32,0.12)";
        this.reflect();
    }

    private reflect(): void {
        for (const kind of ORDER) {
            const seg = this.segs[kind];
            const active = kind === this.kind;
            seg.setAttribute("aria-pressed", active ? "true" : "false");
            // Active segment: accent fill + white text. HC surfaces carry a `selected`
            // role instead of the brand accent.
            const fill = this.surface?.selected ?? accent;
            seg.style.background = active ? fill : "transparent";
            seg.style.color = active ? "#FFFFFF" : (this.surface?.fg ?? "#15161E");
            // Locked teaser (NG-274): grey the segment (greyed, not hidden) and mark it
            // disabled — its click handler routes to onLockedClick (the upgrade banner). A
            // hover tooltip (`title`) + aria-label carry the "Pro feature" reason so the user
            // sees WHY it's disabled without relying on the host banner (invisible in Desktop).
            const greyed = this.locked[kind];
            seg.style.opacity = greyed ? "0.4" : "1";
            seg.style.cursor = greyed ? "not-allowed" : "pointer";
            seg.setAttribute("aria-disabled", greyed ? "true" : "false");
            if (greyed && this.lockReason) {
                seg.title = this.lockReason;
                seg.setAttribute("aria-label", `${kind} view. ${this.lockReason}`);
            } else {
                seg.removeAttribute("title");
                seg.setAttribute("aria-label", `Switch to ${kind} view`);
            }
        }
    }

    current(): ViewKind { return this.kind; }
    /** Force the toggle to a view without firing onToggle — used when the visual
     *  resets the canvas to the graph (e.g. the segment was turned off mid-view). */
    set(kind: ViewKind): void { this.kind = this.enabled[kind] ? kind : "graph"; this.reflect(); }
    /**
     * Position the pill. An explicit corner (tl/tr/bl/br) pins it there. "auto"
     * keeps the legacy bottom-right dodge:
     *  - the **gear** (settings bar anchored "br"/Auto) is a real 36px control, so
     *    the pill steps *left* of it (`right: 58px`) and shares its raised baseline
     *    (`bottom: 21px`) so the two are vertically centred with each other — the
     *    gear is lifted the same 5px to clear the watermark (see `syncGearLift`).
     *  - the **Zentrix watermark** is a thin corner label, so the pill stacks
     *    *above* it (`bottom: 34px`) and stays flush in the corner horizontally.
     *  - with neither, the pill drops flush into the corner at `right/bottom: 10px`.
     * The gear (left-dodge) wins when both are present.
     */
    place(corner: ViewCorner, gearAtBr: boolean, brandingOn: boolean, dodge?: { gearCorner: Corner | null; actionBar: boolean }): void {
        const s = this.root.style;
        s.top = s.bottom = s.left = s.right = "";
        if (corner === "auto") {
            s.right = gearAtBr ? "58px" : "10px";
            s.bottom = gearAtBr ? "21px" : (brandingOn ? "34px" : "10px");
            return;
        }
        // Explicit corner: step the pill clear of any higher-priority chrome pinned to the
        // same corner — the fixed quick-action toolbar (top-right) and the settings gear —
        // so the three never overlap (NG-136). `cornerInset` returns the flush 10px when the
        // corner is otherwise empty, so a lone pill still sits in the corner as before.
        const inset = dodge
            ? cornerInset(corner, "pill", { actionBar: dodge.actionBar, gearCorner: dodge.gearCorner, pillCorner: corner, legendCorner: null })
            : 10;
        const isTop = corner === "tl" || corner === "tr";
        const isLeft = corner === "tl" || corner === "bl";
        s[isTop ? "top" : "bottom"] = "10px";
        s[isLeft ? "left" : "right"] = `${inset}px`;
    }
    show(): void { this.root.style.display = "flex"; }
    hide(): void { this.root.style.display = "none"; }
}
