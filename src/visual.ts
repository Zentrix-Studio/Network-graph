/*
 *  Zentrix Network Graph — Power BI custom visual
 *  MVP (Core tier). Built against ../docs/feature-reference.md and
 *  ../KICKOFF-PROMPT.md (single source of truth one level up).
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { interpolateString, select, Selection } from "d3";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { EmptyReason, GraphData, NodeInfoField, NodeInfoMode } from "./types";
import { buildGraphData, missingRequiredRole } from "./model/dataTransform";
import { buildGraphModel, neighborIndex, topNeighbors, nodeFlows } from "./model/graphModel";
import { edgeBetweenness } from "./model/centrality";
import { formatValue, ValueDisplayUnits } from "./render/nodeValues";
import { GraphModel } from "./model/graphTypes";
import { resolveLayout, serializePositions, LayoutMode } from "./model/resolveLayout";
import { DEFAULT_COLLIDE_PADDING, resolveCollisions, resolveCollisionsPreservingShape } from "./model/collide";
import { resolveClusters, ClusterMode } from "./model/resolveClusters";
import { shortestPath, weightedShortestPath, kHopSet } from "./model/traversal";
import { buildHierarchy, hiddenByCollapse, isParentNode, subtreeSet, computeDepth, Hierarchy } from "./model/hierarchy";
import { rankedNodeSet, RankMode, RankBy } from "./model/ranking";
import { inducedSubgraphLayout } from "./model/subgraphLayout";
import { computeCentrality, CentralityMetric, betweennessCentrality, closenessCentrality, pageRank } from "./model/centrality";
import { deriveTreeParents } from "./model/treeLayout";
import { conditionalColor, resolveNodeField, parseRules, serializeRules, CFRule } from "./model/conditionalFormat";
import { RulesPanel } from "./interaction/rulesPanel";
import { computeNarrative, InsightAction, articulationFlags } from "./insights/graphInsights";
import {
    renderGraph, fitTransform, drawLabels, makeEdgeWidth, GraphGeometry, GraphRenderOptions,
    LabelPosition, LabelWrap, LabelBgType, NodeShape, edgeCurvePath, pairPerp, trimEdgeEnds,
    selfLoopPath, edgeLabelPlacement,
} from "./render/graph";
import { drawGraph as drawGraphCanvas, pickNodeAt, Ctx2D } from "./render/canvasGraph";
import { renderBasemap } from "./render/worldOutline";
import { drawNodeValues } from "./render/nodeValues";
import { renderHulls } from "./render/hulls";
import { renderClusterLabels } from "./render/clusterLabels";
import {
    lodShowLabels, nodeCountRadiusScale, renderGraphStatus, renderMinimap,
    responsiveNodeRadiusScale,
} from "./render/scale";
import {
    ColorMode, ColorDriver, paletteByName, lerpColor, categoryIndex, scaleByName,
    sampleScale, reverseIf, familyOf, isCvdSafe,
} from "./render/colors";
import { renderLegendCard, edgeWeightSection, LegendSection, EDGE_DASHES, LegendCorner } from "./render/legend";
import {
    bindNodeSelection, bindContextMenu, bindCanvasContextMenu,
    applySelectionDim, applyHoverEmphasis, applyExploreMask, applyPathEmphasis, applySearchHighlight,
} from "./interaction/selection";
import { EnterprisePanel } from "./interaction/enterprisePanel";
import { enableNodeDrag } from "./interaction/drag";
import { arrowDirection, pickDirectionalNeighbor } from "./interaction/keyboardNav";
import { enableLasso } from "./interaction/lasso";
import { GraphTooltip } from "./interaction/tooltip";
import { LandingPage } from "./interaction/landingPage";
import { DetailPanel } from "./interaction/detailPanel";
import { ViewToggle, ViewKind, ViewCorner } from "./interaction/viewToggle";
import { cornerInset, resolveCorner, CornerPref } from "./interaction/chromePlacement";
import { renderInsightView } from "./render/insightView";
import { ActionBar, ExportFormat, ICONS, makeLineIcon } from "./interaction/actionBar";
import { buildNodesCsv, buildEdgesCsv, buildNodeRows, buildEdgeRows, NodeCsvInput } from "./interaction/exportCsv";
import { buildPdfBase64, buildWorkbookBase64 } from "./interaction/exportFiles";
import { captureVisualSnapshot } from "./interaction/exportSnapshot";
import { SettingsOverlay, SettingsState } from "./interaction/settingsPanel";
import { PremiumGate } from "./interaction/license";
import { ZoomController } from "./interaction/zoom";
import { renderSummaryTable } from "./render/summaryTable";
import { buildClusterGraph } from "./model/clusterGraph";
import { TemporalController, timeRange, edgeVisibleAt, nodeFirstTime, nodeVisibleAt } from "./interaction/temporalControls";
import { NoteStore, nodeNoteKey, NoteMode, AnnotationTheme } from "./notes/store";
import { NoteEditor } from "./interaction/noteEditor";
import { renderNotes, AnchorPos } from "./render/notesLayer";
import { resolveSurface, fontFamily, accent, Surface, HCRoles } from "./theme/zentrixTokens";
import { getSemanticIcon, inferSemanticIcon } from "./interaction/iconCatalog";

type G = Selection<SVGGElement, unknown, null, undefined>;
type RankingAction = "filter" | "highlight";

/** Rough perceived-luminance check on a #rrggbb color → true if dark. */
function isDarkColor(hex?: string): boolean {
    if (!hex || hex[0] !== "#" || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Short, deliberate hierarchy transition: long enough to read, short enough that
 *  repeated exploration still feels direct. */
const FOLD_MOTION_MS = 260;

/** Stable edge identities for refresh enter/update/exit, including parallel edges. */
function motionEdgeKeys(model: GraphModel): string[] {
    const seen = new Map<string, number>();
    return model.links.map((l) => {
        const pair = `${model.nodes[l.source].key}\u0001${model.nodes[l.target].key}`;
        const ordinal = seen.get(pair) ?? 0;
        seen.set(pair, ordinal + 1);
        return `${pair}\u0001${ordinal}`;
    });
}

/**
 * Ensure every ItemDropdown slice holds a valid item. If a report has a stale
 * persisted value whose property type changed (bool → enum, etc.), the formatting
 * service can leave `slice.value` undefined; downstream `.value.value` reads then
 * throw and the whole visual falls back to the fatal message. Resetting to the
 * first item keeps rendering with a sensible default instead of crashing.
 */
function coerceDropdowns(model: VisualFormattingSettingsModel): void {
    for (const card of model.cards) {
        for (const slice of (card as unknown as { slices: { items?: { value: unknown }[]; value?: { value: unknown } }[] }).slices) {
            if (!Array.isArray(slice.items) || !slice.items.length) continue;
            const v = slice.value;
            const valid = v != null && slice.items.some((it) => it.value === v.value);
            if (!valid) slice.value = slice.items[0] as { value: unknown };
        }
    }
}

/** Human label for a centrality metric (for the legend + tooltip). */
function centralityLabel(metric: CentralityMetric): string {
    switch (metric) {
        case "degree": return "Connection centrality";
        case "betweenness": return "Betweenness";
        case "closeness": return "Closeness";
        case "pagerank": return "PageRank";
        default: return "Centrality";
    }
}

/** Max of a numeric field over nodes without spreading a huge array onto the stack. */
function maxOf(arr: number[]): number {
    let m = -Infinity;
    for (const v of arr) if (v > m) m = v;
    return Number.isFinite(m) ? m : 0;
}

interface RenderState {
    model: GraphModel;
    data: GraphData;
    idsByNode: ISelectionId[][];
    /** One selection id per edge/link (parallel to model.links) for edge cross-filter (NG-076). */
    idsByEdge: ISelectionId[];
    neighbors: number[][];
    /** Community id per node when clustering is active, else null. */
    community: number[] | null;
    /** Per-node centrality (0..1) when a metric is selected, else null. */
    centrality: number[] | null;
    /** The active centrality metric label (for legend/tooltip), or null. */
    centralityMetric: CentralityMetric;
    width: number;
    height: number;
    dark: boolean;
    hc: boolean;
    geo?: GraphGeometry;
}

interface MotionNodeSnapshot {
    key: string;
    x: number;
    y: number;
    r: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
}

interface MotionEdgeSnapshot {
    key: string;
    d: string;
    stroke: string;
    strokeWidth: number;
    opacity: number;
}

interface MotionSnapshot {
    nodes: Map<string, MotionNodeSnapshot>;
    edges: Map<string, MotionEdgeSnapshot>;
}

interface LayoutSnapshot {
    pinned: boolean;
    positions: string | null;
}

/** Complete authored state restored by one visual-wide undo/redo step. */
interface AuthoringSnapshot {
    settings: SettingsState;
    layout: LayoutSnapshot;
    rules: string;
    notes: string;
    legendCollapsed: boolean;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    /** Host tooltip service — drives report-page (and default) tooltips when the Tooltip
     *  setting is "report". Null if the host doesn't provide it. */
    private tooltipService: powerbi.extensibility.ITooltipService | null = null;
    private element: HTMLElement;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;

    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private defsGroup: Selection<SVGDefsElement, unknown, null, undefined>;
    private zoomGroup: G;
    private basemapGroup: G;
    private hullGroup: G;
    private clusterLabelGroup: G;
    private edgeGroup: G;
    private nodeGroup: G;
    /** Short-lived removed-node/edge ghosts used by staged data-refresh motion. */
    private motionGroup: G;
    private valueGroup: G;
    private labelGroup: G;
    /** Non-interactive status dots on parents whose descendants are folded. */
    private foldIndicatorGroup: G;
    private notesGroup: G;
    private overlayGroup: G;

    private tooltip: GraphTooltip;
    /** True while a node drag gesture is live (NG-109). d3-drag captures mousemove/
     *  mouseup at the window but NOT mouseover — when the pointer briefly outruns the
     *  circle and re-enters, mouseover would re-show the tooltip mid-drag, frozen in
     *  place (its follow-move is swallowed by d3's capture). Hover handlers bail while
    *  this is set. */
    private nodeDragging = false;
    private landing: LandingPage;
    private detailPanel: DetailPanel;
    private viewToggle: ViewToggle;
    private actionBar: ActionBar;
    /** Restore-from-focus-mode button (NG-118); shown only while chrome is hidden. */
    private restoreBtn!: HTMLButtonElement;
    private temporal: TemporalController;
    /** Per-render temporal data: node first-appearance times + edge times (NG-077). */
    private temporalData: { firstTime: (number | null)[]; edgeTime: (number | null)[] } | null = null;
    /** On-canvas annotations (NG-074): store + editor + the last-persisted blob guard. */
    private notes = new NoteStore();
    private noteEditor!: NoteEditor;
    private pendingNotes: string | null = null;
    private toolbar: SettingsOverlay;
    /** UAT-7: a gear click on a small tile switched the report to focus mode; the
     *  bar auto-opens when the in-focus update() arrives. */
    private pendingFocusOpen = false;
    private premium: PremiumGate;
    private zoom: ZoomController;
    private enterprisePanel: EnterprisePanel;
    private rulesPanel: RulesPanel;

    /** Conditional-formatting rules (R-cf), parsed from the persisted blob and edited
     *  via the Rules panel. Applied in the colour accessor. */
    private cfRules: CFRule[] = [];
    /** The serialized rules we optimistically applied and are waiting for the host to
     *  echo back. Guards against a stale interleaved update() clobbering a just-made
     *  rule edit before persistProperties lands (G2-006) — mirrors the settings bar's
     *  pending reconciliation. Null once storage matches (confirmed) or nothing pends. */
    private pendingRules: string | null = null;

    // Explore (E3) + path (E5) session state (not persisted).
    private exploreFocus: string | null = null;
    private exploreHops = 1;
    private exploreTrail: string[] = [];
    private pathSource: string | null = null;
    private pathTarget: string | null = null;

    // Clickable-insight previews (NG-252): transient/session-local, never persisted or
    // cross-filtered. Only one is live at a time. `insightColorMode` overrides the
    // authored colour scheme for a preview; `insightBridgeLinks` accents the structural-
    // bridge edge set (link indices); `insightFocusActive` lets an insight-driven ego
    // focus (reusing exploreFocus) show even when the explore setting is off. Cleared by
    // an empty-canvas click, Escape, or applying another insight action.
    private insightColorMode: "cluster" | "component" | null = null;
    private insightBridgeLinks: Set<number> | null = null;
    private insightFocusActive = false;

    /** Lazy, memoized analytical columns for the Table view (NG-253). Computed once per
     *  render snapshot the first time a reader switches a column on, so the heavy
     *  betweenness/closeness passes never run for the default table. Cache is keyed on
     *  the lastRender identity, so a new render rebuilds it. */
    private tableMetricCache = new Map<string, number[] | boolean[]>();
    private tableMetricToken: RenderState | null = null;

    // Hierarchy fold/drill session state (Node-parent). Keys, so they survive re-index.
    private collapsed = new Set<string>();          // collapsed parent keys (expand/collapse)
    private collapsedHidden = new Set<number>();    // node indices hidden by a collapsed ancestor
    /** Dataset + Start-collapsed state last applied to the session-local fold set.
     *  Including the setting value is essential: authors toggle it optimistically after
     *  first paint, and a data-only signature used to ignore that transition. */
    private collapseInitedFor: string | null = null;
    private foldMotionTimer: number | null = null;
    private drillRoot: string | null = null;         // current drill-down root key (null = top)
    private drillTrail: string[] = [];               // drill breadcrumb
    private hierState: Hierarchy | null = null;      // hierarchy for the current render (fold/drill)
    private searchTerm = "";

    /** Positions blob (key→[x,y]) for pinned mode — from metadata or optimistic. */
    private storedPositions: string | null = null;
    /** Whether the author has explicitly persisted either node-radius endpoint (NG-239).
     *  Value-independent: it is the *presence* of the persisted property, not its value,
     *  that switches off automatic density/canvas down-scaling — so a deliberate Max of 40
     *  (or Min of 4) is honoured exactly instead of being mistaken for the untouched default. */
    private radiusAuthored = false;
    /** Whether the author has explicitly persisted edge curvature (NG-242). When false, Tree
     *  layout applies its smart maximum-curvature default; when true, the author's value wins
     *  (including 0 for straight tree links). Same value-independent presence signal as above. */
    private curveAuthored = false;
    /** One-shot guard for the legacy "Bold labels" fold (NG-245). The accessibility bold
     *  master was removed as redundant with the per-label Bold toggles; a report that saved
     *  it ON is migrated into those toggles exactly once. */
    private migratedLegacyBold = false;
    /** Visual-wide authoring history: settings, layout, rules, annotations, and
     *  persisted visual chrome. Session-local and bounded; transient exploration,
     *  selection, hover, zoom, and search are intentionally not authored state. */
    private undoHistory: AuthoringSnapshot[] = [];
    private redoHistory: AuthoringSnapshot[] = [];
    private historyStart: AuthoringSnapshot | null = null;
    private replayingHistory = false;
    /** Baseline held while the annotation editor previews per-keystroke changes;
     *  the finished note is recorded as one authored action on commit/delete. */
    private noteEditBefore: AuthoringSnapshot | null = null;
    /** Active legend cross-filter, as "mode:itemIndex" — session-local toggle state
     *  for click-to-filter legend rows (N6). Null when no legend filter is applied. */
    private legendActive: string | null = null;
    /** Legend folded to its compact pill (NG-118). Persisted across refresh via the
     *  `colors.legendCollapsed` machine-state property (NG-142). */
    private legendCollapsed = false;
    /** Optimistic-clobber guard for `legendCollapsed`: the just-toggled value, held
     *  until persistProperties echoes it back so a stale interleaved update() can't
     *  revert the fold before it lands (mirrors `pendingRules`). Null = follow storage. */
    private pendingLegendCollapsed: boolean | null = null;
    /** Focus/presentation mode (NG-118): all chrome (legend, gear, action bar,
     *  panels, branding) hidden so only the graph shows. Session-local; a small
     *  restore button is the one affordance that survives. */
    private chromeHidden = false;
    /** Active view: graph / summary-table (session-local — works in Reading view). */
    private viewMode: ViewKind = "graph";
    /** The mounted summary-table DOM, or null. */
    private summaryEl: HTMLElement | null = null;
    /** Index of the node whose optional full-information panel is open. */
    private openNode: number | null = null;
    /** Last successful render inputs, replayed on in-visual (pin) changes without a
     *  host round-trip. */
    private lastRender?: RenderState;

    /** Structural signature (node keys + edge endpoints) of the last painted graph.
     *  The label/value settle-in fade arms only when this CHANGES — i.e. genuinely new
     *  data — so a settings-echo update() or a resize (same graph) never re-flashes the
     *  labels. undefined until the first render, so the first paint always settles. */
    private lastModelSig?: string;
    /** Geometry captured immediately before a host update clears the SVG layers. */
    private pendingMotion: MotionSnapshot | null = null;
    private graphPainted = false;
    /** One-shot request used by the global settings Reset to replay the same
     *  root-outward entrance choreography as a newly loaded visual. */
    private replayInitialMotion = false;
    private motionFrame: number | null = null;
    private motionTimer: number | null = null;

    // --- Canvas scale mode (large graphs) ------------------------------------
    /** Under-SVG canvas for the fast render path; null until created / if unsupported. */
    private canvasEl: HTMLCanvasElement | null = null;
    private ctx: Ctx2D | null = null;
    /** True while the current render is on the canvas path (drives interaction routing). */
    private canvasActive = false;
    /** Everything `redrawCanvas()` needs to repaint on zoom/pan/selection without a full update. */
    private canvasState: {
        st: RenderState; geo: GraphGeometry;
        radiusOf: (i: number) => number; colorOf: (i: number) => string; nodeOpacity?: number;
        edgeColor: string; edgeColorOf?: (li: number) => string | null; edgeWidthOf: (li: number) => number;
        edgeCurve?: number;
        edgeSuppressedOf?: (li: number) => boolean;
        edgeSecondaryOf?: (li: number) => boolean;
        nodeStroke: string; strokeOf?: (i: number) => { color: string; width: number } | null;
        iconOf?: (i: number) => string | null;
        hideEdges?: boolean;
        /** The exact hard-visibility mask last used to paint this Canvas frame. */
        isHiddenNode?: (i: number) => boolean;
    } | null = null;
    private hoverNode: number | null = null;
    /** True when links are hidden but revealed on hover (req 1) — read by the hover handler. */
    private edgesHoverReveal = false;

    /** The host's high-contrast roles, read fresh on every update. Non-null only
     *  while `colorPalette.isHighContrast`; drives every surface colour so the
     *  visual matches whichever HC theme the user picked (not a hard-coded pair). */
    private hcRoles: HCRoles | undefined;
    /** Localization manager (NG-228). Resolves capabilities displayNameKeys and runtime
     *  strings against the registered stringResources; undefined on hosts without it.
     *  Passed to the FormattingSettingsService so the native pane localizes too. */
    private localization?: powerbi.extensibility.ILocalizationManager;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.events = this.host.eventService;
        this.selectionManager = this.host.createSelectionManager();
        try {
            this.localization = (this.host as unknown as {
                createLocalizationManager?: () => powerbi.extensibility.ILocalizationManager;
            }).createLocalizationManager?.();
        } catch { this.localization = undefined; }
        this.formattingSettingsService = new FormattingSettingsService(this.localization);

        this.tooltip = new GraphTooltip(options.element);
        try { this.tooltipService = (options.host as unknown as { tooltipService?: powerbi.extensibility.ITooltipService }).tooltipService || null; } catch { this.tooltipService = null; }
        const launch = (url: string) => {
            try { this.host.launchUrl(url); } catch { /* host without URL launching */ }
        };
        this.landing = new LandingPage(options.element, {
            // Power BI's launchUrl API supports HTTP(S), not mailto. Use Outlook's
            // HTTPS compose deep link so the support address is pre-filled without
            // requesting WebAccess or passing any report data outside the sandbox.
            onSupport: () => launch(
                "https://outlook.office.com/mail/deeplink/compose?to=support%40zentrixstudio.in"
                + "&subject=Zentrix%20Network%20Graph%20Support",
            ),
            onLinkedIn: () => launch("https://www.linkedin.com/company/zentrixstudio/"),
        });
        this.detailPanel = new DetailPanel(options.element, () => this.closeDetail());
        this.viewToggle = new ViewToggle(options.element, (kind) => {
            this.viewMode = kind;
            this.rerenderFromSettings();
        });
        // Quick-action bar (T12+N16): zoom in/out/fit + visual-wide undo/redo +
        // reset layout.
        this.actionBar = new ActionBar(options.element, {
            onZoomIn: () => this.zoom.zoomBy(1.25),
            onZoomOut: () => this.zoom.zoomBy(1 / 1.25),
            onFit: () => this.zoom.reset(),
            onUndo: () => this.undoVisualChange(),
            onRedo: () => this.redoVisualChange(),
            onResetLayout: () => this.resetLayout(),
            onExport: (format) => { void this.exportData(format); },
            onFocusMode: () => this.setChromeHidden(true),
        });
        // Conventional visual-history shortcuts are scoped to this visual. Text-editing
        // controls keep their native undo/redo, and unavailable history falls through so
        // Power BI can handle its own report-level command.
        this.element.addEventListener("keydown", (event) => this.onHistoryShortcut(event));
        // Focus mode (NG-118): the lone affordance that survives when all chrome is
        // hidden — a small button, top-right, to bring the panels back.
        this.restoreBtn = this.makeRestoreButton(options.element);
        // Temporal controller (NG-077): scrubbing/playing filters edges by time without
        // a full re-render — just DOM display toggles over the stable full-graph layout.
        this.temporal = new TemporalController(options.element, (t) => this.applyTemporalFilter(t));
        // Annotation editor (NG-074). onChange repaints optimistically from the working
        // copy; onCommit persists the store; blank text on commit deletes the note.
        this.noteEditor = new NoteEditor(options.element, this.noteTheme(false, false), {
            onChange: (note) => { this.notes.upsert(note); this.rerenderFromSettings(); },
            onCommit: (note) => {
                if (note.text.trim() || note.mode === "marker") this.notes.upsert(note);
                else this.notes.remove(note.id);
                this.persistNotes();
                this.commitAuthoringSnapshot(this.noteEditBefore);
                this.noteEditBefore = null;
            },
            onDelete: (note) => {
                this.notes.remove(note.id);
                this.persistNotes();
                this.commitAuthoringSnapshot(this.noteEditBefore);
                this.noteEditBefore = null;
            },
            onClose: () => { /* focus returns to the canvas naturally */ },
        });
        this.toolbar = new SettingsOverlay(
            options.element,
            this.host,
            (resetAll) => this.rerenderFromSettings(resetAll, resetAll),
            () => this.beginAuthoringChange(),
            () => this.commitAuthoringChange(),
        );
        this.premium = new PremiumGate(this.host, () => this.rerenderFromSettings());
        this.enterprisePanel = new EnterprisePanel(options.element, {
            onExploreFocus: (key) => { this.setExploreFocus(key); this.rerenderFromSettings(); },
            onExploreHops: (h) => { this.exploreHops = h; this.rerenderFromSettings(); },
            onPathChange: (s, t) => { this.pathSource = s; this.pathTarget = t; this.rerenderFromSettings(); },
            onSearch: (term) => { this.searchTerm = term; this.rerenderFromSettings(); },
            onClosePanel: () => {
                this.searchTerm = "";
                this.setExploreFocus(null);
                this.exploreHops = 1;
                this.pathSource = null;
                this.pathTarget = null;
                this.toolbar.setValues({
                    "find.show": false,
                    "explore.show": false,
                    "path.show": false,
                });
            },
        });
        this.rulesPanel = new RulesPanel(options.element, (rules) => {
            const before = this.captureAuthoringSnapshot();
            this.cfRules = rules;
            this.pendingRules = serializeRules(rules); // optimistic until the host confirms it
            this.persistRules(rules);
            this.rerenderFromSettings();
            this.commitAuthoringSnapshot(before);
        }, () => {
            // Closing the panel is the same authoring action as switching off
            // "Rules editor": rules remain active, only the editor is hidden.
            this.toolbar.setValue("cf.show", false);
        });

        // Under-SVG canvas for the large-graph fast path. Click-through (pointer-events
        // none) so the SVG on top owns all interaction — in canvas mode the SVG has no
        // node elements and routes hover/click through arithmetic hit-testing instead.
        // getContext returns null under jsdom (no canvas): the visual then falls back to
        // the SVG path, so tests and unsupported hosts still render.
        try {
            const c = document.createElement("canvas");
            c.className = "zentrix-network-canvas";
            c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:0";
            const el = options.element as HTMLElement;
            if (getComputedStyle(el).position === "static") el.style.position = "relative";
            el.insertBefore(c, el.firstChild);
            this.canvasEl = c;
            this.ctx = (c.getContext("2d") as unknown as Ctx2D) || null;
        } catch { this.canvasEl = null; this.ctx = null; }

        this.svg = select(options.element)
            .append("svg")
            .classed("zentrix-network", true)
            .attr("width", "100%")
            .attr("height", "100%")
            .style("position", "relative")
            .style("z-index", "1");

        // Fixed layer order (bottom → top). The zoom group wraps the pannable/zoomable
        // content (hulls, edges, nodes, labels); the overlay (branding, minimap,
        // truncation note, empty state) stays fixed on screen, outside the zoom.
        this.defsGroup = this.svg.append("defs");
        this.zoomGroup = this.svg.append("g").classed("zoom", true);
        // Outline-map backdrop (Geo-route mode) — the bottom-most layer so continents
        // sit UNDER edges, nodes and labels. Empty unless geo mode + the toggle are on.
        this.basemapGroup = this.zoomGroup.append("g").classed("basemap", true);
        this.hullGroup = this.zoomGroup.append("g").classed("hulls", true);
        this.clusterLabelGroup = this.zoomGroup.append("g").classed("cluster-labels", true);
        this.edgeGroup = this.zoomGroup.append("g").classed("edges", true);
        this.motionGroup = this.zoomGroup.append("g").classed("motion-ghosts", true)
            .attr("pointer-events", "none");
        this.nodeGroup = this.zoomGroup.append("g").classed("nodes", true);
        this.valueGroup = this.zoomGroup.append("g").classed("node-values", true);
        this.labelGroup = this.zoomGroup.append("g").classed("labels", true);
        this.foldIndicatorGroup = this.zoomGroup.append("g").classed("fold-indicators", true)
            .attr("pointer-events", "none")
            .attr("aria-hidden", "true");
        // Annotations sit above the graph but inside the zoom group so they pan/zoom with it.
        this.notesGroup = this.zoomGroup.append("g").classed("annotations", true);
        this.overlayGroup = this.svg.append("g").classed("overlay", true);

        // Zoom & pan (Enterprise scale mode) — transforms the zoom group; redraws
        // the fixed overlay chrome (minimap viewport rect) on change.
        this.zoom = new ZoomController(
            this.svg.node() as Element,
            (s, animated) => {
                // NG-112: discrete zoom steps (buttons / fit / reset) ease via a CSS
                // transform transition; wheel & pan clear the class first so pointer
                // tracking stays 1:1. Canvas mode redraws pixels per frame, so easing
                // only the SVG overlay would tear — keep it instant there.
                this.svg.classed("zx-zoom-anim",
                    animated && !this.canvasActive && !!this.formattingSettings?.nodes.animate.value);
                this.zoomGroup.attr("transform", `translate(${s.tx},${s.ty}) scale(${s.k})`);
            },
            () => {
                this.syncSemanticZoom();
                if (this.canvasActive) this.redrawCanvas();
                if (this.lastRender && this.viewMode === "graph") this.renderOverlayChrome(this.lastRender);
            },
        );

        // Empty-canvas click clears the cross-filter, closes full node information,
        // and exits ego-focus (G2-007). (The settings bar handles its own click-away.)
        this.svg.on("click", () => {
            // Clicking the canvas commits any open annotation edit before clearing
            // selection (NG-074) — otherwise the working copy is lost on the next refresh.
            if (this.noteEditor.isOpen()) { this.noteEditor.commit(); return; }
            this.closeDetail();
            // Empty-canvas click also dismisses any transient Insight preview (NG-252).
            const clearedPreview = this.clearInsightPreview();
            if (!this.clearExploreFocus() && clearedPreview) this.rerenderFromSettings();
        });

        // Escape exits drill-down, then ego-focus, from the canvas (G2-007). A focused
        // node bubbles the keydown here. Bound once; the svg persists across repaints.
        this.svg.on("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (this.chromeHidden) { event.preventDefault(); this.setChromeHidden(false); return; }
            if (this.drillRoot) { event.preventDefault(); this.drillOut(); return; }
            // Escape also dismisses any transient Insight preview (NG-252).
            const clearedPreview = this.clearInsightPreview();
            if (this.clearExploreFocus()) event.preventDefault();
            else if (clearedPreview) { event.preventDefault(); this.rerenderFromSettings(); }
        });

        // Right-click on empty canvas → the report-level context menu (Power BI
        // never opens it for a custom visual unless the visual asks).
        bindCanvasContextMenu(this.svg as unknown as Selection<Element, unknown, null, undefined>,
            this.selectionManager, (e) => this.menuOrigin(e));

        // Selection can also change from OUTSIDE this visual — another visual
        // cross-filtering us, or the report clearing all filters. Without this the
        // graph keeps showing a stale dim state.
        const sm = this.selectionManager as unknown as {
            registerOnSelectCallback?: (cb: () => void) => void;
        };
        if (typeof sm.registerOnSelectCallback === "function") {
            sm.registerOnSelectCallback(() => this.syncSelectionDim());
        }

        // Show onboarding immediately — Power BI won't call update() until a role
        // is bound, so a landing page shown only from update() never appears.
        try { this.landing.show(); } catch { /* never blank the visual */ }
    }

    public update(options: VisualUpdateOptions): void {
        // Preserve the live authored state before hydrating a host-supplied model.
        // If the Format pane (or another host surface) changed it, the completed
        // update becomes one undoable action. Data/resize-only updates compare equal.
        const externalBefore = this.lastRender && !this.replayingHistory
            ? this.captureAuthoringSnapshot()
            : null;
        this.events.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel, dataView);
            // Guard against a persisted value whose property type changed (e.g. an old
            // boolean saved for a slice that is now a dropdown) — the formatting service
            // leaves such a dropdown's value undefined, which would crash every `.value.value`
            // read. Reset any dropdown with an invalid/missing value to its first item.
            coerceDropdowns(this.formattingSettings);
            this.migrateLegacyBoldLabels(dataView);

            const palette = this.host.colorPalette;
            const hc = !!palette.isHighContrast;
            // Read the host's actual HC roles. Power BI has several HC themes
            // (yellow-on-black, black-on-white, …) — assuming white-on-black was
            // the bug that made the visual ignore the user's chosen theme.
            const role = (c?: { value?: string }) => (c && c.value) || undefined;
            this.hcRoles = hc ? {
                foreground: role(palette.foreground),
                background: role(palette.background),
                foregroundSelected: role(palette.foregroundSelected),
                hyperlink: role(palette.hyperlink),
            } : undefined;
            const dark = !hc && isDarkColor(palette.background && palette.background.value);
            const surface = this.surfaceFor(dark, hc);

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);
            this.pendingMotion = this.captureMotionSnapshot();
            this.cancelMotion();
            this.clearLayers();
            this.tooltip.setTheme(surface, dark, this.formattingSettings.branding.show.value);
            this.detailPanel.setTheme(surface);
            this.viewToggle.setTheme(surface);
            this.actionBar.setTheme(surface);

            const reason = missingRequiredRole(dataView);
            if (reason) {
                this.pendingMotion = null;
                this.graphPainted = false;
                this.viewToggle.hide();
                this.actionBar.hide();
                this.openNode = null;
                this.detailPanel.hide();
                this.toolbar.update(this.formattingSettings, dark, true);
                this.enterprisePanel.hide();
                this.rulesPanel.hide();
                this.removeSummary();
                this.renderEmptyState(reason, width, height, surface);
                if (reason === "noData") { this.landing.setTheme(surface); try { this.landing.show(); } catch { /* */ } }
                else this.landing.hide();
                this.events.renderingFinished(options);
                return;
            }
            this.landing.hide();
            // Viewers-free enforcement: the gate only ever bites in edit/authoring
            // mode (ViewMode.Edit / InFocusEdit); Reading view always fail-opens.
            this.premium.refresh(options.viewMode != null && options.viewMode !== 0);

            // Progressive data loading (T11). The table mapping windows rows at 30k per
            // segment; when the host reports another segment (`metadata.segment`) and we
            // are still under the edge budget, request the next window. The host then
            // re-enters update() with the accumulated rows — each pass renders what it
            // has, so the graph appears immediately and densifies instead of freezing.
            const moreSegments = (dataView!.metadata as unknown as { segment?: unknown }).segment != null;
            if (moreSegments && this.formattingSettings.scale.fetchMore.value) {
                const have = dataView!.table?.rows?.length
                    ?? dataView!.categorical?.categories?.[0]?.values?.length ?? 0;
                const budget = this.maxEdgeBudget();
                if (have < budget) {
                    try {
                        (this.host as unknown as { fetchMoreData?: (aggregateSegments?: boolean) => boolean })
                            .fetchMoreData?.(true);
                    } catch { /* host without fetchMoreData — the 30k window stands */ }
                }
            }

            // Read persisted pinned positions (written by togglePin via persistProperties).
            this.storedPositions = readStoredPositions(dataView!);
            // Whether either node-radius endpoint was ever persisted (NG-239). Combined with
            // the settings bar's live pending edits so both a reloaded report and an in-flight
            // gear drag count as "authored" and use the exact Min/Max instead of auto-scaling.
            this.radiusAuthored = readObjectAuthored(dataView!, "nodes", ["minRadius", "maxRadius"]);
            // Whether edge curvature was ever persisted (NG-242) — lets an explicit value
            // override Tree's automatic max-curvature default, straight links included.
            this.curveAuthored = readObjectAuthored(dataView!, "edges", ["curve"]);
            // Load persisted annotations (NG-074), with the optimistic-clobber guard: a
            // stale interleaved update() must not revert a just-written note before its
            // persistProperties echoes back.
            this.loadNotes(dataView!);
            // Read persisted conditional-formatting rules (edited via the Rules panel).
            // Read persisted conditional-formatting rules, but don't let a stale
            // interleaved update() clobber a just-made optimistic edit before its
            // persistProperties lands (G2-006): keep applying the pending edit until the
            // host echoes it back, then clear and follow storage. Without this, toggling
            // the Rules editor (or any refresh) mid-persist reverts to the old rule set.
            const storedRules = readStoredRules(dataView!);
            if (this.pendingRules != null && storedRules === this.pendingRules) this.pendingRules = null;
            this.cfRules = parseRules(this.pendingRules != null ? this.pendingRules : storedRules);

            // Read the persisted legend fold (NG-142), with the same optimistic-clobber
            // guard: honour a just-made toggle until persistProperties echoes it back.
            const storedLegendCollapsed = readLegendCollapsed(dataView!);
            if (this.pendingLegendCollapsed != null && storedLegendCollapsed === this.pendingLegendCollapsed) this.pendingLegendCollapsed = null;
            this.legendCollapsed = this.pendingLegendCollapsed != null ? this.pendingLegendCollapsed : storedLegendCollapsed;

            // Build the graph (pure) with the honest render budget (scale mode E1).
            const maxEdges = this.maxEdgeBudget();
            const data0 = buildGraphData(dataView!, maxEdges, {
                mergeDuplicates: this.formattingSettings.nodes.mergeDuplicates.value,
            });
            const model0 = buildGraphModel(data0.edges, data0.labelByKey);

            // Clustering (Enterprise E2), gated by the premium licence (fail-open).
            // Also computed when colour-by-cluster is selected, so the palette can use it,
            // and when "Group by cluster" wants the grouping force even with hulls hidden.
            const cl = this.formattingSettings.clusters;
            const colorByCluster = this.formattingSettings.colors.mode.value.value === "cluster";
            const clusterOn = this.premium.active && (cl.show.value || colorByCluster
                || cl.collapse.value || cl.groupByCluster.value);
            const clusterMode = (cl.clusterBy.value.value as ClusterMode) || "auto";
            const community0 = clusterOn
                ? resolveClusters(model0, (i) => (data0.attrs[i]?.category ?? null), {
                    mode: clusterMode,
                    resolution: Math.max(0.2, (cl.resolution.value || 100) / 100),
                    minClusterSize: Math.max(1, cl.minClusterSize.value || 1),
                    maxClusters: Math.max(0, cl.maxClusters.value || 0),
                })
                : null;

            // Cluster collapse (NG-078): swap in the aggregated community graph as a
            // consistent (model, data) pair so the whole pipeline runs on it unchanged.
            const collapse = clusterOn && community0 !== null && this.formattingSettings.clusters.collapse.value;
            let model = model0, data = data0, community = community0;
            if (collapse && community0) {
                const cg = buildClusterGraph(model0, community0, data0);
                model = cg.model; data = cg.data;
                community = model.nodes.map((_, i) => i); // identity → distinct meta-node colours
            }
            const { idsByNode, idsByEdge } = this.buildSelectionIds(dataView!, model, data);
            const neighbors = neighborIndex(model);

            // Centrality (Enterprise moat) — computed once here, reused for size/colour/
            // ranking/tooltip. Gated by the premium licence (fail-open).
            const cMetric = this.formattingSettings.centrality.metric.value.value as CentralityMetric;
            const centralityMetric: CentralityMetric = this.premium.active ? cMetric : "none";
            const centrality = centralityMetric !== "none" ? computeCentrality(model, centralityMetric) : null;

            this.lastRender = { model, data, idsByNode, idsByEdge, neighbors, community, centrality, centralityMetric, width, height, dark, hc };
            // Settle-in fade decision: arm it only when the GRAPH ITSELF changed, not on a
            // settings-echo update() (persistProperties round-trips back through update with
            // the same data) or a resize. Both would otherwise rebuild the labels and replay
            // the fade — the "labels flash on every settings change" the CEO reported. The
            // signature is structural (node keys + edge endpoints); a pure cosmetic/measure
            // refresh leaves it unchanged, so no fade.
            const modelSig = model.nodes.length + "n" + model.links.length + "e|"
                + model.nodes.map((n) => n.key).join(",") + "|"
                + model.links.map((l) => l.source + ">" + l.target).join(",");
            const dataChanged = modelSig !== this.lastModelSig;
            this.lastModelSig = modelSig;
            // View-switch visibility is gated inside paint() (summaryTable.show), so a
            // gear edit takes effect on the optimistic rerenderFromSettings path too.
            this.zoom.setEnabled(this.premium.active);
            this.zoom.reset(); // new data → re-fit

            // Enterprise explore/path pickers: repopulate for the new node set and
            // drop any stale focus/path selection that no longer exists.
            const keys = model.nodes.map((n) => n.key);
            const keySet = new Set(keys);
            if (this.exploreFocus && !keySet.has(this.exploreFocus)) this.setExploreFocus(null);
            this.exploreTrail = this.exploreTrail.filter((k) => keySet.has(k));
            if (this.pathSource && !keySet.has(this.pathSource)) this.pathSource = null;
            if (this.pathTarget && !keySet.has(this.pathTarget)) this.pathTarget = null;
            this.enterprisePanel.setTheme(surface);
            this.enterprisePanel.setNodes(keys);
            this.enterprisePanel.setViewport(width, height);
            const ep = this.premium.active;
            this.enterprisePanel.configure(
                ep && this.formattingSettings.find.show.value,
                ep && this.formattingSettings.explore.show.value,
                ep && this.formattingSettings.path.show.value);

            // Rules editor (R-cf) — core feature. The rules colour nodes whenever they
            // exist; the panel is just the editor, shown by the cformat.show toggle.
            this.rulesPanel.setTheme(surface);
            this.rulesPanel.setAvailability({
                weighted: data0.hasWeight,
                category: data0.hasCategory,
                centrality: centrality !== null,
            });
            this.rulesPanel.setRules(this.cfRules);
            this.rulesPanel.configure(this.formattingSettings.cformat.show.value);

            // In-visual settings bar (shared @zentrix component): primary settings
            // surface. Hidden on tiles too small for its popover. Reconcile its
            // optimistic PENDING edits onto the freshly-populated model BEFORE painting
            // (G2-001): persistProperties is async, so the host can fire an update()
            // whose objects don't yet carry a just-made gear edit. If paint ran first it
            // would repaint the pre-edit default (e.g. single-colour reverting to the
            // theme accent) and — since the pending replay never itself repaints — strand
            // the canvas on that default until the next unrelated render. Reconciling
            // first means paint always reflects the user's latest edit.
            const tooSmall = width < 340 || height < 220;
            this.toolbar.update(this.formattingSettings, dark, tooSmall, {
                hasParent: data0.hasParent,
                hasCategory: data0.hasCategory,
                hasSize: data0.hasSize,
                hasWeight: data0.hasWeight,
                hasIcon: data0.hasIcon,
                hasEdgeType: data0.hasEdgeType,
                hasTime: data0.hasTime,
                hasTooltips: data0.hasTooltips,
                hasGeo: data0.attrs.some((attr) => attr.lat != null && attr.lon != null),
                canvasAvailable: !!this.ctx,
                nodeCount: model.nodes.length,
                edgeCount: model.links.length,
            });
            // The quick-action toolbar owns the top-right corner; tell the gear so it steps
            // left of it instead of overlapping when the author pins the gear top-right (NG-136).
            this.toolbar.setActionBarPresent(this.formattingSettings.toolbar.actions.value);
            this.toolbar.setCorner("br");
            // UAT-7 (mirrored from the heatmap) — tiles too small for the settings
            // popover to make sense: the gear click switches the report into FOCUS
            // MODE instead. The visual fills the canvas, update() re-runs with
            // isInFocus, and the bar auto-opens there so the click still lands in
            // settings. forceOpen bypasses the gate by design; hosts without focus
            // support fall back to opening in place (gate returns false).
            // Threshold: the master+detail popover is ~640px wide and ~430px tall;
            // under that it buries the graph. Short-but-wide tiles stay in place —
            // the popover covering a SHORT tile vertically is the normal config UX;
            // it's narrow tiles that break.
            const needsFocusForSettings = !options.isInFocus
                && (width < 640 || height < 400);
            this.toolbar.setOpenGate(needsFocusForSettings ? () => {
                try { this.host.switchFocusModeState(true); } catch { return false; }
                this.pendingFocusOpen = true;
                return true;
            } : null);
            if (options.isInFocus && this.pendingFocusOpen) {
                this.pendingFocusOpen = false;
                this.toolbar.forceOpen();
            }

            // Fade the labels in only when the graph data actually changed (dataChanged) —
            // NOT on a settings-echo update() or a resize, which would re-flash the always-
            // rebuilt labels. Optimistic gear repaints (rerenderFromSettings) pass settle=false.
            this.paint(this.lastRender, dataChanged);
            this.commitAuthoringSnapshot(externalBefore);

            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
            this.renderFatal(options.viewport.width, options.viewport.height);
        }
    }

    /** Legacy fold for the removed accessibility "Bold labels" master (NG-245). That toggle
     *  was redundant with the per-label Outer/Inner Bold controls (it merely OR'd into both),
     *  so it was deleted. A report that persisted it ON is migrated ONCE into the per-label
     *  toggles — bold preserved and now fully controllable. Cross-load idempotence comes from
     *  the *presence* of a persisted `labels.bold`: once migration (or any explicit outer-bold
     *  edit) has written it, we never fold again, so bold is never re-forced stuck-on. No write
     *  to the now-undeclared `accessibility` object is needed (a strict host could drop it). */
    private migrateLegacyBoldLabels(dataView: DataView | undefined): void {
        if (this.migratedLegacyBold || !dataView) return;
        const objs = dataView.metadata?.objects as Record<string, powerbi.DataViewObject> | undefined;
        const legacy = (objs?.accessibility as { boldLabels?: unknown } | undefined)?.boldLabels;
        if (legacy !== true) return; // nothing saved → the per-label toggles already own bold
        // Already migrated, or the author has explicitly set outer bold → they own it now.
        if ((objs?.labels as { bold?: unknown } | undefined)?.bold !== undefined) {
            this.migratedLegacyBold = true;
            return;
        }
        this.migratedLegacyBold = true;
        // Optimistic: reflect it in this frame so the migration causes no bold flicker.
        this.formattingSettings.labels.bold.value = true;
        this.formattingSettings.labels.innerBold.value = true;
        this.host.persistProperties({
            merge: [{ objectName: "labels", selector: null, properties: { bold: true, innerBold: true } }],
        } as powerbi.VisualObjectInstancesToPersist);
    }

    /** The surface palette for a theme, with the host's live HC roles applied. */
    private surfaceFor(dark: boolean, hc: boolean): Surface {
        return resolveSurface(dark, hc, this.hcRoles);
    }

    /** Load the persisted note blob, guarding a just-written optimistic edit (NG-074). */
    private loadNotes(dataView: DataView): void {
        const obj = dataView.metadata?.objects?.notesStore as { data?: unknown } | undefined;
        const json = typeof obj?.data === "string" ? obj.data : "";
        if (this.pendingNotes != null) {
            if (json === this.pendingNotes) this.pendingNotes = null; // host confirmed our write
            else return;                                             // our write is still in flight
        }
        this.notes.load(json);
    }

    /** Write the note store through to the report, then repaint. */
    private persistNotes(): void {
        const json = this.notes.toJSON();
        this.pendingNotes = json;
        this.host.persistProperties({
            merge: [{ objectName: "notesStore", selector: null, properties: { data: json } }],
        } as powerbi.VisualObjectInstancesToPersist);
        this.rerenderFromSettings();
    }

    /** Open the annotation editor on a node (existing note, or a fresh one). */
    private openNoteEditor(st: RenderState, i: number): void {
        const anchor = nodeNoteKey(st.model.nodes[i]);
        const existing = this.notes.get(anchor);
        if (!existing && this.notes.isFull()) return;
        this.noteEditBefore = this.captureAuthoringSnapshot();
        const mode = (this.formattingSettings.annotations.defaultMode.value.value as NoteMode) ?? "all";
        const note = existing ?? this.notes.create(anchor, mode);
        this.noteEditor.setTheme(this.noteTheme(st.dark, st.hc));
        this.noteEditor.open(note, st.model.nodes[i].key, !existing);
    }

    /** Annotation editor/renderer theme, resolved from the current surface (NG-074). */
    private noteTheme(dark: boolean, hc: boolean): AnnotationTheme {
        const s = this.surfaceFor(dark, hc);
        return {
            bg: s.bg, fg: s.fg, muted: s.muted,
            accent: hc ? s.fg : accent,
            line: hc ? s.fg : (dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"),
            font: fontFamily,
        };
    }

    /** Context-menu coordinates. Power BI expects them relative to the VISUAL's
     *  box; passing raw client coords puts the menu in the wrong place on any
     *  report where the visual isn't at the top-left of the page. */
    private menuOrigin(event: MouseEvent): { x: number; y: number } {
        const r = this.element.getBoundingClientRect
            ? this.element.getBoundingClientRect()
            : { left: 0, top: 0 } as DOMRect;
        return { x: event.clientX - r.left, y: event.clientY - r.top };
    }

    /** Repaint from cached inputs after an in-visual change — no host round-trip.
     *  Layout-authoring actions preserve the currently displayed geometry so the
     *  recomputed arrangement can settle from what the reader just saw. */
    private rerenderFromSettings(animateLayout = false, replayInitial = false): void {
        if (!this.lastRender) return;
        this.replayInitialMotion = replayInitial;
        this.pendingMotion = animateLayout ? this.captureMotionSnapshot() : null;
        this.cancelMotion();
        this.clearLayers();
        this.paint(this.lastRender, animateLayout);
    }

    /** Build the focus-mode restore button — an eye icon, top-right, hidden until
     *  focus mode is on (NG-118). It is deliberately the only chrome that survives. */
    private makeRestoreButton(host: HTMLElement): HTMLButtonElement {
        const b = document.createElement("button");
        b.className = "zx-restore";
        b.type = "button";
        b.title = "Show panels";
        b.setAttribute("aria-label", "Show panels");
        b.appendChild(makeLineIcon(ICONS.eye));
        const s = b.style;
        s.position = "absolute"; s.right = "10px"; s.top = "10px"; s.zIndex = "20";
        s.width = "30px"; s.height = "30px"; s.display = "none";
        s.alignItems = "center"; s.justifyContent = "center";
        s.border = "none"; s.borderRadius = "9px"; s.cursor = "pointer";
        s.padding = "6px"; s.boxSizing = "content-box"; s.lineHeight = "1";
        b.onclick = (e) => { e.stopPropagation(); this.setChromeHidden(false); };
        host.appendChild(b);
        return b;
    }

    /** Toggle focus mode (NG-118): hide every chrome element so only the graph
     *  shows, or bring it all back. Repaints optimistically (no host round-trip). */
    private setChromeHidden(hidden: boolean): void {
        if (this.chromeHidden === hidden) return;
        this.chromeHidden = hidden;
        this.rerenderFromSettings();
    }

    /** Theme the restore button to match the action-bar chrome (NG-118). */
    private themeRestoreButton(surface: Surface): void {
        const dark = surface.bg !== "#FFFFFF";
        const b = this.restoreBtn.style;
        b.background = surface.bg;
        b.border = `1px solid ${surface.edge}${dark ? "" : "33"}`;
        b.boxShadow = dark ? "0 4px 14px rgba(0,0,0,0.45)" : "0 4px 14px rgba(11,16,32,0.12)";
        b.color = surface.fg;
    }

    /** Draw the graph (or the summary table) from a render state. */
    private paint(st: RenderState, settle = false): void {
        const s = this.formattingSettings;
        const surface = this.surfaceFor(st.dark, st.hc);
        this.rulesPanel.setAvailability({
            centrality: this.premium.active
                && (s.centrality.metric.value.value as CentralityMetric) !== "none",
        });
        // Turning the opt-in off immediately removes any open panel and forgets its
        // node so a later repaint cannot bring it back.
        if (!s.nodes.showFullInfoOnClick.value) {
            this.openNode = null;
            this.detailPanel.hide();
        } else {
            // Reconcile the open panel against the CURRENT selection truth rather than
            // sticky last-click memory (NG-QA-004). A Power BI bookmark restores
            // selectionManager state directly — no click event fires — so without this,
            // switching bookmarks left the panel showing whatever node a real click had
            // last opened, ignoring what the newly-applied bookmark actually selected
            // (including "nothing", which must close the panel).
            const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
            const stillOpen = this.openNode != null && this.openNode < st.idsByNode.length
                && !!st.idsByNode[this.openNode]
                && st.idsByNode[this.openNode].some((id) => selected.some((sid) => idEquals(sid, id)));
            if (!stillOpen) {
                const idx = selected.length
                    ? st.idsByNode.findIndex((ids) => !!ids && ids.some((id) => selected.some((sid) => idEquals(sid, id))))
                    : -1;
                this.openNode = idx >= 0 ? idx : null;
                if (this.openNode == null) this.detailPanel.hide();
            }
        }
        const overlaysDisabled = !s.toolbar.showOverlays.value;
        // Focus mode is entered from the quick-action eye button, so disabling
        // Quick actions must also exit that mode. Otherwise its orphaned restore-eye
        // survives after the action bar is gone (the exact Format-pane bug in NG-168).
        if ((!s.toolbar.actions.value || overlaysDisabled) && this.chromeHidden) this.chromeHidden = false;
        const hideChrome = this.chromeHidden || overlaysDisabled;
        // Small-tile chrome shedding (CEO): on a cramped tile the floating overlays —
        // the quick-action/zoom bar, the Graph/Table/Insight pill, and the legend +
        // branding watermark — overlap each other and bury the graph. Below the
        // breakpoint we suppress all of them and keep only the gear (still the way in
        // to every setting). Computed from the render state's own viewport so it holds
        // on the optimistic rerenderFromSettings() path too, not just host updates.
        const smallTile = this.isSmallTile(st.width, st.height);

        // View switch (NG-125): gate the floating Graph / Table / Insight pill. Each
        // non-graph segment is offered independently — Table via summaryTable.show,
        // Insight via insights.show (Enterprise-gated). Turning off the segment a
        // reader is currently in forces the canvas back to the graph so they're never
        // stranded in a view they can no longer leave. Placement is author-controlled
        // (summaryTable.position): an explicit corner pins the pill; "auto" keeps the
        // legacy bottom-right dodge — LEFT of the gear when it anchors bottom-right,
        // ABOVE the Zentrix watermark, else flush in the corner.
        const tableSeg = s.summaryTable.show.value;
        const insightSeg = this.premium.active && s.insights.show.value;
        this.viewToggle.setSegments({ table: tableSeg, insight: insightSeg });
        // If the current view's segment was just turned off, follow the pill back to graph.
        if (this.viewMode !== "graph" && this.viewToggle.current() === "graph") this.viewMode = "graph";
        if (this.viewToggle.hasAlternateView() && !hideChrome && !smallTile) {
            const gearCornerPref = (s.toolbar.position.value.value as string) || "auto";
            const gearAtBr = s.toolbar.show.value && (gearCornerPref === "br" || gearCornerPref === "auto");
            const viewCorner = ((s.summaryTable.position.value.value as string) || "auto") as ViewCorner;
            // Explicit-corner dodge (NG-136): resolve the gear's real corner (Auto → br, or
            // null when the gear is hidden) and whether the action bar owns top-right, so the
            // pill steps clear of both. The action bar is independent of the gear's show flag.
            const gearCorner = s.toolbar.show.value ? resolveCorner(gearCornerPref as CornerPref, "br") : null;
            const actionBar = s.toolbar.actions.value;
            this.viewToggle.place(viewCorner, gearAtBr, s.branding.show.value, { gearCorner, actionBar });
            this.viewToggle.show();
        } else {
            if (this.viewMode !== "graph") { this.viewMode = "graph"; this.viewToggle.set("graph"); }
            this.viewToggle.hide();
        }

        // Find, Explore and Shortest path all operate on graph geometry. Keep
        // their authored switches and transient values intact across view changes,
        // but never render the card over the independent Table or Insight surfaces.
        this.enterprisePanel.setGraphViewActive(this.viewMode === "graph");

        // Alternate views (C14 / NG-125): swap the canvas for the node-metrics table
        // or the plain-English insight read-out.
        if (this.viewMode !== "graph") {
            this.removeSummary();
            this.svg.style("display", "none");
            this.detailPanel.hide();
            this.actionBar.hide(); // zoom/undo act on the graph canvas only
            this.overlayGroup.selectAll("*").remove(); // drop any lingering legend/chrome
            if (this.viewMode === "insight") {
                this.summaryEl = renderInsightView(this.element, computeNarrative(st.model), surface, st.hc,
                    (a) => this.applyInsightAction(a));
            } else {
                this.summaryEl = renderSummaryTable(this.element, st.model, st.data.attrs, st.data.hasCategory, surface, {
                    // Category colours drive the WEIGHTED bars + CATEGORY dots — the same
                    // accessor the graph uses, so the two views always agree.
                    colorOf: this.makeColorAccessor(st, surface),
                    categories: st.data.categories,
                    onExport: this.downloadService() ? (): void => { void this.exportData("csv"); } : undefined,
                    hc: st.hc,
                    // Opt-in analytical columns (NG-253) — lazy + memoized, so nothing
                    // heavy runs unless the reader switches a column on.
                    analyticsAvailable: this.tableAnalyticsAvailable(st),
                    metricFor: (key) => this.tableMetricFor(st, key),
                });
            }
            return;
        }
        this.removeSummary();
        this.svg.style("display", null);

        // Filtered-to-empty guard (86d3wdnbk / NG-233): both required roles are bound —
        // so update() passed the missingRequiredRole gate — but a slicer/visual-level
        // filter has left zero rows, so the model has no nodes. Without this the Graph
        // tab paints a blank white canvas with no explanation, while the Table tab (which
        // computes "Nodes: 0") correctly reads as empty. Surface the same empty state on
        // the default Graph view so a user landing here doesn't read it as frozen/broken.
        // The view pill is already placed above, so Table/Insight stay reachable.
        if (st.model.nodes.length === 0) {
            this.graphPainted = false;
            this.canvasActive = false;
            this.clearCanvas();
            this.clearLayers();
            this.detailPanel.hide();
            this.openNode = null;
            this.actionBar.hide();
            this.enterprisePanel.setChromeHidden(true);
            this.rulesPanel.hide();
            this.restoreBtn.style.display = "none";
            this.renderEmptyState("noRows", st.width, st.height, surface);
            return;
        }

        // Focus mode (NG-118): hide every persistent chrome element (gear, panels,
        // temporal, view pill) so only the graph shows; the restore button is the one
        // affordance that survives. The SVG overlay chrome (legend/branding/insights)
        // is suppressed in renderOverlayChrome. Applied on both the host-update and the
        // optimistic rerender paths since both run paint().
        this.toolbar.setHidden(hideChrome);
        this.enterprisePanel.setChromeHidden(hideChrome);
        if (hideChrome) {
            this.detailPanel.hide();
            this.rulesPanel.hide();
        } else {
            this.rulesPanel.configure(s.cformat.show.value);
        }
        // The restore eye belongs only to temporary focus mode. Persisted overlay-off
        // is restored from the Format pane and must leave a completely clean canvas.
        this.restoreBtn.style.display = this.chromeHidden ? "flex" : "none";
        this.themeRestoreButton(surface);

        // Quick-action bar (T12+N16): zoom in/out/fit + visual-wide undo/redo +
        // reset layout. History covers every authored visual change, while reset
        // remains specifically about node positions.
        if (s.toolbar.actions.value && !hideChrome && !smallTile) {
            this.actionBar.setState(
                this.premium.active,
                this.undoHistory.length > 0,
                this.redoHistory.length > 0,
                s.pin.pinned.value || this.storedPositions != null,
                this.downloadService() != null,
            );
            this.actionBar.show();
        } else {
            this.actionBar.hide();
        }
        // R3 — smooth adjustment animation. CSS owns the first-paint entrance; retained
        // graph geometry is advanced by applyGraphMotion's real requestAnimationFrame
        // ticks so Power BI cannot collapse movement into one final-attribute jump.
        this.svg.classed("zx-animated", s.nodes.animate.value);
        // The label/value settle-in FADE is different: it's a keyframe animation that
        // REPLAYS whenever the (rebuilt-each-repaint) text is created. Only arm it on a
        // real data/layout render (`settle`), never on the optimistic gear-repaint path,
        // or every cosmetic toggle makes the labels flash out and back in.
        this.svg.classed("zx-settle", settle && s.nodes.animate.value);
        // Animation durations live entirely in the stylesheet (the --zx-settle /
        // --zx-zoom / --zx-label-fade var() fallbacks). NG-141 removed the CEO-tunable
        // timer sliders (settle/zoom/label-fade) — the fixed defaults read best and the
        // knobs had no real use — so nothing overrides those custom properties anymore.

        const mode = (s.layout.mode.value.value as LayoutMode) ?? "force";
        const pinned = s.pin.pinned.value;
        // Unpinned → drop any stale saved positions so a later pin freezes fresh.
        if (!pinned) this.storedPositions = null;

        // Group-by-cluster (E2): feed the community + strength into the force layout so
        // same-cluster nodes condense. Scaled to a stable [0.02, 0.4] pull; 0 = off.
        const groupOn = s.clusters.groupByCluster.value && st.community != null;
        const clusterStrength = groupOn
            ? Math.max(0.02, Math.min(0.4, ((s.clusters.groupingStrength.value || 30) / 100) * 0.4))
            : 0;

        // Resolve ranking and rendered node dimensions before layout. Concentric uses
        // them for adaptive circumference; the restored classic Tree accepts them only
        // for call-shape compatibility. They do not depend on eventual coordinates.
        const rankKept = this.rankedKeptSet(st);
        const rankFilterKept = this.rankingAction() === "filter" ? rankKept : null;
        const visibleNodeCount = rankFilterKept?.size ?? st.model.nodes.length;
        let radiusOf = this.makeRadiusAccessor(st, visibleNodeCount);
        const nodeRadii = st.model.nodes.map((_, i) => radiusOf(i));
        const labelOfForLayout = this.makeNodeLabel(st);
        const labelFontSize = Math.max(6, s.labels.fontSize.value || 11);
        const labelWidths = st.model.nodes.map((_, i) =>
            Math.min(220, labelOfForLayout(i).length * labelFontSize * 0.6));
        const hierarchyParents = (mode === "tree" || mode === "radial")
            ? (st.data.hasParent
                ? st.data.attrs.map((a) => a?.parent ?? null)
                : deriveTreeParents(st.model))
            : undefined;
        const ringGroups: (string | number | null)[] = st.data.hasCategory
            ? st.data.attrs.map((a) => a?.category ?? null)
            : st.community
                ? st.community
                : st.model.nodes.map((node) => node.component);

        const layoutInput = {
            mode, pinned,
            storedPositions: this.storedPositions,
            charge: -Math.abs(s.layout.charge.value || 30),
            linkDistance: s.layout.linkDistance.value || 30,
            community: groupOn ? st.community! : undefined,
            clusterStrength,
            treeParents: hierarchyParents,
            geoCoords: st.data.attrs.map((a) => (a && a.lat != null && a.lon != null ? { lat: a.lat, lon: a.lon } : null)),
            viewport: { width: st.width, height: st.height },
            nodeRadii,
            labelWidths,
            ringGroups,
        };

        // Resolve ranking before layout. A Filter view can solve only its kept-node
        // subgraph, avoiding a wasted multi-thousand-node full simulation on initial
        // render. Highlight still needs the stable complete layout.
        let fullLayout = !rankFilterKept || (pinned && !this.storedPositions)
            ? resolveLayout(st.model, layoutInput)
            : null;

        // Pinned but nothing saved yet (first pin) → persist the computed layout so
        // the next render is a frozen replay. (Uses the FULL-graph layout, before any
        // Top-N re-layout below, so a pin always freezes the whole graph.)
        if (pinned && !this.storedPositions) {
            // A first pin still freezes the complete graph, even while Top-N is
            // filtering the current view. This is the only filtered render that
            // intentionally computes the full layout.
            if (!fullLayout) fullLayout = resolveLayout(st.model, layoutInput);
            const blob = serializePositions(st.model, fullLayout);
            this.storedPositions = blob;
            this.persistPin(true, blob);
            layoutInput.storedPositions = blob;
        }

        // Top/Bottom-N filter action (R-rank): lay out the *induced subgraph* of the kept
        // nodes so the filtered view behaves like a proper N-node network — connected
        // where edges exist, centred, filling the canvas — instead of leaving the kept
        // hubs frozen at their full-graph coordinates with every neighbour masked away.
        // Crucially, use the selected layout mode: Filter must not make Concentric,
        // Radial, Tree, or Geo look like broken aliases for Force.
        const layout = rankFilterKept
            ? inducedSubgraphLayout(st.model, rankFilterKept, layoutInput)
            : fullLayout!;

        let colorOf = this.makeColorAccessor(st, surface);
        const edgeType = this.makeEdgeTypeAccessors(st);
        // Node fill opacity (R1). Only emit when < 100% so default renders are unchanged.
        const opPct = Math.max(10, Math.min(100, s.colors.opacity.value ?? 100));
        const nodeOpacity = opPct < 100 ? opPct / 100 : undefined;

        // Parent-node emphasis: a node is a "parent" if it's referenced as another node's
        // Node-parent. When on, parents get a distinct border, optional fill, and a size
        // boost — layered over the normal colour/size accessors so all other features keep
        // working. Applies to both render paths (SVG stroke + canvas strokeOf).
        const pcard = s.parents;
        const parentEmph = pcard.show.value && st.data.hasParent && !st.hc;
        let parentStrokeOf: ((i: number) => { color: string; width: number } | null) | undefined;
        if (parentEmph) {
            const pk = new Set<string>();
            for (const a of st.data.attrs) if (a?.parent) pk.add(a.parent);
            const isParent = (i: number): boolean => pk.has(st.model.nodes[i].key);
            const border = { color: (pcard.borderColor.value.value as string) || surface.fg, width: Math.max(0, pcard.borderWidth.value || 3) };
            parentStrokeOf = (i) => (isParent(i) ? border : null);
            const pFill = (pcard.fill.value.value as string) || "";
            if (pFill) { const base = colorOf; colorOf = (i) => (isParent(i) ? pFill : base(i)); }
            const boost = Math.max(1, (pcard.sizeBoost.value || 140) / 100);
            if (boost !== 1) { const baseR = radiusOf; radiusOf = (i) => (isParent(i) ? baseR(i) * boost : baseR(i)); }
        }

        // Link colour (NG-133): resolve the per-edge colour accessors from the colour
        // mode AGAINST the final node colours (after parent-emphasis recolour above), so
        // source/target/gradient links track exactly what their endpoint nodes show.
        const edgeColors = this.makeEdgeColorAccessors(st, surface, colorOf, edgeType);
        // Link visibility (req 1): show normally · hide but reveal incident links on
        // hover · hide entirely. `edgesHoverReveal` is read by the node hover handler.
        const edgeRenderMode: "show" | "hover" | "off" =
            s.edges.show.value ? "show" : (s.edges.showOnHover.value ? "hover" : "off");
        this.edgesHoverReveal = edgeRenderMode === "hover";

        // Insights (NG-125): the read-out now lives in the full-canvas Insight view
        // (a segment of the view switch), not a docked top band — so the graph layout
        // reserves no top inset for it.
        const insightsInset = 0;

        // Avoid overlap (NG-112): the layout engines space nodes by charge alone and
        // know nothing about render radii, so a large radius range overlaps circles.
        // This deterministic relaxation runs on the fitted pixel geometry (where radii
        // live) for every layout mode except the coordinate-faithful one (geo, where a
        // position IS the datum). Runs on both render paths via `postFit`.
        // Skip the in-place collision relax when Top-N filtering is active: the induced sub-layout
        // already spaces the kept nodes, and the hidden non-kept nodes are parked on one
        // point — relaxing that pile would shove the kept nodes around.
        const collideOn = s.nodes.collide.value && mode !== "geo" && !rankFilterKept;
        const rawNodeGap = Number(s.nodes.nodeGap.value);
        const nodeGap = Math.max(0, Math.min(60,
            Number.isFinite(rawNodeGap) ? rawNodeGap : DEFAULT_COLLIDE_PADDING));
        const collideBounds = { x0: 4, y0: insightsInset + 4, x1: Math.max(8, st.width - 4), y1: Math.max(8, st.height - 4) };
        const collide = collideOn
            ? (g: GraphGeometry): void => {
                resolveCollisionsPreservingShape(g.px, radiusOf, { padding: nodeGap, bounds: collideBounds });
            }
            : undefined;

        // Always construct the author-enabled label layer. On large graphs semantic
        // zoom crossfades that layer at the LOD threshold instead of destroying and
        // rebuilding it, so zooming in can reveal labels without a full graph repaint.
        const showLabels = s.labels.show.value;

        // Node glyph resolver: a per-node data icon always wins; otherwise either one
        // global glyph ("all") or a distinct glyph per hierarchy depth ("level"). Depth
        // reuses the deterministic `nodeDepths` used by "By level" colouring; depths
        // beyond L4 fall back to the L4 ("deeper") slot. Computed once per render.
        const iconOf = this.makeIconOf(st);
        const fillPatternOf = this.makeFillPatternOf(st);
        const twoWay = this.makeTwoWayDisplay(st);
        // Tree layout is computed from one parent edge per non-root node. Keep those
        // structural links prominent and retain every additional relationship as a
        // lighter curved/dashed cross-link instead of letting it dominate the hierarchy.
        const edgeSecondaryOf = mode === "tree" && hierarchyParents
            ? (li: number): boolean => {
                const link = st.model.links[li];
                const source = st.model.nodes[link.source].key;
                const target = st.model.nodes[link.target].key;
                return hierarchyParents[link.source] !== target
                    && hierarchyParents[link.target] !== source;
            }
            : undefined;
        // Tree DEFAULTS to the strongest bow so parent/child relationships fan apart, but
        // the author keeps full control (NG-242): an explicitly set curvature wins, 0 (straight
        // links) included. Only an untouched curvature falls back to Tree's automatic maximum.
        const curveAuthored = this.curveAuthored || this.toolbar.hasPendingEdit("edges.curve");
        const authoredCurve = s.edges.curve.value || 0;
        const effectiveEdgeCurve = mode === "tree" && !curveAuthored ? 100 : authoredCurve;

        const renderOpts: GraphRenderOptions = {
            width: st.width, height: st.height,
            padTop: insightsInset,
            colorOf, radiusOf, nodeOpacity,
            nodeShape: s.nodes.shape.value.value as NodeShape,
            // Node type "halo" (NG-113): soft glow discs under the markers. Skipped in
            // high contrast — a translucent tint is a colour-only cue HC strips.
            nodeHalo: (s.nodes.style.value.value as string) === "halo" && !st.hc,
            parentStrokeOf,
            // Only render base64 data: images — NEVER an external URL, so the code
            // provably makes no external call (certifiable by construction).
            imageOf: (i) => { const im = st.data.attrs[i]?.image; return im && im.startsWith("data:") ? im : null; },
            iconOf,
            nodeFillPatternOf: fillPatternOf,
            labelOf: this.makeNodeLabel(st),
            edgeColor: edgeColors.representative,
            edgeColorOf: edgeColors.colorOf,
            edgeColorEndOf: edgeColors.colorEndOf,
            edgeGradient: edgeColors.gradient,
            edgeDashOf: edgeColors.dashOf,
            edgeRenderMode,
            bidirectionalOf: twoWay?.bidirectionalOf,
            edgeSuppressedOf: twoWay?.edgeSuppressedOf,
            edgeSecondaryOf,
            edgeLabelOf: this.makeEdgeLabel(st),
            edgeThickness: s.edges.thickness.value || 1,
            edgeScaleByWeight: s.edges.scaleByWeight.value,
            edgeCurve: effectiveEdgeCurve,
            nodeStroke: surface.bg,
            // Label colour honours the setting; blank/high-contrast → theme foreground.
            labelColor: st.hc ? surface.fg : ((s.labels.color.value.value as string) || surface.fg),
            font: (s.labels.fontFamily.value.value as string) || fontFamily,
            showArrows: s.edges.showArrows.value,
            showLabels,
            maxLabels: Math.max(0, s.labels.maxLabels.value || 0),
            // Bold from the label style OR the a11y toggle (either forces bold).
            labelBold: s.labels.bold.value,
            labelSize: s.labels.fontSize.value || 11,
            labelItalic: s.labels.italic.value,
            labelUnderline: s.labels.underline.value,
            labelPosition: s.labels.position.value.value as LabelPosition,
            labelWrap: s.labels.wrap.value.value as LabelWrap,
            labelBg: s.labels.bgShow.value,
            labelBgType: s.labels.bgType.value.value as LabelBgType,
            labelBgColor: (s.labels.bgColor.value.value as string) || surface.bg,
            labelBgPadding: Math.max(0, s.labels.bgWidth.value ?? 3),
            flow: s.edges.flow.value,
            flowSpeed: Math.max(1, s.edges.flowSpeed.value || 3),
            postFit: collide,
        };

        // Renderer split: past the threshold (or when forced) the bulk draws to the
        // under-SVG canvas — one paint, no per-element DOM — breaking the SVG node ceiling.
        // Small graphs stay on the fully-interactive SVG path (unchanged). Labels, overlays,
        // and hit-testing stay in SVG/arithmetic on top.
        let geo: GraphGeometry;
        let nodeSel: ReturnType<typeof renderGraph>["nodeSel"];
        if (this.useCanvas(st.model.nodes.length, st.model.links.length)) {
            this.hullGroup.selectAll("*").remove();
            this.edgeGroup.selectAll("*").remove();
            this.nodeGroup.selectAll("*").remove();
            let maxR = 4;
            for (let i = 0; i < st.model.nodes.length; i++) maxR = Math.max(maxR, radiusOf(i));
            geo = fitTransform(layout, st.width, st.height, maxR + 10, insightsInset);
            if (collide) collide(geo);
            this.canvasActive = true;
            this.canvasState = {
                st, geo, radiusOf, colorOf, nodeOpacity,
                // Canvas has no per-edge DOM, so gradient falls back to the source-side
                // colour (edgeColors.colorOf) — batches cheaply, reads the same at scale.
                edgeColor: edgeColors.representative, edgeColorOf: edgeColors.colorOf,
                edgeWidthOf: makeEdgeWidth(st.model, s.edges.thickness.value || 1, s.edges.scaleByWeight.value),
                edgeCurve: effectiveEdgeCurve,
                edgeSuppressedOf: twoWay?.edgeSuppressedOf,
                edgeSecondaryOf,
                nodeStroke: surface.bg, strokeOf: parentStrokeOf,
                iconOf,
                hideEdges: edgeRenderMode !== "show",
            };
            this.sizeCanvas(st.width, st.height);
            // The actual pixels are painted by the guaranteed syncSelectionDim() call at
            // the end of paint (it redraws the canvas with the combined dim set), so we
            // don't draw here — avoids a redundant second full repaint per update.
            this.labelGroup.selectAll("*").remove();
            if (showLabels) drawLabels(this.labelGroup, st.model, geo, renderOpts);
            this.bindCanvasInteraction(st);
            nodeSel = this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node"); // empty ⇒ SVG-node handlers no-op
        } else {
            this.canvasActive = false;
            this.canvasState = null;
            this.clearCanvas();
            this.unbindCanvasInteraction();
            const r = renderGraph(this.defsGroup, this.edgeGroup, this.nodeGroup, this.labelGroup, st.model, layout, renderOpts);
            nodeSel = r.nodeSel; geo = r.geo;
        }
        st.geo = geo;

        // Outline-map backdrop (Geo-route mode): draw the faint world silhouette + grid
        // UNDER the graph, using the SAME fit transform as the nodes (geo.scale/tx/ty),
        // so every continent sits exactly beneath the cities placed on it. Gated to geo
        // mode where real lat/long actually drove the layout — not the force fallback a
        // coordinate-less "geo" pick lands on, nor a Top-N induced re-layout.
        const geoActive = mode === "geo" && !rankFilterKept &&
            st.data.attrs.some((a) => !!a && a.lat != null && a.lon != null);
        if (geoActive && s.layout.showBasemap.value) {
            renderBasemap(this.basemapGroup, geo, { landFill: surface.fg, stroke: surface.fg });
        } else {
            this.basemapGroup.selectAll("*").remove();
        }

        // Hierarchy fold/collapse (Node-parent). Compute the hidden-descendant set; it is
        // applied as an additive mask (SVG) / visibility predicate (canvas) below.
        // Drill-down (NG-072) shares this hierarchy.
        this.collapsedHidden = new Set<number>();
        const hcard = s.hierarchy;
        // An explicit Node-parent binding owns fold/drill semantics. Drag additionally
        // needs a hierarchy for the common Source/Target-only star graph shown in the
        // visual, so when that role is absent it reuses Tree mode's deterministic
        // spanning forest (highest-degree centre per component, then BFS descendants).
        const explicitHierarchy: Hierarchy | null = st.data.hasParent
            ? buildHierarchy(st.model, (i) => st.data.attrs[i]?.parent ?? null) : null;
        const dragHierarchy: Hierarchy = explicitHierarchy ?? (() => {
            const parentKeys = deriveTreeParents(st.model);
            return buildHierarchy(st.model, (i) => parentKeys[i] ?? null);
        })();
        const hier: Hierarchy | null = (hcard.foldable.value || hcard.drilldown.value)
            ? explicitHierarchy : null;
        if (hier && hcard.foldable.value) {
            const sig = st.model.nodes.map((n, i) =>
                `${n.key}\u0000${st.data.attrs[i]?.parent ?? ""}`).join("\u0001");
            const initKey = `${hcard.startCollapsed.value ? "collapsed" : "expanded"}|${sig}`;
            if (this.collapseInitedFor !== initKey) {
                this.collapsed = hcard.startCollapsed.value
                    ? new Set(st.model.nodes.filter((_, i) => isParentNode(hier, i)).map((n) => n.key))
                    : new Set<string>();
                this.collapseInitedFor = initKey;
            }
            this.collapsedHidden = hiddenByCollapse(hier, (i) => this.collapsed.has(st.model.nodes[i].key));
        }
        // Drill-down: restrict the view to the drilled node's subtree (everything else
        // hidden, additively with any fold). Stale root (removed from data) → reset.
        if (hier && hcard.drilldown.value && this.drillRoot) {
            const ri = st.model.indexByKey.get(this.drillRoot);
            if (ri === undefined) { this.drillRoot = null; this.drillTrail = []; }
            else {
                const inView = subtreeSet(hier, ri);
                for (let i = 0; i < st.model.nodes.length; i++) if (!inView.has(i)) this.collapsedHidden.add(i);
            }
        } else if (!hcard.drilldown.value && this.drillRoot) {
            this.drillRoot = null; this.drillTrail = []; // feature turned off → exit drill
        }
        this.hierState = hier;

        // Value-inside-node (formatted) — a labelled-bubble layer above the nodes.
        // Skipped in canvas mode: it is a per-node SVG layer that would reintroduce the
        // DOM cost the canvas path exists to avoid (values return when zoomed to SVG scale).
        this.valueGroup.selectAll("*").remove();
        if (!this.canvasActive && s.nodes.showValue.value) {
            const configuredInnerColor = s.labels.innerColor.value.value as string;
            const innerColor = st.hc ? surface.fg : configuredInnerColor;
            const nodeShape = s.nodes.shape.value.value as NodeShape;
            // Donut nodes carry the value over their open centre, where the canvas — not the
            // node fill — shows through. Contrast against the *canvas* (surface.fg, dark on a
            // light theme) instead of the fill, or white contrast-text vanishes in the hole
            // (NG-242, replacing the reverted inner-label background).
            const donut = nodeShape === "donut";
            drawNodeValues(this.valueGroup, st.model, geo.px, {
                valueOf: (i) => this.nodeValueOf(st, i),
                radiusOf,
                shape: nodeShape,
                textColorOf: (i) => innerColor || (donut ? surface.fg : (isDarkColor(colorOf(i)) ? "#FFFFFF" : surface.fg)),
                outsideColor: innerColor || surface.fg,
                // With outer labels on, a value that can't fit inside a small node is hidden
                // rather than pushed below it — the outer label already names it (NG-240).
                outerLabelsShown: s.labels.show.value,
                decimals: Math.max(0, s.nodes.valueDecimals.value || 0),
                displayUnits: s.labels.innerValueFormat.value.value as ValueDisplayUnits,
                font: (s.labels.innerFontFamily.value.value as string) || fontFamily,
                fontSize: s.labels.innerFontSize.value || 14,
                bold: s.labels.innerBold.value,
                italic: s.labels.innerItalic.value,
                underline: s.labels.innerUnderline.value,
            });
        }
        // Cluster hulls (E2) sit behind the graph, in pixel space. Shown only when
        // the Clusters feature is on (colour-by-cluster alone just recolours nodes).
        // Suppressed under collapse (NG-078) — each meta-node is its own community, so
        // hulls would degenerate to a ring per node.
        const cl = s.clusters;
        const clusterVisible = st.community != null && cl.show.value && !cl.collapse.value;
        if (clusterVisible && cl.showHulls.value) {
            const pal = paletteByName(s.colors.palette.value.value as string);
            const clickFilter = cl.clickToFilter.value;
            const hoverEmph = cl.hoverEmphasis.value;
            renderHulls(this.hullGroup, geo.px, st.community!, (c) => pal[c % pal.length], {
                pad: Math.max(0, cl.hullPadding.value ?? 14),
                shape: (cl.hullStyle.value.value as "rounded" | "convex") || "rounded",
                fillOpacity: Math.max(0, Math.min(60, cl.fillOpacity.value ?? 12)) / 100,
                strokeOpacity: Math.max(0, Math.min(100, cl.borderOpacity.value ?? 35)) / 100,
                strokeWidth: Math.max(0, cl.borderWidth.value ?? 2),
                tint: (cl.colorSource.value.value === "single") ? (cl.tint.value.value || null) : null,
                onEach: (clickFilter || hoverEmph)
                    ? (path, cluster) => {
                        path.attr("pointer-events", "fill").style("cursor", clickFilter ? "pointer" : "default");
                        if (clickFilter) path.on("click", () => this.clusterPick(st, cluster));
                        if (hoverEmph) {
                            path.on("mouseenter", () => this.emphasizeCluster(st, cluster))
                                .on("mouseleave", () => this.syncSelectionDim());
                        }
                    }
                    : undefined,
            }, radiusOf);
        } else {
            this.hullGroup.selectAll("*").remove();
        }
        // Cluster captions (E2) — one label per cluster, lifted above its node cloud so it
        // clears the topmost node (NG-246), with author-controlled typography.
        if (clusterVisible && cl.showLabels.value) {
            const configuredLabelColor = cl.labelColor.value.value as string;
            const autoColor = (cl.labelColorMode.value.value as string) !== "manual";
            // Auto (NG-247): each caption takes its cluster's own colour — the SAME colour the
            // hull uses (single tint, else the per-cluster palette entry) — so a label maps to
            // its region at a glance. Manual uses the picked colour. HC always wins.
            const pal = paletteByName(s.colors.palette.value.value as string);
            const singleTint = cl.colorSource.value.value === "single" ? (cl.tint.value.value || null) : null;
            const colorOf = st.hc
                ? () => surface.fg
                : autoColor
                    ? (c: number) => singleTint || pal[c % pal.length]
                    : () => configuredLabelColor || surface.fg;
            renderClusterLabels(this.clusterLabelGroup, geo.px, st.community!,
                (c) => this.clusterLabel(st, c, cl.showSizes.value),
                {
                    font: (cl.labelFont.value.value as string) || fontFamily,
                    colorOf,
                    fontSize: Math.max(8, cl.labelSize.value || 12),
                    bold: cl.labelBold.value,
                    italic: cl.labelItalic.value,
                },
                radiusOf);
        } else {
            this.clusterLabelGroup.selectAll("*").remove();
        }

        // Interaction: cross-filter selection + hover tooltip + keyboard.
        bindNodeSelection(nodeSel, {
            idsByNode: st.idsByNode,
            selectionManager: this.selectionManager,
            nodeGroup: this.nodeGroup,
            edgeGroup: this.edgeGroup,
            onChange: () => this.syncSelectionDim(),
            // A plain parent-node click is the hierarchy action. Modified clicks
            // remain available for multi-selection and annotation authoring.
            activate: (event, i) => !event.altKey && !event.ctrlKey && !event.metaKey
                ? this.onNodeActivate(st, i) : false,
        });
        // Right-click a node → the native data-point context menu (Drill through,
        // Include/Exclude, Show as a table, …).
        bindContextMenu(nodeSel, st.idsByNode, this.selectionManager, (e) => this.menuOrigin(e));
        // Edge cross-filter (NG-076): clicking a link selects its relationship row so the
        // report filters to that specific edge. Endpoint nodes light up for free because
        // their idsByNode share the same row id. Ctrl/Cmd extends the selection.
        this.edgeGroup.selectAll<SVGPathElement, number>(
            "path.edge, path.selfloop, path.edge-hit, path.selfloop-hit",
        )
            .style("cursor", "pointer")
            .on("click", (event: MouseEvent, li: number) => {
                event.stopPropagation();
                const id = st.idsByEdge[li];
                if (id) this.selectionManager.select(id, event.ctrlKey || event.metaKey).then(() => this.syncSelectionDim());
            })
            .on("contextmenu", (event: MouseEvent, li: number) => {
                event.preventDefault();
                event.stopPropagation();
                this.selectionManager.showContextMenu(st.idsByEdge[li] ?? {}, this.menuOrigin(event));
            })
            // Hover a link → its tooltip (source/target/weight/type). Endpoint nodes
            // already emphasise on their own hover; the edge card is the relationship view.
            .on("mouseover", (event: MouseEvent, li: number) => {
                if (this.nodeDragging) return; // NG-109: no tooltips while dragging a node over links
                this.showEdgeTooltip(st, li, event.clientX, event.clientY);
            })
            .on("mousemove", (event: MouseEvent, li: number) => {
                if (this.nodeDragging) return;
                this.moveEdgeTooltip(st, li, event.clientX, event.clientY);
            })
            .on("mouseout", () => this.hideTooltip());
        nodeSel.on("mouseover", (event: MouseEvent, i: number) => {
            if (this.nodeDragging) return; // NG-109: mouseover mid-drag would re-show a frozen tooltip
            applyHoverEmphasis(this.nodeGroup, this.edgeGroup, st.model, i, st.neighbors, this.edgesHoverReveal);
            this.showTooltip(st, i, event.clientX, event.clientY);
        });
        nodeSel.on("mousemove", (event: MouseEvent, i: number) => {
            if (this.nodeDragging) return;
            this.moveTooltip(st, i, event.clientX, event.clientY);
        });
        nodeSel.on("mouseout", () => {
            this.hideTooltip();
            this.syncSelectionDim(); // restore selection dim state
        });
        nodeSel.on("keydown", (event: KeyboardEvent, i: number) => {
            const dir = arrowDirection(event.key);
            if (dir) {
                // Move focus to the nearest node in the arrow's direction (a11y, NG-081).
                event.preventDefault();
                const to = pickDirectionalNeighbor(geo.px, i, dir);
                if (to >= 0) {
                    const el = this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
                        .filter((d) => d === to).node();
                    (el as SVGGraphicsElement | null)?.focus();
                }
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!event.ctrlKey && !event.metaKey && this.onNodeActivate(st, i)) return;
                const ids = st.idsByNode[i] ?? [];
                if (ids.length) this.selectionManager.select(ids, event.ctrlKey || event.metaKey)
                    .then(() => this.syncSelectionDim());
                if (s.nodes.showFullInfoOnClick.value) this.openDetail(st, i, surface);
            } else if (event.key === "Escape") {
                if (this.drillRoot) { event.preventDefault(); this.drillOut(); }
                else if (this.clearExploreFocus()) event.preventDefault(); // exit ego-focus (G2-007)
            }
        });
        // Alt/Option-click opens annotations. A plain click opens the full information
        // panel only when the author enabled Nodes → On click → Show full info.
        nodeSel.on("click.note", (event: MouseEvent, i: number) => {
            if (event.altKey) {
                event.stopPropagation();
                this.openNoteEditor(st, i);
                return;
            }
            // bindNodeSelection has already consumed a plain parent click.
            if (!event.ctrlKey && !event.metaKey && this.canNodeActivate(i)) return;
            if (s.nodes.showFullInfoOnClick.value) {
                event.stopPropagation();
                this.openDetail(st, i, surface);
            }
        });

        // Lasso multi-select (NG-083): shift-drag a marquee on empty canvas to select
        // every enclosed node at once (Ctrl/Cmd extends). Drawn in the zoom group so it
        // aligns under pan/zoom; rebound each render for the live geometry.
        enableLasso(this.svg, {
            points: geo.px,
            drawInto: this.zoomGroup,
            frame: this.zoomGroup.node() as SVGGElement,
            stroke: surface.fg,
            fill: st.hc ? "transparent" : "rgba(124,92,255,0.14)",
            onSelect: (indices, additive) => {
                const ids = indices.flatMap((i) => st.idsByNode[i] ?? []);
                this.selectionManager.select(ids, additive).then(() => this.syncSelectionDim());
            },
        });

        // Manual drag — grab a node and place it by hand. The drop auto-pins so the
        // hand-authored arrangement is frozen and survives refresh (the authoring
        // half of the pinned-layout wedge). A plain click (no movement) is untouched.
        enableNodeDrag(nodeSel, {
            geo, model: st.model, hierarchy: dragHierarchy,
            edgeGroup: this.edgeGroup, labelGroup: this.labelGroup,
            decorGroups: [this.valueGroup],
            donut: (s.nodes.shape.value.value as NodeShape) === "donut", radiusOf,
            onDragStart: () => this.hideTooltip(), // both the card AND the host service tooltip
            setDragging: (on) => {
                this.nodeDragging = on;
                this.svg.classed("zx-dragging", on);
            },
            onDrop: (worldByKey, draggedIndices) => {
                // NG-109: the repaint below replaces the hovered circle, whose mouseout
                // would otherwise be the only thing hiding the tooltip — a removed
                // element never fires it, leaving the card stuck on screen.
                this.hideTooltip();
                const before = this.captureAuthoringSnapshot();
                // NG-112/149/155: settle neighbours around the drop. The parent is at
                // the pointer-release position; descendants already hold their target
                // parent-delta positions in geo, but remain visually stationary until
                // this repaint animates them. Keep the whole target subtree fixed while
                // nudging overlaps, then persist the settled arrangement.
                if (collide) {
                    resolveCollisions(geo.px, radiusOf, {
                        padding: nodeGap,
                        fixed: new Set(draggedIndices),
                        bounds: collideBounds,
                    });
                    const k = geo.scale || 1;
                    for (let ni = 0; ni < st.model.nodes.length; ni++) {
                        const wx = (geo.px[ni].x - geo.tx) / k;
                        const wy = (geo.px[ni].y - geo.ty) / k;
                        worldByKey[st.model.nodes[ni].key] = [Math.round(wx * 100) / 100, Math.round(wy * 100) / 100];
                    }
                }
                this.storedPositions = JSON.stringify(worldByKey);
                this.formattingSettings.pin.pinned.value = true; // optimistic: paint replays the drop
                this.persistPin(true, this.storedPositions);
                this.rerenderFromSettings(true);
                this.commitAuthoringSnapshot(before);
            },
        });

        // Explore mode (E3): clicking a node focuses its ego network; re-clicking the
        // already-focused node exits (canvas-level toggle, G2-007).
        const exploreOn = this.premium.active && s.explore.show.value;
        if (exploreOn) {
            nodeSel.on("click.explore", (event: MouseEvent, i: number) => {
                event.stopPropagation();
                const key = st.model.nodes[i].key;
                this.setExploreFocus(this.exploreFocus === key ? null : key);
                this.rerenderFromSettings();
            });
        }

        // Preserve the chosen node through optimistic settings/layout repaints while
        // the opt-in remains active.
        if (!hideChrome && s.nodes.showFullInfoOnClick.value &&
            this.openNode != null && this.openNode < st.model.nodes.length) {
            this.openDetail(st, this.openNode, surface);
        }

        this.renderOverlayChrome(st);
        this.syncSelectionDim();
        this.applyEnterpriseEmphasis(st);
        this.applyRanking(st);
        this.applyCollapse(st, geo, radiusOf);
        this.setupTemporal(st);
        this.renderAnnotations(st, geo, radiusOf);
        this.syncSemanticZoom();
        this.applyGraphMotion(st, geo, radiusOf, settle);
    }

    // --- Annotations (NG-074) ------------------------------------------------
    /** Draw all notes anchored to their nodes (display-only overlay; editing is via
     *  Alt-click on the node underneath, so the layer never blocks graph interaction). */
    private renderAnnotations(st: RenderState, geo: GraphGeometry, radiusOf: (i: number) => number): void {
        this.notesGroup.style("pointer-events", "none");
        if (!this.formattingSettings.annotations.show.value || !this.notes.count()) {
            this.notesGroup.selectAll("*").remove();
            return;
        }
        // anchor (node key) → on-screen position + radius.
        const posByAnchor = new Map<string, AnchorPos>();
        for (let i = 0; i < st.model.nodes.length; i++) {
            posByAnchor.set(st.model.nodes[i].key, { x: geo.px[i].x, y: geo.px[i].y, r: radiusOf(i) });
        }
        const ordered = this.notes.ordered();
        const numberOf = (n: { id: string }) => ordered.findIndex((o) => o.id === n.id) + 1;
        renderNotes(this.notesGroup, ordered, (a) => posByAnchor.get(a) ?? null, numberOf, this.noteTheme(st.dark, st.hc));
    }

    // --- Motion system (NG-151) ---------------------------------------------

    /** Capture identity-keyed geometry before update() clears the render layers. */
    private captureMotionSnapshot(): MotionSnapshot | null {
        const st = this.lastRender;
        if (!this.graphPainted || !st?.geo || this.canvasActive) return null;
        const nodes = new Map<string, MotionNodeSnapshot>();
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node").each(function (i) {
            const n = st.model.nodes[i];
            const p = st.geo!.px[i];
            const el = select(this);
            let x = p.x;
            let y = p.y;
            if (this.tagName.toLowerCase() === "circle") {
                x = +(el.attr("cx") || p.x);
                y = +(el.attr("cy") || p.y);
            } else {
                const match = /translate\(\s*([^,\s)]+)[,\s]+([^,\s)]+)/.exec(el.attr("transform") || "");
                if (match) {
                    const tx = Number(match[1]), ty = Number(match[2]);
                    if (Number.isFinite(tx) && Number.isFinite(ty)) { x = tx; y = ty; }
                }
            }
            nodes.set(n.key, {
                key: n.key, x, y,
                r: +(el.attr("r") || 8),
                fill: el.attr("fill") || "none",
                stroke: el.attr("stroke") || "none",
                strokeWidth: +(el.attr("stroke-width") || 1),
            });
        });
        const edgeKeys = motionEdgeKeys(st.model);
        const edges = new Map<string, MotionEdgeSnapshot>();
        this.edgeGroup.selectAll<SVGPathElement, number>("path.edge").each(function (li) {
            const el = select(this);
            const key = edgeKeys[li];
            edges.set(key, {
                key,
                d: el.attr("d") || "",
                stroke: el.attr("stroke") || "currentColor",
                strokeWidth: +(el.attr("stroke-width") || 1),
                opacity: +(el.attr("stroke-opacity") || 0.55),
            });
        });
        return { nodes, edges };
    }

    /** Cancel delayed motion work; every new gesture/update starts from a clean state. */
    private cancelMotion(): void {
        if (this.motionFrame != null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this.motionFrame);
        }
        if (this.motionTimer != null) clearTimeout(this.motionTimer);
        this.motionFrame = null;
        this.motionTimer = null;
        this.svg.classed("zx-enter", false).classed("zx-refresh", false).classed("zx-grow", false)
            .classed("zx-motion-tween", false);
        this.canvasEl?.classList.remove("zx-canvas-enter", "zx-canvas-refresh");
    }

    /** Crossfade labels/values at the existing LOD threshold without a repaint. */
    private syncSemanticZoom(): void {
        const st = this.lastRender;
        if (!st || !this.formattingSettings) return;
        const labelsVisible = lodShowLabels(
            this.formattingSettings.labels.show.value,
            st.model.nodes.length,
            this.zoom.get().k,
        );
        const valuesVisible = this.formattingSettings.nodes.showValue.value
            && lodShowLabels(true, st.model.nodes.length, this.zoom.get().k);
        this.labelGroup.classed("zx-lod-hidden", !labelsVisible)
            .attr("aria-hidden", labelsVisible ? null : "true");
        // Values are also secondary detail on dense graphs, but remain unchanged on
        // ordinary-sized graphs where lodShowLabels is always true.
        this.valueGroup.classed("zx-lod-hidden", !valuesVisible)
            .attr("aria-hidden", valuesVisible ? null : "true");
    }

    /** First paint, keyed refresh, and large-canvas entrance choreography. Retained
     *  SVG geometry uses a tick renderer, mirroring the render-on-every-tick model used
     *  by force simulations, rather than relying on host-sensitive SVG transitions. */
    private applyGraphMotion(
        st: RenderState,
        geo: GraphGeometry,
        radiusOf: (i: number) => number,
        dataChanged: boolean,
    ): void {
        const previous = this.pendingMotion;
        this.pendingMotion = null;
        const first = !this.graphPainted;
        const replayInitial = this.replayInitialMotion;
        this.replayInitialMotion = false;
        const initialGrowth = first || replayInitial;
        this.graphPainted = true;
        // A layout-mode change or viewport re-fit can move retained nodes without
        // changing graph structure. Compare against the captured visible positions so
        // those automatic adjustments receive the same settle as a data refresh.
        const geometryChanged = previous
            ? st.model.nodes.some((n, i) => {
                const old = previous.nodes.get(n.key);
                const next = geo.px[i];
                return !old || Math.abs(old.x - next.x) > 0.25 || Math.abs(old.y - next.y) > 0.25;
            })
            : false;
        const enabled = (dataChanged || geometryChanged || initialGrowth)
            && this.formattingSettings.nodes.animate.value
            && (!initialGrowth || this.formattingSettings.nodes.initialAnimation.value);
        if (!enabled) return;

        // Canvas scale mode: one composited fade, never thousands of per-node effects.
        if (this.canvasActive) {
            const cls = first ? "zx-canvas-enter" : "zx-canvas-refresh";
            this.canvasEl?.classList.add(cls);
            this.scheduleMotionCleanup(700);
            return;
        }

        if (initialGrowth) {
            this.runInitialGrowthMotion(st, geo, radiusOf);
            return;
        }

        if (!previous) {
            this.svg.classed("zx-enter", true);
            const depths = st.model.nodes.length <= 150 ? this.nodeDepths(st) : null;
            this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
                .style("--zx-enter-delay", (i) => `${depths ? Math.min(240, depths[i] * 28) : 0}ms`);
            this.scheduleMotionCleanup(750);
            return;
        }

        this.svg.classed("zx-refresh", true);
        this.drawRemovedMotionGhosts(st, previous);

        // New nodes emerge from their retained parent/nearest retained neighbour.
        const parentKeys = st.data.hasParent
            ? st.model.nodes.map((_, i) => st.data.attrs[i]?.parent ?? null)
            : deriveTreeParents(st.model);
        const initial = geo.px.map((p) => ({ x: p.x, y: p.y }));
        const isNew = new Set<number>();
        for (let i = 0; i < st.model.nodes.length; i++) {
            const old = previous.nodes.get(st.model.nodes[i].key);
            if (old) { initial[i] = { x: old.x, y: old.y }; continue; }
            isNew.add(i);
            const parent = parentKeys[i] ? previous.nodes.get(parentKeys[i]!) : null;
            if (parent) { initial[i] = { x: parent.x, y: parent.y }; continue; }
            for (const nb of st.neighbors[i]) {
                const near = previous.nodes.get(st.model.nodes[nb].key);
                if (near) { initial[i] = { x: near.x, y: near.y }; break; }
            }
        }

        const target = geo.px.map((p) => ({ x: p.x, y: p.y }));
        const current = initial.map((p) => ({ x: p.x, y: p.y }));
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node").each(function (i) {
            const el = select(this);
            if (this.tagName.toLowerCase() === "circle") {
                el.attr("cx", initial[i].x).attr("cy", initial[i].y);
            } else {
                el.attr("transform", `translate(${initial[i].x},${initial[i].y})`);
            }
            el.classed("zx-new-node", isNew.has(i));
        });

        // Build one path interpolator per retained/new edge. Unlike an SVG `d`
        // transition, this produces a real intermediate path on every animation tick,
        // so links remain attached even inside Power BI's sandbox.
        const targetEdge = new Map<number, string>();
        const edgeTween = new Map<number, (t: number) => string>();
        const edgeKeys = motionEdgeKeys(st.model);
        this.edgeGroup.selectAll<SVGPathElement, number>("path.edge").each(function (li) {
            const el = select(this);
            const finalD = el.attr("d") || "";
            targetEdge.set(li, finalD);
            const l = st.model.links[li];
            const sp = initial[l.source], tp = initial[l.target];
            const trimmed = trimEdgeEnds(
                sp.x, sp.y, tp.x, tp.y, radiusOf(l.source), radiusOf(l.target),
            );
            const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
            const [px, py] = pairPerp(initial[lo], initial[hi]);
            const parallel = +(el.attr("data-parallel") || 0);
            const seededD = previous.edges.get(edgeKeys[li])?.d || edgeCurvePath(
                trimmed.sx + px * parallel, trimmed.sy + py * parallel,
                trimmed.ex + px * parallel, trimmed.ey + py * parallel,
                px, py, +(el.attr("data-off") || 0),
            );
            edgeTween.set(li, interpolateString(seededD, finalD));
            el.attr("d", seededD);
        });

        /** Paint actual geometry for one layout tick. This is deliberately imperative:
         *  the DOM attributes themselves represent the visible in-flight position, so
         *  captureMotionSnapshot() can resume from here if the Power BI property echo
         *  rebuilds the visual halfway through the settle. */
        const paintFrame = (progress: number): void => {
            const eased = 1 - Math.pow(1 - progress, 3);
            for (let i = 0; i < current.length; i++) {
                current[i].x = initial[i].x + (target[i].x - initial[i].x) * eased;
                current[i].y = initial[i].y + (target[i].y - initial[i].y) * eased;
            }
            this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node").each(function (i) {
                const p = current[i];
                const el = select(this);
                if (this.tagName.toLowerCase() === "circle") el.attr("cx", p.x).attr("cy", p.y);
                else el.attr("transform", `translate(${p.x},${p.y})`);
            });
            this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
                .attr("d", (li) => edgeTween.get(li)?.(eased) || targetEdge.get(li) || "");
            this.edgeGroup.selectAll<SVGPathElement, number>("path.selfloop, path.selfloop-hit")
                .attr("d", (li) => {
                    const ni = st.model.links[li].source;
                    return selfLoopPath(current[ni], radiusOf(ni));
                });
            this.edgeGroup.selectAll<SVGTextElement, number>("text.edge-label")
                .each(function (li) {
                    const l = st.model.links[li];
                    const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                    const [px, py] = pairPerp(current[lo], current[hi]);
                    const label = select(this);
                    const parallel = +(label.attr("data-parallel") || 0);
                    const place = edgeLabelPlacement(
                        { x: current[l.source].x + px * parallel, y: current[l.source].y + py * parallel },
                        { x: current[l.target].x + px * parallel, y: current[l.target].y + py * parallel },
                        px, py,
                        +(label.attr("data-off") || 0),
                    );
                    label.attr("x", place.x).attr("y", place.y).attr("transform", place.transform);
                });
            this.defsGroup.selectAll<SVGLinearGradientElement, unknown>("linearGradient.zx-edge-grad")
                .each(function () {
                    const li = Number((this.id || "").replace("zx-eg-", ""));
                    const l = st.model.links[li];
                    if (!l) return;
                    select(this)
                        .attr("x1", current[l.source].x).attr("y1", current[l.source].y)
                        .attr("x2", current[l.target].x).attr("y2", current[l.target].y);
                });
            for (const group of [this.labelGroup, this.valueGroup]) {
                group.selectAll<SVGGraphicsElement, unknown>("[data-ni]").each(function () {
                    const el = select(this);
                    const ni = Number(el.attr("data-ni"));
                    const p = current[ni];
                    if (!p) return;
                    const x = p.x + (+el.attr("data-dx") || 0);
                    const y = p.y + (+el.attr("data-dy") || 0);
                    el.attr("x", x).attr("y", y);
                    if (this.tagName.toLowerCase() === "text") {
                        el.selectAll("tspan").attr("x", x);
                    }
                });
            }
        };

        const finish = (): void => {
            paintFrame(1);
            this.motionFrame = null;
            this.svg.classed("zx-motion-tween", false);
            this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
                .attr("d", (li) => targetEdge.get(li) || "");
        };
        paintFrame(0);
        void this.svg.node()?.getBoundingClientRect();
        const reducedMotion = typeof matchMedia === "function"
            && matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (typeof requestAnimationFrame !== "function" || reducedMotion) {
            finish();
            this.scheduleMotionCleanup(250);
            return;
        }
        this.svg.classed("zx-motion-tween", true);
        const duration = 760;
        let startedAt: number | null = null;
        const tick = (now: number): void => {
            if (startedAt == null) startedAt = now;
            const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
            paintFrame(progress);
            if (progress >= 1) {
                finish();
                return;
            }
            this.motionFrame = requestAnimationFrame(tick);
        };
        this.motionFrame = requestAnimationFrame(tick);
        this.scheduleMotionCleanup(duration + 300);
    }

    /** Initial-load / Reset-all choreography. Each connected component starts at
     *  its deterministic root, then descendants travel outward on a real 2.4s
     *  frame clock. A small damped perpendicular drift makes the settling legible
     *  without changing the final deterministic layout. */
    private runInitialGrowthMotion(
        st: RenderState,
        geo: GraphGeometry,
        radiusOf: (i: number) => number,
    ): void {
        const target = geo.px.map((p) => ({ x: p.x, y: p.y }));
        const parentKeys = st.data.hasParent
            ? st.model.nodes.map((_, i) => st.data.attrs[i]?.parent ?? null)
            : deriveTreeParents(st.model);
        const { parentIdx } = buildHierarchy(st.model, (i) => parentKeys[i] ?? null);
        const depths = computeDepth(parentIdx);
        const rootOf = (i: number): number => {
            let at = i;
            for (let guard = 0; guard < parentIdx.length && parentIdx[at] >= 0; guard++) {
                at = parentIdx[at];
            }
            return at;
        };
        const initial = target.map((_, i) => {
            const root = target[rootOf(i)] ?? target[i];
            return { x: root.x, y: root.y };
        });
        const current = initial.map((p) => ({ x: p.x, y: p.y }));
        const maxDepth = Math.max(1, ...depths);
        const localProgress = (i: number, progress: number): number => {
            const delay = Math.min(0.28, (depths[i] / maxDepth) * 0.22);
            return Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
        };

        this.svg.classed("zx-enter", true).classed("zx-grow", true)
            .classed("zx-motion-tween", true);
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
            .style("--zx-enter-delay", (i) => `${Math.min(520, depths[i] * 95)}ms`);

        const targetEdge = new Map<number, string>();
        this.edgeGroup.selectAll<SVGPathElement, number>("path.edge").each(function (li) {
            const el = select(this);
            const finalD = el.attr("d") || "";
            targetEdge.set(li, finalD);
        });

        const paintFrame = (progress: number): void => {
            for (let i = 0; i < current.length; i++) {
                const local = localProgress(i, progress);
                const eased = 1 - Math.pow(1 - local, 3);
                const sx = initial[i].x, sy = initial[i].y;
                const dx = target[i].x - sx, dy = target[i].y - sy;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const drift = Math.sin(local * Math.PI * 3) * (1 - local)
                    * Math.min(12, distance * 0.045);
                current[i].x = sx + dx * eased + (-dy / distance) * drift;
                current[i].y = sy + dy * eased + (dx / distance) * drift;
            }
            this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node").each(function (i) {
                const p = current[i];
                const el = select(this);
                if (this.tagName.toLowerCase() === "circle") el.attr("cx", p.x).attr("cy", p.y);
                else el.attr("transform", `translate(${p.x},${p.y})`);
            });
            this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
                .attr("d", function (li) {
                    const l = st.model.links[li];
                    const sp = current[l.source], tp = current[l.target];
                    const trimmed = trimEdgeEnds(
                        sp.x, sp.y, tp.x, tp.y, radiusOf(l.source), radiusOf(l.target),
                    );
                    const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                    const [px, py] = pairPerp(current[lo], current[hi]);
                    const parallel = +(select(this).attr("data-parallel") || 0);
                    return edgeCurvePath(
                        trimmed.sx + px * parallel, trimmed.sy + py * parallel,
                        trimmed.ex + px * parallel, trimmed.ey + py * parallel,
                        px, py, +(select(this).attr("data-off") || 0),
                    );
                });
            this.edgeGroup.selectAll<SVGPathElement, number>("path.selfloop, path.selfloop-hit")
                .attr("d", (li) => {
                    const ni = st.model.links[li].source;
                    return selfLoopPath(current[ni], radiusOf(ni));
                });
            this.edgeGroup.selectAll<SVGTextElement, number>("text.edge-label")
                .each(function (li) {
                    const l = st.model.links[li];
                    const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
                    const [px, py] = pairPerp(current[lo], current[hi]);
                    const label = select(this);
                    const parallel = +(label.attr("data-parallel") || 0);
                    const place = edgeLabelPlacement(
                        { x: current[l.source].x + px * parallel, y: current[l.source].y + py * parallel },
                        { x: current[l.target].x + px * parallel, y: current[l.target].y + py * parallel },
                        px, py,
                        +(label.attr("data-off") || 0),
                    );
                    label.attr("x", place.x).attr("y", place.y).attr("transform", place.transform);
                });
            this.defsGroup.selectAll<SVGLinearGradientElement, unknown>("linearGradient.zx-edge-grad")
                .each(function () {
                    const li = Number((this.id || "").replace("zx-eg-", ""));
                    const l = st.model.links[li];
                    if (!l) return;
                    select(this)
                        .attr("x1", current[l.source].x).attr("y1", current[l.source].y)
                        .attr("x2", current[l.target].x).attr("y2", current[l.target].y);
                });
            for (const group of [this.labelGroup, this.valueGroup]) {
                group.selectAll<SVGGraphicsElement, unknown>("[data-ni]").each(function () {
                    const el = select(this);
                    const ni = Number(el.attr("data-ni"));
                    const p = current[ni];
                    if (!p) return;
                    const x = p.x + (+el.attr("data-dx") || 0);
                    const y = p.y + (+el.attr("data-dy") || 0);
                    el.attr("x", x).attr("y", y);
                    if (this.tagName.toLowerCase() === "text") el.selectAll("tspan").attr("x", x);
                });
            }
        };

        const finish = (): void => {
            paintFrame(1);
            this.motionFrame = null;
            // End the growth and entrance states atomically. Removing only zx-grow
            // leaves `.zx-enter .nodes .node` active for the cleanup grace period,
            // which re-arms zx-node-fade after every node reaches its destination
            // and produces a single whole-graph blink.
            this.svg.classed("zx-motion-tween", false).classed("zx-grow", false)
                .classed("zx-enter", false);
            this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
                .attr("d", (li) => targetEdge.get(li) || "");
        };
        void this.svg.node()?.getBoundingClientRect();
        const reducedMotion = typeof matchMedia === "function"
            && matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (typeof requestAnimationFrame !== "function" || reducedMotion) {
            finish();
            this.scheduleMotionCleanup(250);
            return;
        }
        const duration = 2400;
        let startedAt: number | null = null;
        const tick = (now: number): void => {
            if (startedAt == null) startedAt = now;
            const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
            paintFrame(progress);
            if (progress >= 1) { finish(); return; }
            this.motionFrame = requestAnimationFrame(tick);
        };
        this.motionFrame = requestAnimationFrame(tick);
        this.scheduleMotionCleanup(duration + 350);
    }

    /** Removed elements briefly remain as non-interactive fade/shrink ghosts. */
    private drawRemovedMotionGhosts(st: RenderState, previous: MotionSnapshot): void {
        const liveNodes = new Set(st.model.nodes.map((n) => n.key));
        for (const old of previous.nodes.values()) {
            if (liveNodes.has(old.key)) continue;
            this.motionGroup.append("circle")
                .classed("zx-motion-removed", true)
                .attr("cx", old.x).attr("cy", old.y).attr("r", old.r)
                .attr("fill", old.fill).attr("stroke", old.stroke)
                .attr("stroke-width", old.strokeWidth);
        }
        const liveEdges = new Set(motionEdgeKeys(st.model));
        for (const old of previous.edges.values()) {
            if (liveEdges.has(old.key)) continue;
            this.motionGroup.append("path")
                .classed("zx-motion-edge-removed", true)
                .attr("d", old.d).attr("fill", "none")
                .attr("stroke", old.stroke).attr("stroke-width", old.strokeWidth)
                .attr("stroke-opacity", old.opacity);
        }
    }

    private scheduleMotionCleanup(ms: number): void {
        if (this.motionTimer != null) clearTimeout(this.motionTimer);
        this.motionTimer = (setTimeout(() => {
            this.motionTimer = null;
            this.svg.classed("zx-enter", false).classed("zx-refresh", false).classed("zx-grow", false)
                .classed("zx-motion-tween", false);
            this.nodeGroup.selectAll(".zx-new-node").classed("zx-new-node", false);
            this.motionGroup.selectAll("*").remove();
            this.canvasEl?.classList.remove("zx-canvas-enter", "zx-canvas-refresh");
        }, ms) as unknown) as number;
    }

    // --- Temporal / dynamic graph (NG-077) -----------------------------------
    /** Show the time controller and reveal edges up to its cursor, or hide it. Only
     *  in the SVG path (canvas has no per-edge DOM to toggle) and when premium. */
    private setupTemporal(st: RenderState): void {
        const active = this.premium.active && st.data.hasTime
            && this.formattingSettings.temporal.show.value && !this.canvasActive
            && !this.chromeHidden && this.formattingSettings.toolbar.showOverlays.value;
        if (!active) { this.temporal.hide(); this.temporalData = null; return; }

        const range = timeRange(st.data.edgeTime);
        if (!range) { this.temporal.hide(); this.temporalData = null; return; }

        this.temporalData = { firstTime: nodeFirstTime(st.model, st.data.edgeTime), edgeTime: st.data.edgeTime };
        // Heuristic: large values are epoch-millis dates; small ordinals stay numeric.
        const isDate = range.max > 1e11;
        this.temporal.setTheme(this.surfaceFor(st.dark, st.hc));
        this.temporal.configure(range, isDate);
        this.temporal.show();
        this.applyTemporalFilter(this.temporal.value());
    }

    /** Toggle node/edge/label visibility for temporal cursor `t` (display only, so the
     *  stable full-graph layout is preserved — nodes never jump as time advances). */
    private applyTemporalFilter(t: number): void {
        const td = this.temporalData;
        if (!td) return;
        this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit, path.selfloop, path.selfloop-hit")
            .style("display", (li) => (edgeVisibleAt(td.edgeTime[li], t) ? null : "none"));
        this.edgeGroup.selectAll<SVGPathElement, { edge: number }>("path.arrowhead")
            .style("display", (h) => (edgeVisibleAt(td.edgeTime[h.edge], t) ? null : "none"));
        this.edgeGroup.selectAll<SVGTextElement, number>("text.edge-label")
            .style("display", (li) => (edgeVisibleAt(td.edgeTime[li], t) ? null : "none"));
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
            .style("display", (i) => (nodeVisibleAt(td.firstTime[i], t) ? null : "none"));
        this.labelGroup.selectAll<SVGGraphicsElement, unknown>("text, rect")
            .style("display", function () {
                const ni = Number((this as SVGGraphicsElement).getAttribute("data-ni"));
                return nodeVisibleAt(td.firstTime[ni], t) ? null : "none";
            });
        this.valueGroup.selectAll<SVGGraphicsElement, unknown>("[data-ni]")
            .style("display", function () {
                const ni = Number((this as SVGGraphicsElement).getAttribute("data-ni"));
                return nodeVisibleAt(td.firstTime[ni], t) ? null : "none";
            });
    }

    // --- Expand/collapse (hierarchy folding) ---------------------------------
    private canNodeActivate(i: number): boolean {
        const h = this.formattingSettings.hierarchy;
        return !!this.hierState && isParentNode(this.hierState, i)
            && (h.drilldown.value || h.foldable.value);
    }

    /** Plain node-click action: drill-down wins over fold when both are on. */
    private onNodeActivate(st: RenderState, i: number): boolean {
        const h = this.formattingSettings.hierarchy;
        if (!this.canNodeActivate(i)) return false;
        const key = st.model.nodes[i].key;
        if (h.drilldown.value) { this.drillInto(key); return true; }
        this.toggleFold(st, i);
        return true;
    }

    private foldMotionEnabled(): boolean {
        const reduced = typeof matchMedia === "function"
            && matchMedia("(prefers-reduced-motion: reduce)").matches;
        return this.formattingSettings.nodes.animate.value && !reduced;
    }

    /** Add an enter/exit class to every visual layer owned by descendants of `root`. */
    private markFoldMotion(
        st: RenderState,
        hierarchy: Hierarchy,
        root: number,
        className: "zx-fold-in" | "zx-fold-out",
    ): void {
        if (this.canvasActive) {
            this.canvasEl?.classList.add(className);
            return;
        }
        const descendants = subtreeSet(hierarchy, root);
        descendants.delete(root);
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
            .filter((i) => descendants.has(i)).classed(className, true);
        for (const group of [this.labelGroup, this.valueGroup]) {
            group.selectAll<SVGGraphicsElement, unknown>("[data-ni]")
                .filter(function () {
                    return descendants.has(Number(this.getAttribute("data-ni")));
                })
                .classed(className, true);
        }
        const touchesDescendant = (li: number): boolean => {
            const link = st.model.links[li];
            return !!link && (descendants.has(link.source) || descendants.has(link.target));
        };
        this.edgeGroup.selectAll<SVGGraphicsElement, number>(
            "path.edge, path.selfloop, path.edge-hit, path.selfloop-hit, text.edge-label",
        ).filter(touchesDescendant).classed(className, true);
        this.edgeGroup.selectAll<SVGGraphicsElement, { edge: number }>("path.arrowhead")
            .filter((head) => touchesDescendant(head.edge)).classed(className, true);
    }

    private clearFoldMotion(className: "zx-fold-in" | "zx-fold-out"): void {
        this.svg.selectAll<SVGGraphicsElement, unknown>(`.${className}`).classed(className, false);
        this.canvasEl?.classList.remove(className);
    }

    /** Toggle a parent from one normal click. Collapse animates the outgoing subtree
     *  before hiding it; expansion paints the subtree and animates it into view. */
    private toggleFold(st: RenderState, i: number): void {
        if (!this.hierState || !this.formattingSettings.hierarchy.foldable.value ||
            !isParentNode(this.hierState, i) || this.foldMotionTimer != null) return;
        const key = st.model.nodes[i].key;
        const hierarchy = this.hierState;
        const collapsing = !this.collapsed.has(key);
        if (!this.foldMotionEnabled()) {
            if (collapsing) this.collapsed.add(key); else this.collapsed.delete(key);
            this.rerenderFromSettings();
            return;
        }
        if (collapsing) {
            this.markFoldMotion(st, hierarchy, i, "zx-fold-out");
            this.foldMotionTimer = window.setTimeout(() => {
                this.foldMotionTimer = null;
                this.clearFoldMotion("zx-fold-out");
                this.collapsed.add(key);
                this.rerenderFromSettings();
            }, FOLD_MOTION_MS);
            return;
        }

        this.collapsed.delete(key);
        this.rerenderFromSettings();
        this.markFoldMotion(st, hierarchy, i, "zx-fold-in");
        this.foldMotionTimer = window.setTimeout(() => {
            this.foldMotionTimer = null;
            this.clearFoldMotion("zx-fold-in");
        }, FOLD_MOTION_MS);
    }

    /** Drill-down: descend into a parent's sub-network (completed in NG-072). */
    private drillInto(key: string): void {
        if (this.drillRoot === key) return;
        if (this.drillRoot) this.drillTrail.push(this.drillRoot);
        this.drillRoot = key;
        this.rerenderFromSettings();
    }

    /** Additive hide of collapsed subtrees, composed with ranking/ego masks. */
    private applyCollapse(st: RenderState, geo: GraphGeometry, radiusOf: (i: number) => number): void {
        this.foldIndicatorGroup.selectAll("*").remove();
        const hidden = this.collapsedHidden;
        // Hide applies for fold AND drill (both fill collapsedHidden).
        if (!this.canvasActive && hidden.size) {
            this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node").filter((d) => hidden.has(d)).style("display", "none");
            this.edgeGroup.selectAll<SVGPathElement, number>("path.edge, path.edge-hit")
                .filter((li) => { const l = st.model.links[li]; return hidden.has(l.source) || hidden.has(l.target); })
                .style("display", "none");
            this.edgeGroup.selectAll<SVGPathElement, { edge: number }>("path.arrowhead")
                .filter((h) => {
                    const l = st.model.links[h.edge];
                    return !!l && (hidden.has(l.source) || hidden.has(l.target));
                })
                .style("display", "none");
        }
        // Labels and values remain SVG overlays in BOTH renderer modes. Keeping these
        // masks inside the SVG-node branch leaves orphan text over a collapsed Canvas
        // graph (the exact Start-collapsed regression recorded in VIS-ENT-006).
        if (hidden.size) {
            this.labelGroup.selectAll<SVGGraphicsElement, unknown>("text, rect")
                .filter(function () { return hidden.has(Number((this as SVGGraphicsElement).getAttribute("data-ni"))); })
                .style("display", "none");
            this.valueGroup.selectAll<SVGTextElement, unknown>("text")
                .filter(function () { return hidden.has(Number(this.getAttribute("data-ni"))); })
                .style("display", "none");
        }
        // A compact status dot, not a control: the parent node remains the click target.
        // The same state is appended to the node's accessible name for non-visual users.
        const hierarchy = this.hierState;
        if (hierarchy && this.formattingSettings.hierarchy.foldable.value) {
            const surface = this.surfaceFor(st.dark, st.hc);
            for (let i = 0; i < st.model.nodes.length; i++) {
                const key = st.model.nodes[i].key;
                if (hidden.has(i) || !isParentNode(hierarchy, i) || !this.collapsed.has(key)) continue;
                const p = geo.px[i];
                const nodeRadius = radiusOf(i);
                const dotRadius = Math.max(3, Math.min(5, nodeRadius * 0.2));
                this.foldIndicatorGroup.append("circle")
                    .attr("class", "fold-indicator")
                    .attr("data-ni", i)
                    .attr("data-node-key", key)
                    .attr("cx", p.x + nodeRadius * 0.72)
                    .attr("cy", p.y - nodeRadius * 0.72)
                    .attr("r", dotRadius)
                    .attr("fill", st.hc ? surface.fg : accent)
                    .attr("stroke", surface.bg)
                    .attr("stroke-width", 2);
                this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
                    .filter((nodeIndex) => nodeIndex === i)
                    .attr("data-collapsed", "true")
                    .attr("aria-label", function () {
                        const current = this.getAttribute("aria-label") || key;
                        return `${current}, children collapsed`;
                    });
            }
        }
        // (Drill-down breadcrumb is drawn in renderOverlayChrome so it survives zoom.)
    }

    private drillOut(): void {
        if (!this.drillRoot) return;
        this.drillRoot = this.drillTrail.pop() ?? null;
        this.rerenderFromSettings();
    }

    /** A clickable "◀ back" breadcrumb shown while drilled in. */
    private drawDrillCrumb(st: RenderState, top = 16): void {
        const surface = this.surfaceFor(st.dark, st.hc);
        const trail = [...this.drillTrail, this.drillRoot!];
        const label = `◀ ${trail.join("  ›  ")}`;
        const g = this.overlayGroup.append("g").classed("zx-drill-crumb", true).style("cursor", "pointer");
        const pad = 8, y = top + 14;
        const w = Math.min(st.width - 24, 12 + label.length * 6.4 + pad * 2);
        g.append("rect").attr("x", 12).attr("y", top).attr("width", w).attr("height", 22).attr("rx", 6)
            .attr("fill", surface.bg).attr("fill-opacity", 0.92).attr("stroke", surface.edge);
        g.append("text").attr("x", 12 + pad).attr("y", y).attr("font-family", fontFamily).attr("font-size", 11)
            .attr("font-weight", 600).attr("fill", surface.fg).text(label);
        g.on("click", (e: MouseEvent) => { e.stopPropagation(); this.drillOut(); });
    }

    /** The ranked Top/Bottom-N node set (R-rank), or null when ranking is off /
     *  covers the whole graph. Filter uses it for layout + visibility; Highlight
     *  uses the same set for emphasis so both actions rank identically. */
    private rankedKeptSet(st: RenderState): Set<number> | null {
        const s = this.formattingSettings;
        const mode = s.ranking.mode.value.value as RankMode;
        if (mode === "off") return null;
        const stored = s.ranking.by.value.value as RankBy;
        const by: RankBy = stored === "weighted" && !st.data.hasWeight
            ? "degree"
            : stored === "centrality" && !st.centrality ? "degree" : stored;
        return rankedNodeSet(st.model, (i) => st.data.attrs[i]?.size ?? null, {
            mode, by, count: Math.max(1, s.ranking.count.value || 10),
            centralityOf: st.centrality ? (i) => st.centrality![i] : undefined,
        });
    }

    private rankingAction(): RankingAction {
        return (this.formattingSettings.ranking.action.value.value as RankingAction) ?? "filter";
    }

    /** One hard-visibility rule for Canvas paint and interaction. A node excluded by
     *  ranking's Filter action, enterprise ego focus, or hierarchy collapse must not
     *  remain in the hit-test index after it disappears from the rendered graph. */
    private canvasHiddenNodeOf(st: RenderState): (i: number) => boolean {
        const kept = this.rankingAction() === "filter" ? this.rankedKeptSet(st) : null;
        const s = this.formattingSettings;
        let ego: Set<number> | null = null;
        if (this.premium.active && (s.explore.show.value || this.insightFocusActive) && this.exploreFocus) {
            const fi = st.model.indexByKey.get(this.exploreFocus);
            if (fi !== undefined) ego = kHopSet(st.model, fi, this.exploreHops, st.neighbors);
        }
        return (i: number): boolean =>
            (!!kept && !kept.has(i)) || (!!ego && !ego.has(i)) || this.collapsedHidden.has(i);
    }

    /** Active node-name search predicate, shared by SVG and Canvas emphasis. */
    private searchMatchesOf(st: RenderState): ((i: number) => boolean) | null {
        const s = this.formattingSettings;
        if (!this.premium.active || !s.find.show.value || !this.searchTerm) return null;
        const term = this.searchTerm.toLowerCase();
        return (i: number): boolean => st.model.nodes[i].label.toLowerCase().includes(term);
    }

    /** Apply the persistent SVG emphasis for ranking's Highlight action. Kept nodes
     *  receive the accent ring; an edge is emphasized only when both endpoints are
     *  kept. All other nodes, links, outer labels, and inner values stay visible but dim. */
    private applyRankingHighlight(st: RenderState, kept: Set<number>): void {
        const matches = (i: number): boolean => kept.has(i);
        applySearchHighlight(this.nodeGroup, this.edgeGroup, st.model, accent, matches, "both");
        for (const group of [this.labelGroup, this.valueGroup]) {
            group.selectAll<SVGGraphicsElement, unknown>("[data-ni]")
                .attr("opacity", function () {
                    return matches(Number(this.getAttribute("data-ni"))) ? 1 : 0.12;
                });
        }
    }

    /** Top/Bottom-N ranking (R-rank): either mask and re-layout the ranked nodes or
     *  retain the complete graph and highlight those nodes. Core feature, not gated. */
    private applyRanking(st: RenderState): void {
        const kept = this.rankedKeptSet(st);
        if (!kept) return;
        const action = this.rankingAction();
        if (action === "filter") {
            applyExploreMask(this.nodeGroup, this.edgeGroup, this.labelGroup, st.model, kept, [this.valueGroup]);
        } else {
            this.applyRankingHighlight(st, kept);
        }
    }

    /** Explore mask (E3) and/or path highlight (E5), applied after selection dim. */
    private applyEnterpriseEmphasis(st: RenderState): void {
        const s = this.formattingSettings;
        if (!this.premium.active) return;

        // Search highlight (R4): enlarge/ring matches, dim the rest.
        const searchMatches = this.searchMatchesOf(st);
        if (searchMatches) applySearchHighlight(this.nodeGroup, this.edgeGroup, st.model, accent, searchMatches);

        // Explore: mask to the k-hop ego network of the focused node. The insight-driven
        // focus (NG-252) reuses this mask but leaves the enterprise explore panel alone.
        if ((s.explore.show.value || this.insightFocusActive) && this.exploreFocus) {
            const fi = st.model.indexByKey.get(this.exploreFocus);
            if (fi !== undefined) {
                const visible = kHopSet(st.model, fi, this.exploreHops, st.neighbors);
                applyExploreMask(this.nodeGroup, this.edgeGroup, this.labelGroup, st.model, visible, [this.valueGroup]);
                if (s.explore.show.value) this.enterprisePanel.setExploreState(this.exploreFocus, this.exploreHops, this.exploreTrail);
            }
        }

        // Insight bridge highlight (NG-252): accent exactly the structural-bridge links,
        // dim the rest — reusing the path-emphasis primitive over an edge-set predicate.
        if (this.insightBridgeLinks && this.insightBridgeLinks.size) {
            const links = this.insightBridgeLinks;
            const bridgeNodes = new Set<number>();
            st.model.links.forEach((l, li) => {
                if (links.has(li)) { bridgeNodes.add(l.source); bridgeNodes.add(l.target); }
            });
            applyPathEmphasis(this.nodeGroup, this.edgeGroup, accent, bridgeNodes, (li) => links.has(li));
        }

        // Path: highlight the shortest path between the two picked nodes.
        if (s.path.show.value && this.pathSource && this.pathTarget) {
            const a = st.model.indexByKey.get(this.pathSource);
            const b = st.model.indexByKey.get(this.pathTarget);
            if (a === undefined || b === undefined) return;
            // Weighted mode routes by least total edge cost (Dijkstra); default is fewest hops (BFS).
            const weighted = s.path.weighted.value;
            const path = weighted ? weightedShortestPath(st.model, a, b) : shortestPath(st.model, a, b, st.neighbors);
            if (!path) {
                this.enterprisePanel.setPathResult(`${this.pathSource} → ${this.pathTarget}: unreachable`);
                return;
            }
            const pathNodes = new Set(path);
            const pairs = new Set<string>();
            for (let i = 0; i + 1 < path.length; i++) {
                const lo = Math.min(path[i], path[i + 1]);
                const hi = Math.max(path[i], path[i + 1]);
                pairs.add(`${lo}-${hi}`);
            }
            const pathEdge = (li: number): boolean => {
                const l = st.model.links[li];
                const lo = Math.min(l.source, l.target);
                const hi = Math.max(l.source, l.target);
                return pairs.has(`${lo}-${hi}`);
            };
            applyPathEmphasis(this.nodeGroup, this.edgeGroup, accent, pathNodes, pathEdge);
            this.enterprisePanel.setPathResult(`${this.pathSource} → ${this.pathTarget}: ${path.length - 1} hop${path.length - 1 === 1 ? "" : "s"}`);
        }
    }

    private setExploreFocus(key: string | null): void {
        this.exploreFocus = key;
        if (!key) { this.exploreTrail = []; return; } // exiting focus resets the ego breadcrumb
        if (this.exploreTrail[this.exploreTrail.length - 1] !== key) {
            this.exploreTrail.push(key);
            if (this.exploreTrail.length > 8) this.exploreTrail.shift();
        }
    }

    /** Canvas-level exit from ego-focus (G2-007): Escape, an empty-canvas click, or
     *  re-clicking the focused node. A no-op (returns false) when nothing is focused,
     *  so it never forces a needless repaint. */
    private clearExploreFocus(): boolean {
        if (!this.exploreFocus) return false;
        this.setExploreFocus(null);
        this.rerenderFromSettings();
        return true;
    }

    /** Dispatch a click on an Insight card (NG-252): return to the graph and apply a
     *  transient, non-persisted preview — focus an entity's ego network, preview a
     *  colouring, or highlight the structural-bridge edge set. Only one preview is live
     *  at once. Reuses existing mechanisms (ego mask, colour accessor, path emphasis) so
     *  the repaint goes through the cached-inputs path with no host round-trip. */
    private applyInsightAction(a: InsightAction): void {
        // Reset every transient preview first — one at a time.
        this.insightColorMode = null;
        this.insightBridgeLinks = null;
        this.insightFocusActive = false;
        this.setExploreFocus(null);
        switch (a.kind) {
            case "focusNode":
                this.setExploreFocus(a.nodeKey);
                this.exploreHops = Math.max(1, this.exploreHops);
                this.insightFocusActive = true;
                break;
            case "colorBy":
                // Cluster preview needs community data; compute it on demand if the
                // authored colour mode never did (component is always available).
                if (a.mode === "cluster" && this.lastRender && !this.lastRender.community) {
                    this.lastRender.community = this.computeInsightCommunity(this.lastRender);
                }
                this.insightColorMode = a.mode;
                break;
            case "highlightBridges": {
                // Map bridge pairs (by natural key) back to every matching link record,
                // so both directions of a reciprocal bridge are accented.
                const model = this.lastRender?.model;
                const links = new Set<number>();
                if (model) {
                    const wanted = new Set(a.pairs.map(([u, v]) => (u < v ? `${u} ${v}` : `${v} ${u}`)));
                    model.links.forEach((l, li) => {
                        if (l.source === l.target) return;
                        const uk = model.nodes[l.source].key, vk = model.nodes[l.target].key;
                        const key = uk < vk ? `${uk} ${vk}` : `${vk} ${uk}`;
                        if (wanted.has(key)) links.add(li);
                    });
                }
                this.insightBridgeLinks = links;
                break;
            }
        }
        if (this.viewMode !== "graph") {
            this.viewMode = "graph";
            this.viewToggle.set("graph");
        }
        this.rerenderFromSettings();
    }

    /** Whether the Table's analytical columns are computable now (NG-253): premium
     *  (fail-open) and within the O(V·E) node cap shared with edge-betweenness/tooltips. */
    private tableAnalyticsAvailable(st: RenderState): boolean {
        return this.premium.active && st.model.nodes.length <= 2000;
    }

    /** Lazy, memoized provider for the Table's opt-in analytical columns (NG-253).
     *  Betweenness/closeness/PageRank/community → number[]; critical → boolean[]; null
     *  when unavailable. Computed at most once per render snapshot per metric. */
    private tableMetricFor(st: RenderState, key: string): number[] | boolean[] | null {
        if (!this.tableAnalyticsAvailable(st)) return null;
        if (this.tableMetricToken !== st) { this.tableMetricCache.clear(); this.tableMetricToken = st; }
        const hit = this.tableMetricCache.get(key);
        if (hit) return hit;
        let v: number[] | boolean[] | null = null;
        switch (key) {
            case "betweenness": v = betweennessCentrality(st.model); break;
            case "closeness": v = closenessCentrality(st.model); break;
            case "pagerank": v = pageRank(st.model); break;
            case "community": v = st.community ?? this.computeInsightCommunity(st); break;
            case "critical": v = articulationFlags(st.model); break;
            default: return null;
        }
        this.tableMetricCache.set(key, v);
        return v;
    }

    /** Louvain communities for a transient cluster preview, using the same settings and
     *  category accessor the main render uses — so the preview matches turning the
     *  authored "Colour by → Community" mode on. Deterministic. */
    private computeInsightCommunity(st: RenderState): number[] {
        const cl = this.formattingSettings.clusters;
        return resolveClusters(st.model, (i) => (st.data.attrs[i]?.category ?? null), {
            mode: (cl.clusterBy.value.value as ClusterMode) || "auto",
            resolution: Math.max(0.2, (cl.resolution.value || 100) / 100),
            minClusterSize: Math.max(1, cl.minClusterSize.value || 1),
            maxClusters: Math.max(0, cl.maxClusters.value || 0),
        });
    }

    /** Clear any transient Insight-view preview (NG-252). Returns true if one was live,
     *  so the caller can repaint. Also releases an insight-driven ego focus. */
    private clearInsightPreview(): boolean {
        const had = this.insightColorMode !== null || this.insightBridgeLinks !== null || this.insightFocusActive;
        this.insightColorMode = null;
        this.insightBridgeLinks = null;
        if (this.insightFocusActive) { this.insightFocusActive = false; this.setExploreFocus(null); }
        return had;
    }

    /** Small-tile breakpoint (CEO): below this the floating overlays (action/zoom bar,
     *  Graph/Table/Insight pill, legend, branding) are shed so only the gear + graph
     *  remain — on a cramped tile the overlays overlap and bury the graph. Kept as one
     *  predicate so paint() and renderOverlayChrome() shed the same way. */
    private isSmallTile(width: number, height: number): boolean {
        return width < 520 || height < 380;
    }

    /** Fixed (non-zoomed) overlay: branding, truncation note, minimap. Redrawn on
     *  zoom/pan so the minimap viewport rect tracks. */
    private renderOverlayChrome(st: RenderState): void {
        const s = this.formattingSettings;
        const surface = this.surfaceFor(st.dark, st.hc);
        this.overlayGroup.selectAll("*").remove();

        // Focus mode and the persisted Format-pane master switch draw nothing over
        // the graph. Only temporary focus mode keeps an HTML restore-eye.
        if (this.chromeHidden || !s.toolbar.showOverlays.value) return;

        // Small-tile shedding (CEO): drop the decorative overlays (legend + branding)
        // on a cramped tile so only the gear + graph remain. The truncation note and
        // drill breadcrumb below are NOT shed — they are honesty/navigation, not chrome.
        const smallTile = this.isSmallTile(st.width, st.height);

        // Ranking and edge-budget honesty share one card. They used to be drawn by
        // separate subsystems at y=18/23, which made the two lines overwrite each
        // other on exactly the large filtered graphs that need both messages.
        const statusLines: string[] = [];
        const rankKept = this.rankedKeptSet(st);
        if (rankKept) {
            const action = this.rankingAction();
            const verb = (s.ranking.mode.value.value as RankMode) === "top" ? "Top" : "Bottom";
            statusLines.push(action === "filter"
                ? `${verb} ${rankKept.size} of ${st.model.nodes.length} nodes`
                : `Highlighting ${verb.toLowerCase()} ${rankKept.size} of ${st.model.nodes.length} nodes`);
        }
        if (st.data.truncated) {
            statusLines.push(`Showing ${st.data.truncated.shownRows.toLocaleString()} of `
                + `${st.data.truncated.totalRows.toLocaleString()} edges`);
        }
        const statusBottom = renderGraphStatus(this.overlayGroup, statusLines, st.width, surface);
        // Drill-down breadcrumb — redrawn here so it survives zoom/pan (overlay is cleared each time).
        if (s.hierarchy.drilldown.value && this.drillRoot) {
            this.drawDrillCrumb(st, statusLines.length ? statusBottom + 6 : 16);
        }
        // Minimap is a navigation aid for a zoomed/panned graph — only useful once
        // the user has zoomed in. On the default fit view it's clutter (and would sit
        // under the gear), so gate it on zoom.
        if (this.premium.active && s.scale.minimap.value && st.geo && this.zoom.get().k > 1.05) {
            renderMinimap(this.overlayGroup, st.geo.px, this.zoom.get(), st.width, st.height, surface);
        }
        const showCategoryLegend = s.colors.showLegend.value;
        const showEdgeLegend = s.colors.showEdgeLegend.value;
        if ((showCategoryLegend || showEdgeLegend) && !smallTile) {
            // NG-113 — all legend content composes into ONE bottom-left card of
            // divider-separated sections: colour mode (category/cluster/…/gradient),
            // typed edges, and the edge-weight thickness scale.
            const sections: LegendSection[] = [];
            if (showCategoryLegend) {
                const main = this.legendSection(st, surface);
                if (main) sections.push(main);
            }
            // Link-colour mode drives what the edge legend shows (req 4): the legend
            // must reflect how links are ACTUALLY coloured, not a fixed grey/type scheme.
            const edgeMode = st.hc ? "auto" : (s.edges.colorMode.value.value as string);
            const links = st.model.links;
            // Typed-edge swatches only make sense in "auto" mode — in the other modes the
            // link colour comes from the endpoints or a single pick, not the edge type.
            if (showEdgeLegend && edgeMode === "auto" && st.data.hasEdgeType && st.data.edgeTypes.length) {
                const pal = paletteByName(s.colors.palette.value.value as string);
                sections.push({
                    kind: "swatch", title: "Edge type", dashed: true,
                    items: st.data.edgeTypes.map((t, i) => ({ label: t, color: pal[i % pal.length] })),
                });
            }
            // Edge-weight section (NG-082) — only when weights actually vary. Its line
            // samples take the current link colour (single mode) instead of fixed grey,
            // and drop the accent-max override so the whole scale reads in that colour.
            // Only when width actually encodes weight (86d3wdnav) — a weight→width scale
            // legend is meaningless when Scale width by weight is off (all links uniform).
            if (showEdgeLegend && links.length && s.edges.scaleByWeight.value) {
                let minW = Infinity, maxW = -Infinity;
                for (const l of links) { if (l.weight < minW) minW = l.weight; if (l.weight > maxW) maxW = l.weight; }
                const widthAt = makeEdgeWidth(st.model, s.edges.thickness.value || 1, s.edges.scaleByWeight.value);
                const lineCol = edgeMode === "single" ? ((s.edges.color.value.value as string) || surface.edge) : surface.edge;
                const ew = edgeWeightSection(minW, maxW, (w) => widthAt(-1, w), lineCol);
                if (ew) { if (edgeMode !== "auto") (ew as { plain?: boolean }).plain = true; sections.push(ew); }
            }
            if (sections.length) {
                const legendPref = ((s.colors.legendPosition.value.value as string) || "auto") as LegendCorner;
                const legendCorner = resolveCorner(legendPref as CornerPref, "bl");
                // Dodge higher-priority chrome sharing the legend's corner (NG-136): the
                // fixed quick-action toolbar (top-right) and the gear. `cornerInset` returns
                // the flush 12px when the corner is clear, so the default bottom-left legend
                // is unmoved. The pill (variable-width HTML, drawn over the SVG) is excluded.
                const nearInset = cornerInset(legendCorner, "legend", {
                    actionBar: s.toolbar.actions.value,
                    gearCorner: s.toolbar.show.value ? resolveCorner((s.toolbar.position.value.value as string) as CornerPref, "br") : null,
                    pillCorner: null,
                    legendCorner,
                });
                renderLegendCard(this.overlayGroup, sections, st.height, surface, st.hc, 0, {
                    collapsed: this.legendCollapsed,
                    onToggle: () => {
                        const before = this.captureAuthoringSnapshot();
                        this.legendCollapsed = !this.legendCollapsed;
                        this.persistLegendCollapsed(this.legendCollapsed);
                        if (this.lastRender) this.renderOverlayChrome(this.lastRender);
                        this.commitAuthoringSnapshot(before);
                    },
                }, st.width, legendCorner, nearInset);
            }
        }
        if (s.branding.show.value && !smallTile) {
            this.overlayGroup.append("text")
                .attr("x", st.width - 8).attr("y", st.height - 8)
                .attr("text-anchor", "end")
                .attr("font-family", fontFamily).attr("font-size", 10)
                .attr("fill", surface.muted).attr("opacity", 0.7)
                .attr("pointer-events", "none")
                .text("Zentrix");
        }
    }

    private openDetail(st: RenderState, i: number, surface: Surface): void {
        if (!this.formattingSettings.nodes.showFullInfoOnClick.value) return;
        this.hideTooltip();
        this.openNode = i;
        this.detailPanel.show(
            st.model,
            i,
            topNeighbors(st.model, i, 6),
            this.nodeBusinessFields(st, i),
            surface,
        );
    }

    private closeDetail(): void {
        this.openNode = null;
        this.detailPanel.hide();
        this.selectionManager.clear().then(() => this.syncSelectionDim());
    }

    private removeSummary(): void {
        if (this.summaryEl && this.summaryEl.parentNode) this.summaryEl.parentNode.removeChild(this.summaryEl);
        this.summaryEl = null;
    }

    // --- Accessors -----------------------------------------------------------
    /** Resolve stored settings against the data/calculations available now. The
     *  original preference stays persisted and resumes if its prerequisite returns,
     *  while rendering and the gear use an honest available fallback. */
    private effectiveColorMode(st: RenderState): ColorMode {
        // Transient Insight-view preview (NG-252) overrides the authored mode without
        // persisting it. "component" always works (component is on every node); "cluster"
        // needs community data — fall through to the stored mode if it isn't available.
        if (this.insightColorMode === "component") return "component";
        if (this.insightColorMode === "cluster" && st.community) return "cluster";
        const stored = (this.formattingSettings.colors.mode.value.value as ColorMode) ?? "single";
        return stored === "category" && !st.data.hasCategory ? "single" : stored;
    }

    private effectivePaletteName(st: RenderState): string {
        const s = this.formattingSettings;
        const stored = String(s.colors.palette.value.value || "");
        const mode = this.effectiveColorMode(st);
        const continuous = mode === "measure"
            || (mode === "level" && String(s.colors.levelStyle.value.value) === "ramp");
        const family = familyOf(stored);
        const familyMatches = continuous
            ? family === "sequential" || family === "diverging"
            : family === "qualitative";
        const cvdMatches = !s.colors.cvdOnly.value || isCvdSafe(stored);
        if (familyMatches && cvdMatches) return stored;
        return continuous ? "viridis" : (s.colors.cvdOnly.value ? "colorblind" : "brand");
    }

    private effectiveColorDriver(st: RenderState): ColorDriver {
        const stored = (this.formattingSettings.colors.colorDriver.value.value as ColorDriver) ?? "size";
        if (stored === "weighted" && !st.data.hasWeight) return "size";
        if (stored === "centrality" && !st.centrality) return "size";
        return stored;
    }

    private effectiveRules(st: RenderState): CFRule[] {
        return this.cfRules.filter((rule) => {
            if (!rule.enabled || !rule.color) return false;
            if (rule.field === "weighted") return st.data.hasWeight;
            if (rule.field === "category") return st.data.hasCategory;
            if (rule.field === "centrality") return st.centrality != null;
            return true;
        });
    }

    private makeColorAccessor(st: RenderState, surface: Surface): (i: number) => string {
        const s = this.formattingSettings;
        const mode = this.effectiveColorMode(st);
        const rev = Boolean(s.colors.reverse.value);
        const paletteName = this.effectivePaletteName(st);
        // Reverse applies uniformly: flip the qualitative order, the scale stops, and the
        // custom 2-stop endpoints — so "Reverse colours" behaves the same across families.
        const palette = reverseIf(paletteByName(paletteName), rev);
        const rawScale = scaleByName(paletteName);
        const scaleStops = rawScale ? reverseIf(rawScale, rev) : null; // named seq/div, else custom
        const single = (s.nodes.defaultColor.value.value as string) || surface.nodeDefault;
        let gLow = (s.colors.gradientLow.value.value as string) || "#EEE9FF";
        let gHigh = (s.colors.gradientHigh.value.value as string) || single;
        if (rev) { const t = gLow; gLow = gHigh; gHigh = t; }
        const catIx = categoryIndex(st.data.categories);
        const { values, min, max } = this.measureRange(st);
        // A continuous t∈[0,1] → colour: a named scale when chosen, else the custom gradient.
        const ramp = (t: number): string => (scaleStops ? sampleScale(scaleStops, t) : lerpColor(gLow, gHigh, t));

        // Conditional-formatting rules (R-cf) override the base colour when they fire.
        // Rules can key off numeric metrics OR the node's name/category (text ops).
        const cfRules = this.effectiveRules(st);
        const cfActive = cfRules.length > 0;
        const cfColor = (i: number): string | null =>
            cfActive ? conditionalColor(cfRules, (field) => resolveNodeField(st.model, st.data.attrs, st.centrality, i, field)) : null;

        // Custom multi-stop gradient (Gradient-tab toggle) takes over ALL colouring: every
        // node maps its Colour-driver value onto [Start … End] regardless of "Colour by".
        // Reverse flips the stop order, matching how it flips scales/endpoints above.
        const customStops = this.customGradientStops();
        if (customStops) {
            const stops = reverseIf(customStops, rev);
            return (i: number) => {
                if (st.hc) return surface.nodeDefault;
                const cf = cfColor(i); if (cf) return cf;
                const v = values[i];
                if (v == null) return single;
                const t = max > min ? (v - min) / (max - min) : 0.5;
                return sampleScale(stops, t);
            };
        }

        const levelStyle = s.colors.levelStyle.value.value as string;
        const depths = mode === "level" ? this.nodeDepths(st) : null;
        const maxDepth = depths ? depths.reduce((a, b) => (b > a ? b : a), 0) : 0;

        return (i: number) => {
            if (st.hc) return surface.nodeDefault;
            if (cfActive) {
                const override = conditionalColor(cfRules, (field) => resolveNodeField(st.model, st.data.attrs, st.centrality, i, field));
                if (override) return override;
            }
            switch (mode) {
                case "single":
                    return single;
                case "cluster":
                    return st.community ? palette[st.community[i] % palette.length] : single;
                case "component":
                    return palette[st.model.nodes[i].component % palette.length];
                case "level": {
                    if (!depths) return single;
                    if (levelStyle === "ramp") return ramp(maxDepth > 0 ? depths[i] / maxDepth : 0);
                    return palette[depths[i] % palette.length];
                }
                case "measure": {
                    const v = values[i];
                    if (v == null) return single;
                    const t = max > min ? (v - min) / (max - min) : 0.5;
                    return ramp(t);
                }
                default: { // category
                    const cat = st.data.attrs[i]?.category;
                    if (st.data.hasCategory && cat != null) return palette[(catIx.get(cat) ?? 0) % palette.length];
                    return single;
                }
            }
        };
    }

    /** Resolve the primary entity icon drawn on each node.
     *  - all: one author-selected icon (an Icon-role value is the back-compat fallback
     *    when no global icon has been selected);
     *  - type: semantic matching from Node category;
     *  - field: each Icon-role value;
     *  - level: one author-selected icon per hierarchy depth.
     *  Plain catalog names from data (e.g. "Server") normalize to stable SVG ids.
     *  Unknown word-like values use the Unknown semantic marker instead of becoming
     *  giant literal text; punctuation/emoji glyphs remain supported for legacy reports. */
    private makeIconOf(st: RenderState): (i: number) => string | null {
        const nodes = this.formattingSettings.nodes;
        const normalize = (raw: string | null | undefined): string | null => {
            const value = String(raw ?? "").trim();
            if (!value) return null;
            const semantic = getSemanticIcon(value);
            if (semantic) return semantic.value;
            return /^[a-z0-9][a-z0-9 _-]*$/i.test(value) ? "zx:unknown" : value;
        };
        const dataIcon = (i: number): string | null => normalize(st.data.attrs[i]?.icon);
        const mode = nodes.iconMode.value.value as string;
        if (mode === "field") return dataIcon;
        if (mode === "type") {
            if (!st.data.hasCategory) return () => null;
            return (i) => inferSemanticIcon(st.data.attrs[i]?.category);
        }
        if (mode !== "level") {
            const global = normalize(nodes.icon.value);
            return global ? () => global : dataIcon;
        }
        const levelIcons = [
            nodes.iconL0.value, nodes.iconL1.value, nodes.iconL2.value,
            nodes.iconL3.value, nodes.iconL4.value,
        ];
        const depths = this.nodeDepths(st);
        const last = levelIcons.length - 1;
        return (i) => {
            const d = depths[i];
            const iconValue = d != null && d >= 0 ? normalize(levelIcons[Math.min(d, last)]) : null;
            return iconValue || dataIcon(i);
        };
    }

    /** Resolve the fill texture for each node. "All" keeps the original single-pattern
     *  behavior; "By level" maps Root/L1/L2/L3/L4+ through the same deterministic
     *  hierarchy depths used by icons and level colouring. */
    private makeFillPatternOf(st: RenderState): (i: number) => string {
        const nodes = this.formattingSettings.nodes;
        if ((nodes.fillPatternMode.value.value as string) !== "level") {
            const global = nodes.fillPattern.value.value as string;
            return () => global;
        }
        const levelPatterns = [
            nodes.fillPatternL0.value.value as string,
            nodes.fillPatternL1.value.value as string,
            nodes.fillPatternL2.value.value as string,
            nodes.fillPatternL3.value.value as string,
            nodes.fillPatternL4.value.value as string,
        ];
        const depths = this.nodeDepths(st);
        const last = levelPatterns.length - 1;
        return (i) => {
            const d = depths[i];
            return d != null && d >= 0 ? levelPatterns[Math.min(d, last)] : "none";
        };
    }

    /** 0-based depth per node for `level` colouring. Uses the Node-parent role when
     *  bound, else a deterministic spanning-forest parent (so "By level" works even
     *  without an explicit hierarchy). Pure/deterministic. */
    private nodeDepths(st: RenderState): number[] {
        const parentKeys = st.data.hasParent
            ? st.model.nodes.map((_, i) => st.data.attrs[i]?.parent ?? null)
            : deriveTreeParents(st.model);
        const { parentIdx } = buildHierarchy(st.model, (i) => parentKeys[i] ?? null);
        return computeDepth(parentIdx);
    }

    /** Values driving measure-colour + its legend, per the chosen colour driver.
     *  Node value uses the bound Node size where present, otherwise the node's
     *  summed connected Edge weight (which equals Degree for unweighted data). */
    private measureRange(st: RenderState): { values: (number | null)[]; min: number; max: number; label: string } {
        const driver = this.effectiveColorDriver(st);
        const nodes = st.model.nodes;
        let values: (number | null)[];
        let label: string;
        switch (driver) {
            case "degree": values = nodes.map((n) => n.degree); label = "Degree"; break;
            case "weighted": values = nodes.map((n) => n.weightedDegree); label = "Weighted degree"; break;
            case "betweenness": values = computeCentrality(st.model, "betweenness") ?? nodes.map((n) => n.degree); label = "Bridge (betweenness)"; break;
            case "pagerank": values = computeCentrality(st.model, "pagerank") ?? nodes.map((n) => n.degree); label = "Influence (PageRank)"; break;
            case "centrality": values = st.centrality ?? nodes.map((n) => n.degree); label = st.centrality ? centralityLabel(st.centralityMetric) : "Degree"; break;
            default: // size
                values = nodes.map((node, i) => st.data.attrs[i]?.size ?? node.weightedDegree);
                label = "Node value";
        }
        let min = Infinity, max = -Infinity;
        for (const v of values) { if (v == null) continue; if (v < min) min = v; if (v > max) max = v; }
        if (!Number.isFinite(min)) { min = 0; max = 1; }
        return { values, min, max, label };
    }

    /** The custom multi-stop node gradient, when the Gradient-tab toggle is on:
     *  [Start, …active mids…, End] as hex stops for `sampleScale`. Returns null when the
     *  toggle is off, so callers fall through to the mode/palette-based colouring. Start/End
     *  reuse gradientLow/gradientHigh; `gradientMids` (0–5, clamped) picks how many mids. */
    private customGradientStops(): string[] | null {
        const c = this.formattingSettings.colors;
        if (!c.customGradient.value) return null;
        const start = (c.gradientLow.value.value as string) || "#EEE9FF";
        const end = (c.gradientHigh.value.value as string) || (this.formattingSettings.nodes.defaultColor.value.value as string);
        const n = Math.max(0, Math.min(5, Math.round(Number(c.gradientMids.value) || 0)));
        const mids = [c.gradientMid1, c.gradientMid2, c.gradientMid3, c.gradientMid4, c.gradientMid5]
            .slice(0, n).map((m) => (m.value.value as string) || start);
        return [start, ...mids, end];
    }

    /** The value shown inside a node, per the Value source setting (null = none). */
    private nodeValueOf(st: RenderState, i: number): number | null {
        const stored = this.formattingSettings.nodes.valueSource.value.value as string;
        const source = stored === "weighted" && !st.data.hasWeight
            ? "size"
            : stored === "centrality" && !st.centrality ? "size" : stored;
        switch (source) {
            case "size": return st.data.attrs[i]?.size ?? st.model.nodes[i].weightedDegree;
            case "weighted": return st.model.nodes[i].weightedDegree;
            case "centrality": return st.centrality ? st.centrality[i] : null;
            default: return st.model.nodes[i].degree;
        }
    }

    private makeRadiusAccessor(st: RenderState, visibleNodeCount = st.model.nodes.length): (i: number) => number {
        const s = this.formattingSettings;
        const configuredMin = Math.max(1, s.nodes.minRadius.value || 4);
        const configuredMax = Math.max(configuredMin, s.nodes.maxRadius.value || 40);
        // Automatic density/canvas sizing belongs only to the untouched default range.
        // As soon as the author touches either endpoint, both values become an explicit
        // range and are rendered exactly as entered. "Touched" is a value-independent
        // signal (NG-239): a persisted endpoint (reloaded report) OR a live gear edit not
        // yet round-tripped through persistProperties. Comparing against the default 4/40
        // was the bug — a deliberate Max of exactly 40 read as "untouched" and silently
        // shrank every node, while 39 and 41 rendered full size.
        const authored = this.radiusAuthored || this.toolbar.hasPendingEdit("nodes.minR", "nodes.maxR");
        const autoRange = !authored;
        const responsiveScale = autoRange
            ? responsiveNodeRadiusScale(st.width, st.height) * nodeCountRadiusScale(visibleNodeCount)
            : 1;
        const minR = Math.max(1, configuredMin * responsiveScale);
        const maxR = Math.max(minR, configuredMax * responsiveScale);
        const scale = Math.max(0.2, (s.nodes.sizeScale.value || 100) / 100); // Size scale % multiplier
        const sizeBy = s.nodes.sizeBy.value.value as string;

        const maxDeg = maxOf(st.model.nodes.map((n) => n.degree)) || 1;
        const resolvedNodeValues = st.model.nodes.map((node, i) =>
            st.data.attrs[i]?.size ?? node.weightedDegree);
        const sizes = resolvedNodeValues.filter((v) => Number.isFinite(v));
        const minSize = sizes.length ? Math.min(...sizes) : 0;
        const maxSize = sizes.length ? Math.max(...sizes) : 1;

        const base = (i: number): number => {
            if (sizeBy === "uniform") return (minR + maxR) / 2;
            if (sizeBy === "measure") {
                const v = resolvedNodeValues[i];
                const t = (v - minSize) / ((maxSize - minSize) || 1);
                return minR + t * (maxR - minR);
            }
            // Size by centrality (already 0..1) when a metric is active.
            if (sizeBy === "centrality" && st.centrality) {
                return minR + st.centrality[i] * (maxR - minR);
            }
            const t = Math.sqrt(st.model.nodes[i].degree) / Math.sqrt(maxDeg);
            return minR + t * (maxR - minR);
        };
        return (i: number) => base(i) * scale;
    }

    /** Typed-edge colour + dash accessors (link-analysis pattern), or empty when no
     *  Edge-type role is bound / high contrast. Edge i maps 1:1 to data.edges[i]. */
    /** Consolidate each reciprocal pair into its first record. The representative gets
     *  two arrowheads; remaining records are suppressed only from rendering, so graph
     *  metrics and business data still retain every source row. */
    private makeTwoWayDisplay(st: RenderState): {
        bidirectionalOf: (i: number) => boolean;
        edgeSuppressedOf: (i: number) => boolean;
    } | undefined {
        const s = this.formattingSettings.edges;
        if (!s.bidirectional.value || !s.showArrows.value) return undefined;
        const groups = new Map<string, number[]>();
        for (let i = 0; i < st.model.links.length; i++) {
            const l = st.model.links[i];
            if (l.source === l.target) continue;
            const lo = Math.min(l.source, l.target), hi = Math.max(l.source, l.target);
            const key = `${lo}-${hi}`;
            const found = groups.get(key);
            if (found) found.push(i); else groups.set(key, [i]);
        }
        const representatives = new Set<number>();
        const suppressed = new Set<number>();
        for (const indices of groups.values()) {
            let forward = false, reverse = false;
            const first = st.model.links[indices[0]];
            for (const i of indices) {
                const l = st.model.links[i];
                if (l.source === first.source && l.target === first.target) forward = true;
                else if (l.source === first.target && l.target === first.source) reverse = true;
            }
            if (!forward || !reverse) continue;
            representatives.add(indices[0]);
            for (let j = 1; j < indices.length; j++) suppressed.add(indices[j]);
        }
        if (!representatives.size) return undefined;
        return {
            bidirectionalOf: (i) => representatives.has(i),
            edgeSuppressedOf: (i) => suppressed.has(i),
        };
    }

    /** Per-edge midpoint label (weight or bound edge-type), or undefined when off. */
    /** Node label text (N4): name, value, both, or directed flow totals. */
    private makeNodeLabel(st: RenderState): (i: number) => string {
        const mode = this.formattingSettings.labels.content.value.value as string;
        // Labels show the human-readable name (`label`), never the compound identity key.
        if (mode === "name") return (i) => st.model.nodes[i].label;
        const dec = Math.max(0, this.formattingSettings.nodes.valueDecimals.value || 0);
        const units = this.formattingSettings.labels.outerValueFormat.value.value as ValueDisplayUnits;
        const fmt = (v: number | null): string => (v == null ? "" : formatValue(v, dec, units));
        if (mode === "value") return (i) => fmt(this.nodeValueOf(st, i)) || st.model.nodes[i].label;
        if (mode === "nameValue") {
            return (i) => {
                const v = fmt(this.nodeValueOf(st, i));
                return v ? `${st.model.nodes[i].label} (${v})` : st.model.nodes[i].label;
            };
        }
        // Flow modes: totals of the directed edge weights in/out of the node.
        const { inflow, outflow } = nodeFlows(st.model);
        const flowOf = (i: number): number =>
            mode === "inflow" ? inflow[i] : mode === "outflow" ? outflow[i] : inflow[i] + outflow[i];
        return (i) => `${st.model.nodes[i].label} ${fmt(flowOf(i))}`.trim();
    }

    private makeEdgeLabel(st: RenderState): ((i: number) => string | null) | undefined {
        const s = this.formattingSettings.edges;
        if (!s.showLabels.value) return undefined;
        const stored = s.labelSource.value.value as string;
        let src = stored;
        const available = (value: string): boolean =>
            (value === "weight" || value === "weightPct") ? st.data.hasWeight
                : value === "type" ? st.data.hasEdgeType
                    : value === "betweenness" ? st.model.nodes.length <= 2000
                        : value === "names" ? true // every edge has a source and target
                            : false;
        if (!available(src)) {
            src = ["weight", "type", "weightPct", "betweenness", "names"].find(available) ?? "";
        }
        if (!src) return undefined;
        if (src === "names") {
            // Source → target node names (N13). Always available — no numeric data needed.
            return (li) => {
                const l = st.model.links[li];
                return `${st.model.nodes[l.source].label} → ${st.model.nodes[l.target].label}`;
            };
        }
        if (src === "weightPct") {
            // Share of total weight (N13). One pass; stable denominator.
            const total = st.model.links.reduce((a, l) => a + (Number.isFinite(l.weight) ? l.weight : 1), 0);
            return (li) => {
                const w = st.model.links[li].weight;
                if (!Number.isFinite(w) || total <= 0) return null;
                return `${Math.round((w / total) * 1000) / 10}%`;
            };
        }
        if (src === "betweenness") {
            // Edge betweenness (N13) — null above the honest node cap (falls silent,
            // never freezes; the gear note documents the cap).
            const ce = edgeBetweenness(st.model);
            return (li) => (ce ? String(Math.round(ce[li] * 100) / 100) : null);
        }
        return (li) => {
            if (src === "type") { const t = st.data.edges[li]?.type; return t != null ? String(t) : null; }
            const w = st.model.links[li].weight;
            return Number.isFinite(w) ? String(Math.round(w * 100) / 100) : null;
        };
    }

    private makeEdgeTypeAccessors(st: RenderState): { colorOf?: (i: number) => string | null; dashOf?: (i: number) => string | null } {
        if (!st.data.hasEdgeType || st.hc) return {};
        const pal = paletteByName(this.formattingSettings.colors.palette.value.value as string);
        const idxByType = new Map(st.data.edgeTypes.map((t, i) => [t, i]));
        const typeIdx = (li: number): number => {
            const t = st.data.edges[li]?.type;
            return t == null ? -1 : (idxByType.get(t) ?? 0);
        };
        return {
            colorOf: (li) => { const k = typeIdx(li); return k < 0 ? null : pal[k % pal.length]; },
            dashOf: (li) => { const k = typeIdx(li); return k < 0 ? null : EDGE_DASHES[k % EDGE_DASHES.length]; },
        };
    }

    /**
     * Link colour resolver (NG-133). Turns the Edges ▸ Link-colour mode into the
     * per-edge accessors the render paths consume, resolved against the FINAL node
     * colours so source/target/gradient links match their endpoint nodes exactly.
     *   · auto     → typed-edge palette (dashed), else theme grey (zero regression)
     *   · single   → one chosen colour for every link
     *   · source   → each link takes its source node's colour
     *   · target   → each link takes its target node's colour
     *   · gradient → source→target ramp (canvas falls back to the source colour)
     * `representative` is the single fallback/arrow/legend colour for the mode.
     * High-contrast forces theme colours (colour is a stripped a11y cue).
     */
    private makeEdgeColorAccessors(
        st: RenderState, surface: Surface, nodeColorOf: (i: number) => string,
        edgeType: { colorOf?: (i: number) => string | null; dashOf?: (i: number) => string | null },
    ): {
        colorOf?: (li: number) => string | null; colorEndOf?: (li: number) => string | null;
        gradient: boolean; dashOf?: (li: number) => string | null; representative: string;
    } {
        const s = this.formattingSettings;
        const links = st.model.links;
        const mode = st.hc ? "auto" : (s.edges.colorMode.value.value as string);
        switch (mode) {
            case "single": {
                const c = (s.edges.color.value.value as string) || surface.edge;
                return { colorOf: () => c, gradient: false, representative: c };
            }
            case "source":
                return { colorOf: (li) => nodeColorOf(links[li].source), gradient: false, representative: surface.edge };
            case "target":
                return { colorOf: (li) => nodeColorOf(links[li].target), gradient: false, representative: surface.edge };
            case "gradient":
                return {
                    colorOf: (li) => nodeColorOf(links[li].source),
                    colorEndOf: (li) => nodeColorOf(links[li].target),
                    gradient: true, representative: surface.edge,
                };
            default: // "auto" — the prior behaviour
                return { colorOf: edgeType.colorOf, dashOf: edgeType.dashOf, gradient: false, representative: surface.edge };
        }
    }

    // --- Pinned layout (C2) --------------------------------------------------
    /** Persist pin state + frozen positions (called by paint's first-pin path). */
    private persistPin(pinned: boolean, positions: string): void {
        this.host.persistProperties({
            merge: [{
                objectName: "pin",
                selector: null,
                properties: { pinned, positions },
            }],
        });
    }

    /** Persist the legend fold (NG-142) so it survives refresh / reopen. Optimistic:
     *  the caller has already flipped `this.legendCollapsed` and repainted; we hold the
     *  value in `pendingLegendCollapsed` until the host echoes it back. */
    private persistLegendCollapsed(collapsed: boolean): void {
        this.pendingLegendCollapsed = collapsed;
        this.host.persistProperties({
            merge: [{
                objectName: "colors",
                selector: null,
                properties: { legendCollapsed: collapsed },
            }],
        });
    }

    private currentLayoutSnapshot(): LayoutSnapshot {
        return {
            pinned: this.formattingSettings.pin.pinned.value,
            positions: this.storedPositions,
        };
    }

    /** Capture all report-authored state owned by this visual. */
    private captureAuthoringSnapshot(): AuthoringSnapshot {
        return {
            settings: this.toolbar.snapshotState(),
            layout: this.currentLayoutSnapshot(),
            rules: serializeRules(this.cfRules),
            notes: this.notes.toJSON(),
            legendCollapsed: this.legendCollapsed,
        };
    }

    private beginAuthoringChange(): void {
        if (!this.replayingHistory && !this.historyStart) {
            this.historyStart = this.captureAuthoringSnapshot();
        }
    }

    private commitAuthoringChange(): void {
        const before = this.historyStart;
        this.historyStart = null;
        this.commitAuthoringSnapshot(before);
    }

    /** Add one completed authored action. Identical before/after states are ignored
     *  (for example cancelling a new blank annotation). */
    private commitAuthoringSnapshot(before: AuthoringSnapshot | null): void {
        if (!before || this.replayingHistory) return;
        const after = this.captureAuthoringSnapshot();
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        this.undoHistory.push(before);
        if (this.undoHistory.length > 200) this.undoHistory.shift();
        this.redoHistory = [];
        this.syncHistoryControls();
    }

    /** History commits happen after the optimistic repaint, so refresh just the
     *  toolbar availability without forcing a second graph render. */
    private syncHistoryControls(): void {
        if (!this.lastRender) return;
        this.actionBar.setState(
            this.premium.active,
            this.undoHistory.length > 0,
            this.redoHistory.length > 0,
            this.formattingSettings.pin.pinned.value || this.storedPositions != null,
            this.downloadService() != null,
        );
    }

    /** Restore one complete authored state, persisting only domains that changed. */
    private applyAuthoringSnapshot(target: AuthoringSnapshot): void {
        const current = this.captureAuthoringSnapshot();
        this.replayingHistory = true;
        try {
            // Pin state + positions are one atomic layout domain below; restoring
            // the boolean through the settings adapter first would create a partial
            // host write with no positions blob.
            this.toolbar.restoreState(target.settings, new Set(["pin.pinned"]));

            if (JSON.stringify(current.layout) !== JSON.stringify(target.layout)) {
                this.storedPositions = target.layout.positions;
                this.formattingSettings.pin.pinned.value = target.layout.pinned;
                this.persistPin(target.layout.pinned, target.layout.positions ?? "");
            }

            if (current.rules !== target.rules) {
                this.cfRules = parseRules(target.rules);
                this.pendingRules = target.rules;
                this.persistRules(this.cfRules);
                this.rulesPanel.setRules(this.cfRules);
            }

            if (current.notes !== target.notes) {
                this.notes.load(target.notes);
                this.pendingNotes = target.notes;
                this.host.persistProperties({
                    merge: [{ objectName: "notesStore", selector: null, properties: { data: target.notes } }],
                } as powerbi.VisualObjectInstancesToPersist);
            }

            if (current.legendCollapsed !== target.legendCollapsed) {
                this.legendCollapsed = target.legendCollapsed;
                this.persistLegendCollapsed(target.legendCollapsed);
            }

            this.rerenderFromSettings(true);
        } finally {
            this.replayingHistory = false;
        }
    }

    /** ↩ Undo the last authored visual change. */
    private undoVisualChange(): void {
        // A toolbar click can happen while the note editor is open. Commit its
        // preview first so Undo targets that just-finished annotation action.
        if (this.noteEditor.isOpen()) this.noteEditor.commit();
        const previous = this.undoHistory.pop();
        if (!previous) return;
        this.redoHistory.push(this.captureAuthoringSnapshot());
        if (this.redoHistory.length > 200) this.redoHistory.shift();
        this.applyAuthoringSnapshot(previous);
    }

    /** ↪ Redo the most recently undone authored visual change. */
    private redoVisualChange(): void {
        // Committing a genuinely new note correctly invalidates the old redo branch;
        // committing an unchanged note is a no-op and leaves redo available.
        if (this.noteEditor.isOpen()) this.noteEditor.commit();
        const next = this.redoHistory.pop();
        if (!next) return;
        this.undoHistory.push(this.captureAuthoringSnapshot());
        if (this.undoHistory.length > 200) this.undoHistory.shift();
        this.applyAuthoringSnapshot(next);
    }

    /** Ctrl/Cmd+Z = undo; Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. */
    private onHistoryShortcut(event: KeyboardEvent): void {
        if (this.viewMode !== "graph" || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
        const target = event.target as HTMLElement | null;
        if (target && (
            target.isContentEditable
            || target.tagName === "INPUT"
            || target.tagName === "TEXTAREA"
            || target.tagName === "SELECT"
            || target.closest?.("[contenteditable='true']") != null
        )) return;

        const key = event.key.toLowerCase();
        const redo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
        const undo = key === "z" && !event.shiftKey;
        if ((!undo && !redo)
            || (undo && this.undoHistory.length === 0)
            || (redo && this.redoHistory.length === 0)) return;

        event.preventDefault();
        event.stopPropagation();
        if (redo) this.redoVisualChange();
        else this.undoVisualChange();
    }

    /** The host download service (privilege: ExportContent), or null where the
     *  host doesn't provide one. The tenant's export policy is enforced host-side. */
    private downloadService(): { exportVisualsContent: (content: string, fileName: string, fileType: string, fileDescription: string) => Promise<boolean> } | null {
        try {
            const dl = (this.host as unknown as {
                downloadService?: { exportVisualsContent?: (c: string, n: string, t: string, d: string) => Promise<boolean> };
            }).downloadService;
            return dl && typeof dl.exportVisualsContent === "function"
                ? (dl as { exportVisualsContent: (c: string, n: string, t: string, d: string) => Promise<boolean> })
                : null;
        } catch { return null; }
    }

    /** Export CSV, a snapshot+data PDF, a PNG snapshot, or a two-sheet workbook. */
    private async exportData(format: ExportFormat): Promise<void> {
        const dl = this.downloadService();
        const st = this.lastRender;
        if (!dl || !st) return;
        const nodeInput: NodeCsvInput = {
            model: st.model,
            attrs: st.data.attrs,
            hasCategory: st.data.hasCategory,
            community: st.community,
            centrality: st.centrality,
            centralityLabel: st.centrality ? centralityLabel(st.centralityMetric) : null,
        };
        const nodesCsv = buildNodesCsv(nodeInput);
        const edgeTypes = st.data.edges.map((e) => e.type ?? null);
        const edgesCsv = buildEdgesCsv(st.model, edgeTypes);
        try {
            if (format === "csv") {
                await dl.exportVisualsContent(nodesCsv, "network-nodes.csv", "csv", "Node metrics");
                await dl.exportVisualsContent(edgesCsv, "network-edges.csv", "csv", "Edge list");
                return;
            }
            if (format === "xlsx") {
                const workbook = buildWorkbookBase64([
                    { name: "Nodes", rows: buildNodeRows(nodeInput) },
                    { name: "Edges", rows: buildEdgeRows(st.model, edgeTypes) },
                ]);
                await dl.exportVisualsContent(workbook, "network-data.xlsx", "base64", "Node metrics and edge list");
                return;
            }

            const snapshot = await captureVisualSnapshot(
                this.svg.node()!,
                this.canvasActive ? this.canvasEl : null,
                st.width,
                st.height,
                this.surfaceFor(st.dark, st.hc).bg,
            );
            if (format === "png") {
                await dl.exportVisualsContent(snapshot.pngBase64, "network-snapshot.png", "base64", "Network visual snapshot");
                return;
            }
            const pdf = buildPdfBase64({
                jpegBase64: snapshot.jpegBase64,
                imageWidth: snapshot.width,
                imageHeight: snapshot.height,
                nodesCsv,
                edgesCsv,
            });
            await dl.exportVisualsContent(pdf, "network-report.pdf", "base64", "Network visual snapshot and data");
        } catch { /* host/tenant policy refused the download — nothing to clean up */ }
    }

    /** ⟲ Reset layout: unpin, drop authored positions, recompute fresh, re-fit. */
    private resetLayout(): void {
        const before = this.captureAuthoringSnapshot();
        this.storedPositions = null;
        this.formattingSettings.pin.pinned.value = false; // optimistic
        this.persistPin(false, "");
        this.zoom.reset();
        this.rerenderFromSettings(true);
        this.commitAuthoringSnapshot(before);
    }

    /** Persist the conditional-formatting rules blob (edited via the Rules panel). */
    private persistRules(rules: CFRule[]): void {
        this.host.persistProperties({
            merge: [{
                objectName: "cformat",
                selector: null,
                properties: { rules: serializeRules(rules) },
            }],
        });
    }

    // --- Selection sync ------------------------------------------------------
    private syncSelectionDim(): void {
        const st = this.lastRender;
        if (!st) return;
        // Canvas mode has no per-node SVG to dim — a full canvas redraw recomputes the
        // combined selection ∧ ranking ∧ ego dimming instead.
        if (this.canvasActive) { this.redrawCanvas(); return; }
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const anySelected = selected.length > 0;
        const isSelectedNode = (i: number): boolean => {
            const ids = st.idsByNode[i];
            return !!ids && ids.some((id) => selected.some((sid) => idEquals(sid, id)));
        };
        // Inbound cross-highlight (NG-228): another visual filtered THIS graph in
        // Highlight mode, so the categorical DataView carries a per-edge highlight mask.
        // Dim everything outside the highlighted set, combined with any local selection
        // (a node must satisfy BOTH predicates to stay fully lit).
        const hl = st.data.edgeHighlight;
        const hlActive = st.data.hasInboundHighlight === true && !!hl;
        const hlNodes = new Set<number>();
        if (hlActive) {
            for (let li = 0; li < st.model.links.length; li++) {
                if (hl![li]) { hlNodes.add(st.model.links[li].source); hlNodes.add(st.model.links[li].target); }
            }
        }
        const anyDim = anySelected || hlActive;
        const isKeptNode = (i: number): boolean =>
            (!anySelected || isSelectedNode(i)) && (!hlActive || hlNodes.has(i));
        const surface = this.surfaceFor(st.dark, st.hc);
        applySelectionDim(this.nodeGroup, this.edgeGroup, anyDim, isKeptNode,
            (li) => [st.model.links[li].source, st.model.links[li].target],
            st.hc ? (surface.selected || surface.fg) : undefined);
        // Ranking highlight is a persistent view state, not a transient hover. Reapply
        // it whenever selection/hover restoration rewrites node opacity and strokes.
        if (this.rankingAction() === "highlight") {
            const kept = this.rankedKeptSet(st);
            if (kept) this.applyRankingHighlight(st, kept);
        }
    }

    // --- Canvas scale-mode plumbing ------------------------------------------
    /** Edge truncation is opt-in. Zero/non-finite means all available relationship
     *  rows; any positive authored value is the deterministic first-N render cap. */
    private maxEdgeBudget(): number {
        const configured = Number(this.formattingSettings.scale.maxEdges.value);
        return Number.isFinite(configured) && configured > 0
            ? Math.max(1, Math.floor(configured))
            : Infinity;
    }

    /** Decide the render path. Auto flips to canvas past the node/edge threshold; the
     *  Renderer setting can force either way. Falls back to SVG if no 2D context. */
    private useCanvas(nodes: number, edges: number): boolean {
        if (!this.ctx) return false;
        const mode = this.formattingSettings.scale.renderMode.value.value as string;
        if (mode === "svg") return false;
        if (mode === "canvas") return true;
        const thr = Math.max(200, this.formattingSettings.scale.canvasThreshold.value || 1200);
        return nodes > thr || edges > thr * 3;
    }

    private dpr(): number { return (typeof window !== "undefined" && window.devicePixelRatio) || 1; }

    private sizeCanvas(w: number, h: number): void {
        if (!this.canvasEl) return;
        const dpr = this.dpr();
        this.canvasEl.width = Math.max(1, Math.round(w * dpr));
        this.canvasEl.height = Math.max(1, Math.round(h * dpr));
        this.canvasEl.style.width = `${w}px`;
        this.canvasEl.style.height = `${h}px`;
    }

    private clearCanvas(): void {
        if (!this.ctx || !this.canvasEl) return;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }

    /** Repaint the canvas from `canvasState` at the current zoom, recomputing the
     *  combined hide/dim set (selection ∧ ranking ∧ ego-focus) and the hover ring.
     *  Cheap enough to call on every zoom/pan/selection tick. */
    private redrawCanvas(): void {
        if (!this.ctx || !this.canvasState) return;
        const {
            st, geo, radiusOf, colorOf, nodeOpacity, edgeColor, edgeColorOf, edgeWidthOf, edgeCurve,
            edgeSuppressedOf, edgeSecondaryOf, nodeStroke, strokeOf, iconOf, hideEdges,
        } = this.canvasState;

        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const anySel = selected.length > 0;
        const searchMatches = this.searchMatchesOf(st);
        const rankKept = this.rankingAction() === "highlight" ? this.rankedKeptSet(st) : null;
        const rankMatches = rankKept ? (i: number): boolean => rankKept.has(i) : null;
        const isSel = (i: number): boolean => {
            const ids = st.idsByNode[i];
            return !!ids && ids.some((id) => selected.some((sid) => idEquals(sid, id)));
        };
        // Ranking Filter, ego focus and collapsed subtrees are hard hides. Ranking
        // Highlight is folded into the dim predicates below so the context remains.
        const isHiddenNode = this.canvasHiddenNodeOf(st);
        this.canvasState.isHiddenNode = isHiddenNode;
        const isHiddenEdge = (li: number): boolean => {
            const l = st.model.links[li];
            return !!edgeSuppressedOf?.(li) || isHiddenNode(l.source) || isHiddenNode(l.target);
        };
        const isSelectionDimNode = (i: number): boolean => anySel && !isSel(i);
        const isDimNode = (i: number): boolean =>
            isSelectionDimNode(i) || (!!searchMatches && !searchMatches(i))
            || (!!rankMatches && !rankMatches(i));
        const isDimEdge = (li: number): boolean => {
            const l = st.model.links[li];
            const selectionDim = isSelectionDimNode(l.source) || isSelectionDimNode(l.target);
            const searchDim = !!searchMatches && !searchMatches(l.source) && !searchMatches(l.target);
            // A ranked relationship is active only when both endpoints are active.
            // Using OR here dims the one-active/one-inactive boundary edges too.
            const rankDim = !!rankMatches && (!rankMatches(l.source) || !rankMatches(l.target));
            return selectionDim || searchDim || rankDim;
        };
        const highlightedStrokeOf = rankMatches
            ? (i: number): { color: string; width: number } | null =>
                rankMatches(i) ? { color: accent, width: 3 } : (strokeOf?.(i) ?? null)
            : strokeOf;

        drawGraphCanvas(this.ctx, st.model, {
            px: geo.px, radiusOf, colorOf, nodeOpacity, edgeColor, edgeColorOf,
            edgeWidthOf: (li) => edgeWidthOf(li), edgeCurve, edgeSecondaryOf,
            nodeStroke, strokeOf: highlightedStrokeOf, iconOf, hideEdges,
            width: st.width, height: st.height, dpr: this.dpr(),
            view: this.zoom.get(), isDimNode, isDimEdge, isHiddenNode, isHiddenEdge,
        });

        // A visibility change can happen without another pointer event. Do not leave
        // the old invisible node's ring or tooltip alive after that update.
        if (this.hoverNode != null && isHiddenNode(this.hoverNode)) {
            this.hoverNode = null;
            this.hideTooltip();
        }

        // Hover ring on top (canvas mode has no per-node SVG to outline).
        if (this.hoverNode != null && this.hoverNode < geo.px.length) {
            const z = this.zoom.get(), d = this.dpr(), c = geo.px[this.hoverNode];
            this.ctx.setTransform(z.k * d, 0, 0, z.k * d, z.tx * d, z.ty * d);
            this.ctx.globalAlpha = 1;
            this.ctx.strokeStyle = accent;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, radiusOf(this.hoverNode) + 3, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    /** Screen point → node index in canvas mode, via the fit + zoom transforms. */
    private pickCanvasNode(clientX: number, clientY: number): number {
        if (!this.canvasState) return -1;
        const rect = (this.svg.node() as Element).getBoundingClientRect();
        const z = this.zoom.get();
        const wx = ((clientX - rect.left) - z.tx) / z.k;
        const wy = ((clientY - rect.top) - z.ty) / z.k;
        return pickNodeAt(
            this.canvasState.geo.px,
            this.canvasState.radiusOf,
            wx,
            wy,
            this.canvasState.isHiddenNode,
        );
    }

    /** Hover (tooltip + ring) and click (cross-filter + optional full info) for canvas mode, bound
     *  once on the SVG surface (which sits over the click-through canvas). */
    private bindCanvasInteraction(st: RenderState): void {
        this.svg.on("mousemove.canvas", (event: MouseEvent) => {
            const i = this.pickCanvasNode(event.clientX, event.clientY);
            if (i >= 0) {
                // show() only on node ENTRY, move() while inside — re-showing the native
                // host tooltip every mousemove makes it flicker/vanish (NG-111).
                if (i !== this.hoverNode) {
                    this.hoverNode = i; this.redrawCanvas();
                    this.showTooltip(st, i, event.clientX, event.clientY);
                } else {
                    this.moveTooltip(st, i, event.clientX, event.clientY);
                }
            } else if (this.hoverNode != null) {
                this.hoverNode = null; this.redrawCanvas(); this.hideTooltip();
            }
        });
        this.svg.on("mouseleave.canvas", () => {
            if (this.hoverNode != null) { this.hoverNode = null; this.redrawCanvas(); }
            this.hideTooltip();
        });
        this.svg.on("click.canvas", (event: MouseEvent) => {
            const i = this.pickCanvasNode(event.clientX, event.clientY);
            if (i < 0) return; // empty space → the svg's own click clears selection
            event.stopPropagation();
            if (!event.altKey && !event.ctrlKey && !event.metaKey && this.onNodeActivate(st, i)) return;
            const ids = st.idsByNode[i] ?? [];
            if (ids.length) this.selectionManager.select(ids, event.ctrlKey || event.metaKey).then(() => this.syncSelectionDim());
            if (this.formattingSettings.nodes.showFullInfoOnClick.value) {
                this.openDetail(st, i, this.surfaceFor(st.dark, st.hc));
            }
        });
    }

    private unbindCanvasInteraction(): void {
        this.svg.on("mousemove.canvas", null).on("mouseleave.canvas", null).on("click.canvas", null);
        this.hoverNode = null;
    }

    // --- Tooltips: Zentrix branded card vs. Power BI NATIVE service -----------
    /** True when the user picked "Native" (value key "report"): hover defers entirely
     *  to Power BI's tooltip service, so the report's native Format-pane setting
     *  (General ▸ Tooltips ▸ Type = Default / Report page) decides what shows. */
    private tooltipNative(): boolean {
        return (this.formattingSettings.tooltip.type.value.value as string) === "report" && !!this.tooltipService;
    }

    /** Whether ANY hover tooltip should show. Two gates, checked before every show/move:
     *  1. Tooltip = "Off" — our own single control that reliably suppresses BOTH styles.
     *     This exists because the native Format-pane General ▸ Tooltips toggle can only
     *     reach the host tooltip service ("report" mode); Power BI exposes no readable
     *     state for that toggle, so a hand-rolled DOM card (`ZentrixOverlayTooltip`)
     *     cannot honour it — `tooltipService.enabled()` does NOT flip with it (NG-130).
     *  2. `tooltipService.enabled()` — kept as a best-effort host gate (and so an
     *     unavailable service fails open to shown). */
    private tooltipsEnabled(): boolean {
        if ((this.formattingSettings.tooltip.type.value.value as string) === "off") return false;
        return this.tooltipService ? this.tooltipService.enabled() : true;
    }

    /** Author-selected mix for both node information surfaces. */
    private nodeInfoMode(st: RenderState): NodeInfoMode {
        const value = this.formattingSettings.tooltip.contentMode.value.value as string;
        if (!st.data.hasTooltips && (value === "business" || value === "combined")) return "network";
        return value === "business" || value === "network" ? value : "combined";
    }

    /** Report-authored node fields, with bound column names and duplicate labels removed.
     *  Explicit Tooltips-well fields lead so authors control the card's primary context. */
    private nodeBusinessFields(st: RenderState, i: number): NodeInfoField[] {
        const attr = st.data.attrs[i];
        if (!attr) return [];
        const fields: NodeInfoField[] = [];
        const seen = new Set<string>();
        const push = (name: string, value: unknown): void => {
            if (value == null || String(value) === "") return;
            const key = name.trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            fields.push({ name, value: String(value) });
        };
        for (const field of attr.tooltips ?? []) push(field.name, field.value);
        push(st.data.roleNames.category ?? "Category", attr.category);
        push(st.data.roleNames.size ?? "Size", attr.size == null ? null : round2(attr.size));
        return fields;
    }

    /** Native-mode data items for a node — every row labelled by the BOUND FIELD's
     *  display name where one exists ("Employee : IC18"), falling back to a generic
     *  label only for computed metrics and unnamed columns (NG-111). */
    private nodeTooltipItems(st: RenderState, i: number): powerbi.extensibility.VisualTooltipDataItem[] {
        const n = st.model.nodes[i];
        const rn = st.data.roleNames;
        const items: powerbi.extensibility.VisualTooltipDataItem[] = [
            { displayName: rn.source ?? "Node", value: String(n.label) },
        ];
        const business = this.nodeBusinessFields(st, i);
        const mode = this.nodeInfoMode(st);
        const showBusiness = mode !== "network" && business.length > 0;
        const showNetwork = mode !== "business" || business.length === 0;
        if (showBusiness) {
            for (const field of business) items.push({ displayName: field.name, value: field.value });
        }
        if (showNetwork) {
            items.push(
                { displayName: "Connections", value: String(n.degree) },
                { displayName: "Incoming", value: String(n.inDegree) },
                { displayName: "Outgoing", value: String(n.outDegree) },
                { displayName: "Connection strength", value: String(round2(n.weightedDegree)) },
            );
        }
        return items;
    }

    /** Show a node tooltip. In "Native" mode we hand the node's data items + selection
     *  identities to the host tooltip service, so the report's native tooltip (default
     *  card or a bound report page, per the Format pane) shows filtered to that node;
     *  otherwise our rich in-visual Zentrix card. */
    private showTooltip(st: RenderState, i: number, x: number, y: number): void {
        if (!this.tooltipsEnabled()) return;
        if (this.tooltipNative()) {
            this.tooltipService!.show({ coordinates: [x, y], isTouchEvent: false, dataItems: this.nodeTooltipItems(st, i), identities: st.idsByNode[i] ?? [] });
            this.tooltip.hide();
        } else {
            const cen = st.centrality ? { label: centralityLabel(st.centralityMetric), value: st.centrality[i] } : null;
            const tooltipSurface = resolveSurface(st.dark, st.hc, this.hcRoles);
            const tooltipColorOf = this.makeColorAccessor(st, tooltipSurface);
            this.tooltip.show(
                st.model,
                i,
                x,
                y,
                cen,
                this.nodeBusinessFields(st, i),
                this.nodeInfoMode(st),
                topNeighbors(st.model, i, 6),
                {
                    accentColor: tooltipColorOf(i),
                    category: st.data.attrs[i]?.category,
                    connectionColor: (key) => {
                        const idx = st.model.indexByKey.get(key);
                        return idx == null ? tooltipSurface.nodeDefault : tooltipColorOf(idx);
                    },
                    showClickHint: this.formattingSettings.nodes.showFullInfoOnClick.value,
                },
            );
        }
    }

    private moveTooltip(st: RenderState, i: number, x: number, y: number): void {
        if (!this.tooltipsEnabled()) return;
        if (this.tooltipNative()) {
            // NG-111: move() must re-carry the REAL data items — a literal empty array
            // makes the host repaint the card with no content, so the native tooltip
            // showed as a blank white box the moment the pointer moved.
            this.tooltipService!.move({ coordinates: [x, y], isTouchEvent: false, dataItems: this.nodeTooltipItems(st, i), identities: st.idsByNode[i] ?? [] });
        } else {
            this.tooltip.move(x, y);
        }
    }

    /** Native-mode data items for an edge — field display names where bound (NG-111). */
    private edgeTooltipItems(st: RenderState, li: number): powerbi.extensibility.VisualTooltipDataItem[] {
        const edge = st.data.edges[li];
        const rn = st.data.roleNames;
        const items: powerbi.extensibility.VisualTooltipDataItem[] = [
            { displayName: rn.source ?? "Source", value: String(edge.source) },
            { displayName: rn.target ?? "Target", value: String(edge.target) },
            { displayName: rn.weight ?? "Weight", value: String(round2(edge.weight)) },
        ];
        if (edge.type != null && edge.type !== "") items.push({ displayName: rn.edgeType ?? "Type", value: String(edge.type) });
        const t = st.data.edgeTime[li];
        if (t != null) items.push({ displayName: rn.time ?? "Time", value: String(t) });
        return items;
    }

    /** Show an edge/link tooltip (NG hover on a relationship). In "Native" mode we hand
     *  the edge's data items + row identity to the host service, so the report's native
     *  tooltip (default or a bound report page) filters to that relationship; otherwise
     *  our in-visual Zentrix card lists source/target/weight/type. */
    private showEdgeTooltip(st: RenderState, li: number, x: number, y: number): void {
        const edge = st.data.edges[li];
        if (!edge || !this.tooltipsEnabled()) return;
        if (this.tooltipNative()) {
            const id = st.idsByEdge[li];
            this.tooltipService!.show({ coordinates: [x, y], isTouchEvent: false, dataItems: this.edgeTooltipItems(st, li), identities: id ? [id] : [] });
            this.tooltip.hide();
        } else {
            const t = st.data.edgeTime[li];
            const extra = t != null ? [{ name: "Time", value: String(t) }] : undefined;
            this.tooltip.showEdge(edge, x, y, extra);
        }
    }

    private moveEdgeTooltip(st: RenderState, li: number, x: number, y: number): void {
        if (!st.data.edges[li] || !this.tooltipsEnabled()) return;
        if (this.tooltipNative()) {
            const id = st.idsByEdge[li];
            // NG-111: same as moveTooltip — empty dataItems blanked the native card.
            this.tooltipService!.move({ coordinates: [x, y], isTouchEvent: false, dataItems: this.edgeTooltipItems(st, li), identities: id ? [id] : [] });
        } else {
            this.tooltip.move(x, y);
        }
    }

    private hideTooltip(): void {
        this.tooltip.hide();
        if (this.tooltipService) this.tooltipService.hide({ immediately: false, isTouchEvent: false });
    }

    private buildSelectionIds(dataView: DataView, model: GraphModel, data: GraphData): { idsByNode: ISelectionId[][]; idsByEdge: ISelectionId[] } {
        // One selection id per edge row, reused across the nodes it touches AND as the
        // per-edge id (NG-076). rowIds may be missing for a row the transform dropped.
        // Dual-path (NG-228): `table` mapping → withTable(rowIndex); `categorical`
        // mapping (production, delivers highlights) → withCategory on the source/target
        // category scope for that row.
        let rowIds: ISelectionId[];
        const table = dataView.table;
        const cats = dataView.categorical?.categories;
        if (table) {
            rowIds = table.rows.map((_, ri) =>
                this.host.createSelectionIdBuilder().withTable(table, ri).createSelectionId());
        } else if (cats && cats.length) {
            const n = cats[0].values?.length ?? 0;
            rowIds = [];
            for (let ri = 0; ri < n; ri++) {
                let b = this.host.createSelectionIdBuilder();
                for (const c of cats) b = b.withCategory(c, ri);
                rowIds.push(b.createSelectionId());
            }
        } else {
            rowIds = [];
        }
        const idsByNode = model.nodes.map((_, i) => (data.attrs[i]?.rowIndices ?? []).map((ri) => rowIds[ri]));
        const idsByEdge = data.edgeRowIndex.map((ri) => rowIds[ri]);
        return { idsByNode, idsByEdge };
    }

    /** Colour-legend section (R1, NG-113) — categorical swatch rows (with per-group
     *  node counts) or a gradient bar, composed into the combined legend card by
     *  renderOverlayChrome. Returns null when the active mode has nothing to show. */
    private legendSection(st: RenderState, _surface: Surface): LegendSection | null {
        const s = this.formattingSettings;
        const mode = (s.colors.mode.value.value as ColorMode) ?? "category";
        const rev = Boolean(s.colors.reverse.value);
        const paletteName = this.effectivePaletteName(st);
        const palette = reverseIf(paletteByName(paletteName), rev);
        const rawScale = scaleByName(paletteName);
        const scaleStops = rawScale ? reverseIf(rawScale, rev) : null;
        // Gradient bar for continuous modes: sample the named scale, or the custom 2-stop.
        const gradient = (min: number, max: number, title: string, stops: string[] | null): LegendSection => {
            let gLow = (s.colors.gradientLow.value.value as string) || "#EEE9FF";
            let gHigh = (s.colors.gradientHigh.value.value as string) || (s.nodes.defaultColor.value.value as string);
            if (rev && !stops) { const t = gLow; gLow = gHigh; gHigh = t; }
            return { kind: "gradient", title, low: gLow, high: gHigh, minLabel: String(round2(min)), maxLabel: String(round2(max)), stops: stops ?? undefined };
        };
        // Custom multi-stop gradient overrides the mode: show the driver's range along the
        // custom stops (matches makeColorAccessor's takeover). Same reverse handling.
        const customStops = this.customGradientStops();
        if (customStops) {
            const { min, max, label } = this.measureRange(st);
            return gradient(min, max, label, reverseIf(customStops, rev));
        }
        // Legend interactivity (N6): rows cross-filter the group's nodes on click
        // (toggle). `groupOf(i)` maps a node index to its legend item index.
        const interactiveFor = (legendMode: string, groupOf: (i: number) => number) => ({
            onClick: (item: number) => this.legendPick(st, legendMode, item, groupOf),
            active: this.legendActive?.startsWith(`${legendMode}:`)
                ? Number(this.legendActive.slice(legendMode.length + 1))
                : null,
        });
        // Per-group node counts — the right-aligned numbers in the redesigned rows.
        const countsBy = (groupOf: (i: number) => number, n: number): number[] => {
            const counts = new Array<number>(n).fill(0);
            for (let i = 0; i < st.model.nodes.length; i++) {
                const gi = groupOf(i);
                if (gi >= 0 && gi < n) counts[gi]++;
            }
            return counts;
        };
        const swatches = (
            title: string, labels: string[], legendMode: string, groupOf: (i: number) => number,
        ): LegendSection => {
            const counts = countsBy(groupOf, labels.length);
            return {
                kind: "swatch", title,
                items: labels.map((label, i) => ({ label, color: palette[i % palette.length], count: counts[i] })),
                interactive: interactiveFor(legendMode, groupOf),
            };
        };
        if (mode === "category" && st.data.hasCategory && st.data.categories.length) {
            const catIdx = categoryIndex(st.data.categories);
            const groupOf = (i: number): number => {
                const c = st.data.attrs[i]?.category;
                return c == null ? -1 : (catIdx.get(String(c)) ?? -1);
            };
            return swatches("Category", st.data.categories, "category", groupOf);
        } else if (mode === "cluster" && st.community) {
            const count = Math.max(0, ...st.community) + 1;
            const labels = Array.from({ length: count }, (_, i) => `Cluster ${i + 1}`);
            return swatches("Clusters", labels, "cluster", (i) => st.community![i] ?? -1);
        } else if (mode === "component") {
            const count = Math.max(1, st.model.componentCount);
            const labels = Array.from({ length: count }, (_, i) => `Component ${i + 1}`);
            return swatches("Components", labels, "component", (i) => st.model.nodes[i].component);
        } else if (mode === "level") {
            const depths = this.nodeDepths(st);
            const maxD = depths.reduce((a, b) => (b > a ? b : a), 0);
            if ((s.colors.levelStyle.value.value as string) === "ramp") {
                return gradient(1, maxD + 1, "Level", scaleStops);
            }
            const labels = Array.from({ length: maxD + 1 }, (_, i) => `Level ${i + 1}`);
            return swatches("Levels", labels, "level", (i) => depths[i] ?? -1);
        } else if (mode === "measure") {
            const { min, max, label } = this.measureRange(st);
            return gradient(min, max, label, scaleStops);
        }
        return null;
    }

    /** Legend row click (N6): toggle a cross-filter on every node in the clicked
     *  group. Re-clicking the active row (while a selection is live) clears it.
     *  Selection state stays the single source of truth — an empty selection means
     *  the stored toggle is stale (canvas click cleared it), so click = fresh select. */
    private legendPick(st: RenderState, legendMode: string, item: number, groupOf: (i: number) => number): void {
        const key = `${legendMode}:${item}`;
        const current = this.selectionManager.getSelectionIds();
        if (this.legendActive === key && current.length) {
            this.legendActive = null;
            this.selectionManager.clear().then(() => {
                this.syncSelectionDim();
                this.renderOverlayChrome(st);
            });
            return;
        }
        const ids: ISelectionId[] = [];
        for (let i = 0; i < st.model.nodes.length; i++) {
            if (groupOf(i) === item) ids.push(...(st.idsByNode[i] ?? []));
        }
        if (!ids.length) return;
        this.legendActive = key;
        this.selectionManager.select(ids, false).then(() => {
            this.syncSelectionDim();
            this.renderOverlayChrome(st); // repaint the legend's active/dim rows
        });
    }

    /** Click a cluster hull → cross-filter every node in that community (E2). */
    private clusterPick(st: RenderState, cluster: number): void {
        if (!st.community) return;
        const ids: ISelectionId[] = [];
        for (let i = 0; i < st.model.nodes.length; i++) {
            if (st.community[i] === cluster) ids.push(...(st.idsByNode[i] ?? []));
        }
        if (!ids.length) return;
        this.selectionManager.select(ids, false).then(() => this.syncSelectionDim());
    }

    /** Hover a cluster hull → emphasise its nodes, dim the rest. Restored on mouse-out
     *  by syncSelectionDim() (which resets opacities to the selection state). */
    private emphasizeCluster(st: RenderState, cluster: number): void {
        if (!st.community || this.canvasActive) return;
        const inCluster = (i: number): boolean => st.community![i] === cluster;
        this.nodeGroup.selectAll<SVGGraphicsElement, number>(".node")
            .attr("opacity", (i) => (inCluster(i) ? 1 : 0.12));
        this.edgeGroup.selectAll<SVGPathElement, number>("path.edge")
            .attr("stroke-opacity", (li) => {
                const l = st.model.links[li];
                return inCluster(l.source) && inCluster(l.target) ? 0.7 : 0.06;
            });
        this.edgeGroup.selectAll<SVGPathElement, { edge: number }>("path.arrowhead")
            .attr("fill-opacity", (h) => {
                const l = st.model.links[h.edge];
                return l && inCluster(l.source) && inCluster(l.target) ? 0.7 : 0.06;
            });
    }

    /** Caption for a cluster: the dominant Node-category value (category mode) or
     *  "Cluster N", optionally suffixed with the node count. */
    private clusterLabel(st: RenderState, cluster: number, withSize: boolean): string {
        if (!st.community) return "";
        let count = 0;
        const catCount = new Map<string, number>();
        for (let i = 0; i < st.model.nodes.length; i++) {
            if (st.community[i] !== cluster) continue;
            count++;
            const c = st.data.attrs[i]?.category;
            if (c != null) catCount.set(String(c), (catCount.get(String(c)) ?? 0) + 1);
        }
        let name = `Cluster ${cluster + 1}`;
        if (this.formattingSettings.clusters.clusterBy.value.value === "category" && catCount.size) {
            let best = "", bestN = -1;
            for (const [k, n] of catCount) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n; }
            name = best;
        }
        return withSize ? `${name} (${count})` : name;
    }

    // --- Empty/fatal states -------------------------------------------------
    private renderEmptyState(reason: EmptyReason, w: number, h: number, surface: Surface): void {
        const copy: Record<EmptyReason, { title: string; detail: string }> = {
            noData: {
                title: "Add Source node and Target node fields to render the network",
                detail: "Optional: add an Edge weight measure to size relationships by value",
            },
            needSource: {
                title: "Add a Source node field to render the network",
                detail: "Source data defines where each relationship begins",
            },
            needTarget: {
                title: "Add a Target node field to render the network",
                detail: "Target data defines where each relationship ends",
            },
            noRows: {
                title: "No nodes match the current filters",
                detail: "Adjust the slicers or filters on this report to bring relationships back into view",
            },
        };
        const message = copy[reason];
        this.overlayGroup.append("text")
            .attr("x", w / 2).attr("y", h / 2 - 8)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", fontFamily).attr("font-size", 13)
            .attr("font-weight", 600)
            .attr("fill", surface.fg)
            .text(message.title);
        this.overlayGroup.append("text")
            .attr("x", w / 2).attr("y", h / 2 + 16)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", fontFamily).attr("font-size", 11)
            .attr("fill", surface.muted)
            .text(message.detail);
    }

    private renderFatal(w: number, h: number): void {
        try {
            this.clearLayers();
            this.overlayGroup.append("text")
                .attr("x", w / 2).attr("y", h / 2).attr("text-anchor", "middle")
                .attr("font-family", fontFamily).attr("font-size", 13).attr("fill", "#B00020")
                .text("Unable to render the network graph");
        } catch { /* last-resort guard */ }
    }

    private clearLayers(): void {
        // The geo basemap and node annotations live in their own zoom-group layers and
        // are re-drawn later on the success render path (basemap after the fit; notes with
        // the node positions). They MUST be cleared here too, or an empty/fatal state — e.g.
        // removing the Source or Target field after a geo render — leaves the world map (or
        // orphaned notes) sitting behind the empty-state message.
        this.basemapGroup.selectAll("*").remove();
        this.hullGroup.selectAll("*").remove();
        this.edgeGroup.selectAll("*").remove();
        this.nodeGroup.selectAll("*").remove();
        this.motionGroup.selectAll("*").remove();
        this.valueGroup.selectAll("*").remove();
        this.labelGroup.selectAll("*").remove();
        this.foldIndicatorGroup.selectAll("*").remove();
        this.clusterLabelGroup.selectAll("*").remove();
        this.notesGroup.selectAll("*").remove();
        this.overlayGroup.selectAll("*").remove();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}

/** Read the persisted positions blob from the DataView metadata objects. */
function readStoredPositions(dataView: DataView): string | null {
    const objs = dataView.metadata && dataView.metadata.objects;
    const pin = objs && (objs as Record<string, powerbi.DataViewObject>).pin;
    const v = pin && (pin as powerbi.DataViewObject).positions;
    if (v == null) return null;
    return typeof v === "string" ? v : String(v);
}

/** Read the persisted conditional-formatting rules blob from DataView metadata. */
function readStoredRules(dataView: DataView): string | null {
    const objs = dataView.metadata && dataView.metadata.objects;
    const cf = objs && (objs as Record<string, powerbi.DataViewObject>).cformat;
    const v = cf && (cf as powerbi.DataViewObject).rules;
    if (v == null) return null;
    return typeof v === "string" ? v : String(v);
}

/** Whether the author has explicitly persisted any of `props` on `object` (NG-239/NG-242).
 *  The signal is the *presence* of the property in the persisted object, never its value —
 *  persistProperties writes the key on any edit, so a deliberate value that happens to equal
 *  the default (radius Max 40, curvature 0) is indistinguishable from untouched by value
 *  alone. Presence is not. Used to let an explicit author value override a mode's smart
 *  default (e.g. Tree's automatic max curvature) without the "typed the default" trap. */
function readObjectAuthored(dataView: DataView, object: string, props: readonly string[]): boolean {
    const objs = dataView.metadata && dataView.metadata.objects;
    const obj = objs && (objs as Record<string, powerbi.DataViewObject>)[object];
    if (!obj) return false;
    return props.some((p) => (obj as powerbi.DataViewObject)[p] !== undefined);
}

/** Read the persisted legend-fold flag from DataView metadata (NG-142). Absent = open. */
function readLegendCollapsed(dataView: DataView): boolean {
    const objs = dataView.metadata && dataView.metadata.objects;
    const colors = objs && (objs as Record<string, powerbi.DataViewObject>).colors;
    const v = colors && (colors as powerbi.DataViewObject).legendCollapsed;
    return v === true;
}

/** ISelectionId equality that tolerates hosts where `.equals` is absent. */
function idEquals(a: ISelectionId, b: ISelectionId): boolean {
    const ae = a as unknown as { equals?: (o: ISelectionId) => boolean };
    return typeof ae.equals === "function" ? ae.equals(b) : a === b;
}
