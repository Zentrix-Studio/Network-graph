"use strict";

import { hashKey } from "./rng";

/**
 * Shared calculation infrastructure — the performance backbone Release A builds
 * ONCE so later analytical features (simulation, comparison, deeper centrality)
 * don't each grow their own ad-hoc limits. NG-128. Pure and deterministic: no
 * Power BI imports, no wall-clock, no `Math.random`. Budgets are op-counts (not
 * milliseconds) precisely so the jsdom sweep stays reproducible.
 *
 * Four primitives:
 *   1. Size policy      — a V·E cost estimate → small/medium/large tier.
 *   2. Calc plan        — per-metric exact / approximate / disabled decision, with
 *                         a HASH-SEEDED sample count so approximation is repeatable.
 *   3. Cancel token     — cooperative cancellation a long loop checks between chunks.
 *   4. Op budget + cache— a spend-counter and a deterministic memo with prefix
 *                         invalidation, so repeated recompute during filtering is cheap.
 */

/* ── 1 · Size policy ─────────────────────────────────────────────────────── */

export type SizeTier = "small" | "medium" | "large";

/** Cost thresholds. Defaults are conservative for exact Brandes under a browser
 *  main thread; tune with benchmark fixtures (Release-A exit criterion). */
export interface SizePolicy {
    /** cost ≤ this ⇒ small (exact runs automatically). */
    smallMaxCost: number;
    /** cost ≤ this ⇒ medium (exact on demand; approximate by default). Above ⇒ large. */
    mediumMaxCost: number;
    /** Above this cost, even approximate all-pairs work is disabled. */
    hardMaxCost: number;
}

export const DEFAULT_SIZE_POLICY: SizePolicy = {
    smallMaxCost: 2_000_000, // ~1.4k nodes × 1.4k edges
    mediumMaxCost: 40_000_000,
    hardMaxCost: 5_000_000_000,
};

/** Cost of an all-pairs / Brandes-style pass: O(V·E). The gate keys on BOTH V and
 *  E — a sparse 30k-node graph and a dense 2k-node one are worlds apart. */
export function estimateBrandesCost(nodes: number, edges: number): number {
    const v = Math.max(0, Math.floor(nodes));
    const e = Math.max(0, Math.floor(edges));
    return v * e;
}

export function classifySize(cost: number, policy: SizePolicy = DEFAULT_SIZE_POLICY): SizeTier {
    if (cost <= policy.smallMaxCost) return "small";
    if (cost <= policy.mediumMaxCost) return "medium";
    return "large";
}

/* ── 2 · Per-metric calculation plan ─────────────────────────────────────── */

/** Which metrics are cheap enough to always run exactly vs. cost-gated. */
type MetricCostClass = "cheap" | "allPairs";
const METRIC_COST: Record<string, MetricCostClass> = {
    degree: "cheap", // O(V) — always exact
    pagerank: "cheap", // O(iter·E) — always exact
    closeness: "allPairs", // BFS/Dijkstra from every source — gated
    betweenness: "allPairs", // Brandes — gated
};

export type CalcMode = "exact" | "approximate" | "disabled";

export interface CalcPlan {
    mode: CalcMode;
    tier: SizeTier;
    estimatedCost: number;
    /** True when exact is offered as an explicit on-demand action (medium tier). */
    exactAvailableOnDemand: boolean;
    /** Approximate mode only: number of sampled BFS sources for Brandes sampling. */
    sampleSources?: number;
    /** Approximate mode only: deterministic seed (hash of the graph signature). */
    seed?: number;
    /** Short, user-facing reason — surfaced next to the metric ("Approximate · …"). */
    reason: string;
}

export interface CalcPlanOpts {
    policy?: SizePolicy;
    /** Sample budget per tier for approximate all-pairs work. */
    mediumSamples?: number;
    largeSamples?: number;
}

/**
 * Decide how a metric should be computed for a graph of this size. Cheap metrics
 * are always exact. All-pairs metrics follow the CEO's tiered policy: small →
 * exact; medium → approximate by default with exact on demand; large → approximate
 * (hash-seeded); beyond `hardMaxCost` → disabled with a reason. The seed is derived
 * from the graph's (V,E) signature, so the same graph always draws the same sample.
 */
export function centralityPlan(
    metric: string, nodes: number, edges: number, opts: CalcPlanOpts = {},
): CalcPlan {
    const policy = opts.policy ?? DEFAULT_SIZE_POLICY;
    const cost = estimateBrandesCost(nodes, edges);
    const tier = classifySize(cost, policy);
    const costClass = METRIC_COST[metric] ?? "allPairs";

    if (costClass === "cheap") {
        return { mode: "exact", tier, estimatedCost: cost, exactAvailableOnDemand: false, reason: "Exact" };
    }
    if (cost > policy.hardMaxCost) {
        return {
            mode: "disabled", tier, estimatedCost: cost, exactAvailableOnDemand: false,
            reason: "Disabled — graph too large for a reliable calculation",
        };
    }
    if (tier === "small") {
        return { mode: "exact", tier, estimatedCost: cost, exactAvailableOnDemand: false, reason: "Exact" };
    }
    // medium + large ⇒ approximate by default; medium also offers exact on demand.
    const samples = tier === "medium" ? (opts.mediumSamples ?? 256) : (opts.largeSamples ?? 128);
    const sampleSources = Math.max(1, Math.min(Math.floor(nodes), samples));
    const seed = hashKey(`${metric}:${Math.floor(nodes)}x${Math.floor(edges)}`);
    return {
        mode: "approximate", tier, estimatedCost: cost,
        exactAvailableOnDemand: tier === "medium",
        sampleSources, seed,
        reason: `Approximate — ${sampleSources.toLocaleString("en-US")} sampled sources · seed ${seed}`,
    };
}

/* ── 3 · Cooperative cancellation ────────────────────────────────────────── */

export interface CancelToken {
    readonly cancelled: boolean;
}
export interface CancelSource {
    readonly token: CancelToken;
    cancel(): void;
}

/** A cooperative cancellation source. A long loop checks `token.cancelled` between
 *  chunks and bails; nothing is pre-empted forcibly. */
export function createCancelSource(): CancelSource {
    let cancelled = false;
    return {
        token: { get cancelled() { return cancelled; } },
        cancel() { cancelled = true; },
    };
}

/* ── 4 · Op budget + deterministic cache ─────────────────────────────────── */

export interface OpBudget {
    readonly limit: number;
    used(): number;
    /** Spend `n` ops (default 1). Returns true while still within budget. */
    spend(n?: number): boolean;
    exhausted(): boolean;
}

/** An operation-count budget (deterministic — no timers). A loop does
 *  `if (!budget.spend() || token.cancelled) break;` to stay bounded. */
export function createOpBudget(limit: number): OpBudget {
    const cap = Math.max(0, Math.floor(limit));
    let used = 0;
    return {
        limit: cap,
        used: () => used,
        spend(n = 1) { used += Math.max(0, Math.floor(n)); return used <= cap; },
        exhausted: () => used >= cap,
    };
}

/** Build a deterministic cache signature from primitive parts (order-sensitive). */
export function calcSignature(parts: (string | number | boolean)[]): string {
    return parts.map((p) => String(p)).join("|");
}

export interface CalcCache<T> {
    get(key: string): T | undefined;
    has(key: string): boolean;
    set(key: string, value: T): void;
    /** Drop every entry whose key starts with `prefix` — the invalidation rule
     *  (e.g. invalidate "centrality|" when the graph changes, keep layout cached). */
    invalidate(prefix: string): void;
    clear(): void;
    readonly size: number;
}

export function createCalcCache<T>(): CalcCache<T> {
    const m = new Map<string, T>();
    return {
        get: (k) => m.get(k),
        has: (k) => m.has(k),
        set: (k, v) => { m.set(k, v); },
        invalidate(prefix) {
            for (const k of Array.from(m.keys())) if (k.startsWith(prefix)) m.delete(k);
        },
        clear() { m.clear(); },
        get size() { return m.size; },
    };
}

/** Memoise `fn` under `key` in `cache`; computes once, returns the cached value after. */
export function computeCached<T>(cache: CalcCache<T>, key: string, fn: () => T): T {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const val = fn();
    cache.set(key, val);
    return val;
}
