"use strict";

import type powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { VisualFormattingSettingsModel } from "../settings";
import { ZentrixSettingsBar } from "./zentrixSettingsBar";
import type { SBCategory, SBCfg } from "./zentrixSettingsBar";
import {
    SB_CATS, SB_FONTS, SB_PALETTES, SB_PRESETS, SB_EMOJI, SB_EMOJI_NAMES,
    makeCfg, applyLocal, readLocal, emitPersistence, settingKeys,
} from "./settingsSchema";
import { cornerInset, Corner } from "./chromePlacement";

type Model = VisualFormattingSettingsModel;
export type SettingsState = Record<string, unknown>;

/** Per-visual schema copy. Dynamic limits must not mutate the exported SB_CATS
 * singleton because one report can host several network visuals with different
 * node totals. Functions inside fields remain shared; only mutable containers
 * and field records are cloned. */
function cloneCategories(categories: readonly SBCategory[]): SBCategory[] {
    return categories.map((category) => ({
        ...category,
        subs: category.subs.map((sub) => ({
            ...sub,
            fields: sub.fields?.map((field) => ({ ...field })),
            options: sub.options ? [...sub.options] : undefined,
            swatches: sub.swatches ? [...sub.swatches] : undefined,
        })),
    }));
}

/** Shallow-clone a slice value so the live model can't share a default object
 *  reference with the throwaway defaults model (which would alias future edits). */
function clone<T>(v: T): T {
    if (v && typeof v === "object") return { ...(v as object) } as T;
    return v;
}

/** Serialize a slice's value into the shape persistProperties expects, by the
 *  same kind-inference the settings sweep uses. Returns undefined for kinds we
 *  can't persist (composite/unknown) so they are skipped, not corrupted. */
function persistValue(slice: { value: unknown; items?: unknown[] }): powerbi.DataViewPropertyValue | undefined {
    const v = slice.value as { value?: unknown } | boolean | number | string | null;
    if (Array.isArray(slice.items)) return String((v as { value: unknown }).value);   // dropdown → item value
    if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
    if (v && typeof v.value === "string") return { solid: { color: v.value } } as unknown as powerbi.DataViewPropertyValue; // color
    return undefined;
}

/**
 * In-visual settings overlay. Thin host wrapper around the reusable Zentrix
 * Settings Bar: wires the live formatting model + persistProperties to the bar
 * and forwards theme / position / visibility from the visual's update loop.
 * Public API (constructor, update, setCorner, forceOpen) is unchanged so
 * visual.ts and the preview harness keep working as-is.
 */
export class SettingsOverlay {
    private bar: ZentrixSettingsBar;
    private cfg: SBCfg;
    private cats: SBCategory[];
    /** Unwrapped adapter used by history replay so restoration does not record itself. */
    private rawCfg: SBCfg;
    private settings!: Model;
    private pref = "auto";
    /** Optimistic edits not yet confirmed by a host round-trip — replayed onto every
     *  freshly-populated model so a stale update() can't revert the canvas. */
    private pending = new Map<string, unknown>();
    /** Data-role availability the schema reads via `@`-prefixed keys (e.g. `@hasParent`)
     *  to gate/annotate controls that only apply when a given field is bound. */
    private flags: Record<string, unknown> = {};

    /** The host element the settings bar mounts into — kept so we can reach the
     *  mirrored bar's `.zsb-anchor` and lift the collapsed gear locally without
     *  style-editing the mirror (see `syncGearLift`). */
    private root: HTMLElement;

    constructor(
        root: HTMLElement,
        private host: IVisualHost,
        private onChange?: (resetAll?: boolean) => void,
        private onHistoryStart?: () => void,
        private onHistoryCommit?: () => void,
    ) {
        this.root = root;
        const persist = (object: string, prop: string, value: powerbi.DataViewPropertyValue) =>
            this.host.persistProperties({ merge: [{ objectName: object, selector: null, properties: { [prop]: value } }] } as powerbi.VisualObjectInstancesToPersist);
        // On every edit: record it as pending (so the next host update() can't clobber it)
        // and repaint immediately from the optimistically-updated model.
        this.rawCfg = makeCfg(() => this.settings, persist, (key, value) => {
            this.pending.set(key, value);
        }, undefined, () => this.flags);
        // Wrap all user-authored settings actions as one history transaction. A
        // per-card/global Reset is one action even though it persists many keys.
        this.cfg = {
            get: (key) => this.rawCfg.get(key),
            set: (key, value) => this.runAuthoringEdit(() => this.rawCfg.set(key, value)),
            resetKeys: (keys) => this.runAuthoringEdit(() => this.rawCfg.resetKeys?.(keys)),
            reset: () => this.runAuthoringEdit(() => this.reset(), true),
        };
        this.cats = cloneCategories(SB_CATS);
        this.bar = new ZentrixSettingsBar(root, {
            cfg: this.cfg, cats: this.cats, fonts: SB_FONTS, palettes: SB_PALETTES, presets: SB_PRESETS, emoji: SB_EMOJI, emojiNames: SB_EMOJI_NAMES,
            corner: "bl", dark: false, closeOnAway: true,
        });
    }

    /** Apply an edit initiated by another in-visual surface through the same
     * optimistic + persistence path as a settings-bar control. */
    setValue(key: string, value: unknown): void {
        this.cfg.set(key, value);
    }

    /** Apply several edits initiated by one external UI action as one repaint and one
     *  authoring-history transaction (for example closing a multi-section panel). */
    setValues(values: Record<string, unknown>): void {
        this.runAuthoringEdit(() => {
            const grouped = new Map<string, Record<string, powerbi.DataViewPropertyValue>>();
            for (const [key, value] of Object.entries(values)) {
                let recognized = false;
                emitPersistence(key, value, (object, prop, persistedValue) => {
                    recognized = true;
                    const properties = grouped.get(object) ?? {};
                    properties[prop] = persistedValue;
                    grouped.set(object, properties);
                });
                if (!recognized) continue;
                applyLocal(this.settings, key, value);
                this.pending.set(key, value);
            }
            if (grouped.size) {
                const merge = [...grouped].map(([objectName, properties]) => ({
                    objectName, selector: null, properties,
                }));
                this.host.persistProperties({ merge } as powerbi.VisualObjectInstancesToPersist);
            }
            if (this.bar.isOpen()) {
                (this.bar as unknown as { refreshActiveDetail: () => void }).refreshActiveDetail();
            }
        });
    }

    /** Snapshot every writable formatting control as primitive engine values. */
    snapshotState(): SettingsState {
        if (!this.settings) return {};
        const state: SettingsState = {};
        for (const key of settingKeys()) state[key] = readLocal(this.settings, key);
        return state;
    }

    /** Restore a settings snapshot without creating a nested history entry.
     *  Only changed keys are persisted; the caller performs one final repaint. */
    restoreState(state: SettingsState, exclude = new Set<string>()): boolean {
        if (!this.settings) return false;
        let changed = false;
        for (const key of settingKeys()) {
            if (!(key in state) || exclude.has(key)) continue;
            const before = readLocal(this.settings, key);
            const after = state[key];
            if (String(before) === String(after)) continue;
            this.rawCfg.set(key, after);
            changed = true;
        }
        if (changed && this.bar.isOpen()) {
            // The mirrored engine keeps this renderer private, but history replay is
            // an exceptional host-driven refresh: rebuild the active detail so open
            // controls immediately show the restored values.
            (this.bar as unknown as { refreshActiveDetail: () => void }).refreshActiveDetail();
        }
        return changed;
    }

    private runAuthoringEdit(edit: () => void, resetAll = false): void {
        if (!this.settings) return;
        this.onHistoryStart?.();
        edit();
        this.onChange?.(resetAll);
        this.onHistoryCommit?.();
    }

    /** Whether the quick-action toolbar occupies the top-right corner. The gear steps
     *  left of it when the author pins the gear to top-right (NG-136). */
    private actionBarPresent = false;
    setActionBarPresent(present: boolean): void {
        if (present === this.actionBarPresent) return;
        this.actionBarPresent = present;
        this.syncGearLift();
    }

    update(s: Model, dark: boolean, forceHidden = false, flags?: Record<string, unknown>): void {
        const flagsChanged = !!flags && (() => {
            const keys = new Set([...Object.keys(this.flags), ...Object.keys(flags)]);
            return [...keys].some((key) => String(this.flags[key]) !== String(flags[key]));
        })();
        if (flags) this.flags = { ...flags };
        this.updateRankingCountMaximum(flags?.nodeCount);
        // Reconcile pending optimistic edits against the freshly-populated model.
        // If the host has confirmed an edit (round-tripped through the dataView),
        // drop it; otherwise re-apply it so this repopulate doesn't revert it.
        for (const [key, val] of this.pending) {
            if (String(readLocal(s, key)) === String(val)) this.pending.delete(key); // host confirmed
            else applyLocal(s, key, val);                                            // not yet → keep showing it
        }
        this.settings = s;
        this.applyTheme(dark);
        this.bar.setVisible(s.toolbar.show.value && !forceHidden);
        this.bar.setCloseOnAway(s.toolbar.closeOnClickAway.value);
        this.pref = (s.toolbar.position.value.value as string) || "auto";
        if (this.pref !== "auto") this.bar.setCorner(this.pref);
        this.syncGearLift();
        if (flagsChanged && this.bar.isOpen()) {
            (this.bar as unknown as { refreshActiveDetail: () => void }).refreshActiveDetail();
        }
        // Ordinary setting echoes do not rebuild the open popover (that would
        // flicker/drop focus). A data-role flag change is different: it can enable
        // or disable choices, so refresh once to keep prerequisites truthful.
    }

    /** The Top/Bottom-N ceiling is the current graph's complete node count, not
     * the 500-node initial default. Update only when data changes; if Filter is
     * already open, rebuild once so its native range/input maxima stay truthful. */
    private rankingCountMaximum = 500;
    private updateRankingCountMaximum(rawCount: unknown): void {
        const count = Number(rawCount);
        if (!Number.isFinite(count)) return;
        const maximum = Math.max(1, Math.floor(count));
        if (maximum === this.rankingCountMaximum) return;
        const filter = this.cats.find((category) => category.id === "filter");
        const field = filter?.subs.flatMap((sub) => sub.fields ?? [])
            .find((candidate) => candidate.key === "rank.count");
        if (!field) return;
        field.max = maximum;
        this.rankingCountMaximum = maximum;
        if (this.bar.isOpen()) {
            (this.bar as unknown as { refreshActiveDetail: () => void }).refreshActiveDetail();
        }
    }

    /** Theme the bar from the host: Power BI high contrast wins over light/dark.
     *  In HC we hand the bar the host's HC roles so its chrome matches the rest of
     *  the visual; otherwise we fall back to the auto-detected light/dark theme. */
    private applyTheme(dark: boolean): void {
        const palette = this.host.colorPalette;
        if (palette.isHighContrast) {
            const v = (c?: { value?: string }) => c && c.value;
            this.bar.setHighContrast(true, {
                foreground: v(palette.foreground),
                background: v(palette.background),
                foregroundSelected: v(palette.foregroundSelected),
                hyperlink: v(palette.hyperlink),
            });
        } else {
            this.bar.setHighContrast(false);
            this.bar.setTheme(dark);
        }
    }

    /**
     * Reset every visual property to its model default (Z-137 §4). Power BI owns
     * the persisted formatting, so we remove each object's properties — the model
     * then falls back to the declared defaults on the next populate. We ALSO copy
     * the defaults onto the live model and clear pending optimistic edits, so the
     * canvas reverts immediately without waiting for the host round-trip.
     */
    private reset(): void {
        if (!this.settings) return;
        // `removeObject` wipes each object's persisted properties entirely, so the
        // model falls back to its declared defaults on the next populate. (A plain
        // `remove` with empty properties{} would be a no-op.)
        const removeObject = (this.settings.cards as { name: string }[]).map(c => ({
            objectName: c.name, selector: null, properties: {},
        }));
        this.host.persistProperties({ removeObject } as unknown as powerbi.VisualObjectInstancesToPersist);

        // UAT-1 (2026-07-15): Power BI Desktop silently ignores the removeObject op,
        // so the revert above never reached the report — the next host render brought
        // every pre-reset setting back. The merge path is the one persistence route
        // proven to work in every host (all normal edits use it), so ALSO persist each
        // slice's default value explicitly. Where removeObject IS honored this merge
        // lands after it and the net state is identical (defaults). Iterates cards
        // only — the notesStore blob is not a card, so annotations survive Reset.
        const defaults = new VisualFormattingSettingsModel();
        const merge: { objectName: string; selector: null; properties: Record<string, powerbi.DataViewPropertyValue> }[] = [];
        for (const card of defaults.cards as { name: string; slices?: { name: string; value: unknown; items?: unknown[] }[] }[]) {
            const properties: Record<string, powerbi.DataViewPropertyValue> = {};
            for (const slice of card.slices ?? []) {
                const v = persistValue(slice);
                if (v !== undefined) properties[slice.name] = v;
            }
            if (Object.keys(properties).length) merge.push({ objectName: card.name, selector: null, properties });
        }
        this.host.persistProperties({ merge } as unknown as powerbi.VisualObjectInstancesToPersist);

        // Optimistic local revert: copy each slice's default value from a fresh model.
        const liveCards = this.settings.cards as { slices?: { value: unknown; name: string }[] }[];
        const defCards = defaults.cards as { slices?: { value: unknown; name: string }[] }[];
        liveCards.forEach((card, ci) => {
            const defSlices = defCards[ci]?.slices ?? [];
            (card.slices ?? []).forEach((slice, si) => {
                const d = defSlices[si];
                if (d && d.name === slice.name) slice.value = clone(d.value);
            });
        });
        this.pending.clear();
    }

    /** Focus mode (NG-118): force-hide the gear regardless of the toolbar.show
     *  setting, then restore it (subject to that setting) when focus mode exits. */
    setHidden(hidden: boolean): void {
        if (!this.settings) return;
        this.bar.setVisible(this.settings.toolbar.show.value && !hidden);
    }

    /** UAT-7 — passthrough: gate a gear CLICK (forceOpen still bypasses it). */
    setOpenGate(fn: (() => boolean) | null): void {
        this.bar.setOpenGate(fn);
    }

    /** Called by the visual after layout when position = Auto. No-op otherwise. */
    setCorner(corner: string): void {
        if (this.pref === "auto") this.bar.setCorner(corner);
        this.syncGearLift();
    }

    /**
     * Inline placement nudges on the mirrored bar's `.zsb-anchor`, applied from the
     * network-graph side so the shared settings-bar CSS stays untouched (NG-139/NG-136):
     *  - **bottom-right**: lift the collapsed gear ~5px off the bottom edge so it clears
     *    the "Zentrix" watermark below it and centres with the view-switch pill beside it.
     *  - **top-right + action bar**: step the gear LEFT of the fixed quick-action toolbar
     *    (which owns the top-right corner) so the two never overlap. `cornerInset` returns
     *    the gear's flush inset (18) when the bar is absent, so the override only fires
     *    when it would actually collide.
     * Every other corner is left to the mirror (no resident chrome there to dodge).
     */
    private syncGearLift(): void {
        const anchor = this.root.querySelector(".zsb-anchor") as HTMLElement | null;
        if (!anchor) return;
        const corner = (anchor.getAttribute("data-corner") || "bl") as Corner;
        anchor.style.bottom = corner === "br" ? "21px" : "";
        if (corner === "tr" && this.actionBarPresent) {
            const inset = cornerInset("tr", "gear", {
                actionBar: true, gearCorner: "tr", pillCorner: null, legendCorner: null,
            });
            anchor.style.right = `${inset}px`;
        } else {
            anchor.style.right = "";
        }
    }

    /** Harness helper — open the bar and (optionally) the sub-group `active`. */
    forceOpen(active?: string): void {
        this.bar.forceOpen(active);
    }

    /** True while the in-visual settings bar is open (issue #7 — suppress hover cards). */
    isOpen(): boolean {
        return this.bar.isOpen();
    }
}
