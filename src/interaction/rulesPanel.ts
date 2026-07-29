"use strict";

/**
 * Conditional-formatting Rules editor — 3a redesign ("sentence rows" + own dropdown).
 *
 * One dense ~29px row per rule that reads left-to-right as a sentence:
 *   enable · colour (opens picker) · field · operator · value · delete
 * so the count is unbounded and each rule is legible at a glance. The field and
 * operator pickers are OUR OWN flat dropdowns — grouped Numeric vs Text for the
 * field — never a native <select> (which renders as dark OS chrome that matches
 * nothing else in the product). Numeric fields expose ≥ > ≤ < = ≠ + a number box;
 * text fields expose is / is not / contains… + a text box. A header shows the live
 * active-count and a clear-all reset; an empty state invites the first rule.
 *
 * Built with createElement + textContent only — never innerHTML (cert rule). Emits
 * the full rule list on every edit; the visual persists + repaints. Public API
 * The optional close callback lets the visual keep the Rules-editor setting in sync
 * when the author dismisses the panel via its close button or by clicking away.
 */

import { Surface, fontFamily, accentStrong } from "../theme/zentrixTokens";
import { CFRule, CF_FIELDS, operatorsFor, fieldType, defaultRule } from "../model/conditionalFormat";
import { COLOR_PICKER_PRESETS } from "./colorPickerPresets";

const COLORS = ["#E5484D", "#2F80ED", "#F2994C", "#33B26B", "#7C5CFF", "#E25C9E"];
const FIELD_HELP: Record<string, string> = {
    degree: "The number of links connected to this node. This is called degree in network analysis.",
    weighted: "The total of the Edge weight values on links connected to this node.",
    size: "The Node size value when provided; otherwise the total Edge weight connected to this node.",
    centrality: "The node’s network-importance score from Analysis. It can measure Degree (number of links), Bridges (betweenness), Reach (closeness), or Influence (PageRank).",
};
const UNAVAILABLE_FIELD_HELP: Record<string, string> = {
    weighted: "Add data to the Edge weight field well to enable Value.",
    centrality: "Choose Degree, Bridges, Reach, or Influence in Analysis → Importance to enable this option.",
    category: "Add data to the Node category field well to enable Category.",
};
type AvailabilityField = "weighted" | "centrality" | "category";
type FieldAvailability = Record<AvailabilityField, boolean>;
interface DropdownItem { value: string; label: string; help?: string; disabled?: boolean }
interface DropdownGroup { label: string; items: DropdownItem[] }

/* Same manual HSV colour model used by the main settings bar. */
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
function hexToRgb(h: string): [number, number, number] {
    h = (h || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return [124, 92, 255];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
    const channel = (x: number): string => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const hexToHsv = (hex: string): { h: number; s: number; v: number } => {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHsv(r, g, b);
};
const hsvToHex = (h: number, s: number, v: number): string => {
    const [r, g, b] = hsvToRgb(h, s, v);
    return rgbToHex(r, g, b);
};
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Theme-resolved palette for one render pass (light defaults; dark via Surface). */
interface Skin { card: string; text: string; label: string; muted: string; faint: string; border: string; sep: string; track: string; accentSoft: string; }

export class RulesPanel {
    private el: HTMLDivElement;
    private headEl!: HTMLDivElement;
    private bodyEl!: HTMLDivElement;
    private rowsEl!: HTMLDivElement;
    private addBtn!: HTMLButtonElement;
    private rules: CFRule[] = [];
    private surface: Surface | null = null;
    private openMenu: HTMLDivElement | null = null;
    private onDocDown: ((e: MouseEvent) => void) | null = null;
    private onPanelDocDown: ((e: MouseEvent) => void) | null = null;
    private activeMenuHelp: { owner: HTMLElement; tip: HTMLElement } | null = null;
    private menuHelpId = 0;
    private manuallyDismissed = false;
    private fieldAvailability: FieldAvailability = {
        weighted: true, centrality: true, category: true,
    };

    constructor(
        host: HTMLElement,
        private onChange: (rules: CFRule[]) => void,
        private onClose?: () => void,
    ) {
        this.el = document.createElement("div");
        const s = this.el.style;
        s.position = "absolute";
        s.left = "50%";
        s.top = "12px";
        s.transform = "translateX(-50%)";
        s.width = "min(560px, calc(100% - 24px))";
        s.zIndex = "20";
        s.display = "none";
        s.borderRadius = "12px";
        s.boxSizing = "border-box";
        s.font = `12px ${fontFamily}`;
        s.boxShadow = "0 2px 6px rgba(16,24,40,.05),0 16px 40px -16px rgba(16,24,40,.28)";
        this.el.onclick = (e) => e.stopPropagation();
        host.appendChild(this.el);
        this.build();
    }

    private build(): void {
        // Header — title · "N active" pill · clear-all reset
        this.headEl = document.createElement("div");
        this.headEl.style.cssText = "display:flex;align-items:center;justify-content:space-between;height:42px;padding:0 14px;box-sizing:border-box";
        this.el.appendChild(this.headEl);

        // Scroll body holds the rows; the footer "+ Add rule" stays a DIRECT child of
        // the panel root so its parentElement is the element whose display toggles
        // (the visibility contract the integration test pins).
        this.bodyEl = document.createElement("div");
        this.bodyEl.style.cssText = "padding:6px 14px 4px;max-height:52vh;overflow-y:auto;box-sizing:border-box";
        this.el.appendChild(this.bodyEl);

        this.rowsEl = document.createElement("div");
        this.rowsEl.style.cssText = "display:flex;flex-direction:column";
        this.bodyEl.appendChild(this.rowsEl);

        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "+ Add rule";
        add.style.cssText = "display:block;margin:12px 14px 14px;width:calc(100% - 28px);height:36px;border:1.5px dashed;border-radius:8px;" +
            `background:transparent;color:${accentStrong};font:600 11.5px ${fontFamily};cursor:pointer`;
        add.onclick = () => {
            this.rules.push(defaultRule(COLORS[this.rules.length % COLORS.length]));
            this.emit();
            this.render();
        };
        this.el.appendChild(add);
        this.addBtn = add;
    }

    setTheme(surface: Surface): void {
        this.surface = surface;
        this.render();
    }

    /** Replace the editor's rules (called on a host round-trip). */
    setRules(rules: CFRule[]): void {
        this.rules = rules.map((r) => ({ ...r }));
        this.render();
    }

    /** Tell the editor which optional data/calculation-backed fields can produce
     *  values in the current visual. Unavailable choices remain visible so their
     *  adjacent help can explain exactly how to enable them. */
    setAvailability(next: Partial<FieldAvailability>): void {
        const merged = { ...this.fieldAvailability, ...next };
        const changed = (Object.keys(merged) as AvailabilityField[])
            .some((key) => merged[key] !== this.fieldAvailability[key]);
        if (!changed) return;
        this.fieldAvailability = merged;
        this.render();
    }

    configure(visible: boolean): void {
        if (!visible) this.manuallyDismissed = false;
        const show = visible && !this.manuallyDismissed;
        this.el.style.display = show ? "block" : "none";
        if (show) this.listenForOutsideClick();
        else {
            this.stopListeningForOutsideClick();
            this.closeMenu();
        }
    }

    hide(): void {
        this.el.style.display = "none";
        this.stopListeningForOutsideClick();
        this.closeMenu();
    }

    private emit(): void { this.onChange(this.rules.map((r) => ({ ...r }))); }

    private ruleAvailable(rule: CFRule): boolean {
        if (rule.field === "weighted") return this.fieldAvailability.weighted;
        if (rule.field === "centrality") return this.fieldAvailability.centrality;
        if (rule.field === "category") return this.fieldAvailability.category;
        return true;
    }

    private unavailableRuleReason(rule: CFRule): string {
        return UNAVAILABLE_FIELD_HELP[rule.field] ?? "This rule's field is unavailable.";
    }

    /** Resolve the render skin from the active Surface (light fallbacks match 3a). */
    private skin(): Skin {
        const dark = this.surface ? this.surface.bg.toLowerCase() < "#888888" : false;
        if (this.surface && dark) {
            return { card: this.surface.bg, text: this.surface.fg, label: this.surface.fg, muted: this.surface.muted,
                faint: this.surface.edge, border: this.surface.edge, sep: this.surface.edge, track: "rgba(255,255,255,.06)", accentSoft: "rgba(124,92,255,.22)" };
        }
        return { card: "#FFFFFF", text: "#1C2330", label: "#5B6477", muted: "#8A93A3", faint: "#B7BFCC",
            border: "#D8DDE6", sep: "#E8EBF1", track: "#F3F4F6", accentSoft: "rgba(124,92,255,.06)" };
    }

    private render(): void {
        this.closeMenu();
        const k = this.skin();
        this.el.style.background = k.card;
        this.el.style.border = `1px solid ${k.border}`;
        this.el.style.color = k.text;
        this.headEl.style.borderBottom = `1px solid ${k.sep}`;
        this.addBtn.style.borderColor = k.border;

        this.renderHeader(k);

        while (this.rowsEl.firstChild) this.rowsEl.removeChild(this.rowsEl.firstChild);
        if (!this.rules.length) { this.rowsEl.appendChild(this.emptyState(k)); return; }
        this.rules.forEach((rule, idx) => this.rowsEl.appendChild(this.ruleRow(rule, idx, k)));
    }

    private renderHeader(k: Skin): void {
        while (this.headEl.firstChild) this.headEl.removeChild(this.headEl.firstChild);
        const left = document.createElement("span");
        left.style.cssText = "display:flex;align-items:center;gap:9px";
        const title = document.createElement("span");
        title.textContent = "CONDITIONAL FORMATTING";
        title.style.cssText = `font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${k.label}`;
        left.appendChild(title);
        const active = this.rules.filter((r) => r.enabled && this.ruleAvailable(r)).length;
        if (active > 0) {
            const pill = document.createElement("span");
            pill.textContent = `${active} active`;
            pill.style.cssText = `font:700 10px ${fontFamily};padding:2px 7px;border-radius:999px;background:rgba(124,92,255,.10);color:${accentStrong}`;
            left.appendChild(pill);
        }
        this.headEl.appendChild(left);

        const actions = document.createElement("span");
        actions.style.cssText = "display:flex;align-items:center;gap:3px";

        const reset = document.createElement("button");
        reset.type = "button";
        reset.title = "Clear all rules";
        reset.setAttribute("aria-label", "Clear all rules");
        reset.style.cssText = `width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:${k.muted};cursor:pointer`;
        reset.appendChild(icon("reset", k.muted));
        reset.onclick = () => { if (!this.rules.length) return; this.rules = []; this.emit(); this.render(); };
        actions.appendChild(reset);

        const close = document.createElement("button");
        close.type = "button";
        close.title = "Close rules editor";
        close.setAttribute("aria-label", "Close rules editor");
        close.style.cssText = `width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:${k.muted};cursor:pointer`;
        close.appendChild(icon("close", k.muted));
        close.onclick = (e) => { e.stopPropagation(); this.dismiss(); };
        actions.appendChild(close);

        this.headEl.appendChild(actions);
    }

    private emptyState(k: Skin): HTMLElement {
        const wrap = document.createElement("div");
        wrap.style.cssText = "padding:16px 8px 18px;display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center";
        const glyph = document.createElement("div");
        glyph.style.cssText = `width:34px;height:34px;border-radius:9px;background:${k.track};display:grid;place-items:center;color:${k.faint}`;
        glyph.appendChild(icon("nodes", k.faint));
        const msg = document.createElement("div");
        msg.textContent = "No rules yet. Add one to colour nodes by links, value, importance, name, or category.";
        msg.style.cssText = `font:400 11.5px ${fontFamily};line-height:1.55;color:${k.label};max-width:250px`;
        wrap.appendChild(glyph); wrap.appendChild(msg);
        return wrap;
    }

    private ruleRow(rule: CFRule, idx: number, k: Skin): HTMLElement {
        const row = document.createElement("div");
        const available = this.ruleAvailable(rule);
        row.style.cssText = "display:flex;align-items:center;gap:7px;padding:9px 2px;box-sizing:border-box;" +
            (idx < this.rules.length - 1 ? `border-bottom:1px solid ${k.sep};` : "") +
            (rule.enabled && available ? "" : "opacity:.55;");
        if (!available) {
            row.setAttribute("aria-disabled", "true");
            row.title = this.unavailableRuleReason(rule);
        }

        row.appendChild(this.toggle(rule, available));
        row.appendChild(this.colorSwatch(rule, k));
        row.appendChild(this.fieldPicker(rule, k));
        row.appendChild(this.opPicker(rule, k));
        row.appendChild(this.valueInput(rule, k));
        row.appendChild(this.delBtn(idx, k));
        return row;
    }

    private toggle(rule: CFRule, available = true): HTMLElement {
        const t = document.createElement("button");
        t.type = "button";
        t.setAttribute("aria-label", available ? "Enable rule" : `Rule inactive. ${this.unavailableRuleReason(rule)}`);
        t.setAttribute("role", "switch");
        t.setAttribute("aria-checked", String(rule.enabled && available));
        t.setAttribute("aria-disabled", String(!available));
        t.disabled = !available;
        t.style.cssText = `position:relative;flex:none;width:30px;height:17px;border:0;border-radius:9px;cursor:${available ? "pointer" : "not-allowed"};` +
            `background:${rule.enabled && available ? accentStrong : "rgba(120,120,140,0.3)"}`;
        const knob = document.createElement("span");
        knob.style.cssText = "position:absolute;top:2px;left:" + (rule.enabled && available ? "15px" : "2px") +
            ";width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.25);transition:.15s";
        t.appendChild(knob);
        t.onclick = () => { rule.enabled = !rule.enabled; this.emit(); this.render(); };
        return t;
    }

    /** Colour dot opens the same HSV + preset picker pattern as the settings bar. */
    private colorSwatch(rule: CFRule, k: Skin): HTMLElement {
        const b = document.createElement("button");
        b.type = "button";
        b.title = "Choose rule colour";
        b.setAttribute("aria-label", "Rule colour");
        b.setAttribute("aria-haspopup", "dialog");
        b.setAttribute("aria-expanded", "false");
        b.style.cssText = `flex:none;width:19px;height:19px;border-radius:50%;border:2px solid ${k.card};` +
            `box-shadow:0 0 0 1px rgba(16,24,40,.14);cursor:pointer;background:${rule.color || COLORS[0]}`;
        b.onclick = (e) => {
            e.stopPropagation();
            if (this.openMenu?.dataset.owner === "color" && this.menuOwner === b) {
                this.closeMenu();
                return;
            }
            this.openColorPicker(b, rule, k);
        };
        return b;
    }

    private openColorPicker(trig: HTMLButtonElement, rule: CFRule, k: Skin): void {
        this.closeMenu();
        const picker = document.createElement("div");
        picker.dataset.owner = "color";
        picker.setAttribute("role", "dialog");
        picker.setAttribute("aria-label", "Choose rule colour");
        picker.style.cssText = `position:absolute;z-index:60;width:224px;box-sizing:border-box;padding:12px;` +
            `background:${k.card};border:1px solid ${k.border};border-radius:11px;` +
            "box-shadow:0 10px 28px -8px rgba(16,24,40,.28)";

        const sv = document.createElement("div");
        sv.setAttribute("data-color-control", "saturation-value");
        sv.style.cssText = "position:relative;width:100%;height:94px;border-radius:9px;cursor:crosshair;overflow:hidden;" +
            "touch-action:none;box-shadow:inset 0 0 0 1px rgba(20,23,50,.12)";
        const svWhite = document.createElement("div");
        svWhite.style.cssText = "position:absolute;inset:0;background:linear-gradient(to right,#fff,rgba(255,255,255,0));pointer-events:none";
        const svBlack = document.createElement("div");
        svBlack.style.cssText = "position:absolute;inset:0;background:linear-gradient(to top,#000,rgba(0,0,0,0));pointer-events:none";
        const svThumb = document.createElement("div");
        svThumb.style.cssText = "position:absolute;width:15px;height:15px;border-radius:50%;border:2.5px solid #fff;" +
            "box-shadow:0 0 0 1px rgba(0,0,0,.45);transform:translate(-50%,-50%);pointer-events:none";
        sv.append(svWhite, svBlack, svThumb);

        const hue = document.createElement("div");
        hue.setAttribute("data-color-control", "hue");
        hue.style.cssText = "position:relative;height:14px;border-radius:999px;margin-top:11px;cursor:pointer;touch-action:none;" +
            "background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
        const hueThumb = document.createElement("div");
        hueThumb.style.cssText = "position:absolute;top:50%;width:16px;height:16px;border-radius:50%;background:#fff;" +
            "box-shadow:0 1px 3px rgba(16,24,64,.4),inset 0 0 0 1px rgba(0,0,0,.12);" +
            "transform:translate(-50%,-50%);pointer-events:none";
        hue.appendChild(hueThumb);

        const colorRow = document.createElement("div");
        colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:11px";
        const chip = document.createElement("div");
        chip.style.cssText = "width:22px;height:22px;border-radius:50%;flex:none;" +
            "box-shadow:inset 0 0 0 1px rgba(13,14,26,.18),0 2px 6px rgba(13,14,26,.18)";
        const hex = document.createElement("input");
        hex.type = "text";
        hex.setAttribute("aria-label", "Rule colour hex value");
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.style.cssText = `height:32px;box-sizing:border-box;min-width:0;flex:1;border:1px solid ${k.border};border-radius:9px;` +
            `background:${k.track};padding:0 10px;color:${k.text};font:500 12px ui-monospace,SFMono-Regular,Menlo,monospace;outline:none`;
        colorRow.append(chip, hex);

        const presetGrid = document.createElement("div");
        presetGrid.style.cssText = "display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:11px";
        picker.append(sv, hue, colorRow, presetGrid);

        const start = isHex(rule.color) ? rule.color : COLORS[0];
        const state = hexToHsv(start);
        const paint = (commit: boolean): void => {
            const color = hsvToHex(state.h, state.s, state.v);
            sv.style.background = `hsl(${state.h},100%,50%)`;
            svThumb.style.left = `${state.s * 100}%`;
            svThumb.style.top = `${(1 - state.v) * 100}%`;
            svThumb.style.background = color;
            hueThumb.style.left = `${(state.h / 360) * 100}%`;
            chip.style.background = color;
            hex.value = color.toUpperCase();
            presetGrid.querySelectorAll<HTMLButtonElement>("button").forEach((swatch) => {
                const active = swatch.dataset.color?.toLowerCase() === color.toLowerCase();
                swatch.setAttribute("aria-pressed", String(active));
                swatch.style.boxShadow = active
                    ? `0 0 0 2px ${k.card},0 0 0 4px ${accentStrong}`
                    : "inset 0 0 0 1px rgba(20,23,50,.16)";
            });
            if (commit) {
                rule.color = color.toUpperCase();
                trig.style.background = rule.color;
                this.emit();
            }
        };
        const drag = (apply: (clientX: number, clientY: number) => void) => (e: PointerEvent): void => {
            e.preventDefault();
            apply(e.clientX, e.clientY);
            const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY);
            const up = (): void => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
        };
        sv.addEventListener("pointerdown", drag((clientX, clientY) => {
            const r = sv.getBoundingClientRect();
            if (!r.width || !r.height) return;
            state.s = clamp01((clientX - r.left) / r.width);
            state.v = clamp01(1 - (clientY - r.top) / r.height);
            paint(true);
        }));
        hue.addEventListener("pointerdown", drag((clientX) => {
            const r = hue.getBoundingClientRect();
            if (!r.width) return;
            state.h = clamp01((clientX - r.left) / r.width) * 360;
            paint(true);
        }));
        hex.onchange = () => {
            let value = hex.value.trim();
            if (value && !value.startsWith("#")) value = `#${value}`;
            if (!isHex(value)) {
                paint(false);
                return;
            }
            Object.assign(state, hexToHsv(value));
            paint(true);
        };
        for (const color of COLOR_PICKER_PRESETS) {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.dataset.color = color;
            swatch.title = color;
            swatch.setAttribute("aria-label", `Use ${color}`);
            swatch.style.cssText = `width:100%;aspect-ratio:1;border-radius:6px;border:0;cursor:pointer;background:${color}`;
            swatch.onclick = (e) => {
                e.stopPropagation();
                Object.assign(state, hexToHsv(color));
                paint(true);
            };
            presetGrid.appendChild(swatch);
        }
        paint(false);

        this.el.appendChild(picker);
        const panelRect = this.el.getBoundingClientRect();
        const trigRect = trig.getBoundingClientRect();
        const pickerWidth = 224;
        let top = trigRect.bottom - panelRect.top + 6;
        if (top + picker.offsetHeight > this.el.offsetHeight && trigRect.top - panelRect.top - picker.offsetHeight - 6 > 0) {
            top = trigRect.top - panelRect.top - picker.offsetHeight - 6;
        }
        picker.style.left = `${Math.max(4, Math.min(trigRect.left - panelRect.left, this.el.offsetWidth - pickerWidth - 4))}px`;
        picker.style.top = `${top}px`;

        trig.setAttribute("aria-expanded", "true");
        this.openMenu = picker;
        this.menuOwner = trig;
        this.onDocDown = (ev) => {
            if (!picker.contains(ev.target as Node) && ev.target !== trig) this.closeMenu();
        };
        document.addEventListener("mousedown", this.onDocDown, true);
    }

    private fieldPicker(rule: CFRule, k: Skin): HTMLElement {
        const cur = CF_FIELDS.find((f) => f.id === rule.field);
        const item = (f: typeof CF_FIELDS[number]): DropdownItem => {
            const availabilityKey = f.id as AvailabilityField;
            const hasDependency = Object.prototype.hasOwnProperty.call(this.fieldAvailability, availabilityKey);
            const disabled = hasDependency && !this.fieldAvailability[availabilityKey];
            return {
                value: f.id,
                label: f.label,
                help: disabled ? UNAVAILABLE_FIELD_HELP[f.id] : FIELD_HELP[f.id],
                disabled,
            };
        };
        const groups = [
            { label: "Numbers", items: CF_FIELDS.filter((f) => f.type === "num").map(item) },
            { label: "Text", items: CF_FIELDS.filter((f) => f.type === "text").map(item) },
        ];
        return this.dropdown(cur?.label ?? rule.field, rule.field, groups, k, { flex: "1.3", strong: true, aria: "Field", menuW: 158 }, (val) => {
            const wasText = fieldType(rule.field) === "text";
            rule.field = val;
            if ((fieldType(rule.field) === "text") !== wasText || !operatorsFor(rule.field).some((o) => o[0] === rule.op)) {
                rule.op = operatorsFor(rule.field)[0][0];
                rule.value = fieldType(rule.field) === "text" ? "" : "5";
            }
            this.emit(); this.render();
        });
    }

    private opPicker(rule: CFRule, k: Skin): HTMLElement {
        const ops = operatorsFor(rule.field);
        const curGlyph = ops.find(([id]) => id === rule.op)?.[1] ?? ops[0][1];
        const items = ops.map(([id, glyph]) => ({ value: id, label: glyph }));
        return this.dropdown(curGlyph, rule.op, [{ label: "", items }], k, { width: "48px", center: true, aria: "Operator", menuW: 96 }, (val) => {
            rule.op = val as CFRule["op"]; this.emit(); this.render();
        });
    }

    private valueInput(rule: CFRule, k: Skin): HTMLElement {
        const isText = fieldType(rule.field) === "text";
        const inp = document.createElement("input");
        inp.type = isText ? "text" : "number";
        inp.value = rule.value;
        inp.placeholder = isText ? "value" : "0";
        inp.setAttribute("aria-label", "Value");
        inp.style.cssText = `${isText ? "flex:1;min-width:52px;" : "width:52px;flex:none;"}box-sizing:border-box;height:29px;` +
            `border:1px solid ${k.border};border-radius:7px;background:transparent;color:${k.text};` +
            `text-align:${isText ? "left" : "center"};padding:0 8px;font:500 11.5px ui-monospace,Menlo,monospace;outline:none`;
        inp.oninput = () => { rule.value = inp.value; };
        inp.onchange = () => { rule.value = inp.value; this.emit(); };
        return inp;
    }

    private delBtn(idx: number, k: Skin): HTMLElement {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "✕";                       // kept as text (regression contract)
        b.title = "Delete rule";
        b.setAttribute("aria-label", "Delete rule");
        b.style.cssText = `flex:none;width:24px;height:24px;border:0;background:transparent;color:${k.faint};` +
            "cursor:pointer;border-radius:6px;font-size:11px;line-height:1";
        b.onclick = () => { this.rules.splice(idx, 1); this.emit(); this.render(); };
        return b;
    }

    /* ── our own flat dropdown (never a native <select>) ── */
    private dropdown(
        curLabel: string, curValue: string,
        groups: DropdownGroup[],
        k: Skin,
        opt: { flex?: string; width?: string; center?: boolean; strong?: boolean; aria?: string; menuW?: number },
        onPick: (value: string) => void,
    ): HTMLElement {
        const trig = document.createElement("button");
        trig.type = "button";
        if (opt.aria) trig.setAttribute("aria-label", `${opt.aria}: ${curLabel}`);
        trig.setAttribute("aria-haspopup", "listbox");
        const base = `${opt.flex ? `flex:${opt.flex};` : ""}${opt.width ? `width:${opt.width};flex:none;` : ""}` +
            `display:flex;align-items:center;${opt.center ? "justify-content:center;" : "justify-content:space-between;"}gap:6px;` +
            `height:29px;box-sizing:border-box;border:1px solid ${k.border};border-radius:7px;padding:0 8px;cursor:pointer;background:transparent`;
        trig.style.cssText = base;
        const lab = document.createElement("span");
        lab.textContent = curLabel;
        lab.style.cssText = `font:${opt.strong ? "600" : "500"} 11px ${fontFamily};color:${k.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
        trig.appendChild(lab);
        if (!opt.center) trig.appendChild(icon("caret", k.muted));

        trig.onclick = (e) => {
            e.stopPropagation();
            if (this.openMenu && this.openMenu.dataset.owner === "1" && this.menuOwner === trig) { this.closeMenu(); return; }
            this.openDropdown(trig, curValue, groups, k, opt.menuW ?? 160, onPick);
        };
        return trig;
    }

    private menuOwner: HTMLElement | null = null;
    private openDropdown(
        trig: HTMLElement, curValue: string,
        groups: DropdownGroup[],
        k: Skin, menuW: number, onPick: (value: string) => void,
    ): void {
        this.closeMenu();
        const menu = document.createElement("div");
        menu.dataset.owner = "1";
        menu.setAttribute("role", "listbox");
        menu.style.cssText = `position:absolute;z-index:60;width:${menuW}px;box-sizing:border-box;padding:5px;` +
            `background:${k.card};border:1px solid ${k.border};border-radius:9px;box-shadow:0 10px 28px -8px rgba(16,24,40,.28)`;
        // trigger active outline
        trig.style.borderColor = accentStrong;

        for (const g of groups) {
            if (g.label) {
                const gh = document.createElement("div");
                gh.textContent = g.label.toUpperCase();
                gh.style.cssText = `font:700 9px ${fontFamily};letter-spacing:.06em;color:${k.faint};padding:5px 8px 3px`;
                menu.appendChild(gh);
            }
            for (const it of g.items) {
                const sel = it.value === curValue;
                const row = document.createElement("div");
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", String(sel));
                row.setAttribute("aria-disabled", String(!!it.disabled));
                row.tabIndex = it.disabled ? -1 : 0;
                row.style.cssText = "display:flex;align-items:center;justify-content:space-between;width:100%;height:29px;box-sizing:border-box;padding:0 8px;" +
                    `border:0;border-radius:6px;cursor:${it.disabled ? "not-allowed" : "pointer"};background:${sel ? "rgba(124,92,255,.06)" : "transparent"};` +
                    `color:${it.disabled ? k.muted : (sel ? accentStrong : k.text)};font:${sel ? "600" : "500"} 11.5px ${fontFamily};text-align:left;` +
                    (it.disabled ? "opacity:.62;" : "");
                const labelGroup = document.createElement("span");
                labelGroup.style.cssText = "display:flex;align-items:center;gap:3px;min-width:0";
                const label = document.createElement("span");
                label.textContent = it.label;
                label.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
                labelGroup.appendChild(label);
                if (it.help) labelGroup.appendChild(this.fieldHelp(it.label, it.help, k));
                row.appendChild(labelGroup);
                const end = document.createElement("span");
                end.style.cssText = "display:flex;align-items:center;flex:none";
                if (sel) end.appendChild(icon("check", it.disabled ? k.muted : accentStrong));
                row.appendChild(end);
                row.onmouseenter = () => { if (!sel && !it.disabled) row.style.background = k.track; };
                row.onmouseleave = () => {
                    if (!sel && !it.disabled) row.style.background = "transparent";
                    if (this.activeMenuHelp?.owner.parentElement === labelGroup) this.hideMenuHelp();
                };
                row.onclick = (e) => {
                    e.stopPropagation();
                    if (it.disabled) return;
                    this.closeMenu();
                    onPick(it.value);
                };
                row.onkeydown = (e) => {
                    if (it.disabled) return;
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault(); e.stopPropagation(); this.closeMenu(); onPick(it.value);
                };
                menu.appendChild(row);
            }
            if (g.label && groups.length > 1 && g !== groups[groups.length - 1]) {
                const sep = document.createElement("div");
                sep.style.cssText = `height:1px;background:${k.sep};margin:3px 4px`;
                menu.appendChild(sep);
            }
        }

        // Position relative to the panel root (scroll-independent).
        this.el.appendChild(menu);
        const pr = this.el.getBoundingClientRect();
        const tr = trig.getBoundingClientRect();
        let top = tr.bottom - pr.top + 4;
        // flip up if it would overflow the panel bottom
        const menuH = menu.offsetHeight;
        if (top + menuH > this.el.offsetHeight && tr.top - pr.top - menuH - 4 > 0) top = tr.top - pr.top - menuH - 4;
        menu.style.left = `${Math.max(4, Math.min(tr.left - pr.left, this.el.offsetWidth - menuW - 4))}px`;
        menu.style.top = `${top}px`;

        this.openMenu = menu; this.menuOwner = trig;
        this.onDocDown = (ev) => { if (!menu.contains(ev.target as Node) && ev.target !== trig) this.closeMenu(); };
        document.addEventListener("mousedown", this.onDocDown, true);
    }

    /** Keyboard/pointer-accessible contextual help for non-obvious rule fields. */
    private fieldHelp(label: string, explanation: string, k: Skin): HTMLElement {
        const help = document.createElement("button");
        help.type = "button";
        help.textContent = "?";
        help.setAttribute("aria-label", `About ${label}`);
        const id = `zx-cf-field-help-${++this.menuHelpId}`;
        help.setAttribute("aria-describedby", id);
        help.style.cssText = `width:12px;height:12px;display:grid;place-items:center;padding:0;border:1px solid ${k.faint};` +
            `border-radius:50%;background:transparent;color:${k.muted};font:700 7.5px ${fontFamily};line-height:1;cursor:help;flex:none`;

        const tip = document.createElement("span");
        tip.id = id;
        tip.setAttribute("role", "tooltip");
        tip.textContent = explanation;
        tip.style.cssText = `display:none;position:absolute;z-index:80;width:238px;box-sizing:border-box;padding:9px 10px;` +
            `border:1px solid ${k.border};border-radius:8px;background:${k.card};color:${k.text};` +
            `font:500 10.5px/1.45 ${fontFamily};text-align:left;box-shadow:0 10px 28px -8px rgba(16,24,40,.28)`;
        help.appendChild(tip);

        help.onmouseenter = () => this.showMenuHelp(help, tip);
        help.onmouseleave = () => this.hideMenuHelp();
        help.onfocus = () => this.showMenuHelp(help, tip);
        help.onblur = () => this.hideMenuHelp();
        help.onmousedown = (e) => e.stopPropagation();
        help.onclick = (e) => {
            e.stopPropagation();
            this.showMenuHelp(help, tip);
        };
        help.onkeydown = (e) => e.stopPropagation();
        return help;
    }

    private showMenuHelp(owner: HTMLElement, tip: HTMLElement): void {
        if (this.activeMenuHelp?.owner === owner) return;
        this.hideMenuHelp();
        this.activeMenuHelp = { owner, tip };
        this.el.appendChild(tip);
        tip.style.display = "block";
        const panel = this.el.getBoundingClientRect();
        const anchor = owner.getBoundingClientRect();
        const width = 238;
        const panelWidth = this.el.offsetWidth || panel.width || 560;
        const leftPreferred = anchor.right - panel.left + 7;
        tip.style.left = `${Math.max(4, Math.min(leftPreferred, panelWidth - width - 4))}px`;
        tip.style.top = `${Math.max(4, anchor.top - panel.top - 3)}px`;
    }

    private hideMenuHelp(): void {
        const active = this.activeMenuHelp;
        if (!active) return;
        active.tip.style.display = "none";
        if (active.owner.isConnected) active.owner.appendChild(active.tip);
        else active.tip.remove();
        this.activeMenuHelp = null;
    }

    private closeMenu(): void {
        this.hideMenuHelp();
        if (this.onDocDown) { document.removeEventListener("mousedown", this.onDocDown, true); this.onDocDown = null; }
        if (this.menuOwner) {
            // Dropdown triggers receive a temporary accent border; colour swatches do
            // not, so keep their theme-matched ring intact when their dialog closes.
            if (this.openMenu?.dataset.owner === "1") this.menuOwner.style.borderColor = "";
            this.menuOwner.setAttribute("aria-expanded", "false");
            this.menuOwner = null;
        }
        if (this.openMenu) { this.openMenu.remove(); this.openMenu = null; }
    }

    private listenForOutsideClick(): void {
        if (this.onPanelDocDown) return;
        this.onPanelDocDown = (event) => {
            if (!this.el.contains(event.target as Node)) this.dismiss();
        };
        document.addEventListener("mousedown", this.onPanelDocDown, true);
    }

    private stopListeningForOutsideClick(): void {
        if (!this.onPanelDocDown) return;
        document.removeEventListener("mousedown", this.onPanelDocDown, true);
        this.onPanelDocDown = null;
    }

    private dismiss(): void {
        if (this.el.style.display === "none") return;
        this.manuallyDismissed = true;
        this.hide();
        this.onClose?.();
    }
}

/* ── tiny inline-SVG icon set (currentColor; createElementNS, never innerHTML) ── */
const NS = "http://www.w3.org/2000/svg";
function icon(name: "caret" | "check" | "reset" | "close" | "nodes", color: string): SVGSVGElement {
    const s = document.createElementNS(NS, "svg");
    const size = name === "nodes" ? 17 : name === "reset" || name === "close" ? 13 : name === "check" ? 11 : 9;
    s.setAttribute("width", String(size)); s.setAttribute("height", String(size));
    s.setAttribute("viewBox", name === "nodes" ? "0 0 18 18" : "0 0 16 16");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", color);
    s.setAttribute("stroke-width", name === "check" ? "2" : name === "caret" ? "1.8" : "1.6");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    const paths: Record<string, string[]> = {
        caret: ["M3.5 6 8 10.5 12.5 6"],
        check: ["M3.5 8.5 6.5 11.5 12.5 4.5"],
        reset: ["M2.5 8a5.5 5.5 0 1 0 1.7-3.98", "M2.2 2v3.3h3.3"],
        close: ["M4 4l8 8", "M12 4l-8 8"],
        nodes: [],
    };
    for (const d of paths[name]) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.appendChild(p); }
    if (name === "nodes") {
        for (const [cx, cy] of [[6.5, 6.5], [11.5, 11.5]]) {
            const c = document.createElementNS(NS, "circle");
            c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy)); c.setAttribute("r", "3.4");
            s.appendChild(c);
        }
    }
    return s;
}
