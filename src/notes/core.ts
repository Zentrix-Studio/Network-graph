"use strict";

// MIRROR OF @zentrix/visual-annotations (platform/packages/visual-annotations/src/{types,store}.ts)
// ---------------------------------------------------------------------------------------------
// DO NOT hand-edit for this visual's convenience. pbiviz webpack resolves from this
// visual's own src/ and cannot take a pnpm workspace dependency, so the golden source
// is COPIED here. Change the golden source, then re-copy. If this mirror and the
// golden source ever disagree, promote THIS up before syncing down — historically the
// golden sources have lagged behind the per-visual copies.
//
// The calendar-specific parts (the anchor key, the renderer, the visual.ts wiring)
// deliberately live OUTSIDE this file — see ./store.ts.
//
// Read platform/packages/visual-annotations/README.md before touching any of this.
// The short version of why it looks like this:
//
//   1. The store is persisted as ONE JSON blob on a capabilities object that has NO
//      Card in the formatting model. A Card would be wiped by the gear's Reset
//      (`removeObject` over every card) — a user resetting their colors would destroy
//      every note they ever wrote.
//   2. `anchor` is a NATURAL KEY the host visual derives from the datum. It is never a
//      serialized selectionId: those are row-index-derived and churn on refresh.
//   3. `dx`/`dy` are in MARK-SIZE units, not pixels, so a resize can't drift a callout
//      away from its mark.
//   4. Styling is a STRUCTURED model, never rich text — certification bans innerHTML.
//
// Everything parsed here is UNTRUSTED (report JSON a human could have hand-edited), so
// it validates and clamps, and NEVER throws: update() is try/caught, and a throw would
// blank the entire visual over a decoration layer.

/** How an annotation is displayed on the plot. */
export type NoteMode =
    | "marker"  // indicator only — the text surfaces on hover / in the detail panel
    | "text"    // callout box only
    | "arrow"   // callout box + a leader line back to the mark
    | "all";    // indicator + callout + leader line

/** How the on-plot indicator is drawn. */
export type MarkerStyle = "number" | "dot" | "icon";

/** Per-note styling. Unset fields fall back to the theme (so an un-styled note is on-brand). */
export interface NoteStyle {
    bold?: boolean;
    italic?: boolean;
    /** Text size in px. */
    size?: number;
    /** Text color. */
    color?: string;
    /** Callout box fill. */
    bg?: string;
    /** Callout box border. */
    border?: string;
    /** Leader-line color (the `arrow` / `all` modes). */
    arrow?: string;
}

/** One author-written annotation, anchored to a data point. */
export interface Note {
    /** Stable id, unique within the store. */
    id: string;
    /** The refresh-stable natural key the host visual derives from the datum. */
    anchor: string;
    text: string;
    mode: NoteMode;
    style: NoteStyle;
    /** Callout offset from the mark, in MARK-SIZE units — NOT pixels. */
    dx: number;
    dy: number;
}

/** The persisted blob. `v` is a schema version so the shape can migrate. */
export interface NoteStoreData {
    v: 1;
    items: Note[];
}

/** Colors the host visual hands the editor, resolved from the token mirror. */
export interface AnnotationTheme {
    bg: string;
    fg: string;
    muted: string;
    accent: string;
    line: string;
    font: string;
}

export const STORE_VERSION = 1;

/**
 * Caps. There is no documented size limit on a persisted property or on a report's
 * visual JSON — so rather than discover one in a customer's report, bound it here.
 */
export const MAX_NOTES = 200;
export const MAX_TEXT = 500;

const MODES: NoteMode[] = ["marker", "text", "arrow", "all"];
const MARKER_STYLES: MarkerStyle[] = ["number", "dot", "icon"];

/** Default callout offset, in mark-size units: up and to the right of the mark. */
export const DEFAULT_DX = 1.6;
export const DEFAULT_DY = -2.4;

export function isMarkerStyle(v: unknown): v is MarkerStyle {
    return MARKER_STYLES.includes(v as MarkerStyle);
}

// --- validation -------------------------------------------------------------

/** Only a CSS color we can vouch for — #rgb / #rrggbb, or rgb()/rgba(). */
const COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgba?\([\d.,\s%]+\))$/;

function asText(v: unknown, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
}

function asColor(v: unknown): string | undefined {
    return typeof v === "string" && COLOR_RE.test(v) ? v : undefined;
}

function asStyle(v: unknown): NoteStyle {
    const raw = (v ?? {}) as Record<string, unknown>;
    const style: NoteStyle = {};
    if (raw.bold === true) style.bold = true;
    if (raw.italic === true) style.italic = true;
    if (typeof raw.size === "number" && isFinite(raw.size)) {
        style.size = Math.max(7, Math.min(32, Math.round(raw.size)));
    }
    const color = asColor(raw.color); if (color) style.color = color;
    const bg = asColor(raw.bg); if (bg) style.bg = bg;
    const border = asColor(raw.border); if (border) style.border = border;
    const arrow = asColor(raw.arrow); if (arrow) style.arrow = arrow;
    return style;
}

function asOffset(v: unknown, fallback: number): number {
    return typeof v === "number" && isFinite(v) ? Math.max(-60, Math.min(60, v)) : fallback;
}

/** Validate one raw entry into a Note, or drop it. */
function asNote(v: unknown): Note | null {
    const raw = (v ?? {}) as Record<string, unknown>;
    const anchor = asText(raw.anchor, 300);
    const id = asText(raw.id, 40);
    if (!anchor || !id) return null;
    // An unreadable mode falls back to the least intrusive one — a marker cannot
    // cover the plot, a callout can.
    const mode = MODES.includes(raw.mode as NoteMode) ? (raw.mode as NoteMode) : "marker";
    return {
        id,
        anchor,
        text: asText(raw.text, MAX_TEXT),
        mode,
        style: asStyle(raw.style),
        dx: asOffset(raw.dx, DEFAULT_DX),
        dy: asOffset(raw.dy, DEFAULT_DY),
    };
}

export function parseStore(json: unknown): NoteStoreData {
    if (typeof json !== "string" || !json.trim()) return { v: STORE_VERSION, items: [] };
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return { v: STORE_VERSION, items: [] };
    }
    const items = (raw as { items?: unknown })?.items;
    if (!Array.isArray(items)) return { v: STORE_VERSION, items: [] };

    const out: Note[] = [];
    const seenIds = new Set<string>();
    const seenAnchors = new Set<string>();
    for (const entry of items) {
        if (out.length >= MAX_NOTES) break;
        const note = asNote(entry);
        if (!note) continue;
        // One note per anchor; first write wins on a duplicate.
        if (seenIds.has(note.id) || seenAnchors.has(note.anchor)) continue;
        seenIds.add(note.id);
        seenAnchors.add(note.anchor);
        out.push(note);
    }
    return { v: STORE_VERSION, items: out };
}

export function serializeStore(data: NoteStoreData): string {
    return JSON.stringify({ v: STORE_VERSION, items: data.items });
}

// --- the store --------------------------------------------------------------

export class NoteStore {
    private items: Note[] = [];
    private index = new Map<string, Note>();

    /** Load from the persisted string (or anything else — it validates). */
    load(json: unknown): void {
        this.items = parseStore(json).items;
        this.reindex();
    }

    private reindex(): void {
        this.index.clear();
        for (const n of this.items) this.index.set(n.anchor, n);
    }

    count(): number { return this.items.length; }
    isFull(): boolean { return this.items.length >= MAX_NOTES; }

    /** The note on an anchor, if any. The caller derives the anchor from its datum. */
    get(anchor: string): Note | undefined { return this.index.get(anchor); }

    /**
     * Notes in a deterministic order (by anchor) — the order the numbered markers
     * count in, so a note's number is stable across re-renders and sessions.
     */
    ordered(): Note[] {
        return [...this.items].sort((a, b) => (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0));
    }

    /**
     * A new (not yet stored) note on an anchor. Ids come from the highest existing
     * `nN` rather than a clock or RNG, so the persisted blob is deterministic and
     * diffable — and so tests don't have to stub time.
     */
    create(anchor: string, mode: NoteMode): Note {
        let max = 0;
        for (const n of this.items) {
            const m = /^n(\d+)$/.exec(n.id);
            if (m) max = Math.max(max, parseInt(m[1] ?? "0", 10));
        }
        return { id: `n${max + 1}`, anchor, text: "", mode, style: {}, dx: DEFAULT_DX, dy: DEFAULT_DY };
    }

    /** Insert or replace by anchor. */
    upsert(note: Note): void {
        const at = this.items.findIndex(n => n.anchor === note.anchor);
        if (at >= 0) this.items[at] = note;
        else if (!this.isFull()) this.items.push(note);
        this.reindex();
    }

    remove(id: string): void {
        this.items = this.items.filter(n => n.id !== id);
        this.reindex();
    }

    toJSON(): string {
        return serializeStore({ v: STORE_VERSION, items: this.items });
    }
}
