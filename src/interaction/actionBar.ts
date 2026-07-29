"use strict";

/**
 * Quick-action bar (T12 + N16, redesigned NG-113). A vertical rounded card in the
 * top-right corner: zoom in / zoom out / fit-to-screen, then (under a hairline
 * divider) reset layout, visual-wide undo/redo, and a four-format export menu.
 * Undo/redo cover authored visual changes; reset remains the focused recovery
 * action for a hand-authored layout.
 *
 * Buttons are icon-only (inline SVG built via createElementNS — never innerHTML)
 * on a soft-shadowed card, matching the legend/toggle chrome. Follows the
 * ViewToggle pattern: plain HTML appended to the visual element, absolute-
 * positioned, constructed once and themed/shown from paint(). Top-right is the
 * one free corner — enterprise panel sits top-left, insights top-centre, legend
 * bottom-left, gear/view-switch/minimap/watermark bottom-right.
 */

import { Surface } from "../theme/zentrixTokens";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Small stroked line icon (16px view, currentColor) built via DOM — cert-safe. */
function lineIcon(paths: string[]): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", "16");
    s.setAttribute("height", "16");
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

export const ICONS = {
    plus: ["M12 5v14", "M5 12h14"],
    minus: ["M5 12h14"],
    fit: ["M4 9V6a2 2 0 0 1 2-2h3", "M15 4h3a2 2 0 0 1 2 2v3", "M20 15v3a2 2 0 0 1-2 2h-3", "M9 20H6a2 2 0 0 1-2-2v-3"],
    reset: ["M20 12a8 8 0 1 1-2.34-5.66", "M20 4v4.5h-4.5"],
    undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
    redo: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
    download: ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"],
    // Eye with a slash — "hide the panels" (enter focus mode).
    eyeOff: ["M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.16 3.19", "M6.6 6.6C3.6 8.3 2 12 2 12s3.5 7 10 7a9.3 9.3 0 0 0 5.4-1.6", "M9.9 9.9a3 3 0 0 0 4.2 4.2", "M3 3l18 18"],
    // Open eye — "show the panels" (exit focus mode).
    eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
};

export type ExportFormat = "csv" | "pdf" | "png" | "xlsx";

export interface ExportMenuPlacementInput {
    hostWidth: number;
    hostHeight: number;
    barLeft: number;
    exportBottom: number;
    menuHeight: number;
}

/** Keep the export card inside the visual and physically separate from the
 *  vertical action bar. Width contracts only when the left-side space is tight. */
export function exportMenuPlacement(input: ExportMenuPlacementInput): {
    left: number; top: number; width: number; maxHeight: number;
} {
    const edge = 8;
    const gap = 8;
    const availableLeft = Math.max(0, input.barLeft - edge - gap);
    const width = Math.min(170, availableLeft);
    const maxHeight = Math.max(0, input.hostHeight - edge * 2);
    const height = Math.min(input.menuHeight, maxHeight);
    const left = Math.max(edge, input.barLeft - gap - width);
    const top = Math.max(edge, Math.min(
        input.exportBottom - height,
        input.hostHeight - edge - height,
    ));
    return { left, top, width, maxHeight };
}

/** Small stroked line icon element (16px, currentColor) — exported so other chrome
 *  (e.g. the focus-mode restore button) can reuse the exact icon language. */
export function makeLineIcon(paths: string[]): SVGSVGElement { return lineIcon(paths); }

export interface ActionBarHooks {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onResetLayout: () => void;
    /** Export through the host downloadService in the selected format. */
    onExport: (format: ExportFormat) => void;
    /** Enter focus mode — hide all chrome so only the graph shows (NG-118). */
    onFocusMode: () => void;
}

interface Btn { el: HTMLButtonElement; }

export class ActionBar {
    private host: HTMLElement;
    private root: HTMLDivElement;
    private sep: HTMLDivElement;
    private zoomIn: Btn;
    private zoomOut: Btn;
    private fit: Btn;
    private undo: Btn;
    private redo: Btn;
    private reset: Btn;
    private export: Btn;
    private focus: Btn;
    private exportMenu: HTMLDivElement;
    private exportItems: HTMLButtonElement[] = [];
    private menuSurface: Surface | null = null;
    private outsideMenuHandler = (ev: MouseEvent): void => {
        if (!this.root.contains(ev.target as Node)) this.closeExportMenu();
    };
    private menuKeyHandler = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
            this.closeExportMenu();
            this.export.el.focus();
        }
    };

    constructor(host: HTMLElement, hooks: ActionBarHooks) {
        this.host = host;
        this.root = document.createElement("div");
        this.root.className = "zx-actions";
        const s = this.root.style;
        s.position = "absolute";
        s.right = "10px";
        s.top = "10px";
        s.zIndex = "16";
        s.display = "none";
        s.flexDirection = "column";
        s.alignItems = "center";
        s.gap = "2px";
        s.padding = "6px";
        s.borderRadius = "14px";
        s.boxSizing = "border-box";

        this.zoomIn = this.makeBtn(ICONS.plus, "Zoom in", hooks.onZoomIn);
        this.zoomOut = this.makeBtn(ICONS.minus, "Zoom out", hooks.onZoomOut);
        this.fit = this.makeBtn(ICONS.fit, "Fit to screen", hooks.onFit);

        // Hairline divider between the zoom group and the layout/export group.
        this.sep = document.createElement("div");
        this.sep.className = "zx-action-sep";
        this.sep.style.cssText = "width:18px;height:1px;margin:4px 0;flex:0 0 auto";
        this.root.appendChild(this.sep);

        this.reset = this.makeBtn(ICONS.reset, "Reset layout", hooks.onResetLayout);
        this.undo = this.makeBtn(
            ICONS.undo, "Undo visual change", hooks.onUndo,
            "Undo visual change (Ctrl/Cmd+Z)", "Control+Z Meta+Z",
        );
        this.redo = this.makeBtn(
            ICONS.redo, "Redo visual change", hooks.onRedo,
            "Redo visual change (Ctrl/Cmd+Shift+Z or Ctrl+Y)",
            "Control+Shift+Z Meta+Shift+Z Control+Y",
        );
        this.export = this.makeBtn(ICONS.download, "Export", () => this.toggleExportMenu());
        this.export.el.setAttribute("aria-haspopup", "menu");
        this.export.el.setAttribute("aria-expanded", "false");
        this.focus = this.makeBtn(ICONS.eyeOff, "Hide panels (focus mode)", hooks.onFocusMode);

        this.exportMenu = document.createElement("div");
        this.exportMenu.className = "zx-export-menu";
        this.exportMenu.setAttribute("role", "menu");
        this.exportMenu.setAttribute("aria-label", "Export options");
        this.exportMenu.style.cssText = "position:absolute;right:52px;bottom:36px;width:170px;" +
            "display:none;flex-direction:column;gap:2px;padding:6px;border-radius:12px;" +
            "box-sizing:border-box;z-index:2;overflow-y:auto";
        const options: { format: ExportFormat; label: string }[] = [
            { format: "csv", label: "CSV data" },
            { format: "pdf", label: "PDF report" },
            { format: "png", label: "PNG snapshot" },
            { format: "xlsx", label: "Excel workbook" },
        ];
        for (const option of options) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "zx-export-option";
            item.setAttribute("role", "menuitem");
            item.setAttribute("aria-label", option.label);
            item.style.cssText = "width:100%;height:40px;display:flex;align-items:center;border:0;" +
                "border-radius:8px;background:transparent;padding:0 14px;text-align:left;cursor:pointer";
            const label = document.createElement("span");
            label.textContent = option.label;
            label.style.cssText = "font:600 12px/1.2 sans-serif;white-space:nowrap";
            item.appendChild(label);
            item.onclick = (ev) => {
                ev.stopPropagation();
                this.closeExportMenu();
                hooks.onExport(option.format);
            };
            this.exportItems.push(item);
            this.exportMenu.appendChild(item);
        }
        this.root.appendChild(this.exportMenu);
        host.appendChild(this.root);
    }

    private makeBtn(
        iconPaths: string[],
        label: string,
        onClick: () => void,
        title = label,
        keyShortcuts?: string,
    ): Btn {
        const el = document.createElement("button");
        el.className = "zx-action";
        el.type = "button";
        el.appendChild(lineIcon(iconPaths));
        el.title = title;
        el.setAttribute("aria-label", label);
        if (keyShortcuts) el.setAttribute("aria-keyshortcuts", keyShortcuts);
        const s = el.style;
        s.width = "30px";
        s.height = "30px";
        s.display = "flex";
        s.alignItems = "center";
        s.justifyContent = "center";
        s.border = "none";
        s.background = "transparent";
        s.borderRadius = "9px";
        s.cursor = "pointer";
        s.lineHeight = "1";
        s.padding = "0";
        el.onclick = (e) => { e.stopPropagation(); onClick(); };
        this.root.appendChild(el);
        return { el };
    }

    setTheme(surface: Surface): void {
        const dark = surface.bg !== "#FFFFFF";
        this.root.style.background = surface.bg;
        this.root.style.border = `1px solid ${surface.edge}${dark ? "" : "33"}`;
        this.root.style.boxShadow = dark
            ? "0 4px 14px rgba(0,0,0,0.45)"
            : "0 4px 14px rgba(11,16,32,0.12)";
        this.sep.style.background = surface.edge;
        this.sep.style.opacity = dark ? "0.5" : "0.35";
        for (const b of [this.zoomIn, this.zoomOut, this.fit, this.undo, this.redo, this.reset, this.export, this.focus]) {
            b.el.style.color = surface.fg;
        }
        this.menuSurface = surface;
        this.exportMenu.style.background = surface.bg;
        this.exportMenu.style.color = surface.fg;
        this.exportMenu.style.border = `1px solid ${surface.edge}${dark ? "" : "44"}`;
        this.exportMenu.style.boxShadow = dark
            ? "0 8px 24px rgba(0,0,0,0.5)"
            : "0 8px 24px rgba(11,16,32,0.18)";
        for (const item of this.exportItems) {
            item.style.color = surface.fg;
        }
    }

    /** Reflect availability: zoom buttons need the zoom controller enabled;
     *  undo/redo need their visual-history stacks; reset needs an authored
     *  (pinned/dragged) layout;
     *  export needs the host downloadService (hidden entirely without it). */
    setState(
        zoomEnabled: boolean,
        canUndo: boolean,
        canRedo: boolean,
        canReset: boolean,
        canExport = false,
    ): void {
        this.setEnabled(this.zoomIn, zoomEnabled);
        this.setEnabled(this.zoomOut, zoomEnabled);
        this.setEnabled(this.fit, zoomEnabled);
        this.setEnabled(this.undo, canUndo);
        this.setEnabled(this.redo, canRedo);
        this.setEnabled(this.reset, canReset);
        this.export.el.style.display = canExport ? "flex" : "none";
        if (!canExport) this.closeExportMenu();
    }

    private setEnabled(b: Btn, on: boolean): void {
        b.el.disabled = !on;
        b.el.style.opacity = on ? "1" : "0.35";
        b.el.style.cursor = on ? "pointer" : "default";
    }

    private toggleExportMenu(): void {
        if (this.exportMenu.style.display === "flex") {
            this.closeExportMenu();
            return;
        }
        if (this.menuSurface) this.setTheme(this.menuSurface);
        this.exportMenu.style.display = "flex";
        this.positionExportMenu();
        this.export.el.setAttribute("aria-expanded", "true");
        document.addEventListener("mousedown", this.outsideMenuHandler);
        document.addEventListener("keydown", this.menuKeyHandler);
        this.exportItems[0]?.focus();
    }

    private closeExportMenu(): void {
        this.exportMenu.style.display = "none";
        this.export.el.setAttribute("aria-expanded", "false");
        document.removeEventListener("mousedown", this.outsideMenuHandler);
        document.removeEventListener("keydown", this.menuKeyHandler);
    }

    /** Position after display so browser geometry is available. The menu uses
     *  host-relative clamping, then converts back to the action bar's local
     *  coordinates because it is mounted as the bar's child. */
    private positionExportMenu(): void {
        const hostRect = this.host.getBoundingClientRect();
        const rootRect = this.root.getBoundingClientRect();
        const exportRect = this.export.el.getBoundingClientRect();
        const hostWidth = this.host.clientWidth || hostRect.width;
        const hostHeight = this.host.clientHeight || hostRect.height;
        if (!(hostWidth > 0) || !(hostHeight > 0)) return;

        const rootWidth = rootRect.width || this.root.offsetWidth || 44;
        const rootLeft = rootRect.width > 0
            ? rootRect.left - hostRect.left
            : hostWidth - 10 - rootWidth;
        const rootTop = rootRect.height > 0
            ? rootRect.top - hostRect.top
            : 10;
        const exportBottom = exportRect.height > 0
            ? exportRect.bottom - hostRect.top
            : rootTop + this.export.el.offsetTop + 30;
        const menuHeight = this.exportMenu.offsetHeight || 180;
        const p = exportMenuPlacement({
            hostWidth, hostHeight, barLeft: rootLeft, exportBottom, menuHeight,
        });

        this.exportMenu.style.right = "auto";
        this.exportMenu.style.bottom = "auto";
        this.exportMenu.style.left = `${p.left - rootLeft}px`;
        this.exportMenu.style.top = `${p.top - rootTop}px`;
        this.exportMenu.style.width = `${p.width}px`;
        this.exportMenu.style.maxHeight = `${p.maxHeight}px`;

    }

    show(): void {
        this.root.style.display = "flex";
        if (this.exportMenu.style.display === "flex") this.positionExportMenu();
    }
    hide(): void { this.closeExportMenu(); this.root.style.display = "none"; }
}
