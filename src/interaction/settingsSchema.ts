"use strict";

/**
 * Network-graph schema + cfg adapter for the shared Zentrix Settings Bar.
 *
 * The bar engine (`zentrixSettingsBar.ts`) is the GOLDEN SOURCE and is identical
 * across every Zentrix visual. THIS file is the only per-visual code: it declares
 * the category/sub/field tree (`SB_CATS`) using engine keys and maps each key to
 * the real formatting model + persistProperties (`KEYS` → `makeCfg`). Same
 * pattern as the heatmap's settingsSchema.
 */

import type powerbi from "powerbi-visuals-api";
import { VisualFormattingSettingsModel, LABEL_FONT_ITEMS } from "../settings";
import type { SBCategory, SBCfg, SBFont, SBOption, SBPalette } from "./zentrixSettingsBar";
import { PALETTES, SCALES, isCvdSafe } from "../render/colors";
import { COLOR_PICKER_PRESETS } from "./colorPickerPresets";
import { SEMANTIC_ICON_NAMES, SEMANTIC_ICON_VALUES } from "./iconCatalog";

type Model = VisualFormattingSettingsModel;
type PersistFn = (object: string, prop: string, value: powerbi.DataViewPropertyValue) => void;
/** Commits a batch of persisted properties, grouped by object, as ONE host call. */
type BatchPersistFn = (merge: { objectName: string; properties: Record<string, powerbi.DataViewPropertyValue> }[]) => void;

interface Entry {
    get(m: Model): unknown;
    set(persist: PersistFn, value: unknown): void;
    setLocal(m: Model, value: unknown): void;
}

/* ── slice accessors typed loosely (the model classes vary per slice) ── */
type AnySlice = { value: any; items?: any[] };

function pickItem(slice: AnySlice, value: unknown): unknown {
    return slice.items?.find((it) => String(it.value) === String(value)) ?? slice.value;
}

function dropdown(object: string, prop: string, acc: (m: Model) => AnySlice): Entry {
    return {
        get: (m) => acc(m).value?.value,
        set: (p, v) => p(object, prop, String(v)),
        setLocal: (m, v) => { acc(m).value = pickItem(acc(m), v); },
    };
}
function bool(object: string, prop: string, acc: (m: Model) => AnySlice): Entry {
    return {
        get: (m) => acc(m).value,
        set: (p, v) => p(object, prop, Boolean(v)),
        setLocal: (m, v) => { acc(m).value = Boolean(v); },
    };
}
function num(object: string, prop: string, acc: (m: Model) => AnySlice): Entry {
    return {
        get: (m) => acc(m).value,
        set: (p, v) => p(object, prop, Number(v)),
        setLocal: (m, v) => { acc(m).value = Number(v); },
    };
}
function color(object: string, prop: string, acc: (m: Model) => AnySlice): Entry {
    return {
        get: (m) => acc(m).value.value,
        set: (p, v) => p(object, prop, { solid: { color: String(v) } } as unknown as powerbi.DataViewPropertyValue),
        setLocal: (m, v) => { acc(m).value = { value: String(v) }; },
    };
}
function text(object: string, prop: string, acc: (m: Model) => AnySlice): Entry {
    return {
        get: (m) => acc(m).value,
        set: (p, v) => p(object, prop, String(v)),
        setLocal: (m, v) => { acc(m).value = String(v); },
    };
}

/* ── engine key → model binding ── */
const KEYS: Record<string, Entry> = {
    // Choosing a layout mode CLEARS the pin (and any dragged/frozen positions), so the
    // chosen layout actually recomputes. Without this, a pinned graph (e.g. after a
    // drag auto-pins it) replays frozen positions and every mode switch looks dead.
    "layout.mode": (() => {
        const base = dropdown("layout", "mode", (m) => m.layout.mode);
        return {
            get: base.get,
            set: (p, v) => { base.set(p, v); p("pin", "pinned", false); p("pin", "positions", ""); },
            setLocal: (m, v) => { base.setLocal(m, v); m.pin.pinned.value = false; },
        };
    })(),
    "layout.charge": num("layout", "charge", (m) => m.layout.charge),
    "layout.link": num("layout", "linkDistance", (m) => m.layout.linkDistance),
    "layout.basemap": bool("layout", "showBasemap", (m) => m.layout.showBasemap),
    // Unpinning also clears the saved positions so a later re-pin freezes the
    // CURRENT layout, not a stale one.
    "pin.pinned": {
        get: (m) => m.pin.pinned.value,
        set: (p, v) => { p("pin", "pinned", Boolean(v)); if (!v) p("pin", "positions", ""); },
        setLocal: (m, v) => { m.pin.pinned.value = Boolean(v); },
    },

    "nodes.sizeBy": dropdown("nodes", "sizeBy", (m) => m.nodes.sizeBy),
    "nodes.autoSize": bool("nodes", "autoSize", (m) => m.nodes.autoSize),
    "nodes.minR": num("nodes", "minRadius", (m) => m.nodes.minRadius),
    "nodes.maxR": num("nodes", "maxRadius", (m) => m.nodes.maxRadius),
    "nodes.scale": num("nodes", "sizeScale", (m) => m.nodes.sizeScale),
    "nodes.shape": dropdown("nodes", "shape", (m) => m.nodes.shape),
    "nodes.style": dropdown("nodes", "style", (m) => m.nodes.style),
    "nodes.fillPattern": dropdown("nodes", "fillPattern", (m) => m.nodes.fillPattern),
    "nodes.fillPatternMode": dropdown("nodes", "fillPatternMode", (m) => m.nodes.fillPatternMode),
    "nodes.fillPatternL0": dropdown("nodes", "fillPatternL0", (m) => m.nodes.fillPatternL0),
    "nodes.fillPatternL1": dropdown("nodes", "fillPatternL1", (m) => m.nodes.fillPatternL1),
    "nodes.fillPatternL2": dropdown("nodes", "fillPatternL2", (m) => m.nodes.fillPatternL2),
    "nodes.fillPatternL3": dropdown("nodes", "fillPatternL3", (m) => m.nodes.fillPatternL3),
    "nodes.fillPatternL4": dropdown("nodes", "fillPatternL4", (m) => m.nodes.fillPatternL4),
    "nodes.icon": text("nodes", "icon", (m) => m.nodes.icon),
    "nodes.iconMode": dropdown("nodes", "iconMode", (m) => m.nodes.iconMode),
    "nodes.iconL0": text("nodes", "iconL0", (m) => m.nodes.iconL0),
    "nodes.iconL1": text("nodes", "iconL1", (m) => m.nodes.iconL1),
    "nodes.iconL2": text("nodes", "iconL2", (m) => m.nodes.iconL2),
    "nodes.iconL3": text("nodes", "iconL3", (m) => m.nodes.iconL3),
    "nodes.iconL4": text("nodes", "iconL4", (m) => m.nodes.iconL4),
    "nodes.color": color("nodes", "defaultColor", (m) => m.nodes.defaultColor),

    "parents.show": bool("parents", "show", (m) => m.parents.show),
    "parents.borderColor": color("parents", "borderColor", (m) => m.parents.borderColor),
    "parents.borderWidth": num("parents", "borderWidth", (m) => m.parents.borderWidth),
    "parents.fill": color("parents", "fill", (m) => m.parents.fill),
    "parents.sizeBoost": num("parents", "sizeBoost", (m) => m.parents.sizeBoost),
    "nodes.animate": bool("nodes", "animate", (m) => m.nodes.animate),
    "nodes.initialAnimation": bool("nodes", "initialAnimation", (m) => m.nodes.initialAnimation),
    "nodes.collide": bool("nodes", "collide", (m) => m.nodes.collide),
    "nodes.gap": num("nodes", "nodeGap", (m) => m.nodes.nodeGap),
    "nodes.showValue": bool("nodes", "showValue", (m) => m.nodes.showValue),
    "nodes.valueSource": dropdown("nodes", "valueSource", (m) => m.nodes.valueSource),
    "nodes.valueDec": num("nodes", "valueDecimals", (m) => m.nodes.valueDecimals),
    "nodes.mergeDup": bool("nodes", "mergeDuplicates", (m) => m.nodes.mergeDuplicates),
    "nodes.clickInfo": bool("nodes", "showFullInfoOnClick", (m) => m.nodes.showFullInfoOnClick),
    // Single node-click action (NG-248). A node click can only do ONE thing, so this virtual
    // key presents the three underlying booleans (Show full info, Expand/collapse, Drill-down)
    // as one mutually-exclusive selector — picking one clears the others. "filter" = none of
    // them (plain cross-filter). Derived get() keeps it truthful if the booleans are set apart.
    "nodes.clickMode": {
        get: (m) => m.nodes.showFullInfoOnClick.value ? "info"
            : m.hierarchy.foldable.value ? "expand"
                : m.hierarchy.drilldown.value ? "drilldown"
                    : "filter",
        set: (p, v) => {
            p("nodes", "showFullInfoOnClick", v === "info");
            p("hierarchy", "foldable", v === "expand");
            p("hierarchy", "drilldown", v === "drilldown");
        },
        setLocal: (m, v) => {
            m.nodes.showFullInfoOnClick.value = v === "info";
            m.hierarchy.foldable.value = v === "expand";
            m.hierarchy.drilldown.value = v === "drilldown";
        },
    },

    "colors.mode": dropdown("colors", "mode", (m) => m.colors.mode),
    "colors.palette": dropdown("colors", "palette", (m) => m.colors.palette),
    "colors.gLow": color("colors", "gradientLow", (m) => m.colors.gradientLow),
    "colors.gHigh": color("colors", "gradientHigh", (m) => m.colors.gradientHigh),
    "colors.customGradient": bool("colors", "customGradient", (m) => m.colors.customGradient),
    "colors.gMids": num("colors", "gradientMids", (m) => m.colors.gradientMids),
    "colors.gMid1": color("colors", "gradientMid1", (m) => m.colors.gradientMid1),
    "colors.gMid2": color("colors", "gradientMid2", (m) => m.colors.gradientMid2),
    "colors.gMid3": color("colors", "gradientMid3", (m) => m.colors.gradientMid3),
    "colors.gMid4": color("colors", "gradientMid4", (m) => m.colors.gradientMid4),
    "colors.gMid5": color("colors", "gradientMid5", (m) => m.colors.gradientMid5),
    "colors.legend": bool("colors", "showLegend", (m) => m.colors.showLegend),
    "colors.edgeLegend": bool("colors", "showEdgeLegend", (m) => m.colors.showEdgeLegend),
    "colors.legendPos": dropdown("colors", "legendPosition", (m) => m.colors.legendPosition),
    "colors.reverse": bool("colors", "reverse", (m) => m.colors.reverse),
    "colors.cvdOnly": bool("colors", "cvdOnly", (m) => m.colors.cvdOnly),
    "colors.opacity": num("colors", "opacity", (m) => m.colors.opacity),
    "colors.levelStyle": dropdown("colors", "levelStyle", (m) => m.colors.levelStyle),
    "colors.driver": dropdown("colors", "colorDriver", (m) => m.colors.colorDriver),

    "tooltip.type": dropdown("tooltip", "type", (m) => m.tooltip.type),
    "tooltip.content": dropdown("tooltip", "contentMode", (m) => m.tooltip.contentMode),

    "edges.show": bool("edges", "show", (m) => m.edges.show),
    "edges.showOnHover": bool("edges", "showOnHover", (m) => m.edges.showOnHover),
    "edges.colorMode": dropdown("edges", "colorMode", (m) => m.edges.colorMode),
    "edges.color": color("edges", "color", (m) => m.edges.color),
    "edges.arrows": bool("edges", "showArrows", (m) => m.edges.showArrows),
    "edges.bidirectional": bool("edges", "bidirectional", (m) => m.edges.bidirectional),
    "edges.showLabels": bool("edges", "showLabels", (m) => m.edges.showLabels),
    "edges.labelSource": dropdown("edges", "labelSource", (m) => m.edges.labelSource),
    "edges.thick": num("edges", "thickness", (m) => m.edges.thickness),
    "edges.scaleByWeight": bool("edges", "scaleByWeight", (m) => m.edges.scaleByWeight),
    "edges.curve": num("edges", "curve", (m) => m.edges.curve),
    "edges.flow": bool("edges", "flow", (m) => m.edges.flow),
    "edges.flowSpeed": num("edges", "flowSpeed", (m) => m.edges.flowSpeed),

    "labels.show": bool("labels", "show", (m) => m.labels.show),
    "labels.content": dropdown("labels", "content", (m) => m.labels.content),
    "labels.outerValueFormat": dropdown("labels", "outerValueFormat", (m) => m.labels.outerValueFormat),
    "labels.max": num("labels", "maxLabels", (m) => m.labels.maxLabels),
    "labels.font": dropdown("labels", "fontFamily", (m) => m.labels.fontFamily),
    "labels.size": num("labels", "fontSize", (m) => m.labels.fontSize),
    "labels.bold": bool("labels", "bold", (m) => m.labels.bold),
    "labels.italic": bool("labels", "italic", (m) => m.labels.italic),
    "labels.underline": bool("labels", "underline", (m) => m.labels.underline),
    "labels.color": color("labels", "color", (m) => m.labels.color),
    "labels.position": dropdown("labels", "position", (m) => m.labels.position),
    "labels.wrap": dropdown("labels", "wrap", (m) => m.labels.wrap),
    "labels.bgShow": bool("labels", "bgShow", (m) => m.labels.bgShow),
    "labels.bgType": dropdown("labels", "bgType", (m) => m.labels.bgType),
    "labels.bgColor": color("labels", "bgColor", (m) => m.labels.bgColor),
    "labels.bgWidth": num("labels", "bgWidth", (m) => m.labels.bgWidth),
    "labels.innerValueFormat": dropdown("labels", "innerValueFormat", (m) => m.labels.innerValueFormat),
    "labels.innerFont": dropdown("labels", "innerFontFamily", (m) => m.labels.innerFontFamily),
    "labels.innerSize": num("labels", "innerFontSize", (m) => m.labels.innerFontSize),
    "labels.innerBold": bool("labels", "innerBold", (m) => m.labels.innerBold),
    "labels.innerItalic": bool("labels", "innerItalic", (m) => m.labels.innerItalic),
    "labels.innerUnderline": bool("labels", "innerUnderline", (m) => m.labels.innerUnderline),
    "labels.innerColor": color("labels", "innerColor", (m) => m.labels.innerColor),

    "rank.mode": dropdown("ranking", "mode", (m) => m.ranking.mode),
    "rank.action": dropdown("ranking", "action", (m) => m.ranking.action),
    "rank.by": dropdown("ranking", "by", (m) => m.ranking.by),
    "rank.count": num("ranking", "count", (m) => m.ranking.count),
    "centrality.metric": dropdown("centrality", "metric", (m) => m.centrality.metric),

    "cf.show": bool("cformat", "show", (m) => m.cformat.show),

    "summaryTable.show": bool("summaryTable", "show", (m) => m.summaryTable.show),
    "summaryTable.position": dropdown("summaryTable", "position", (m) => m.summaryTable.position),

    "clusters.show": bool("clusters", "show", (m) => m.clusters.show),
    "clusters.clusterBy": dropdown("clusters", "clusterBy", (m) => m.clusters.clusterBy),
    "clusters.resolution": num("clusters", "resolution", (m) => m.clusters.resolution),
    "clusters.minSize": num("clusters", "minClusterSize", (m) => m.clusters.minClusterSize),
    "clusters.maxClusters": num("clusters", "maxClusters", (m) => m.clusters.maxClusters),
    "clusters.collapse": bool("clusters", "collapse", (m) => m.clusters.collapse),
    "clusters.showHulls": bool("clusters", "showHulls", (m) => m.clusters.showHulls),
    "clusters.hullStyle": dropdown("clusters", "hullStyle", (m) => m.clusters.hullStyle),
    "clusters.hullPadding": num("clusters", "hullPadding", (m) => m.clusters.hullPadding),
    "clusters.fillOpacity": num("clusters", "fillOpacity", (m) => m.clusters.fillOpacity),
    "clusters.borderWidth": num("clusters", "borderWidth", (m) => m.clusters.borderWidth),
    "clusters.borderOpacity": num("clusters", "borderOpacity", (m) => m.clusters.borderOpacity),
    "clusters.colorSource": dropdown("clusters", "colorSource", (m) => m.clusters.colorSource),
    "clusters.tint": color("clusters", "tint", (m) => m.clusters.tint),
    "clusters.showLabels": bool("clusters", "showLabels", (m) => m.clusters.showLabels),
    "clusters.showSizes": bool("clusters", "showSizes", (m) => m.clusters.showSizes),
    "clusters.labelFont": dropdown("clusters", "labelFont", (m) => m.clusters.labelFont),
    "clusters.labelSize": num("clusters", "labelSize", (m) => m.clusters.labelSize),
    "clusters.labelBold": bool("clusters", "labelBold", (m) => m.clusters.labelBold),
    "clusters.labelItalic": bool("clusters", "labelItalic", (m) => m.clusters.labelItalic),
    "clusters.labelColorMode": dropdown("clusters", "labelColorMode", (m) => m.clusters.labelColorMode),
    "clusters.labelColor": color("clusters", "labelColor", (m) => m.clusters.labelColor),
    "clusters.groupBy": bool("clusters", "groupByCluster", (m) => m.clusters.groupByCluster),
    "clusters.groupStrength": num("clusters", "groupingStrength", (m) => m.clusters.groupingStrength),
    "clusters.clickFilter": bool("clusters", "clickToFilter", (m) => m.clusters.clickToFilter),
    "clusters.hoverEmphasis": bool("clusters", "hoverEmphasis", (m) => m.clusters.hoverEmphasis),
    "hierarchy.foldable": bool("hierarchy", "foldable", (m) => m.hierarchy.foldable),
    "hierarchy.startCollapsed": bool("hierarchy", "startCollapsed", (m) => m.hierarchy.startCollapsed),
    "hierarchy.drilldown": bool("hierarchy", "drilldown", (m) => m.hierarchy.drilldown),
    "scale.maxEdges": num("scale", "maxEdges", (m) => m.scale.maxEdges),
    "scale.fetchMore": bool("scale", "fetchMore", (m) => m.scale.fetchMore),
    "scale.minimap": bool("scale", "minimap", (m) => m.scale.minimap),
    "scale.renderMode": dropdown("scale", "renderMode", (m) => m.scale.renderMode),
    "scale.canvasThreshold": num("scale", "canvasThreshold", (m) => m.scale.canvasThreshold),
    "insights.show": bool("insights", "show", (m) => m.insights.show),
    "find.show": bool("find", "show", (m) => m.find.show),
    "explore.show": bool("explore", "show", (m) => m.explore.show),
    "path.show": bool("path", "show", (m) => m.path.show),
    "path.weighted": bool("path", "weighted", (m) => m.path.weighted),
    "temporal.show": bool("temporal", "show", (m) => m.temporal.show),
    "annotations.show": bool("annotations", "show", (m) => m.annotations.show),
    "annotations.defaultMode": dropdown("annotations", "defaultMode", (m) => m.annotations.defaultMode),

    // Native Format-pane master switch. Deliberately not surfaced inside the gear:
    // once it hides every overlay, the Format pane is the reliable way back.
    "bar.showOverlays": bool("toolbar", "showOverlays", (m) => m.toolbar.showOverlays),
    "bar.show": bool("toolbar", "show", (m) => m.toolbar.show),
    "bar.closeAway": bool("toolbar", "closeOnClickAway", (m) => m.toolbar.closeOnClickAway),
    "bar.actions": bool("toolbar", "actions", (m) => m.toolbar.actions),
    "bar.pos": dropdown("toolbar", "position", (m) => m.toolbar.position),
    "branding.show": bool("branding", "show", (m) => m.branding.show),
};

export function applyLocal(m: Model, key: string, value: unknown): void { KEYS[key]?.setLocal(m, value); }
export function readLocal(m: Model, key: string): unknown { return KEYS[key]?.get(m); }
/** Emit the persisted property/properties for one engine key without performing
 * a host write. Callers can collect several keys into one atomic merge payload. */
export function emitPersistence(key: string, value: unknown, persist: PersistFn): void {
    KEYS[key]?.set(persist, value);
}
/** Stable list of every writable engine key, used by visual-wide undo/redo snapshots. */
export function settingKeys(): string[] { return Object.keys(KEYS); }

/** Every capabilities object reachable through the bar — drives the no-orphan guard. */
export function gearObjectNames(): Set<string> {
    const m = new VisualFormattingSettingsModel();
    const out = new Set<string>();
    const rec: PersistFn = (object) => { out.add(object); };
    for (const k of Object.keys(KEYS)) {
        try { KEYS[k].set(rec, KEYS[k].get(m)); } catch { /* recording only */ }
    }
    return out;
}

/** Run one engine key's `Entry.set` and commit everything it persists as ONE batched
 * host call, grouped by object. A composite key (e.g. nodes.clickMode, NG-QA-002) calls
 * the collector several times for different real properties backing one mutually-exclusive
 * selection — persisting each as its OWN separate host call risks a same-tick write race
 * (a host that doesn't queue/merge back-to-back persistProperties calls can drop all but
 * the last one), which would silently desync the composite's booleans from each other and
 * from what the gear displays. One call per edit closes that race entirely. */
function persistEntry(batch: BatchPersistFn, e: Entry, value: unknown): void {
    const grouped = new Map<string, Record<string, powerbi.DataViewPropertyValue>>();
    e.set((object, prop, v) => {
        const properties = grouped.get(object) ?? {};
        properties[prop] = v;
        grouped.set(object, properties);
    }, value);
    if (grouped.size) batch([...grouped].map(([objectName, properties]) => ({ objectName, properties })));
}

export function makeCfg(
    getModel: () => Model, batch: BatchPersistFn,
    onChange?: (key: string, value: unknown) => void, reset?: () => void,
    getFlags?: () => Record<string, unknown>,
): SBCfg {
    return {
        // `@`-prefixed keys are read-only DATA flags (e.g. `@hasParent`), not settings —
        // they let the schema gate/annotate controls on which data roles are bound. They
        // have no KEYS entry, so `set` no-ops on them (below).
        get(key: string): unknown {
            if (key.charCodeAt(0) === 64) return getFlags?.()[key.slice(1)];
            const e = KEYS[key]; return e ? e.get(getModel()) : undefined;
        },
        set(key: string, value: unknown): void {
            const e = KEYS[key]; if (!e) return;
            e.setLocal(getModel(), value); // optimistic
            persistEntry(batch, e, value);  // durable, one atomic host call
            onChange?.(key, value);
        },
        // Per-card reset: read each key's default off a fresh model, then persist +
        // optimistically apply it — same merge-of-defaults path the global Reset uses,
        // scoped to one card's engine keys (heatmap ledger UAT-1 parity).
        resetKeys(keys: string[]): void {
            const fresh = new VisualFormattingSettingsModel();
            for (const key of keys) {
                const e = KEYS[key]; if (!e) continue;
                const def = e.get(fresh);
                e.setLocal(getModel(), def);
                persistEntry(batch, e, def);
                onChange?.(key, def);
            }
        },
        reset,
    };
}

/* ── the category tree ── */
const opt = (v: string, l: string): [string, string] => [v, l];
const depOpt = (
    value: string,
    label: string,
    disabledIf: (get: (key: string) => unknown) => boolean,
    disabledReason: string,
): SBOption => ({ value, label, disabledIf, disabledReason });
const PATTERN_OPTIONS: [string, string][] = [
    opt("none", "Solid"), opt("dots", "Dots"), opt("rings", "Circles"),
    opt("diagonal", "Diagonal"), opt("crosshatch", "Hatch"), opt("grid", "Grid"),
    opt("horizontal", "Horizontal"), opt("vertical", "Vertical"), opt("checker", "Checker"),
    opt("diamonds", "Diamonds"), opt("zigzag", "Zigzag"), opt("waves", "Waves"),
];
const PATTERN_LEVEL_OPTIONS: [string, string][] = PATTERN_OPTIONS.map(([value, label]) =>
    opt(value, value === "none" ? "None" : label));
const PATTERN_ICONS: Record<string, string> = {
    none: "fillSolid", dots: "fillDots", rings: "fillRings",
    diagonal: "fillDiagonal", crosshatch: "fillCrosshatch", grid: "fillGrid",
    horizontal: "fillHorizontal", vertical: "fillVertical", checker: "fillChecker",
    diamonds: "fillDiamonds", zigzag: "fillZigzag", waves: "fillWaves",
};

/* Shared corner options (NG-125). POS5 = the view-switch / legend order the CEO
   listed (auto, then the four corners top-left → bottom-right); POS_BAR keeps the
   toolbar's existing order so its native-pane control and gear control agree. */
const POS5: [string, string][] = [opt("auto", "Auto"), opt("tl", "Top-left"), opt("tr", "Top-right"), opt("bl", "Bottom-left"), opt("br", "Bottom-right")];
const POS_BAR: [string, string][] = [opt("auto", "Auto"), opt("bl", "Bottom-left"), opt("br", "Bottom-right"), opt("tl", "Top-left"), opt("tr", "Top-right")];

/* Palette swatch previews for the `paletteList` — built from the render truth
   (src/render/colors.ts) so the gear dots exactly match what the graph draws, and so
   the qualitative library + the sequential/diverging scales stay in sync automatically
   (no hand-transcription drift). Each carries its `family` + `cvdSafe` for the gear's
   intent-first family filter and CVD badge/filter. */
const PAL_NAMES: Record<string, string> = {
    brand: "Zentrix", colorblind: "CVD-safe", classic10: "Classic 10", set2: "Set 2",
    set3: "Set 3", highviz: "High-visibility", grayscale: "Grayscale", contrast: "High contrast",
    viridis: "Viridis", mako: "Mako", violetSeq: "Violet ramp", tealSeq: "Teal ramp",
    slateSeq: "Slate ramp", violetTeal: "Violet–Teal", coolWarm: "Cool–Warm",
    blueOrange: "Blue–Orange", pinkGreen: "Pink–Green", tealRose: "Teal–Rose",
    custom: "Custom gradient",
};
const palName = (id: string): string => PAL_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

export const SB_PALETTES: Record<string, SBPalette> = {};
for (const [id, cols] of Object.entries(PALETTES))
    SB_PALETTES[id] = { name: palName(id), light: cols.slice(0, 8), family: "qualitative", cvdSafe: isCvdSafe(id) };
for (const [id, sc] of Object.entries(SCALES))
    SB_PALETTES[id] = { name: palName(id), light: sc.stops.slice(0, 8), family: sc.family, cvdSafe: sc.cvdSafe };
SB_PALETTES["custom"] = { name: "Custom gradient", light: ["#EEE9FF", "#7C5CFF"], family: "sequential", cvdSafe: false };

/* Every palette + scale as options, in registry order (qualitative → scales → custom).
   The gear filters this list per mode via `paletteFilter`. */
const PALETTE_OPTS: [string, string][] = Object.keys(SB_PALETTES).map((id) => opt(id, palName(id)));

/* Continuous (ramp) vs categorical intent — governs which palette family applies. */
function isContinuousMode(g: (key: string) => unknown): boolean {
    const m = String(g("colors.mode"));
    return m === "measure" || (m === "level" && String(g("colors.levelStyle")) === "ramp");
}
/* The explicit multi-stop node gradient (Gradient tab toggle) — independent of mode. */
const isCustomOn = (g: (key: string) => unknown): boolean => Boolean(g("colors.customGradient"));
/* How many midpoint stops are active (0–5), clamped defensively. */
const midCount = (g: (key: string) => unknown): number =>
    Math.max(0, Math.min(5, Math.round(Number(g("colors.gMids")) || 0)));
const canvasWillRender = (g: (key: string) => unknown): boolean => {
    if (g("@canvasAvailable") === false) return false;
    const mode = String(g("scale.renderMode"));
    if (mode === "canvas") return true;
    if (mode === "svg") return false;
    const threshold = Math.max(200, Number(g("scale.canvasThreshold")) || 1200);
    return Number(g("@nodeCount")) > threshold || Number(g("@edgeCount")) > threshold * 3;
};
const hullDependencyReason = (g: (key: string) => unknown): string => {
    if (!g("clusters.show")) return "Turn on Show clusters to configure cluster hulls.";
    if (g("clusters.collapse")) return "Turn off Collapse to meta-nodes to configure cluster hulls.";
    return "Turn on Show hulls to configure the cluster boundary.";
};
/* Show only palettes of the family the mode wants, and only CVD-safe when asked. */
const paletteFilter = (g: (key: string) => unknown, _id: string, pal?: SBPalette): boolean => {
    const fam = pal?.family ?? "qualitative";
    const familyOk = isContinuousMode(g) ? (fam === "sequential" || fam === "diverging") : (fam === "qualitative");
    if (!familyOk) return false;
    if (Boolean(g("colors.cvdOnly")) && !pal?.cvdSafe) return false;
    return true;
};

/** Reason shown when a Pro feature's control is dimmed on the free tier (NG-268).
 *  Paired with `dimIf: (g) => !g("@licensed")` so the gear greys it + shows this on hover. */
const PRO_REASON = "Premium — start your free 30-day trial to unlock it.";

export const SB_CATS: SBCategory[] = [
    { id: "layout", name: "Layout", flat: true, subs: [{ id: "layout", kind: "fields", fields: [
        { control: "tiles", label: "Mode", key: "layout.mode", tileColumns: 3,
            options: [opt("force", "Force"), opt("circle", "Concentric"), opt("ring", "Circular"),
                opt("grid", "Grid"), opt("tree", "Tree"),
                { value: "geo", label: "Geo", disabledIf: (g) => !g("@licensed") || !g("@hasGeo"),
                    disabledReasonFn: (g) => !g("@licensed") ? PRO_REASON
                        : "Add valid Latitude and Longitude data to enable Geo layout." }],
            tileIcons: { force: "force", circle: "concentric", ring: "circular", grid: "grid", tree: "tree", geo: "geo" },
            info: "Force reveals general network clusters. Concentric puts the strongest hub in the centre and progressively lower-connectivity nodes on grouped outer rings. Circular places every node on a single ring in a crossing-minimising order. Grid arranges nodes on a stable square grid, hubs first. Tree uses the original layered hierarchy, chooses the most connected root when no Node parent is bound, and defaults to maximum link curvature (override it in Edges ▸ Curvature). Geo needs Latitude and Longitude. Choosing a mode clears a pinned layout so the new mode can run." },
        { control: "note", label: "Hierarchy inferred from link connectivity. Add a Node parent field when the report needs an exact business hierarchy.",
            visibleIf: (g) => String(g("layout.mode")) === "tree" && !g("@hasParent") },
        { control: "slider", label: "Repulsion", key: "layout.charge", min: 1, max: 200, step: 1,
            dimIf: (g) => {
                const mode = String(g("layout.mode"));
                return mode !== "force" && !(mode === "geo" && !g("@hasGeo"));
            },
            disabledReason: "Repulsion is available in Force layout. Geo also uses it only while falling back to Force because coordinates are missing.",
            info: "Controls how strongly nodes push apart in Force mode. It has no effect in Concentric or Tree layouts; Geo uses it only when coordinates are missing and the visual falls back to Force." },
        { control: "slider", label: "Edge length", key: "layout.link", min: 5, max: 200, step: 5,
            dimIf: (g) => {
                const mode = String(g("layout.mode"));
                return mode !== "force" && !(mode === "geo" && !g("@hasGeo"));
            },
            disabledReason: "Edge length is available in Force layout. Geo also uses it only while falling back to Force because coordinates are missing.",
            info: "Sets the preferred link distance in Force mode. It has no effect in Concentric or Tree layouts; Geo uses it only when coordinates are missing and the visual falls back to Force." },
        { control: "switch", label: "Outline map", key: "layout.basemap",
            note: "Faint world map + lat/long grid behind the nodes (Geo-route mode)",
            dimIf: (g) => !g("@hasGeo"),
            disabledReason: "Add valid Latitude and Longitude data to enable the outline map.",
            visibleIf: (g) => String(g("layout.mode")) === "geo" },
        { control: "switch", label: "Pin layout", key: "pin.pinned",
            info: "Freezes and saves the current node positions so refreshes and report reopenings reuse them. Dragging a node also pins the authored layout. Turn this off—or choose another layout mode—to calculate positions again." },
    ] }] },
    { id: "nodes", name: "Nodes", subs: [
        { id: "nodesSize", name: "Size", kind: "fields", fields: [
            { control: "segText", label: "Size by", key: "nodes.sizeBy", options: [
                opt("degree", "Degree"),
                opt("measure", "Node value"),
                depOpt("centrality", "Importance", (g) => String(g("centrality.metric")) === "none", "Choose an Importance calculation in Analysis to enable this option."),
                opt("uniform", "Same size")],
                info: "Degree is the number of links connected to a node. Node value uses Node size when provided, otherwise the total connected Edge weight (or Degree for unweighted data). Importance uses the calculation selected in Analysis. Same size gives every node the same radius." },
            { control: "switch", label: "Auto size to canvas", key: "nodes.autoSize",
                note: "Fit node radii to the tile: shrinks the range on small canvases and dense graphs so nodes never swamp the view. Turn off to use an exact Min/Max." },
            { control: "range", label: "Radius range", keys: ["nodes.minR", "nodes.maxR"], boxLabels: ["MIN", "MAX"], min: 1, max: 60, step: 1, suffix: "px",
                dimIf: (g) => !!g("nodes.autoSize"),
                disabledReason: "Auto size to canvas is on — Min/Max act as the 4–40px caps. Turn it off to set an exact range." },
            { control: "slider", label: "Size scale", key: "nodes.scale", min: 20, max: 400, step: 10, suffix: "%" },
            { control: "switch", label: "Avoid overlap", key: "nodes.collide",
                dimIf: (g) => String(g("layout.mode")) === "geo" && !!g("@hasGeo"),
                disabledReason: "Avoid overlap is unavailable when Geo uses exact Latitude and Longitude positions.",
                note: "Nudge overlapping nodes apart after layout (off for exact geo/XY positions)" },
            { control: "slider", label: "Node gap", key: "nodes.gap", min: 0, max: 60, step: 1, suffix: "px",
                dimIf: (g) => !g("nodes.collide") || (String(g("layout.mode")) === "geo" && !!g("@hasGeo")),
                disabledReasonFn: (g) => String(g("layout.mode")) === "geo" && !!g("@hasGeo")
                    ? "Node gap is unavailable when Geo uses exact Latitude and Longitude positions."
                    : "Turn on Avoid overlap to enable Node gap.",
                info: "Increases the target edge-to-edge clearance without enlarging nodes. If the requested gap cannot fit in the viewport, the graph preserves its layout shape and uses the largest spacing that fits. Ignored when Avoid overlap is off or Geo positions are exact." },
            { control: "switch", label: "Merge duplicate nodes", key: "nodes.mergeDup",
                note: "On: one node per name, holding both its incoming and outgoing edges (folds spelling/case/whitespace variants too). Off: split each name into its outgoing (source) and incoming (target) vertices, so a name that is both a hub and a destination shows as two nodes." },
        ] },
        // Wider than the 242 default: visual choices need breathing space.
        { id: "nodesStyle", name: "Style", kind: "fields", width: 320, fields: [
            { control: "segText", label: "Type", key: "nodes.style", options: [opt("halo", "Halo"), opt("flat", "Flat")],
                note: "Halo draws a soft glow ring of the node's colour behind each marker" },
            { control: "tiles", label: "Shape", key: "nodes.shape",
                options: [opt("circle", "Circle"), opt("square", "Square"), opt("diamond", "Diamond"), opt("triangle", "Triangle"), opt("hexagon", "Hexagon"), opt("donut", "Donut")],
                tileIcons: { circle: "shapeCircle", square: "shapeSquare", diamond: "shapeDiamond", triangle: "shapeTriangle", hexagon: "shapeHexagon", donut: "shapeDonut" },
                info: "Applies to ordinary node markers. A semantic icon or bound node image replaces the shape for that node." },
            // Node colour lives in Colours → Mode (the primary colour surface), not here.
            { control: "switch", label: "Animate adjustments", key: "nodes.animate",
                info: "Animates visual transitions such as zoom and layout adjustments. It changes how updates move, not the final node positions. Reduced-motion preferences and Canvas rendering can suppress some animation." },
            { control: "switch", label: "Initial growth animation", key: "nodes.initialAnimation",
                dimIf: (g) => !g("nodes.animate"),
                disabledReason: "Turn on Animate adjustments to enable the initial growth animation.",
                info: "On initial load—and after Reset all—nodes grow outward from each component root and visibly settle into their deterministic positions. The animation lasts about 2.4 seconds and respects reduced-motion preferences." },
        ] },
        { id: "nodesPatterns", name: "Patterns", kind: "fields", width: 320, fields: [
            { control: "segText", label: "Apply pattern", key: "nodes.fillPatternMode",
                options: [opt("all", "All nodes"), opt("level", "By level")],
                note: "By level gives each hierarchy depth its own fill texture. Uses the Node-parent role, or a derived tree when unbound." },
            { control: "tiles", label: "Pattern", key: "nodes.fillPattern",
                options: PATTERN_OPTIONS, tileIcons: PATTERN_ICONS, tileColumns: 4,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) !== "level",
                info: "Applies to ordinary shape markers. A semantic icon or bound node image replaces the patterned marker for that node." },
            { control: "select", label: "Root (L0)", key: "nodes.fillPatternL0", options: PATTERN_LEVEL_OPTIONS,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) === "level" },
            { control: "select", label: "Level 1", key: "nodes.fillPatternL1", options: PATTERN_LEVEL_OPTIONS,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) === "level" },
            { control: "select", label: "Level 2", key: "nodes.fillPatternL2", options: PATTERN_LEVEL_OPTIONS,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) === "level" },
            { control: "select", label: "Level 3", key: "nodes.fillPatternL3", options: PATTERN_LEVEL_OPTIONS,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) === "level" },
            { control: "select", label: "Level 4+", key: "nodes.fillPatternL4", options: PATTERN_LEVEL_OPTIONS,
                visibleIf: (g) => String(g("nodes.fillPatternMode")) === "level" },
        ] },
        { id: "nodesIcons", name: "Icons", kind: "fields", width: 440, fields: [
            { control: "segText", label: "Apply icon", key: "nodes.iconMode",
                options: [opt("all", "All nodes"),
                    depOpt("type", "By node type", (g) => !g("@hasCategory"), "Add data to the Node category field well to enable this option."),
                    depOpt("field", "By field value", (g) => !g("@hasIcon"), "Add data to the Icon field well to enable this option."),
                    opt("level", "By hierarchy level")],
                noteFn: (g) => {
                    const mode = String(g("nodes.iconMode"));
                    if (mode === "type") return g("@hasCategory")
                        ? "Node category values are matched to semantic entity icons automatically."
                        : "Add a Node category field to assign icons by node type.";
                    if (mode === "field") return g("@hasIcon")
                        ? "Each Icon field value can be an icon name such as Person, Server, or Database."
                        : "Add an Icon field to assign an icon from each field value.";
                    if (mode === "level") return "Assign an entity icon to each hierarchy depth.";
                    return "Choose one entity icon for every node. Status and action glyphs are intentionally excluded.";
                } },
            { control: "emoji", label: "Icon", key: "nodes.icon",
                visibleIf: (g) => String(g("nodes.iconMode")) === "all",
                info: "The main icon identifies what entity the node represents. A bound base64 image remains the highest-priority marker." },
            { control: "emoji", label: "Root (L0)", key: "nodes.iconL0",
                visibleIf: (g) => String(g("nodes.iconMode")) === "level" },
            { control: "emoji", label: "Level 1", key: "nodes.iconL1",
                visibleIf: (g) => String(g("nodes.iconMode")) === "level" },
            { control: "emoji", label: "Level 2", key: "nodes.iconL2",
                visibleIf: (g) => String(g("nodes.iconMode")) === "level" },
            { control: "emoji", label: "Level 3", key: "nodes.iconL3",
                visibleIf: (g) => String(g("nodes.iconMode")) === "level" },
            { control: "emoji", label: "Level 4+", key: "nodes.iconL4",
                visibleIf: (g) => String(g("nodes.iconMode")) === "level" },
        ] },
        // Parent emphasis only has an effect once a Node-parent field is bound (that's what
        // defines which nodes are "parents"). Without it the toggle would silently no-op, so
        // gate the whole group on `@hasParent`: dim it and show a hint pointing at the role.
        { id: "nodesParents", name: "Parents", kind: "fields", fields: [
            { control: "switch", label: "Emphasise parents", key: "parents.show", dimIf: (g) => !g("@hasParent"),
                noteFn: (g) => (g("@hasParent") ? undefined : "Add a Node parent field to enable parent styling."),
                info: "Styles nodes that act as parents in an explicit hierarchy. Bind a Node parent field first, then turn this on to enable the border, fill, and size controls below." },
            { control: "color", label: "Border", key: "parents.borderColor", dimIf: (g) => !g("@hasParent") || !g("parents.show"),
                info: "Applies only when a Node parent field is bound and Emphasise parents is on." },
            { control: "slider", label: "Border width", key: "parents.borderWidth", min: 0, max: 12, step: 1, dimIf: (g) => !g("@hasParent") || !g("parents.show"),
                info: "Applies only when a Node parent field is bound and Emphasise parents is on." },
            { control: "color", label: "Fill (blank = auto)", key: "parents.fill", dimIf: (g) => !g("@hasParent") || !g("parents.show"),
                info: "Overrides the fill of parent nodes only when a Node parent field is bound and Emphasise parents is on. Leave it blank to keep each parent’s normal node colour." },
            { control: "slider", label: "Parent size", key: "parents.sizeBoost", min: 100, max: 300, step: 10, suffix: "%", dimIf: (g) => !g("@hasParent") || !g("parents.show"),
                info: "Scales parent nodes only when a Node parent field is bound and Emphasise parents is on. 100% keeps their normal size." },
        ] },
        { id: "nodesClick", name: "On click", kind: "fields", fields: [
            // One action per node click (NG-248) — mutually exclusive by construction.
            { control: "select", label: "Click action", key: "nodes.clickMode",
                options: [
                    opt("filter", "Cross-filter only"),
                    opt("info", "Show full info"),
                    depOpt("expand", "Expand / collapse", (g) => !g("@licensed"), PRO_REASON),
                    depOpt("drilldown", "Drill-down", (g) => !g("@licensed"), PRO_REASON)],
                info: "A node click does exactly one thing. Cross-filter only keeps the standard report interaction; the other three each take over the click, so cross-filtering may not fire while one is active. Show full info opens the node detail panel; Expand / collapse folds a parent's descendants; Drill-down makes the clicked node the temporary root. Expand and Drill-down follow the bound Node parent, or a hierarchy derived from link connectivity." },
            { control: "switch", label: "Start collapsed", key: "hierarchy.startCollapsed",
                visibleIf: (g) => String(g("nodes.clickMode")) === "expand",
                dimIf: (g) => String(g("nodes.clickMode")) !== "expand",
                disabledReason: "Set Click action to Expand / collapse to start the hierarchy collapsed.",
                info: "Has an effect only with Expand / collapse. The graph initially shows roots with descendants folded until the user expands them." },
        ] },
    ] },
    { id: "colors", name: "Colours", subs: [
        { id: "mode", name: "Mode", kind: "fields", fields: [
            // Intent-first "Colour by": Structure modes (Community / Component) and Hierarchy
            // (Level) sit beside the classic Single/Category/Measure — the analytical edge
            // Powerviz lacks. segText refreshes the detail, so the fields below re-gate live.
            { control: "select", label: "Colour by", key: "colors.mode", options: [
                opt("single", "Single"),
                depOpt("category", "Category", (g) => !g("@hasCategory"), "Add data to the Node category field well to enable Category."),
                opt("measure", "Value"),
                opt("cluster", "Community"), opt("component", "Component"), opt("level", "Level")],
                info: "Single uses Nodes → Style → Colour. Category needs a Node category field. Value uses the Colour driver below. Community detects densely connected groups, Component separates disconnected subnetworks, and Level uses the Node parent hierarchy or a derived hierarchy. A custom gradient or matching conditional rule overrides this base mode." },
            // Structural continuous drivers (Hub / Bridge / Influence) live here — the headline.
            { control: "select", label: "Colour driver", key: "colors.driver",
                options: [
                    opt("size", "Node value"),
                    opt("degree", "Degree"),
                    depOpt("weighted", "Value", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to enable Value."),
                    depOpt("centrality", "Importance", (g) => String(g("centrality.metric")) === "none", "Choose an Importance calculation in Analysis to enable this option."),
                    opt("betweenness", "Bridges"), opt("pagerank", "Influence")],
                visibleIf: (g) => String(g("colors.mode")) === "measure" || isCustomOn(g),
                info: "Chooses the number mapped along the palette. Node value uses Node size when provided, otherwise total connected Edge weight. Degree counts links; Value totals Edge weight; Importance uses Analysis; Bridges uses betweenness; Influence uses PageRank." },
            { control: "segText", label: "Level colours", key: "colors.levelStyle",
                options: [opt("distinct", "Distinct"), opt("ramp", "Ramp")],
                visibleIf: (g) => String(g("colors.mode")) === "level",
                info: "Distinct assigns a separate qualitative colour to each hierarchy depth. Ramp maps shallow-to-deep levels along a sequential or diverging scale. It is available only when Colour by is Level." },
            { control: "paletteList", label: "Palette", key: "colors.palette",
                options: PALETTE_OPTS, optionFilter: paletteFilter,
                visibleIf: (g) => String(g("colors.mode")) !== "single",
                info: "The list is filtered automatically: discrete modes show qualitative palettes, while Measure and Level ramp show continuous scales. A custom node gradient overrides this palette." },
            { control: "switch", label: "Reverse colours", key: "colors.reverse",
                visibleIf: (g) => String(g("colors.mode")) !== "single" },
            { control: "switch", label: "CVD-safe only", key: "colors.cvdOnly",
                visibleIf: (g) => String(g("colors.mode")) !== "single",
                info: "Filters the Palette list to schemes marked safe for common colour-vision deficiencies. It does not recolour the graph until you select one of the remaining palettes." },
            // The base node colour. In Single mode this IS the graph colour (palette is hidden);
            // in every other mode it is the fallback where no palette/gradient/rule applies.
            { control: "color", label: "Node colour", key: "nodes.color",
                dimIf: isCustomOn,
                disabledReason: "Turn off Custom node gradient (Gradient tab) to use a fixed node colour.",
                infoFn: (g) => String(g("colors.mode")) === "single"
                    ? "Sets the single node marker colour. Semantic entity icons inherit this colour."
                    : "The fallback node colour, used where no palette, gradient, or conditional rule applies. Palette, gradient, and conditional-rule colours override it; semantic entity icons inherit the resolved node colour." },
            { control: "slider", label: "Node opacity", key: "colors.opacity", min: 10, max: 100, step: 5, suffix: "%" },
            // Legend show + position live in the Overlays category (with the other chrome).
        ] },
        { id: "gradient", name: "Gradient", kind: "fields", fields: [
            // The custom multi-stop node gradient. A single toggle owns the tab: when ON,
            // every node is painted along Start → (mids) → End, positioned by the Colour
            // driver value (lowest = Start, highest = End), and it OVERRIDES "Colour by".
            // Start/End reuse the classic gLow/gHigh keys; Midpoints adds 0–5 stops between.
            { control: "switch", label: "Custom node gradient", key: "colors.customGradient",
                info: "Paint every node along your own Start → End ramp, positioned by the Colour driver (Mode tab). Overrides “Colour by”." },
            { control: "select", label: "Colour driver", key: "colors.driver",
                options: [
                    opt("size", "Node value"),
                    opt("degree", "Degree"),
                    depOpt("weighted", "Value", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to enable Value."),
                    depOpt("centrality", "Importance", (g) => String(g("centrality.metric")) === "none", "Choose an Importance calculation in Analysis to enable this option."),
                    opt("betweenness", "Bridges"), opt("pagerank", "Influence")],
                visibleIf: isCustomOn,
                info: "Chooses the number mapped along the custom Start → End ramp." },
            { control: "color", label: "Start", key: "colors.gLow", visibleIf: isCustomOn },
            { control: "stepper", label: "Midpoints", key: "colors.gMids", min: 0, max: 5, step: 1, visibleIf: isCustomOn,
                note: "Add up to 5 colour stops between Start and End for a multi-hue ramp." },
            { control: "color", label: "Mid 1", key: "colors.gMid1", visibleIf: (g) => isCustomOn(g) && midCount(g) >= 1 },
            { control: "color", label: "Mid 2", key: "colors.gMid2", visibleIf: (g) => isCustomOn(g) && midCount(g) >= 2 },
            { control: "color", label: "Mid 3", key: "colors.gMid3", visibleIf: (g) => isCustomOn(g) && midCount(g) >= 3 },
            { control: "color", label: "Mid 4", key: "colors.gMid4", visibleIf: (g) => isCustomOn(g) && midCount(g) >= 4 },
            { control: "color", label: "Mid 5", key: "colors.gMid5", visibleIf: (g) => isCustomOn(g) && midCount(g) >= 5 },
            { control: "color", label: "End", key: "colors.gHigh", visibleIf: isCustomOn },
            // Node colour itself lives in Colours → Mode. Empty-state hint when the gradient
            // is off — the colour controls above are all gated, so the tab would otherwise
            // show only the toggle. Explain what turning it on does (never a blank pane — NG-144).
            { control: "note", visibleIf: (g) => !isCustomOn(g),
                labelFn: (g) => String(g("colors.mode")) === "single"
                    ? "Turn on “Custom node gradient” to colour nodes along a Start → End ramp of your choice. Otherwise nodes use the single Node colour set in the Mode tab."
                    : "Turn on “Custom node gradient” to colour nodes along a Start → End ramp of your choice. Otherwise nodes use the palette selected in the Mode tab." },
        ] },
    ] },
    { id: "edges", name: "Edges", flat: true, subs: [{ id: "edges", kind: "fields", fields: [
        { control: "switch", label: "Show links", key: "edges.show" },
        // Follow-up that only appears once links are hidden: reveal a node's incident
        // links on hover so a dense graph reads clean but stays explorable (req 1).
        { control: "switch", label: "Show links on hover", key: "edges.showOnHover",
            visibleIf: (g) => !g("edges.show"),
            note: "Links stay hidden until you hover a node, then only its connections appear" },
        { control: "select", label: "Link colour", key: "edges.colorMode",
            options: [opt("auto", "Automatic"), opt("single", "Single colour"),
                opt("source", "Source node colour"), opt("target", "Target node colour"),
                opt("gradient", "Source → target gradient")],
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to choose link colours.",
            note: "Source / target / gradient colour links by their endpoint nodes — best for tracing dense links" },
        { control: "color", label: "Colour", key: "edges.color",
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to choose a single link colour.",
            visibleIf: (g) => String(g("edges.colorMode")) === "single" },
        { control: "switch", label: "Arrows", key: "edges.arrows",
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to enable arrows." },
        { control: "switch", label: "Merge two-way links", key: "edges.bidirectional",
            dimIf: (g) => !g("edges.show") || !g("edges.arrows"),
            disabledReasonFn: (g) => !g("edges.show")
                ? "Turn on Show links to merge two-way links."
                : "Turn on Arrows to merge opposite directions into one two-headed link.",
            info: "Off shows A → B and B → A as separate parallel links. On combines them into one link with an arrowhead at each end. One-direction links are unchanged." },
        { control: "slider", label: "Width", key: "edges.thick", min: 1, max: 12, step: 1,
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to change link width.",
            info: "Sets the width of the heaviest link. With Scale width by weight on, lighter links scale down from here; off, every link uses this width." },
        { control: "switch", label: "Scale width by weight", key: "edges.scaleByWeight",
            dimIf: (g) => !g("edges.show") || !g("@hasWeight"),
            disabledReasonFn: (g) => !g("edges.show")
                ? "Turn on Show links to scale width by weight."
                : "Add data to the Edge weight field well to scale link width by weight.",
            info: "On maps each link's width to its Edge weight — the heaviest link at Width, the lightest at 20% of it. Off draws every link at the flat Width." },
        { control: "slider", label: "Curvature", key: "edges.curve", min: 0, max: 100, step: 5,
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to change link curvature.",
            info: "How strongly links bow. Tree defaults to maximum curvature so relationships fan apart, but any value you set here wins — including 0 for straight links." },
        { control: "switch", label: "Link labels", key: "edges.showLabels",
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to enable link labels." },
        { control: "select", label: "Link label", key: "edges.labelSource",
            options: [
                depOpt("weight", "Weight", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to enable Weight labels."),
                depOpt("type", "Edge type", (g) => !g("@hasEdgeType"), "Add data to the Edge type field well to enable Edge type labels."),
                depOpt("weightPct", "Weight % of total", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to enable Weight % of total."),
                depOpt("betweenness", "Edge betweenness", (g) => Number(g("@nodeCount")) > 2000, "Edge betweenness is available for graphs with 2,000 nodes or fewer."),
                opt("names", "Source → target")],
            dimIf: (g) => !g("edges.show") || !g("edges.showLabels"),
            disabledReasonFn: (g) => !g("edges.show")
                ? "Turn on Show links to choose link-label content."
                : "Turn on Link labels to choose their content.",
            note: "Betweenness = share of shortest paths crossing the link (computed up to 2,000 nodes)" },
        { control: "switch", label: "Animate flow", key: "edges.flow",
            dimIf: (g) => !g("edges.show"),
            disabledReason: "Turn on Show links to animate their flow." },
        { control: "slider", label: "Flow speed", key: "edges.flowSpeed", min: 1, max: 10, step: 1,
            dimIf: (g) => !g("edges.show") || !g("edges.flow"),
            disabledReasonFn: (g) => !g("edges.show")
                ? "Turn on Show links to set flow speed."
                : "Turn on Animate flow to set flow speed.",
            info: "Has an effect only when Animate flow is on." },
    ] }] },
    { id: "labels", name: "Labels", subs: [
        { id: "labelsOuter", name: "Outer", kind: "fields", fields: [
            { control: "switch", label: "Show outer label", key: "labels.show" },
            { control: "select", label: "Content", key: "labels.content",
                options: [opt("name", "Name"), opt("value", "Value"), opt("nameValue", "Name (value)"),
                    opt("inflow", "Inflow"), opt("outflow", "Outflow"), opt("flow", "Total flow")],
                dimIf: (g) => !g("labels.show"),
                disabledReason: "Turn on Show outer label to choose its content.",
                note: "Flow modes total the directed edge weights in/out of each node" },
            { control: "select", label: "Display units", key: "labels.outerValueFormat",
                options: [opt("auto", "Auto (K/M/B)"), opt("none", "Full number"),
                    opt("thousands", "Thousands (K)"), opt("millions", "Millions (M)"),
                    opt("billions", "Billions (B)")],
                dimIf: (g) => !g("labels.show") || String(g("labels.content")) === "name",
                disabledReasonFn: (g) => !g("labels.show")
                    ? "Turn on Show outer label to choose display units."
                    : "Choose numeric label content—Value, Name (value), Inflow, Outflow, or Total flow—to enable display units.",
                info: "Formats numeric outer-label content. Auto chooses K, M, or B from the value." },
            { control: "slider", label: "Decimals", key: "nodes.valueDec", min: 0, max: 4, step: 1,
                dimIf: (g) => !g("labels.show") || String(g("labels.content")) === "name",
                disabledReasonFn: (g) => !g("labels.show")
                    ? "Turn on Show outer label to set decimal places."
                    : "Choose numeric label content to set decimal places.",
                info: "Controls numeric precision for outer labels. The same precision is shared with inner labels." },
            { control: "slider", label: "Max labels", key: "labels.max", min: 0, max: 500, step: 10,
                dimIf: (g) => !g("labels.show"),
                disabledReason: "Turn on Show outer label to set the maximum label count.",
                info: "Caps how many node labels are drawn to keep dense graphs readable and fast. When capped, the visual prioritises the most connected nodes. Set 0 to hide all labels." },
            { control: "select", label: "Position", key: "labels.position", options: [opt("auto", "Auto (best fit)"), opt("right", "Right"), opt("left", "Left"), opt("top", "Top"), opt("bottom", "Bottom")],
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to choose its position." },
            { control: "segText", label: "Wrap", key: "labels.wrap", options: [opt("off", "Off"), opt("on", "On"), opt("auto", "Auto")],
                dimIf: (g) => !g("labels.show"),
                disabledReason: "Turn on Show outer label to control wrapping.",
                info: "On wraps long labels. Off keeps one line. Auto wraps only when the available label space makes it useful." },
            { control: "font", label: "Font", key: "labels.font",
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to choose its font." },
            { control: "slider", label: "Size", key: "labels.size", min: 6, max: 40, step: 1,
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to change its size." },
            { control: "multiSeg", label: "Style", keys: ["labels.bold", "labels.italic", "labels.underline"], glyphs: ["B", "I", "U"],
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to change its text style." },
            { control: "color", label: "Colour", key: "labels.color",
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to change its colour." },
            { control: "switch", label: "Background", key: "labels.bgShow",
                dimIf: (g) => !g("labels.show"), disabledReason: "Turn on Show outer label to add a background." },
            { control: "select", label: "Bg style", key: "labels.bgType", options: [opt("card", "Card"), opt("highlight", "Highlight"), opt("pill", "Pill")],
                dimIf: (g) => !g("labels.show") || !g("labels.bgShow"),
                disabledReasonFn: (g) => !g("labels.show")
                    ? "Turn on Show outer label to choose a background style."
                    : "Turn on Background to choose its style.",
                info: "Has an effect only when Background is on." },
            { control: "color", label: "Bg colour", key: "labels.bgColor", dimIf: (g) => !g("labels.show") || !g("labels.bgShow"),
                disabledReasonFn: (g) => !g("labels.show")
                    ? "Turn on Show outer label to choose a background colour."
                    : "Turn on Background to choose its colour.",
                info: "Has an effect only when Background is on." },
            { control: "slider", label: "Bg width", key: "labels.bgWidth", min: 0, max: 20, step: 1, suffix: "px", dimIf: (g) => !g("labels.show") || !g("labels.bgShow"),
                disabledReasonFn: (g) => !g("labels.show")
                    ? "Turn on Show outer label to set background width."
                    : "Turn on Background to set its width.",
                info: "Controls the padding around the label and has an effect only when Background is on." },
        ] },
        { id: "labelsInner", name: "Inner", kind: "fields", fields: [
            // These three persisted node-value settings keep their existing keys for
            // bookmark compatibility; only their gear placement moves into Labels.
            { control: "switch", label: "Show inner label", key: "nodes.showValue",
                dimIf: canvasWillRender,
                disabledReason: "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold." },
            { control: "segText", label: "Value", key: "nodes.valueSource",
                options: [
                    opt("size", "Node value"),
                    opt("degree", "Degree"),
                    depOpt("weighted", "Value", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to enable Value."),
                    depOpt("centrality", "Importance", (g) => String(g("centrality.metric")) === "none", "Choose an Importance calculation in Analysis to enable this option.")],
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to choose its value.",
                info: "Node value uses Node size when provided, otherwise total connected Edge weight. Degree counts links, Value totals Edge weight, and Importance uses the calculation selected in Analysis." },
            { control: "slider", label: "Decimals", key: "nodes.valueDec", min: 0, max: 4, step: 1,
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to set decimal places." },
            { control: "select", label: "Display units", key: "labels.innerValueFormat",
                options: [opt("auto", "Auto (K/M/B)"), opt("none", "Full number"),
                    opt("thousands", "Thousands (K)"), opt("millions", "Millions (M)"),
                    opt("billions", "Billions (B)")],
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to choose display units.",
                info: "Formats numeric inner labels. Auto chooses K, M, or B from the value." },
            { control: "font", label: "Font", key: "labels.innerFont",
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to choose its font." },
            { control: "slider", label: "Size", key: "labels.innerSize", min: 6, max: 40, step: 1,
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to change its size.",
                info: "Sets the preferred inner-label size. Text still shrinks when needed to fit inside its node." },
            { control: "multiSeg", label: "Style", keys: ["labels.innerBold", "labels.innerItalic", "labels.innerUnderline"], glyphs: ["B", "I", "U"],
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to change its text style." },
            { control: "color", label: "Colour", key: "labels.innerColor",
                dimIf: (g) => !g("nodes.showValue") || canvasWillRender(g),
                disabledReasonFn: (g) => canvasWillRender(g)
                    ? "Inner labels require SVG rendering. Choose SVG or raise the Auto Canvas threshold."
                    : "Turn on Show inner label to change its colour.",
                info: "Leave blank for automatic contrast against each node fill (over the canvas for donut nodes)." },
        ] },
    ] },
    { id: "filter", name: "Filter", flat: true, subs: [{ id: "filter", kind: "fields", fields: [
        { control: "segText", label: "Show", key: "rank.mode", options: [opt("off", "All"), opt("top", "Top N"), opt("bottom", "Bottom N")] },
        { control: "segText", label: "Action", key: "rank.action", options: [opt("filter", "Filter"), opt("highlight", "Highlight")],
            dimIf: (g) => String(g("rank.mode")) === "off",
            disabledReason: "Choose Top N or Bottom N under Show to enable ranking actions.",
            info: "Filter shows only the ranked N nodes and re-lays out that subgraph. Highlight keeps the complete network in place, accents the ranked N nodes, and dims the rest." },
        { control: "segText", label: "Rank by", key: "rank.by", options: [
            opt("degree", "Degree"),
            depOpt("weighted", "Value", (g) => !g("@hasWeight"), "Add data to the Edge weight field well to rank by Value."),
            opt("size", "Node value"),
            depOpt("centrality", "Importance", (g) => String(g("centrality.metric")) === "none", "Choose an Importance calculation in Analysis to rank by Importance.")],
            dimIf: (g) => String(g("rank.mode")) === "off",
            disabledReason: "Choose Top N or Bottom N under Show to select a ranking value.",
            info: "Used only when Show is Top N or Bottom N. Degree counts links; Value totals Edge weight; Node value uses Node size when provided and otherwise total connected Edge weight; Importance uses the calculation selected in Analysis." },
        { control: "slider", label: "N", key: "rank.count", min: 1, max: 500, step: 1,
            note: "Applies when Show = Top N / Bottom N", dimIf: (g) => String(g("rank.mode")) === "off",
            disabledReason: "Choose Top N or Bottom N under Show to set N." },
    ] }] },
    { id: "cformat", name: "Rules", flat: true, subs: [{ id: "cformat", kind: "fields", fields: [
        { control: "switch", label: "Rules editor", key: "cf.show",
            info: "Shows or hides the rule editor panel. Existing enabled rules continue colouring nodes even when the editor itself is hidden. Rules override the base Colours mode when their conditions match." },
        { control: "heading", label: "Colour nodes by any number of rules — numeric (degree, centrality…) or text (name, category)." },
    ] }] },
    // Overlays (NG-125) — the small display/placement controls for the visual's
    // chrome, consolidated in one place: the hover tooltip, the floating view switch
    // (Table + Insight segments and where it sits), the colour legend, and the
    // settings-bar toolbar. Each placement is auto / a fixed corner.
    { id: "overlays", name: "Overlays", subs: [
        { id: "ovTooltip", name: "Tooltip", kind: "fields", fields: [
            { control: "segText", label: "Style", key: "tooltip.type", options: [opt("card", "Zentrix card"), opt("report", "Native"), opt("off", "Off")],
                info: "Zentrix card uses the styled tooltip inside the visual. Native uses Power BI’s tooltip service and supports report-page tooltips when one is configured. Off disables both node and link hover tooltips." },
            { control: "select", label: "Node information", key: "tooltip.content",
                options: [
                    depOpt("business", "Business fields", (g) => !g("@hasTooltips"), "Add data to the Tooltips field well to enable Business fields."),
                    depOpt("combined", "Business + network", (g) => !g("@hasTooltips"), "Add data to the Tooltips field well to enable Business + network."),
                    opt("network", "Network metrics")],
                dimIf: (g) => String(g("tooltip.type")) === "off",
                disabledReason: "Choose Zentrix card or Native tooltip style to configure node information.",
                info: "Controls the node hover card. Add report fields to the Tooltips data well, then choose whether they replace or supplement network metrics." },
            { control: "heading", label: "Add business fields to the Tooltips data well. Business fields replaces technical metrics; Business + network shows both." },
        ] },
        { id: "ovViews", name: "View switch", kind: "fields", fields: [
            { control: "switch", label: "Summary table", key: "summaryTable.show" },
            { control: "switch", label: "Insights", key: "insights.show",
                dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON,
                note: "A plain-English read-out of the network — hubs, connectivity, bridges, density" },
            { control: "select", label: "Position", key: "summaryTable.position", options: POS5,
                dimIf: (g) => !g("summaryTable.show") && !g("insights.show"),
                disabledReason: "Turn on Summary table or Insights to position the view switch.",
                note: "Where the floating Graph / Table / Insight switch sits" },
            { control: "heading", label: "Adds Table and Insight segments to the floating switch — flip the canvas to the node-metrics table or the plain-English network read-out." },
        ] },
        { id: "ovLegend", name: "Legend", kind: "fields", fields: [
            { control: "switch", label: "Category legend", key: "colors.legend",
                dimIf: (g) => (String(g("colors.mode")) === "single" && !g("colors.customGradient"))
                    || (String(g("colors.mode")) === "category" && !g("@hasCategory")),
                disabledReasonFn: (g) => String(g("colors.mode")) === "category" && !g("@hasCategory")
                    ? "Add data to the Node category field well, or choose another Colour by mode, to enable the node legend."
                    : "Choose a category, structure, hierarchy, or value colour mode—or enable Custom node gradient—to show a node legend.",
                info: "Shows the node-colour legend for categories, communities, components, levels, or a numeric colour scale. Single-colour mode may have nothing to list." },
            { control: "switch", label: "Edge legend", key: "colors.edgeLegend",
                dimIf: (g) => !g("@hasEdgeType") && !g("@hasWeight"),
                disabledReason: "Add data to the Edge type or Edge weight field well to enable an edge legend.",
                info: "Shows edge-type and edge-weight guides when those fields provide meaningful groups or a varying numeric scale." },
            { control: "select", label: "Position", key: "colors.legendPos", options: POS5,
                dimIf: (g) => {
                    const nodeMode = String(g("colors.mode"));
                    const nodeAvailable = nodeMode !== "single" || !!g("colors.customGradient");
                    const categoryAvailable = nodeMode !== "category" || !!g("@hasCategory");
                    const nodeLegend = !!g("colors.legend") && nodeAvailable && categoryAvailable;
                    const edgeLegend = !!g("colors.edgeLegend") && (!!g("@hasEdgeType") || !!g("@hasWeight"));
                    return !nodeLegend && !edgeLegend;
                },
                disabledReason: "Enable a node or edge legend that has the required data before choosing its position.",
                info: "Has an effect when a renderable node or edge legend is on. Auto chooses a corner that avoids other overlays." },
        ] },
        { id: "ovToolbar", name: "Gear icon", kind: "fields", fields: [
            { control: "switch", label: "Show settings bar", key: "bar.show" },
            { control: "select", label: "Gear position", key: "bar.pos", options: POS_BAR, dimIf: (g) => !g("bar.show"),
                info: "Has an effect only when Show settings bar is on. Auto places the gear to avoid other overlays." },
            { control: "switch", label: "Quick actions (zoom, undo, redo, reset)", key: "bar.actions",
                info: "Shows compact zoom, visual-wide undo/redo, focus, and layout-reset actions independently of the settings gear." },
            { control: "switch", label: "Close on click-away", key: "bar.closeAway", dimIf: (g) => !g("bar.show"),
                info: "Has an effect only when Show settings bar is on. When enabled, clicking the graph closes an open settings card." },
        ] },
    ] },
    { id: "enterprise", name: "Enterprise", subs: [
        { id: "clusters", name: "Clusters", kind: "fields", fields: [
            { control: "switch", label: "Show clusters", key: "clusters.show", dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON },
            { control: "select", label: "Cluster by", key: "clusters.clusterBy",
                options: [opt("auto", "Auto (communities)"),
                    depOpt("category", "Category field", (g) => !g("@hasCategory"), "Add data to the Node category field well to enable Category field."),
                    opt("component", "Connected components")],
                dimIf: (g) => !g("clusters.show"),
                disabledReason: "Turn on Show clusters to choose how clusters are detected.",
                info: "Requires Show clusters. Auto detects densely connected communities. Category needs a Node category field and falls back to Auto when it is missing. Component groups disconnected subnetworks.",
                noteFn: (g) => (String(g("clusters.clusterBy")) === "category" && !g("@hasCategory")
                    ? "Add a Node category field, or clusters fall back to auto." : undefined) },
            { control: "slider", label: "Granularity", key: "clusters.resolution", min: 20, max: 300, step: 10, suffix: "%",
                note: "Higher = more, smaller clusters; lower = fewer, coarser (community detection only)",
                dimIf: (g) => !g("clusters.show") || String(g("clusters.clusterBy")) !== "auto",
                disabledReasonFn: (g) => !g("clusters.show")
                    ? "Turn on Show clusters to set granularity."
                    : "Set Cluster by to Auto (communities) to adjust granularity." },
            { control: "slider", label: "Min cluster size", key: "clusters.minSize", min: 1, max: 25, step: 1,
                note: "Clusters below this many nodes fold into one “Other” group",
                dimIf: (g) => !g("clusters.show"),
                disabledReason: "Turn on Show clusters to set the minimum cluster size." },
            { control: "slider", label: "Max clusters", key: "clusters.maxClusters", min: 0, max: 20, step: 1,
                note: "0 = unlimited; otherwise keep the N largest and fold the rest into “Other”",
                dimIf: (g) => !g("clusters.show"),
                disabledReason: "Turn on Show clusters to set the maximum cluster count." },
            { control: "switch", label: "Collapse to meta-nodes", key: "clusters.collapse", dimIf: (g) => !g("clusters.show"),
                info: "Requires Show clusters. Replaces each cluster with one aggregate node so the graph shows relationships between clusters instead of every member node." },
            { control: "heading", label: "Hull appearance" },
            { control: "switch", label: "Show hulls", key: "clusters.showHulls",
                dimIf: (g) => !g("clusters.show") || !!g("clusters.collapse"),
                disabledReasonFn: (g) => !g("clusters.show")
                    ? "Turn on Show clusters to enable hulls."
                    : "Turn off Collapse to meta-nodes to display cluster hulls.",
                info: "Requires Show clusters. Draws a boundary around the member nodes of each visible cluster; it is not used when clusters are collapsed to meta-nodes." },
            { control: "select", label: "Hull style", key: "clusters.hullStyle",
                options: [opt("rounded", "Rounded"), opt("convex", "Convex (sharp)")],
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires both Show clusters and Show hulls." },
            { control: "slider", label: "Padding", key: "clusters.hullPadding", min: 0, max: 60, step: 2, suffix: "px",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Expands each cluster boundary around its outer nodes. Requires both Show clusters and Show hulls." },
            { control: "slider", label: "Fill opacity", key: "clusters.fillOpacity", min: 0, max: 60, step: 2, suffix: "%",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires both Show clusters and Show hulls." },
            { control: "slider", label: "Border width", key: "clusters.borderWidth", min: 0, max: 6, step: 1, suffix: "px",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires both Show clusters and Show hulls." },
            { control: "slider", label: "Border opacity", key: "clusters.borderOpacity", min: 0, max: 100, step: 5, suffix: "%",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires both Show clusters and Show hulls." },
            { control: "select", label: "Hull colour", key: "clusters.colorSource",
                options: [opt("palette", "Per-cluster palette"), opt("single", "Single tint")],
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires both Show clusters and Show hulls. Per-cluster uses each cluster’s palette colour; Single tint enables the Tint control below." },
            { control: "color", label: "Tint", key: "clusters.tint",
                visibleIf: (g) => String(g("clusters.colorSource")) === "single",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: hullDependencyReason,
                info: "Requires Show clusters, Show hulls, and Hull colour set to Single tint." },
            { control: "heading", label: "Labels & layout" },
            { control: "switch", label: "Cluster labels", key: "clusters.showLabels", dimIf: (g) => !g("clusters.show"),
                info: "Requires Show clusters. Displays each cluster’s name; Category mode uses category names, while detected communities/components use generated group labels." },
            { control: "switch", label: "Show sizes", key: "clusters.showSizes",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels"),
                info: "Requires both Show clusters and Cluster labels. Appends the member-node count to each cluster label." },
            { control: "font", label: "Label font", key: "clusters.labelFont",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels"),
                disabledReason: "Turn on Cluster labels to style them." },
            { control: "slider", label: "Label size", key: "clusters.labelSize", min: 8, max: 40, step: 1,
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels"),
                disabledReason: "Turn on Cluster labels to style them." },
            { control: "multiSeg", label: "Label style", keys: ["clusters.labelBold", "clusters.labelItalic"], glyphs: ["B", "I"],
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels"),
                disabledReason: "Turn on Cluster labels to style them." },
            { control: "select", label: "Label colour", key: "clusters.labelColorMode",
                options: [opt("auto", "Auto (match cluster)"), opt("manual", "Manual")],
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels"),
                disabledReason: "Turn on Cluster labels to style them.",
                info: "Auto colours each caption to match its own cluster, so you can tell which label belongs to which cluster at a glance. Manual uses the fixed colour below." },
            { control: "color", label: "Custom colour", key: "clusters.labelColor",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showLabels") || String(g("clusters.labelColorMode")) !== "manual",
                disabledReasonFn: (g) => !g("clusters.showLabels")
                    ? "Turn on Cluster labels to style them."
                    : "Set Label colour to Manual to choose a fixed colour.",
                visibleIf: (g) => String(g("clusters.labelColorMode")) === "manual",
                info: "Leave blank to fall back to the theme's automatic label colour." },
            { control: "switch", label: "Group by cluster", key: "clusters.groupBy",
                note: "Pull same-cluster nodes together so hulls stop overlapping (force layout)",
                dimIf: (g) => !g("clusters.show") || String(g("layout.mode")) !== "force",
                disabledReasonFn: (g) => !g("clusters.show")
                    ? "Turn on Show clusters to group nodes by cluster."
                    : "Group by cluster is available in Force layout." },
            { control: "slider", label: "Grouping strength", key: "clusters.groupStrength", min: 5, max: 100, step: 5, suffix: "%",
                dimIf: (g) => !g("clusters.show") || !g("clusters.groupBy") || String(g("layout.mode")) !== "force",
                info: "Requires Show clusters and Group by cluster. It affects Force layout only; higher values pull members more tightly toward their cluster." },
            { control: "switch", label: "Click hull to filter", key: "clusters.clickFilter",
                dimIf: (g) => !g("clusters.show") || !g("clusters.showHulls") || !!g("clusters.collapse"),
                disabledReasonFn: (g) => !g("clusters.show")
                    ? "Turn on Show clusters to enable hull filtering."
                    : g("clusters.collapse")
                        ? "Turn off Collapse to meta-nodes to restore clickable hulls."
                        : "Turn on Show hulls to enable click-to-filter.",
                info: "Requires Show clusters and visible hulls. Clicking a hull cross-filters to the nodes in that cluster." },
            { control: "switch", label: "Hover to emphasise", key: "clusters.hoverEmphasis",
                dimIf: (g) => !g("clusters.show") || (!g("clusters.showHulls") && !g("clusters.showLabels")),
                disabledReasonFn: (g) => !g("clusters.show")
                    ? "Turn on Show clusters to enable hover emphasis."
                    : "Turn on Show hulls or Cluster labels to provide a hover target.",
                info: "Requires Show clusters. Hovering a cluster hull or label dims nodes outside that cluster." },
        ] },
        { id: "scale", name: "Scale", kind: "fields", fields: [
            { control: "select", label: "Renderer", key: "scale.renderMode", options: [opt("auto", "Auto"), opt("svg", "SVG (interactive)"), opt("canvas", "Canvas (fast)")],
                info: "Auto uses SVG below the Canvas threshold and Canvas above it. SVG keeps the richest per-element interaction; Canvas is faster for large graphs. Time animation is available only in SVG mode." },
            { control: "slider", label: "Canvas above (nodes)", key: "scale.canvasThreshold", min: 200, max: 20000, step: 100,
                note: "Auto switches to canvas past this node count", dimIf: (g) => String(g("scale.renderMode")) !== "auto",
                disabledReason: "Set Renderer to Auto to configure the Canvas threshold." },
            { control: "slider", label: "Max edges (0 = All)", key: "scale.maxEdges", min: 0, max: 50000, step: 100,
                info: "Defaults to All so every available relationship between shown nodes is retained. Set a positive value only when you deliberately want a performance cap; Load beyond 30k rows requests additional Power BI data windows until all rows or that cap is reached." },
            { control: "switch", label: "Load beyond 30k rows", key: "scale.fetchMore",
                note: "Requests more data windows until all rows or the explicit Max-edges cap is reached" },
            { control: "switch", label: "Minimap", key: "scale.minimap", dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON },
        ] },
        { id: "analysis", name: "Analysis", kind: "fields", fields: [
            { control: "select", label: "Importance", key: "centrality.metric", options: [opt("none", "Off"), opt("degree", "Degree"), opt("betweenness", "Bridges"), opt("closeness", "Reach"), opt("pagerank", "Influence")],
                dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON,
                info: "Calculates node importance for size, labels, colour, rules, filtering, and tooltips. Degree counts links; Bridges finds connectors between groups (betweenness); Reach favours nodes close to all others (closeness); Influence favours links from important nodes (PageRank)." },
            { control: "switch", label: "Search box", key: "find.show", dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON },
            { control: "switch", label: "Explore mode", key: "explore.show",
                dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON,
                info: "Adds an exploration control for focusing on a selected node and its neighbourhood. It changes the visible subgraph, not the underlying data." },
            { control: "switch", label: "Path analysis", key: "path.show",
                dimIf: (g) => !g("@licensed"), disabledReason: PRO_REASON,
                info: "Adds controls for selecting two nodes and highlighting the shortest path between them." },
            { control: "switch", label: "Use link values", key: "path.weighted",
                dimIf: (g) => !g("path.show") || !g("@hasWeight"),
                disabledReasonFn: (g) => !g("path.show")
                    ? "Turn on Path analysis to use link values."
                    : "Add data to the Edge weight field well to use link values as path costs.",
                info: "Has an effect only when Path analysis is on. It uses the bound Edge weight values as path costs and finds the lowest-cost route; without usable values, the fewest-links route is used." },
            { control: "switch", label: "Time animation", key: "temporal.show",
                dimIf: (g) => !g("@licensed") || !g("@hasTime") || canvasWillRender(g)
                    || (!!g("clusters.show") && !!g("clusters.collapse")),
                disabledReasonFn: (g) => !g("@licensed") ? PRO_REASON
                    : !g("@hasTime")
                    ? "Add valid data to the Time field well to enable time animation."
                    : !!g("clusters.show") && !!g("clusters.collapse")
                        ? "Turn off Collapse to meta-nodes to animate the original timed links."
                        : "Time animation requires SVG rendering. Choose SVG or raise the Auto Canvas threshold.",
                info: "Requires a Time field and SVG rendering. It adds a time slider that reveals nodes and links across the bound time range; it stays hidden when no valid time values exist or Canvas rendering is active." },
            { control: "switch", label: "Show annotations", key: "annotations.show" },
            { control: "select", label: "Annotation style", key: "annotations.defaultMode", options: [opt("marker", "Marker"), opt("text", "Text"), opt("arrow", "Text + arrow"), opt("all", "All")],
                dimIf: (g) => !g("annotations.show"),
                disabledReason: "Turn on Show annotations to choose the annotation tools.",
                info: "Sets which annotation tools are offered when Show annotations is on. It does not restyle annotations that were already created." },
        ] },
    ] },
    // Note: the native Visual overlays card also owns a Format-pane-only master
    // switch (`bar.showOverlays`). The individual gear controls below remain mirrored
    // here; Brand stays native-pane-only.
];

/* Font list for the gear's font picker — id === css === the persisted stack, so
   it round-trips through the `labels.font` dropdown binding. Mirrors settings.ts. */
export const SB_FONTS: SBFont[] = LABEL_FONT_ITEMS.map((f) => ({ id: f.value, label: f.displayName, css: f.value }));

export const SB_PRESETS: string[] = COLOR_PICKER_PRESETS;
/** Back-compatible option names consumed by the shared settings-bar API. Values
 * are now stable semantic SVG ids rather than platform-dependent emoji glyphs. */
export const SB_EMOJI: string[] = SEMANTIC_ICON_VALUES;
export const SB_EMOJI_NAMES: Record<string, string> = SEMANTIC_ICON_NAMES;
