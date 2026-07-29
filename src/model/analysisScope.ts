"use strict";

/**
 * AnalysisScope — the single source of truth for "what data does a stated result
 * actually cover?". Every metric, insight, tooltip, export line and accessible
 * summary derives its "visible / loaded / complete / filtered" wording from HERE
 * rather than each deciding independently (which is how a visual ends up saying
 * "the top connector" when it means "the top connector among the 30,000 rows that
 * happened to load"). Release A, NG-128.
 *
 * Pure and deterministic — NO Power BI imports. `src/visual.ts` assembles the raw
 * counts from the DataView + GraphModel and calls `buildAnalysisScope`; every
 * downstream layer consumes the classification helpers, never the raw fields.
 *
 * The four coverage states map to the CEO's Release-A distinction:
 *   complete → the full delivered network is analysed and shown
 *   partial  → the model holds more rows than were delivered (loading not drained)
 *   filtered → a report filter/slicer narrowed what the visual received
 *   subset   → fewer entities are displayed than were analysed (render/rank cap)
 * `isSampled` is a separate METHOD axis (approximate vs exact), not a coverage
 * state — an exact result over a partial network and an approximate result over a
 * complete one are different honesty claims, so they never collapse into one enum.
 */

/** Raw coverage counts for a single render. Consumed only via the helpers below. */
export interface AnalysisScope {
    /** Rows the visual has actually received this update (delivered, not the model total). */
    loadedRows: number;
    /** Model total when knowable (e.g. from segment metadata); omitted when it isn't. */
    availableRows?: number;
    /** Nodes that survived data-health filtering and entered the analysis. */
    analysedNodes: number;
    /** Edges (unique, post-health) that entered the analysis. */
    analysedEdges: number;
    /** Nodes actually drawn on the canvas (after render/rank caps). */
    displayedNodes: number;
    /** Edges actually drawn on the canvas. */
    displayedEdges: number;
    /** True once `fetchMoreData` has drained every segment (no more rows are coming). */
    isLoadingComplete: boolean;
    /** True when a report filter/slicer is narrowing the data the visual received. */
    isFiltered: boolean;
    /** True when a metric in play used an approximation rather than exact computation. */
    isSampled: boolean;
}

/** Coverage state for headline wording. Does NOT encode approximation (see `isSampled`). */
export type ScopeCompleteness = "complete" | "partial" | "filtered" | "subset";

/** Orthogonal boolean facts about a scope — for callers that need more than the headline. */
export interface ScopeFlags {
    /** More rows exist in the model than were delivered (loading not drained). */
    partiallyLoaded: boolean;
    /** Fewer entities are displayed than were analysed (a render or rank cap is hiding some). */
    subsetDisplayed: boolean;
    /** A metric used an approximation rather than an exact calculation. */
    sampled: boolean;
    /** A report filter/slicer is narrowing the visual's input. */
    filtered: boolean;
    /** The full delivered network is analysed and shown, exactly. */
    complete: boolean;
}

const clampInt = (n: unknown): number => {
    const v = typeof n === "number" && isFinite(n) ? Math.floor(n) : 0;
    return v < 0 ? 0 : v;
};

/**
 * Normalise raw counts into a safe `AnalysisScope` (non-negative integers; a
 * bogus `availableRows` below `loadedRows` is lifted to `loadedRows` so coverage
 * math never claims the model is smaller than what already arrived).
 */
export function buildAnalysisScope(raw: Partial<AnalysisScope>): AnalysisScope {
    const loadedRows = clampInt(raw.loadedRows);
    const analysedNodes = clampInt(raw.analysedNodes);
    const analysedEdges = clampInt(raw.analysedEdges);
    // Displayed can never exceed analysed — a cap only ever hides, never invents.
    const displayedNodes = Math.min(analysedNodes, clampInt(raw.displayedNodes));
    const displayedEdges = Math.min(analysedEdges, clampInt(raw.displayedEdges));
    const scope: AnalysisScope = {
        loadedRows,
        analysedNodes,
        analysedEdges,
        displayedNodes,
        displayedEdges,
        isLoadingComplete: raw.isLoadingComplete !== false, // default: assume drained
        isFiltered: raw.isFiltered === true,
        isSampled: raw.isSampled === true,
    };
    if (raw.availableRows != null && isFinite(raw.availableRows)) {
        scope.availableRows = Math.max(loadedRows, clampInt(raw.availableRows));
    }
    return scope;
}

/** True when the model is known to hold more rows than were delivered. */
export function scopePartiallyLoaded(s: AnalysisScope): boolean {
    if (!s.isLoadingComplete) return true;
    return s.availableRows != null && s.availableRows > s.loadedRows;
}

/** True when a render/rank cap is drawing fewer entities than were analysed. */
export function scopeSubsetDisplayed(s: AnalysisScope): boolean {
    return s.displayedEdges < s.analysedEdges || s.displayedNodes < s.analysedNodes;
}

/** The full flag set — for callers that need to compose their own wording. */
export function scopeFlags(s: AnalysisScope): ScopeFlags {
    const partiallyLoaded = scopePartiallyLoaded(s);
    const subsetDisplayed = scopeSubsetDisplayed(s);
    return {
        partiallyLoaded,
        subsetDisplayed,
        sampled: s.isSampled,
        filtered: s.isFiltered,
        complete: !partiallyLoaded && !subsetDisplayed && !s.isFiltered,
    };
}

/**
 * The single headline coverage state. Priority when several apply: a network the
 * visual literally cannot see all of (`partial`) is the most consequential caveat,
 * then intentional narrowing (`filtered`), then a display-only cap (`subset`).
 * Approximation is deliberately NOT part of this axis.
 */
export function primaryScope(s: AnalysisScope): ScopeCompleteness {
    if (scopePartiallyLoaded(s)) return "partial";
    if (s.isFiltered) return "filtered";
    if (scopeSubsetDisplayed(s)) return "subset";
    return "complete";
}

/**
 * The reusable suffix an insight appends to a ranking claim so it is honest by
 * construction — e.g. "the top connector" + `scopeQualifier` → "the top connector
 * in the visible subgraph". `complete` returns "" so callers can omit it cleanly.
 */
export function scopeQualifier(s: AnalysisScope): string {
    switch (primaryScope(s)) {
        case "partial": return "in the network loaded so far";
        case "filtered": return "in the filtered network";
        case "subset": return "in the visible subgraph";
        default: return "";
    }
}

const num = (n: number): string => Math.round(n).toLocaleString("en-US");

/**
 * A one-line, deterministic coverage note for provenance, exports and the accessible
 * summary — states rows delivered (of the model total when known), entities/relations
 * analysed, and how many are shown when a cap is hiding some. Never invents a total.
 */
export function scopeCoverageNote(s: AnalysisScope): string {
    const parts: string[] = [];
    if (s.availableRows != null && s.availableRows > s.loadedRows) {
        parts.push(`${num(s.loadedRows)} of ~${num(s.availableRows)} rows delivered`);
    } else {
        parts.push(`${num(s.loadedRows)} rows delivered`);
    }
    if (!s.isLoadingComplete) parts.push("loading incomplete");
    parts.push(`${num(s.analysedNodes)} entities / ${num(s.analysedEdges)} relationships analysed`);
    if (scopeSubsetDisplayed(s)) {
        parts.push(`${num(s.displayedNodes)} entities / ${num(s.displayedEdges)} relationships shown`);
    }
    if (s.isFiltered) parts.push("report filter active");
    return parts.join(" · ");
}
