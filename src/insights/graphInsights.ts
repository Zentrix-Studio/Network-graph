"use strict";

/**
 * Deterministic graph-insight engine (Enterprise E6). Zero rendering deps, pure
 * — the network-graph analog of the heatmap's insight engine. Surfaces the
 * "so what" of a graph: hubs, bridges, fragmentation, and density. Every result
 * is reproducible for the same DataView (fixed node/edge order throughout).
 */

import { GraphModel } from "../model/graphTypes";
import { detectCommunities } from "../model/clustering";
import { betweennessCentrality } from "../model/centrality";

/** Tone drives the cue dot colour; importance bolds the highest-signal lines.
 *  Mirrors the heatmap insight card so both visuals read as one system. */
export type InsightTone = "positive" | "negative" | "neutral";
export type InsightImportance = "high" | "normal";

export interface Insight {
    kind: "hub" | "bridge" | "components" | "density";
    text: string;
    tone: InsightTone;
    importance: InsightImportance;
}

/** Ranked narrative insights for the graph. */
export function computeInsights(model: GraphModel): Insight[] {
    const out: Insight[] = [];
    const n = model.nodes.length;
    if (n === 0) return out;

    // Hub — highest-degree node (ties → lowest index, i.e. first-seen). The headline
    // takeaway of most graphs → neutral tone (a fact, not good/bad), high importance.
    let hub = 0;
    for (let i = 1; i < n; i++) if (model.nodes[i].degree > model.nodes[hub].degree) hub = i;
    if (model.nodes[hub].degree > 0) {
        out.push({
            kind: "hub", tone: "neutral", importance: "high",
            text: `Top hub: ${model.nodes[hub].key} (degree ${model.nodes[hub].degree})`,
        });
    }

    // Bridges — edges whose removal disconnects the graph (Tarjan). Parallel edges
    // are handled by tracking edge ids, so a doubled link is never a bridge. A
    // fragility warning → negative tone, high importance.
    const bridges = findBridges(model);
    if (bridges.length) {
        const b = bridges[0];
        out.push({
            kind: "bridge", tone: "negative", importance: "high",
            text: `${bridges.length} bridge edge${bridges.length > 1 ? "s" : ""} — e.g. ${model.nodes[b[0]].key} ↔ ${model.nodes[b[1]].key} (removing it fragments the graph)`,
        });
    }

    // Fragmentation — component count + largest / singletons. Fragmented → negative;
    // a single connected component is a healthy structure → positive.
    const sizes = new Array<number>(model.componentCount).fill(0);
    for (const node of model.nodes) sizes[node.component]++;
    const largest = sizes.reduce((m, v) => Math.max(m, v), 0);
    const singletons = sizes.filter((v) => v === 1).length;
    if (model.componentCount > 1) {
        out.push({
            kind: "components", tone: "negative", importance: "normal",
            text: `${model.componentCount} disconnected components; largest holds ${largest} of ${n} nodes` +
                (singletons ? `, ${singletons} isolated` : ""),
        });
    } else {
        out.push({
            kind: "components", tone: "positive", importance: "normal",
            text: `Fully connected — 1 component across ${n} nodes`,
        });
    }

    // Density — actual vs possible undirected edges (self-loops/parallels excluded).
    // A descriptive measure, no inherent polarity → neutral.
    const uniquePairs = countUniquePairs(model);
    const possible = (n * (n - 1)) / 2;
    const density = possible > 0 ? (uniquePairs / possible) * 100 : 0;
    out.push({
        kind: "density", tone: "neutral", importance: "normal",
        text: `Density ${density.toFixed(density < 1 ? 2 : 1)}% (${uniquePairs} of ${possible} possible links)`,
    });

    return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Plain-English narrative (NG-125). The Insight VIEW (a full-canvas segment of
 * the Graph / Table / Insight switch) reads out — in ordinary sentences, no
 * jargon — what the network actually shows: how big it is, who the central
 * players are, whether it holds together, what would break it, and how tightly
 * knit it is. Pure + deterministic for the same DataView, like everything else
 * in this module, so the jsdom sweep stays stable.
 * ──────────────────────────────────────────────────────────────────────── */

export interface NarrativeLine { text: string; tone: InsightTone; strong?: boolean }
/** An optional graph action a card's headline metric triggers on click (NG-252).
 *  All actions are transient/session-local — they never rewrite saved settings:
 *  focus an entity's ego network, preview a colouring, or highlight the structural-
 *  bridge edge set. Identities travel as natural keys so the render layer maps them
 *  back onto the live model deterministically (no indices baked at narrative time). */
export type InsightAction =
    | { kind: "focusNode"; nodeKey: string }
    | { kind: "colorBy"; mode: "cluster" | "component" }
    | { kind: "highlightBridges"; pairs: [string, string][] };
/** A card. `metric` is the visually-prominent headline number (value + label,
 *  optional sub-line, optional click `action`); `lines` carry the explanation. */
export interface NarrativeMetric { value: string; label: string; sub?: string; tone: InsightTone; action?: InsightAction }
export interface NarrativeSection { title: string; metric?: NarrativeMetric; lines: NarrativeLine[] }
/** `subhead` is the small metadata line under the (now insight-oriented) headline. */
export interface GraphNarrative { headline: string; subhead?: string; sections: NarrativeSection[] }

/** Format an integer with thousands separators, deterministically (no locale). */
function num(n: number): string {
    const s = String(Math.round(n));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A percentage, never rounding a genuine < / > 100 to a flat 100. One decimal
 *  normally (1979/1983 → "99.8%", not the "100%" a naive Math.round produced —
 *  the NG-125/127 fix); two decimals below 1% so tiny densities stay legible
 *  ("0.20%", not "0.2%"). */
function pct1(part: number, whole: number): string {
    if (whole <= 0) return "0%";
    const p = (part / whole) * 100;
    if (p > 0 && p < 1) {
        const s = p.toFixed(2);
        return s === "0.00" ? "<0.01%" : `${s}%`;       // never understate a real share as 0
    }
    let s = p.toFixed(1);
    if (s === "100.0" && part < whole) s = "99.9";      // never overstate a partial share as 100
    if (s === "0.0" && part > 0) s = "<0.1";
    return `${s}%`;
}

/** Median of a numeric list (does not mutate the caller's array). */
function median(values: number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Build the plain-English narrative for a graph. Returns an insight-oriented
 * headline (+ a metadata subhead) plus ordered cards, each led by a prominent
 * metric: Overview, Components, Key players, Communities, Structural bridges,
 * Network structure. Empty graphs yield just an explanatory headline, no cards.
 * Pure + deterministic for the same DataView (fixed node/edge order throughout).
 */
export function computeNarrative(model: GraphModel): GraphNarrative {
    const n = model.nodes.length;
    if (n === 0) {
        return { headline: "No network to describe yet — bind Source and Target node fields to draw one.", sections: [] };
    }

    // Two distinct edge counts, kept honest everywhere (correction #2): the raw
    // records provided vs the unique entity-to-entity links actually analysed
    // (self-loops + parallels collapsed). Density, bridges and communities all
    // operate on the analysed set.
    const records = model.links.length;
    const selfLoops = model.links.reduce((c, l) => c + (l.source === l.target ? 1 : 0), 0);
    const uniquePairs = countUniquePairs(model);
    const excluded = records - uniquePairs;   // parallels + self-loops dropped from analysis

    const sections: NarrativeSection[] = [];

    // Shared connectivity facts (used by the headline + several cards).
    const sizes = new Array<number>(model.componentCount).fill(0);
    for (const node of model.nodes) sizes[node.component]++;
    const largest = sizes.reduce((m, v) => Math.max(m, v), 0);
    const singletons = sizes.filter((v) => v === 1).length;
    const bridges = findBridges(model);

    // --- Headline + subhead (insight-oriented, correction: "UI & writing") ---
    const headline = buildHeadline(model, n, largest, bridges.length);
    const subhead = `${num(n)} ${n === 1 ? "entity" : "entities"} · ${num(records)} relationship ${records === 1 ? "record" : "records"}`
        + (excluded > 0 ? ` · ${num(uniquePairs)} unique links analysed` : "");

    // --- Overview (avg + median degree) -------------------------------------
    // Degree here is the UNIQUE-NEIGHBOUR count (simple undirected basis), NOT
    // model.node.degree, which counts directed edge records for the directed Table.
    // On the record basis a reciprocal A→B / B→A pair double-counts the neighbour, so
    // "average connections per entity" could exceed n−1 and disagree with the
    // "unique relationships" and density numbers shown in the same view (NG-251).
    const degrees = undirectedDegrees(model);
    const totalDegree = degrees.reduce((c, d) => c + d, 0);
    const avgDegree = totalDegree / n;
    const medDegree = median(degrees);
    const leaves = degrees.filter((d) => d === 1).length;
    const overview: NarrativeLine[] = [];
    // Lead with interpretation, not a restatement of the visible counts (the counts
    // already live in the subhead): when most entities hang off a single link, that's
    // a low-redundancy structure worth naming — it's what the numbers actually mean.
    if (n >= 4 && leaves / n >= 0.3) {
        overview.push({
            text: `Low redundancy — ${pct1(leaves, n)} of entities connect through just one relationship, so losing that single link cuts them off entirely. Much of the network hinges on individual relationships with no backup route.`,
            tone: "neutral", strong: true,
        });
    }
    overview.push({
        text: `The network contains ${num(n)} ${n === 1 ? "entity" : "entities"} and ${num(uniquePairs)} unique ${uniquePairs === 1 ? "relationship" : "relationships"}.`,
        tone: "neutral",
    }, {
        // Median alongside the average — a few hubs can pull the mean well above typical.
        text: `Median connections: ${fmtStat(medDegree)} per entity — half of all entities have ${fmtStat(medDegree)} or fewer.`,
        tone: "neutral",
    });
    if (excluded > 0) {
        overview.push({
            text: `${num(records)} relationship records were provided; ${num(excluded)} were duplicate or self-links, leaving ${num(uniquePairs)} unique entity-to-entity links to analyse.`,
            tone: "neutral",
        });
    } else if (selfLoops > 0) {
        overview.push({
            text: `${num(selfLoops)} ${selfLoops === 1 ? "relationship links an entity to itself" : "relationships link an entity to itself"} (self-loops).`,
            tone: "neutral",
        });
    }
    sections.push({
        title: "Overview",
        metric: { value: fmtStat(avgDegree), label: "average connections per entity", tone: "neutral" },
        lines: overview,
    });

    // --- Components (disconnected groups) -----------------------------------
    const connectivity: NarrativeLine[] = [];
    let compMetric: NarrativeMetric;
    if (model.componentCount <= 1) {
        compMetric = { value: "1", label: "connected network", tone: "positive" };
        connectivity.push({ text: `Everything hangs together as one connected web — you can trace a path between any two of the ${num(n)} entities.`, tone: "positive", strong: true });
    } else {
        // Clicking recolours the graph by component so the separate groups pop out.
        compMetric = { value: pct1(largest, n), label: "of entities in the largest group", tone: "negative", action: { kind: "colorBy", mode: "component" } };
        // Describe the remainder honestly rather than only the largest.
        const otherCount = model.componentCount - 1;
        const otherSizes = sizes.slice().sort((a, b) => b - a).slice(1); // all but the largest
        let remainder: string;
        if (model.componentCount === 2) {
            remainder = `while the smaller contains ${num(otherSizes[0])}`;
        } else {
            remainder = `while the remaining ${num(otherCount)} groups hold ${num(n - largest)} entities between them`;
        }
        connectivity.push({
            text: `The network contains ${num(model.componentCount)} disconnected groups. The largest contains ${num(largest)} of ${num(n)} entities (${pct1(largest, n)}), ${remainder}.`,
            tone: "negative", strong: true,
        });
        if (singletons > 0) {
            connectivity.push({
                text: `${num(singletons)} ${singletons === 1 ? "entity sits" : "entities sit"} completely on their own, connected to nothing.`,
                tone: "negative",
            });
        }
    }
    sections.push({ title: "Components", metric: compMetric, lines: connectivity });

    // --- Key players (most connected vs. best connector vs. most critical) --
    // "Most connected" ranks by unique-neighbour degree (same basis as the counts
    // above), so a node's stated "direct links" can never exceed n−1 (NG-251).
    const order = model.nodes.map((_, i) => i).sort((a, b) => degrees[b] - degrees[a] || a - b);
    const hub = order[0];
    const players: NarrativeLine[] = [];
    let playersMetric: NarrativeMetric;
    if (degrees[hub] > 0) {
        // Clicking focuses the hub's ego network (zoom in, neighbours kept, rest fade).
        playersMetric = { value: num(degrees[hub]), label: `direct connections — ${model.nodes[hub].key} leads`, tone: "neutral", action: { kind: "focusNode", nodeKey: model.nodes[hub].key } };
        const second = order[1];
        const secondClause = (second != null && degrees[second] > 0)
            ? ` ${model.nodes[second].key} follows with ${num(degrees[second])}.`
            : "";
        players.push({
            text: `${model.nodes[hub].key} is the most connected entity, with ${num(degrees[hub])} direct ${degrees[hub] === 1 ? "link" : "links"}.${secondClause}`,
            tone: "neutral", strong: true,
        });
        // Best connector — highest betweenness (sits on the most shortest paths).
        // Distinct from "most connected": a broker between groups, not just a hub.
        // Guarded by a node cap (Brandes is O(V·E)); skipped on very large graphs.
        const broker = topBetweenness(model);
        if (broker != null && broker !== hub) {
            players.push({
                text: `${model.nodes[broker].key} is the strongest connector — it sits on more shortest paths between other entities than anyone else, brokering flow between different parts of the network.`,
                tone: "neutral",
            });
        }
        // Most critical — an articulation point whose removal splits its group.
        const critical = topArticulation(model);
        if (critical != null) {
            players.push({
                text: `${model.nodes[critical].key} is the most structurally critical entity — removing it would disconnect part of its group.`,
                tone: "negative",
            });
        }
    } else {
        playersMetric = { value: "0", label: "connections — every entity stands alone", tone: "negative" };
        players.push({ text: "No entity is connected to any other — every point stands alone.", tone: "negative" });
    }
    sections.push({ title: "Key players", metric: playersMetric, lines: players });

    // --- Communities (Louvain clusters) -------------------------------------
    const communitySection = buildCommunitySection(model, n);
    if (communitySection) sections.push(communitySection);

    // --- Structural bridges -------------------------------------------------
    // "Bridge" is the precise graph term (removing it raises the component count);
    // "critical" alone overstates what topology proves, so the business reading is a
    // separate, softer line rather than baked into the label.
    const fragility: NarrativeLine[] = [];
    let bridgeMetric: NarrativeMetric;
    if (bridges.length === 0) {
        bridgeMetric = { value: "0", label: "structural bridges", sub: "none — a resilient structure", tone: "positive" };
        fragility.push({ text: "No single relationship is holding the network together — losing any one link won't split it apart. That's a resilient structure.", tone: "positive" });
    } else {
        const share = pct1(bridges.length, uniquePairs);
        // Clicking highlights exactly these bridge links on the graph (pairs by key so
        // the render layer maps them back to every matching link record).
        const bridgePairs = bridges.map(([a, b]) => [model.nodes[a].key, model.nodes[b].key] as [string, string]);
        bridgeMetric = { value: num(bridges.length), label: "structural bridges", sub: `${share} of analysed links`, tone: "negative", action: { kind: "highlightBridges", pairs: bridgePairs } };
        fragility.push({
            text: `${num(bridges.length)} ${bridges.length === 1 ? "relationship is a structural bridge" : "relationships are structural bridges"}: removing any one would split part of the network into separate groups. They are ${share} of the ${num(uniquePairs)} analysed relationships.`,
            tone: "negative", strong: true,
        });
        fragility.push({
            text: "Potential points of failure — each of these links carries flow with no alternative route, so it's a single point of failure for the two sides it joins.",
            tone: "neutral",
        });
        const b = bridges[0];
        fragility.push({
            text: `For example, ${model.nodes[b[0]].key} ↔ ${model.nodes[b[1]].key} is the only link holding its two sides together.`,
            tone: "neutral",
        });
    }
    sections.push({ title: "Structural bridges", metric: bridgeMetric, lines: fragility });

    // --- Network structure (density) ----------------------------------------
    const possible = (n * (n - 1)) / 2;
    const densityPct = possible > 0 ? (uniquePairs / possible) * 100 : 0;
    const structureLines: NarrativeLine[] = [{
        text: `Only ${pct1(uniquePairs, possible)} of all possible relationships exist — ${num(uniquePairs)} of ${num(possible)} possible links are present.`,
        tone: "neutral",
    }];
    // Density alone means little without size/domain context, so interpret rather
    // than slap on an absolute label. Anything under ~15% of possible links is a
    // low-density structure that leans on a few relationships, not broad redundancy.
    let structureSub: string | undefined;
    if (densityPct < 5) {
        // Sparse is normal at scale — say so, don't imply it's a weakness.
        structureSub = "a sparse network";
        structureLines.push({
            text: "The network is sparse — most entities are connected through a small number of relationships. Low density is normal for large real-world networks and doesn't by itself indicate a weak or unhealthy structure.",
            tone: "neutral",
        });
    } else if (densityPct < 15) {
        structureSub = "a low-density network";
        structureLines.push({
            text: "Low-density network — most entities are connected through a small number of relationships rather than broad redundancy, so the structure leans on a few key links.",
            tone: "neutral",
        });
    } else if (densityPct < 30) {
        structureLines.push({ text: "This is a moderately connected network — a fair share of the possible relationships are present.", tone: "neutral" });
    } else {
        structureLines.push({ text: "This is a densely connected network — most entities that could be linked are.", tone: "neutral" });
    }
    sections.push({
        title: "Network structure",
        metric: { value: pct1(uniquePairs, possible), label: "of possible links exist", sub: structureSub, tone: "neutral" },
        lines: structureLines,
    });

    return { headline, subhead, sections };
}

/** Format a degree statistic: integers plain, halves to one decimal (median of an even count). */
function fmtStat(v: number): string {
    return Number.isInteger(v) ? num(v) : v.toFixed(1);
}

/**
 * Insight-oriented headline — leads with the takeaway, not a bare count (which
 * moves to the subhead). Covers: one resilient web, one web held by N bridges,
 * a dominant-plus-fragments network, and a genuinely fragmented one.
 */
function buildHeadline(model: GraphModel, n: number, largest: number, bridgeCount: number): string {
    const bridgeClause = bridgeCount > 0
        ? `, but ${num(bridgeCount)} ${bridgeCount === 1 ? "relationship is a critical point" : "relationships are critical points"} of failure`
        : "";
    if (model.componentCount <= 1) {
        return bridgeCount > 0
            ? `All ${num(n)} entities form one connected network${bridgeClause}.`
            : `All ${num(n)} entities form one connected, resilient network with no single point of failure.`;
    }
    const share = (largest / n) * 100;
    if (share >= 90) {
        return `Almost every entity belongs to one large network${bridgeClause}.`;
    }
    return `The network splits into ${num(model.componentCount)} separate groups; the largest holds ${pct1(largest, n)} of all entities${bridgeClause}.`;
}

/** Highest-betweenness node (the strongest broker), or null if not meaningful.
 *  Brandes is O(V·E); capped so the on-demand Insight view stays responsive on
 *  large graphs. Deterministic (fixed index order, first-seen tie-break). */
function topBetweenness(model: GraphModel): number | null {
    const n = model.nodes.length;
    if (n < 3 || n > 2500) return null;              // cap: skip on very large graphs
    const bc = betweennessCentrality(model);
    let best = -1, bestVal = 0;
    for (let i = 0; i < n; i++) {
        if (bc[i] > bestVal) { bestVal = bc[i]; best = i; }
    }
    return bestVal > 0 ? best : null;
}

/** Representative articulation point: the one with the highest degree (largest
 *  blast radius), first-seen tie-break. null when the graph has none. */
function topArticulation(model: GraphModel): number | null {
    const aps = findArticulationPoints(model);
    if (aps.length === 0) return null;
    let best = aps[0];
    for (const i of aps) if (model.nodes[i].degree > model.nodes[best].degree) best = i;
    return best;
}

/** The Communities card, or null when clustering isn't meaningful (tiny graphs). */
function buildCommunitySection(model: GraphModel, n: number): NarrativeSection | null {
    if (n < 3) return null;
    const { community, count } = detectCommunities(model);
    const sizes = new Array<number>(count).fill(0);
    for (const c of community) sizes[c]++;
    const sorted = sizes.slice().sort((a, b) => b - a);
    // A lone node is its own Louvain community, but it is NOT a "closely-connected
    // community" — describing it as one is false and inflates the count (NG-251).
    // Count only genuine multi-node groups; surface the loners separately (the
    // Components card already flags them), consistent with the rest of the view.
    const singletons = sorted.filter((s) => s === 1).length;
    const realCount = count - singletons;
    if (realCount <= 1) {
        const lead = realCount === 1 && singletons === 0
            ? "The network forms a single tightly-knit community; no distinct sub-groups stand out."
            : `The network doesn't split into distinct communities — ${singletons > 0 ? `${num(singletons)} ${singletons === 1 ? "entity stands" : "entities stand"} on their own and the rest form one loosely-knit group` : "it reads as one loosely-knit group"}.`;
        return {
            title: "Communities",
            metric: { value: "1", label: "community — no clear sub-groups", tone: "neutral" },
            lines: [{ text: lead, tone: "neutral" }],
        };
    }
    const largest = sorted[0];
    const topK = Math.min(3, realCount);
    const topShare = sorted.slice(0, topK).reduce((s, v) => s + v, 0);
    const lines: NarrativeLine[] = [{
        text: `The network divides into ${num(realCount)} closely-connected communities — clusters of entities more tied to each other than to the rest (think departments, interest groups, or operational silos).`,
        tone: "neutral", strong: true,
    }, {
        text: `The largest community holds ${num(largest)} ${largest === 1 ? "entity" : "entities"}; the top ${topK === 1 ? "community accounts" : `${topK} account`} for ${pct1(topShare, n)} of the network.`,
        tone: "neutral",
    }];
    // Interpret the concentration, don't just state it: is the network dominated by a
    // few clusters, or spread evenly? That's the "so what" an analyst would report.
    if (realCount >= 3) {
        lines.push(topShare / n >= 0.6
            ? { text: `Activity is concentrated — the top ${topK === 1 ? "cluster holds" : `${topK} clusters hold`} most of the network, suggesting it revolves around a few groups rather than being distributed evenly across all ${num(realCount)} communities.`, tone: "neutral" }
            : { text: `The network is fairly evenly distributed across its ${num(realCount)} communities, with no single cluster dominating.`, tone: "neutral" });
    }
    if (singletons > 0) {
        lines.push({
            text: `${num(singletons)} ${singletons === 1 ? "entity belongs" : "entities belong"} to no community, sitting outside these groups entirely.`,
            tone: "neutral",
        });
    }
    return {
        title: "Communities",
        // Clicking previews community colouring so the clusters are visible on the graph.
        metric: { value: num(realCount), label: "closely-connected communities", tone: "neutral", action: { kind: "colorBy", mode: "cluster" } },
        lines,
    };
}

/** Unique-neighbour degree per node — the simple undirected basis the narrative
 *  uses everywhere (matches countUniquePairs / density / bridges). Distinct from
 *  model.node.degree, which counts directed edge records for the directed Table, and
 *  would double-count a reciprocal A→B / B→A pair. Self-loops excluded. */
function undirectedDegrees(model: GraphModel): number[] {
    const nb = model.nodes.map(() => new Set<number>());
    for (const l of model.links) {
        if (l.source === l.target) continue;
        nb[l.source].add(l.target);
        nb[l.target].add(l.source);
    }
    return nb.map((s) => s.size);
}

/** Distinct undirected node pairs that share at least one edge. */
function countUniquePairs(model: GraphModel): number {
    const seen = new Set<string>();
    for (const l of model.links) {
        if (l.source === l.target) continue;
        seen.add(l.source < l.target ? `${l.source}-${l.target}` : `${l.target}-${l.source}`);
    }
    return seen.size;
}

/**
 * Tarjan articulation-point finding (cut vertices) — nodes whose removal
 * increases the component count, i.e. disconnects part of the graph. Iterative
 * DFS (large-graph safe), self-loops excluded. Returns node indices, ascending.
 * A DFS root is an articulation point iff it has >1 DFS-tree child; a non-root u
 * is one iff some child v has low[v] >= disc[u]. Deterministic (index order).
 */
function findArticulationPoints(model: GraphModel): number[] {
    const n = model.nodes.length;
    const adj: number[][] = model.nodes.map(() => []);
    for (const l of model.links) {
        if (l.source === l.target) continue;
        adj[l.source].push(l.target);
        adj[l.target].push(l.source);
    }

    const disc = new Array<number>(n).fill(-1);
    const low = new Array<number>(n).fill(0);
    const isAP = new Array<boolean>(n).fill(false);
    let timer = 0;

    for (let start = 0; start < n; start++) {
        if (disc[start] !== -1) continue;
        disc[start] = low[start] = timer++;
        const stack: { u: number; parent: number; ptr: number; children: number }[] =
            [{ u: start, parent: -1, ptr: 0, children: 0 }];
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const u = frame.u;
            if (frame.ptr < adj[u].length) {
                const v = adj[u][frame.ptr++];
                if (v === frame.parent) continue;       // skip the edge we came in on
                if (disc[v] === -1) {
                    frame.children++;
                    disc[v] = low[v] = timer++;
                    stack.push({ u: v, parent: u, ptr: 0, children: 0 });
                } else {
                    low[u] = Math.min(low[u], disc[v]); // back edge
                }
            } else {
                stack.pop();
                if (stack.length) {
                    const p = stack[stack.length - 1].u;
                    low[p] = Math.min(low[p], low[u]);
                    // Non-root parent p is a cut vertex if this child can't reach above p.
                    if (stack[stack.length - 1].parent !== -1 && low[u] >= disc[p]) isAP[p] = true;
                }
                // Root is a cut vertex iff it has more than one DFS-tree child.
                if (frame.parent === -1 && frame.children > 1) isAP[u] = true;
            }
        }
    }

    const out: number[] = [];
    for (let i = 0; i < n; i++) if (isAP[i]) out.push(i);
    return out;
}

/** Per-node articulation-point flags (NG-253): true where removing the node would
 *  disconnect part of its component. Exported for the Table's "Critical" column so it
 *  reuses the same Tarjan pass the narrative uses. Deterministic. */
export function articulationFlags(model: GraphModel): boolean[] {
    const flags = new Array<boolean>(model.nodes.length).fill(false);
    for (const i of findArticulationPoints(model)) flags[i] = true;
    return flags;
}

/** Tarjan bridge-finding. Returns bridge edges as [uIndex, vIndex] pairs. */
function findBridges(model: GraphModel): [number, number][] {
    const n = model.nodes.length;
    // Bridges run on the SAME simple undirected graph every other metric uses —
    // the set of unique entity-to-entity pairs (see countUniquePairs), self-loops
    // excluded. Parallel and reciprocal records (A→B twice, or A→B and B→A) collapse
    // to ONE analysed link, so each unique pair contributes exactly one edge here.
    // This keeps the tree identity honest: a connected graph of N nodes / N-1 unique
    // links is a tree, so every one of those links must read as a bridge. Treating a
    // reciprocal pair as two parallel edges (never a bridge) is what silently
    // under-counted bridges against the unique-links framing the UI already commits to.
    const adj: { to: number; id: number }[][] = model.nodes.map(() => []);
    const pairId = new Map<string, number>();
    for (const l of model.links) {
        if (l.source === l.target) continue;
        const key = l.source < l.target ? `${l.source}-${l.target}` : `${l.target}-${l.source}`;
        if (pairId.has(key)) continue; // already have this unique pair as one edge
        const id = pairId.size;
        pairId.set(key, id);
        adj[l.source].push({ to: l.target, id });
        adj[l.target].push({ to: l.source, id });
    }

    const disc = new Array<number>(n).fill(-1);
    const low = new Array<number>(n).fill(0);
    const bridges: [number, number][] = [];
    let timer = 0;

    // Iterative DFS to avoid stack overflow on large graphs.
    for (let start = 0; start < n; start++) {
        if (disc[start] !== -1) continue;
        const stack: { u: number; parentEdge: number; ptr: number }[] = [{ u: start, parentEdge: -1, ptr: 0 }];
        disc[start] = low[start] = timer++;
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const u = frame.u;
            if (frame.ptr < adj[u].length) {
                const { to: v, id } = adj[u][frame.ptr++];
                if (id === frame.parentEdge) continue; // don't traverse the edge we came in on
                if (disc[v] === -1) {
                    disc[v] = low[v] = timer++;
                    stack.push({ u: v, parentEdge: id, ptr: 0 });
                } else {
                    low[u] = Math.min(low[u], disc[v]);
                }
            } else {
                stack.pop();
                const parent = stack.length ? stack[stack.length - 1].u : -1;
                if (parent !== -1) {
                    low[parent] = Math.min(low[parent], low[u]);
                    if (low[u] > disc[parent]) bridges.push([parent, u]);
                }
            }
        }
    }
    return bridges;
}
