"use strict";

/**
 * Deterministic graph-aware Concentric layout. Unlike the old index-order circle,
 * it exposes core–periphery structure: the strongest hub occupies the centre and
 * lower-connectivity peers fan across progressively larger grouped rings. Business
 * groups/components remain contiguous and connected peers remain adjacent.
 * The persisted mode key remains `circle` for report compatibility.
 */

import { GraphModel, LayoutResult, Vec2 } from "../model/graphTypes";

function boundsOf(positions: Vec2[]): LayoutResult["bounds"] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0; }
    return { minX, minY, maxX, maxY };
}

export interface CircularLayoutConfig {
    /** Business category/community per node. Missing values fall back to component. */
    groups?: (string | number | null)[];
    /** Render radii used to choose a circle large enough for unequal nodes. */
    nodeRadii?: number[];
}

/** Graph-aware cyclic order, exported so QA can pin its readability guarantees. */
export function circularOrder(model: GraphModel, groups?: (string | number | null)[]): number[] {
    const n = model.nodes.length;
    if (n <= 1) return model.nodes.map((_, i) => i);
    const groupKey = (i: number): string => {
        const value = groups?.[i];
        return value == null || value === "" ? `component:${model.nodes[i].component}` : `group:${String(value)}`;
    };
    const buckets = new Map<string, number[]>();
    const firstGroupIndex = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const key = groupKey(i);
        if (!buckets.has(key)) {
            buckets.set(key, []);
            firstGroupIndex.set(key, i);
        }
        buckets.get(key)!.push(i);
    }

    // Weighted adjacency is used both to sequence groups and to walk each group.
    const adjacency: Map<number, number>[] = model.nodes.map(() => new Map<number, number>());
    const groupLinks = new Map<string, number>();
    for (const link of model.links) {
        if (link.source === link.target) continue;
        const w = 1 + Math.log1p(Math.max(0, link.weight));
        adjacency[link.source].set(link.target, (adjacency[link.source].get(link.target) ?? 0) + w);
        adjacency[link.target].set(link.source, (adjacency[link.target].get(link.source) ?? 0) + w);
        const a = groupKey(link.source), b = groupKey(link.target);
        if (a !== b) {
            const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
            groupLinks.set(pair, (groupLinks.get(pair) ?? 0) + w);
        }
    }
    const between = (a: string, b: string): number => {
        if (a === b) return 0;
        const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        return groupLinks.get(pair) ?? 0;
    };

    const groupKeys = [...buckets.keys()];
    const groupStrength = (key: string): number =>
        groupKeys.reduce((sum, other) => sum + between(key, other), 0);
    const remaining = new Set(groupKeys);
    const groupOrder: string[] = [];
    let current = groupKeys.slice().sort((a, b) =>
        (groupStrength(b) - groupStrength(a))
        || (buckets.get(b)!.length - buckets.get(a)!.length)
        || ((firstGroupIndex.get(a) ?? 0) - (firstGroupIndex.get(b) ?? 0)))[0];
    while (remaining.size) {
        if (!remaining.has(current)) current = [...remaining][0];
        groupOrder.push(current);
        remaining.delete(current);
        if (!remaining.size) break;
        current = [...remaining].sort((a, b) =>
            (between(current, b) - between(current, a))
            || (groupStrength(b) - groupStrength(a))
            || ((firstGroupIndex.get(a) ?? 0) - (firstGroupIndex.get(b) ?? 0)))[0];
    }

    const order: number[] = [];
    const ranges: { start: number; end: number }[] = [];
    for (const key of groupOrder) {
        const members = buckets.get(key)!;
        const unvisited = new Set(members);
        let at = members.slice().sort((a, b) =>
            (model.nodes[b].degree - model.nodes[a].degree)
            || model.nodes[a].label.localeCompare(model.nodes[b].label) || (a - b))[0];
        const start = order.length;
        while (unvisited.size) {
            if (!unvisited.has(at)) at = [...unvisited][0];
            order.push(at);
            unvisited.delete(at);
            if (!unvisited.size) break;
            const visited = new Set(order.slice(start));
            at = [...unvisited].sort((a, b) => {
                const score = (candidate: number): number => {
                    const direct = adjacency[at].get(candidate) ?? 0;
                    let connectedToPlaced = 0;
                    for (const v of visited) connectedToPlaced += adjacency[v].get(candidate) ?? 0;
                    return direct * 4 + connectedToPlaced + model.nodes[candidate].degree * 0.02;
                };
                return (score(b) - score(a))
                    || model.nodes[a].label.localeCompare(model.nodes[b].label) || (a - b);
            })[0];
        }
        ranges.push({ start, end: order.length });
    }

    // A few bounded adjacent-swap passes reduce circular link span while never
    // breaking the business-group sectors. Large graphs keep the linear walk above.
    if (n <= 320 && model.links.length <= 5000) {
        const score = (): number => {
            const pos = new Array<number>(n);
            for (let i = 0; i < n; i++) pos[order[i]] = i;
            let total = 0;
            for (const link of model.links) {
                const d = Math.abs(pos[link.source] - pos[link.target]);
                total += Math.min(d, n - d) * (1 + Math.log1p(Math.max(0, link.weight)));
            }
            return total;
        };
        let best = score();
        for (let pass = 0; pass < 3; pass++) {
            let improved = false;
            for (const range of ranges) {
                for (let i = range.start; i + 1 < range.end; i++) {
                    [order[i], order[i + 1]] = [order[i + 1], order[i]];
                    const candidate = score();
                    if (candidate + 1e-9 < best) {
                        best = candidate;
                        improved = true;
                    } else {
                        [order[i], order[i + 1]] = [order[i + 1], order[i]];
                    }
                }
            }
            if (!improved) break;
        }
    }
    return order;
}

/** Concentric core–periphery rings with grouped sectors and size-aware radii. */
export function circularLayout(
    model: GraphModel,
    config: CircularLayoutConfig | number = {},
): LayoutResult {
    const n = model.nodes.length;
    const positions: Vec2[] = new Array(n);
    if (n === 0) return { positions, bounds: boundsOf(positions), iterations: 0 };
    const cfg = typeof config === "number" ? { } : config;
    const baseRadius = typeof config === "number" ? config : 200;
    if (n === 1) {
        positions[0] = { x: 0, y: 0 };
        return { positions, bounds: boundsOf(positions), iterations: 0 };
    }
    const order = circularOrder(model, cfg.groups);
    const orderPos = new Map(order.map((node, slot) => [node, slot]));
    const keyOf = (i: number): string => {
        const value = cfg.groups?.[i];
        return value == null || value === "" ? `component:${model.nodes[i].component}` : `group:${String(value)}`;
    };
    const hub = model.nodes.map((_, i) => i).sort((a, b) =>
        (model.nodes[b].degree - model.nodes[a].degree)
        || (model.nodes[b].weightedDegree - model.nodes[a].weightedDegree)
        || model.nodes[a].label.localeCompare(model.nodes[b].label) || (a - b))[0];
    positions[hub] = { x: 0, y: 0 };

    const remainingByImportance = model.nodes.map((_, i) => i)
        .filter((i) => i !== hub)
        .sort((a, b) =>
            (model.nodes[b].degree - model.nodes[a].degree)
            || (model.nodes[b].weightedDegree - model.nodes[a].weightedDegree)
            || (orderPos.get(a)! - orderPos.get(b)!));
    const ringCount = n <= 12 ? 1 : n <= 36 ? 2 : n <= 90 ? 3 : Math.min(6, 3 + Math.ceil((n - 90) / 120));
    const adjacency: number[][] = model.nodes.map(() => []);
    for (const link of model.links) {
        if (link.source === link.target) continue;
        adjacency[link.source].push(link.target);
        adjacency[link.target].push(link.source);
    }

    // Preserve actual graph layers when they exist. Parent/child networks then put
    // direct hub peers on the first ring and their descendants on the next rings,
    // removing many avoidable inter-ring crossings. A one-hop star still uses the
    // balanced capacity fallback so it does not regress to one giant perimeter.
    const distance = new Array<number>(n).fill(Infinity);
    distance[hub] = 0;
    const queue = [hub];
    for (let head = 0; head < queue.length; head++) {
        const u = queue[head];
        for (const v of adjacency[u]) if (!Number.isFinite(distance[v])) {
            distance[v] = distance[u] + 1;
            queue.push(v);
        }
    }
    const finiteDepths = [...new Set(distance.filter((d) => Number.isFinite(d) && d > 0))];
    let rings: number[][];
    if (ringCount > 1 && finiteDepths.length >= 2) {
        const maxDepth = Math.max(...finiteDepths);
        const layered = Array.from({ length: ringCount }, () => [] as number[]);
        for (const i of remainingByImportance) {
            const d = distance[i];
            const slot = !Number.isFinite(d)
                ? ringCount - 1
                : maxDepth <= 1
                    ? 0
                    : Math.round((d - 1) * (ringCount - 1) / (maxDepth - 1));
            layered[Math.max(0, Math.min(ringCount - 1, slot))].push(i);
        }
        rings = layered.filter((members) => members.length > 0);
    } else {
        const weightTotal = ringCount * (ringCount + 1) / 2;
        rings = [];
        let consumed = 0;
        for (let ring = 0; ring < ringCount; ring++) {
            const left = remainingByImportance.length - consumed;
            const ringsLeft = ringCount - ring;
            const target = ring === ringCount - 1
                ? left
                : Math.max(1, Math.min(left - (ringsLeft - 1),
                    Math.round(remainingByImportance.length * (ring + 1) / weightTotal)));
            rings.push(remainingByImportance.slice(consumed, consumed + target));
            consumed += target;
        }
    }

    const tau = 2 * Math.PI;
    const normalAngle = (angle: number): number => ((angle % tau) + tau) % tau;
    const circularMean = (values: number[], fallback: number): number => {
        if (!values.length) return normalAngle(fallback);
        let x = 0, y = 0;
        for (const value of values) { x += Math.cos(value); y += Math.sin(value); }
        return Math.hypot(x, y) < 1e-7 ? normalAngle(fallback) : normalAngle(Math.atan2(y, x));
    };
    const angleOf = new Map<number, number>();
    const baseAngleOf = (i: number): number => tau * (orderPos.get(i) ?? 0) / Math.max(1, n);
    const anchorOf = (i: number): number => circularMean(
        adjacency[i].map((neighbor) => angleOf.get(neighbor))
            .filter((angle): angle is number => angle !== undefined),
        baseAngleOf(i),
    );
    const topologyOrder = (base: number[]): number[] => {
        if (!angleOf.size) return base.slice().sort((a, b) => orderPos.get(a)! - orderPos.get(b)!);
        const buckets = new Map<string, number[]>();
        for (const i of base.slice().sort((a, b) => orderPos.get(a)! - orderPos.get(b)!)) {
            const key = keyOf(i);
            const bucket = buckets.get(key);
            if (bucket) bucket.push(i);
            else buckets.set(key, [i]);
        }
        const grouped = [...buckets.entries()].map(([key, members]) => {
            const anchor = circularMean(members.map(anchorOf), baseAngleOf(members[0]));
            members.sort((a, b) => {
                const da = normalAngle(anchorOf(a) - anchor + Math.PI) - Math.PI;
                const db = normalAngle(anchorOf(b) - anchor + Math.PI) - Math.PI;
                return (da - db) || (orderPos.get(a)! - orderPos.get(b)!);
            });
            return { key, members, anchor };
        }).sort((a, b) => (a.anchor - b.anchor) || a.key.localeCompare(b.key));
        // Put the circular seam in the largest group-to-group gap, not through a
        // connected sector. This is the circular equivalent of a barycentric sweep.
        if (grouped.length > 1) {
            let after = 0, largest = -1;
            for (let i = 0; i < grouped.length; i++) {
                const next = (i + 1) % grouped.length;
                const gap = normalAngle(grouped[next].anchor - grouped[i].anchor);
                if (gap > largest) { largest = gap; after = next; }
            }
            grouped.push(...grouped.splice(0, after));
        }
        return grouped.flatMap((group) => group.members);
    };

    let priorRadius = 0;
    let priorMaxNode = Math.max(4, Number(cfg.nodeRadii?.[hub]) || 12);
    for (let ring = 0; ring < rings.length; ring++) {
        const members = topologyOrder(rings[ring]);
        let groupCount = 0;
        let circumference = 0;
        let maxNode = 4;
        for (let slot = 0; slot < members.length; slot++) {
            if (slot === 0 || keyOf(members[slot]) !== keyOf(members[slot - 1])) groupCount++;
            const r = Math.max(4, Number(cfg.nodeRadii?.[members[slot]]) || 12);
            maxNode = Math.max(maxNode, r);
            circumference += 2 * r + 18;
        }
        const sectorGap = groupCount > 1
            ? Math.min(0.18, Math.PI / Math.max(8, members.length + groupCount))
            : 0;
        const naturalRadius = circumference / (2 * Math.PI);
        const firstRadius = Math.max(78, Math.min(baseRadius * 0.48, 110));
        const R = ring === 0
            ? Math.max(firstRadius, naturalRadius)
            : Math.max(naturalRadius, priorRadius + priorMaxNode + maxNode + 58);
        const step = (tau - sectorGap * groupCount) / Math.max(1, members.length);
        let cursor = -Math.PI / 2;
        const rawAngles: number[] = [];
        for (let slot = 0; slot < members.length; slot++) {
            if (slot > 0 && keyOf(members[slot]) !== keyOf(members[slot - 1])) cursor += sectorGap;
            rawAngles.push(cursor + step / 2);
            cursor += step;
        }
        // Rotate the whole ring to minimise angular distance to already placed
        // neighbours. Ordering removes crossings; phase alignment shortens the links.
        const phaseCandidates: number[] = [];
        for (let slot = 0; slot < members.length; slot++) {
            for (const neighbor of adjacency[members[slot]]) {
                const anchor = angleOf.get(neighbor);
                if (anchor !== undefined) phaseCandidates.push(anchor - rawAngles[slot]);
            }
        }
        const phase = circularMean(phaseCandidates, ring % 2 ? step / 2 : 0);
        for (let slot = 0; slot < members.length; slot++) {
            const theta = rawAngles[slot] + phase;
            const i = members[slot];
            positions[i] = { x: R * Math.cos(theta), y: R * Math.sin(theta) };
            angleOf.set(i, normalAngle(theta));
        }
        priorRadius = R;
        priorMaxNode = maxNode;
    }
    return { positions, bounds: boundsOf(positions), iterations: 0 };
}
