"use strict";

/**
 * Zoom & pan controller (Enterprise scale mode, E1). Maintains a transform state
 * and applies it to the content group; mouse wheel zooms about the cursor, drag
 * pans. Session-local. Hit-testing stays correct because the DOM nodes are
 * transformed natively — no manual coordinate math for clicks.
 */

export interface ZoomState { k: number; tx: number; ty: number; }

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

export class ZoomController {
    private state: ZoomState = { k: 1, tx: 0, ty: 0 };
    private dragging = false;
    private lastX = 0;
    private lastY = 0;
    private enabled = true;

    constructor(
        private svgEl: Element,
        /** `animated` = a discrete step (button zoom / fit / reset) the caller may
         *  ease visually; wheel & pan pass false so tracking stays 1:1 (NG-112). */
        private apply: (s: ZoomState, animated: boolean) => void,
        private onChange: () => void,
    ) {
        svgEl.addEventListener("wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
        svgEl.addEventListener("mousedown", (e) => this.onDown(e as MouseEvent));
        if (typeof window !== "undefined") {
            window.addEventListener("mousemove", (e) => this.onMove(e));
            window.addEventListener("mouseup", () => { this.dragging = false; });
        }
    }

    setEnabled(v: boolean): void {
        this.enabled = v;
        if (!v) this.reset();
    }

    /** Reset to identity (called on new data so the graph re-fits). */
    reset(): void {
        this.state = { k: 1, tx: 0, ty: 0 };
        this.apply(this.state, true);
        this.onChange();
    }

    get(): ZoomState { return this.state; }

    /** Step-zoom about the viewport centre (quick-action buttons, N16). Uses the
     *  same clamp/around math as the wheel so the two never disagree. Under jsdom
     *  the rect is 0×0, so the centre degrades to the origin — still deterministic. */
    zoomBy(factor: number): void {
        if (!this.enabled) return;
        const rect = (this.svgEl as HTMLElement).getBoundingClientRect();
        this.zoomAround(rect.width / 2, rect.height / 2, factor, true);
    }

    private onWheel(e: WheelEvent): void {
        if (!this.enabled) return;
        e.preventDefault();
        const rect = (this.svgEl as HTMLElement).getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        this.zoomAround(px, py, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }

    /** Zoom keeping the world point under the cursor fixed on screen. */
    private zoomAround(px: number, py: number, factor: number, animated = false): void {
        const s = this.state;
        const k2 = clamp(s.k * factor, 0.2, 8);
        const ratio = k2 / s.k;
        s.tx = px - ratio * (px - s.tx);
        s.ty = py - ratio * (py - s.ty);
        s.k = k2;
        this.apply(s, animated);
        this.onChange();
    }

    private onDown(e: MouseEvent): void {
        if (!this.enabled) return;
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    private onMove(e: MouseEvent): void {
        if (!this.dragging || !this.enabled) return;
        this.state.tx += e.clientX - this.lastX;
        this.state.ty += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.apply(this.state, false);
        this.onChange();
    }
}
