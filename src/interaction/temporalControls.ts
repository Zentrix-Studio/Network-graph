"use strict";

/**
 * Temporal / dynamic graph (NG-077). When a Time role is bound, edges carry a time
 * value and this controller reveals them over a scrubbable, playable axis — the
 * classic "watch the network grow" animation. Edges with a time > the cursor are
 * hidden; a node appears once its first incident timed edge does. Untimed edges are
 * always shown (base structure). Session-local (works in Reading view), textContent
 * only, no external calls (a plain setInterval drives Play).
 *
 * The geometry helpers are pure & deterministic — the testable core; the class is
 * the thin DOM shell.
 */

import { GraphModel } from "../model/graphTypes";
import { Surface, fontFamily, accent } from "../theme/zentrixTokens";

/** Min/max across the parseable edge times, or null when none are timed. */
export function timeRange(edgeTime: (number | null)[]): { min: number; max: number } | null {
    let min = Infinity, max = -Infinity;
    for (const t of edgeTime) {
        if (t == null) continue;
        if (t < min) min = t;
        if (t > max) max = t;
    }
    return min === Infinity ? null : { min, max };
}

/** An edge is visible at cursor `t` when it has no time (structural) or time <= t. */
export function edgeVisibleAt(edgeTimeVal: number | null, t: number): boolean {
    return edgeTimeVal == null || edgeTimeVal <= t;
}

/** Earliest incident timed edge per node (null if a node has only untimed edges). */
export function nodeFirstTime(model: GraphModel, edgeTime: (number | null)[]): (number | null)[] {
    const first = new Array<number | null>(model.nodes.length).fill(null);
    model.links.forEach((l, li) => {
        const t = edgeTime[li];
        if (t == null) return;
        for (const nd of [l.source, l.target]) {
            const cur = first[nd];
            if (cur == null || t < cur) first[nd] = t;
        }
    });
    return first;
}

/** A node is visible at cursor `t` if it has no timed edge, or its first one has arrived. */
export function nodeVisibleAt(firstTimeVal: number | null, t: number): boolean {
    return firstTimeVal == null || firstTimeVal <= t;
}

export class TemporalController {
    private wrap: HTMLDivElement;
    private slider: HTMLInputElement;
    private playBtn: HTMLButtonElement;
    private label: HTMLSpanElement;
    private timer: number | null = null;
    private range: { min: number; max: number } = { min: 0, max: 1 };
    private isDate = false;

    constructor(host: HTMLElement, private onScrub: (t: number) => void) {
        this.wrap = document.createElement("div");
        this.wrap.className = "zx-temporal";
        const w = this.wrap.style;
        w.position = "absolute"; w.left = "50%"; w.transform = "translateX(-50%)";
        w.bottom = "10px"; w.zIndex = "16"; w.display = "none";
        w.alignItems = "center"; w.gap = "8px"; w.padding = "6px 10px";
        w.borderRadius = "8px";

        this.playBtn = document.createElement("button");
        this.playBtn.textContent = "▶";
        this.playBtn.style.cssText = `cursor:pointer;border-radius:6px;width:26px;height:26px;font:12px ${fontFamily}`;
        this.playBtn.onclick = (e) => { e.stopPropagation(); this.togglePlay(); };

        this.slider = document.createElement("input");
        this.slider.type = "range";
        this.slider.min = "0"; this.slider.max = "1000"; this.slider.value = "1000";
        this.slider.style.cssText = "width:220px;cursor:pointer";
        this.slider.oninput = (e) => { e.stopPropagation(); this.pause(); this.emit(); };

        this.label = document.createElement("span");
        this.label.style.cssText = `font:11px ${fontFamily};min-width:74px;text-align:right`;

        this.wrap.appendChild(this.playBtn);
        this.wrap.appendChild(this.slider);
        this.wrap.appendChild(this.label);
        host.appendChild(this.wrap);
    }

    setTheme(surface: Surface): void {
        this.wrap.style.background = surface.bg;
        this.wrap.style.border = `1px solid ${surface.edge}`;
        this.wrap.style.color = surface.fg;
        this.playBtn.style.background = surface.bg;
        this.playBtn.style.color = accent;
        this.playBtn.style.border = `1px solid ${surface.edge}`;
        this.label.style.color = surface.muted;
    }

    /** Bind to a data range; `isDate` formats the label as a date. Cursor starts at max. */
    configure(range: { min: number; max: number }, isDate: boolean): void {
        this.range = range.max > range.min ? range : { min: range.min, max: range.min + 1 };
        this.isDate = isDate;
        this.slider.value = "1000";
        this.reflect();
    }

    /** Current cursor time (data units). */
    value(): number {
        const frac = Number(this.slider.value) / 1000;
        return this.range.min + frac * (this.range.max - this.range.min);
    }

    show(): void { this.wrap.style.display = "flex"; }
    hide(): void { this.pause(); this.wrap.style.display = "none"; }

    private emit(): void { this.reflect(); this.onScrub(this.value()); }

    private reflect(): void {
        const v = this.value();
        this.label.textContent = this.isDate
            ? new Date(v).toISOString().slice(0, 10)
            : String(Math.round(v * 100) / 100);
    }

    private togglePlay(): void { this.timer == null ? this.play() : this.pause(); }

    private play(): void {
        this.playBtn.textContent = "❚❚";
        if (Number(this.slider.value) >= 1000) this.slider.value = "0"; // replay from start
        this.timer = window.setInterval(() => {
            const next = Number(this.slider.value) + 20; // ~50 steps
            if (next >= 1000) { this.slider.value = "1000"; this.emit(); this.pause(); return; }
            this.slider.value = String(next);
            this.emit();
        }, 60);
    }

    private pause(): void {
        if (this.timer != null) { window.clearInterval(this.timer); this.timer = null; }
        this.playBtn.textContent = "▶";
    }
}
