"use strict";

/**
 * Three-tier capability gate wired to Power BI's transactable Licensing API (API ≥ 4.7).
 *
 * MODEL (CEO 2026-08-05): gate **capability, not looks**. Everything that makes a
 * screenshot look good is free (drives installs → AppSource ranking); we charge for
 * the three things buyers expense — analysis (algorithms), scale (big graphs), and
 * production (things that make a report repeatable/deployable). Three tiers:
 *
 *   free       — a genuinely good-looking, fully interactive network up to the free
 *                node/edge cap. All shapes, icons, patterns, palettes, labels,
 *                cross-filter, tooltips, legends, search, Top/Bottom-N filter.
 *   pro        — analytics + production on small/medium graphs: centrality metrics,
 *                community/component colouring, custom gradient builder, Rules,
 *                Insights, flow animation, Pin layout, drill/expand, network tooltip.
 *   enterprise — scale + heavy analysis + deploy: clustering/hulls/meta-nodes,
 *                renderer/canvas/max-edges/load-30k/minimap, Explore, Path, Time,
 *                Geo + outline map, Annotations, and the uncapped full graph.
 *
 * NO WATERMARK. We gate OR watermark, never both (the prior NG-272 watermark is
 * intentionally not reinstated here). The base graph always renders — the gate never
 * blocks rendering and never throws into update().
 *
 * FAIL-OPEN on every safe path: unsupported host/env, unavailable licence info
 * (signed-out/offline Desktop), or any licence-API error all resolve to the TOP tier
 * (enterprise). Enforcement is edit-mode only — **viewers are free** (CEO 2026-07-23,
 * the anti-ZoomCharts wedge; their per-viewer seat + 20-user minimum is the
 * most-resented policy in the category). A published visual cannot be end-to-end
 * licence-tested, so the policy is a PURE function (`evaluateTier`) pinned by
 * mocked-API tests; give the reviewer licence info in "Notes for certification".
 *
 * UX: the visual never draws its own licensing UI. When enforcement is on and no
 * usable plan exists we raise Power BI's predefined notification; a blocked feature
 * click raises the predefined `notifyFeatureBlocked` banner. Never our own chrome.
 */

import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

/* ── tiers ── */
export type Tier = "free" | "pro" | "enterprise";
const RANK: Record<Tier, number> = { free: 0, pro: 1, enterprise: 2 };
/** True when `current` is at or above the `required` tier. */
export function meetsTier(current: Tier, required: Tier): boolean {
    return RANK[current] >= RANK[required];
}

/* ── the feature → required-tier map (single source of truth) ──
 * Both visual.ts (runtime gating) and settingsSchema.ts (gear dimming) read this,
 * so the split can never drift between "the control is greyed" and "the feature
 * actually runs". Anything NOT listed here is free by construction. */
export type Feature =
    // Enterprise — scale + heavy analysis + deploy
    | "fullGraph"        // uncapped node/edge count
    | "clusters"         // clustering, hulls, meta-nodes, group-by
    | "scale"            // renderer / canvas threshold / max-edges / load-30k
    | "minimap"
    | "explore"          // ego-focus exploration
    | "path"             // shortest-path analysis
    | "temporal"         // time animation
    | "geo"              // geo layout + outline map
    | "annotations"
    // Pro — analytics + production on small/medium graphs
    | "centrality"       // centrality metrics + colour/size/rank-by them
    | "communityColor"   // Community / Component colour modes
    | "gradientBuilder"  // custom multi-stop node gradient
    | "rules"            // conditional-formatting rules
    | "insights"         // plain-English network read-out
    | "flow"             // animated edge flow
    | "drilldown"        // drill-down / expand-collapse click actions
    | "highlightFilter"  // Top/Bottom-N "Highlight" action
    | "iconByGroup"      // differentiated icon modes (by node type / field value / level);
                         //   applying ONE icon to all nodes is free
    | "patternByLevel"   // per-hierarchy-level fill textures; one pattern for all nodes is free
    | "innerLabels"      // in-node value labels
    | "labelBg"          // outer-label backgrounds (card / highlight / pill)
    | "networkTooltip"   // network-metrics tooltip content (business fields stay free)
    | "pin"              // pinned / frozen layout (report consistency)
    | "parents"          // parent-node emphasis
    | "showFullInfo"     // "Show full info" click action (detail panel)
    | "flowLabels";      // Inflow / Outflow / Total-flow label content

// The base hover tooltip (business fields) stays FREE — only its network-metrics content
// is Pro. Everything not listed here is free by construction (shapes, all palettes, all
// core colouring, outer name/value labels, cross-filter, legends, search, Top/Bottom-N
// Filter action, and every layout but Geo).
export const FEATURE_TIER: Record<Feature, Tier> = {
    fullGraph: "enterprise", clusters: "enterprise", scale: "enterprise",
    minimap: "enterprise", explore: "enterprise", path: "enterprise",
    temporal: "enterprise", geo: "enterprise", annotations: "enterprise",
    centrality: "pro", communityColor: "pro", gradientBuilder: "pro",
    rules: "pro", insights: "pro", flow: "pro",
    drilldown: "pro", highlightFilter: "pro",
    iconByGroup: "pro", patternByLevel: "pro", innerLabels: "pro", labelBg: "pro",
    networkTooltip: "pro", pin: "pro", parents: "pro", showFullInfo: "pro",
    flowLabels: "pro",
};

/** Per-tier data caps. A capped graph shows the honest "showing N of M nodes" notice —
 *  never a blank/error state. Free is deliberately small; Pro gets the visual's full
 *  interactive budget (2k nodes / 5k edges); Enterprise is uncapped (scale features). */
export const FREE_NODE_CAP = 500;
export const FREE_EDGE_CAP = 2000;
export const PRO_NODE_CAP = 2000;
export const PRO_EDGE_CAP = 5000;

/** Node/edge render caps for a tier (Infinity = uncapped). */
export function tierCaps(tier: Tier): { nodes: number; edges: number } {
    switch (tier) {
        case "enterprise": return { nodes: Infinity, edges: Infinity };
        case "pro": return { nodes: PRO_NODE_CAP, edges: PRO_EDGE_CAP };
        default: return { nodes: FREE_NODE_CAP, edges: FREE_EDGE_CAP };
    }
}

/* ── go-paid configuration ── */
/** TEST-ONLY tier override. Power BI Desktop (and any side-loaded, pre-publish visual)
 *  has no usable licensing service, so the gate ALWAYS fail-opens there — the locked
 *  experience can't be seen by side-loading. Set this to force a tier for a throwaway
 *  test build: "free" shows the locked/free experience anywhere, "enterprise" forces
 *  everything unlocked. **MUST be `null` for any production / AppSource build** (a
 *  non-null value bypasses the real licence check entirely). */
const FORCE_TIER: Tier | null = null;

/** Go-paid master switch. ON = enforce the tier gate. Ships enforcing; the AppSource
 *  plan(s) — with Microsoft's one-month free trial — MUST be live at go-live or every
 *  creator drops to the free tier. CEO-only switch. */
const LOCK_ON_NO_PLAN = true;
/** Viewers-free: enforce in edit/authoring mode only. Leave false unless the CEO
 *  reverses the 2026-07-23 decision to charge report viewers too. */
const ENFORCE_FOR_VIEWERS = false;

/** Only Active and Warning are usable licences (Microsoft: "all other states should
 *  be treated as not resulting in a usable license"). */
const USABLE_STATES = new Set<number>([
    1, // ServicePlanState.Active
    2, // ServicePlanState.Warning (grace period)
]);

/** Map a purchased plan's service-plan identifier → the tier it unlocks. Fill this in
 *  once Partner Center provisions the Pro / Enterprise plans. Until then a usable plan
 *  of an UNKNOWN identifier resolves to `enterprise` (paid = full, deliberately
 *  generous), and the free/paid split at runtime collapses to free vs full — the Pro
 *  middle tier is defined and ready but only becomes distinct once a Pro plan exists. */
const PLAN_TIERS: Record<string, Tier> = {
    // "zentrix-network-graph-pro": "pro",
    // "zentrix-network-graph-enterprise": "enterprise",
};

export interface LicenseInfoLike {
    plans?: { spIdentifier?: string; state?: number }[];
    isLicenseUnsupportedEnv?: boolean;
    isLicenseInfoAvailable?: boolean;
}

export interface TierDecision {
    /** Resolved tier for this session. */
    tier: Tier;
    /** Which predefined host notification to raise ("none" clears any). */
    notify: "none" | "required" | "unsupportedEnv";
}

/**
 * Pure tier evaluation — the entire policy in one testable function.
 * `editing` is true in edit/authoring mode (where viewers-free enforcement bites).
 */
export function evaluateTier(
    info: LicenseInfoLike | null | undefined,
    opts: { lockOnNoPlan: boolean; enforceForViewers: boolean; editing: boolean },
): TierDecision {
    // Master switch off → everything free, no notifications (pre-go-paid state).
    if (!opts.lockOnNoPlan) return { tier: "enterprise", notify: "none" };
    // Viewers-free: outside edit mode the gate never closes and never nags.
    if (!opts.editing && !opts.enforceForViewers) return { tier: "enterprise", notify: "none" };
    // No info at all (call failed) → fail open.
    if (!info) return { tier: "enterprise", notify: "none" };
    // Unsupported environment (Publish-to-web, embed, Report Server, …): licence
    // enforcement cannot work there — fail open, tag the env notification.
    if (info.isLicenseUnsupportedEnv) return { tier: "enterprise", notify: "unsupportedEnv" };
    // Licence info unavailable (signed-out / offline Desktop) → fail open.
    if (info.isLicenseInfoAvailable === false) return { tier: "enterprise", notify: "none" };
    const usable = Array.isArray(info.plans)
        ? info.plans.filter((p) => p && USABLE_STATES.has(p.state ?? -1))
        : [];
    if (!usable.length) return { tier: "free", notify: "required" };
    // Highest tier among usable plans; an unknown-but-usable plan → enterprise.
    let best: Tier = "free";
    for (const p of usable) {
        const t: Tier = (p.spIdentifier && PLAN_TIERS[p.spIdentifier]) || "enterprise";
        if (RANK[t] > RANK[best]) best = t;
    }
    return { tier: best, notify: "none" };
}

interface LicenseManagerLike {
    getAvailableServicePlans?: () => Promise<LicenseInfoLike>;
    notifyLicenseRequired?: (type: number) => Promise<boolean>;
    notifyFeatureBlocked?: (tooltip: string) => Promise<boolean>;
    clearLicenseNotification?: () => Promise<boolean>;
}

export class LicenseGate {
    /** Fail-open default: top tier until a licence check says otherwise. */
    private tierState: Tier = "enterprise";
    private lastNotified: TierDecision["notify"] = "none";

    constructor(private host: IVisualHost, private onResolved: () => void) { }

    /** The resolved tier for this session (fail-open to `enterprise`). A non-null
     *  FORCE_TIER (test builds only) overrides the live licence state entirely. */
    get tier(): Tier { return FORCE_TIER ?? this.tierState; }

    /** Whether a given feature is unlocked at the current tier. */
    allows(feature: Feature): boolean { return meetsTier(this.tier, FEATURE_TIER[feature]); }

    /** Node cap for the current tier (Free 500, Pro 2k, Enterprise ∞). */
    get nodeCap(): number { return tierCaps(this.tier).nodes; }
    /** Edge cap for the current tier (Free 2k, Pro 5k, Enterprise ∞). */
    get edgeCap(): number { return tierCaps(this.tier).edges; }

    /** Transient "this feature needs a licence" banner. Best-effort; fires only while
     *  gated (a fully-unlocked / fail-open session is a no-op). Uses Power BI's
     *  predefined `notifyFeatureBlocked` — never our own UI. The caller edge-triggers
     *  it so the banner isn't re-raised on every repaint. */
    blockFeature(tooltip: string): void {
        if (this.tier === "enterprise") return;
        try {
            const lm = (this.host as unknown as { licenseManager?: LicenseManagerLike }).licenseManager;
            void lm?.notifyFeatureBlocked?.(tooltip);
        } catch { /* cosmetic — never break the gate */ }
    }

    /**
     * Re-check the licence. Best-effort and fully guarded — any failure leaves the
     * gate at the TOP tier. `editing` comes from the host's viewMode (edit vs read).
     */
    refresh(editing = false): void {
        if (FORCE_TIER) { this.tierState = FORCE_TIER; return; } // test build — skip the licence check
        if (!LOCK_ON_NO_PLAN) { this.tierState = "enterprise"; return; }
        try {
            const lm = (this.host as unknown as { licenseManager?: LicenseManagerLike }).licenseManager;
            if (!lm || typeof lm.getAvailableServicePlans !== "function") {
                this.tierState = "enterprise"; // unsupported host → fail open
                return;
            }
            lm.getAvailableServicePlans()
                .then((info) => {
                    const d = evaluateTier(info, {
                        lockOnNoPlan: LOCK_ON_NO_PLAN,
                        enforceForViewers: ENFORCE_FOR_VIEWERS,
                        editing,
                    });
                    this.tierState = d.tier;
                    this.applyNotification(lm, d.notify);
                    // The repaint must NOT be inside this promise's failure path — a throw
                    // from rendering would otherwise hit the .catch below and silently
                    // revert the tier to enterprise, masking a real downgrade.
                    try { this.onResolved(); } catch { /* repaint failure never reverts the tier */ }
                })
                .catch(() => { this.tierState = "enterprise"; }); // licence-API error → fail open
        } catch {
            this.tierState = "enterprise";
        }
    }

    /** Raise/clear the PREDEFINED host notification (never our own UI). */
    private applyNotification(lm: LicenseManagerLike, notify: TierDecision["notify"]): void {
        if (notify === this.lastNotified) return;
        this.lastNotified = notify;
        try {
            if (notify === "required") void lm.notifyLicenseRequired?.(0);          // General
            else if (notify === "unsupportedEnv") void lm.notifyLicenseRequired?.(1); // UnsupportedEnv
            else void lm.clearLicenseNotification?.();
        } catch { /* notification is cosmetic — never let it break the gate */ }
    }
}
