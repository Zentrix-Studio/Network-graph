"use strict";

/**
 * Decide node positions for a render — the join between the layout engines and
 * pinned-layout mode (feature C2, the flagship wedge). This is what lets the
 * graph "stay put": ZoomCharts (the market leader) explicitly cannot save a
 * layout, so its graph re-solves and dances on every refresh. Here, when the
 * layout is pinned we DO NOT run the simulation at all — we replay the frozen
 * positions the author saved.
 *
 * Pure and Power-BI-free: the caller passes the stored-positions string (which
 * it read from dataView.metadata.objects) rather than this module touching the host.
 */

import { GraphModel, LayoutResult, Vec2 } from "./graphTypes";
import { seedPosition } from "./rng";
import { computeForceLayout } from "./forceLayout";
import { circularLayout } from "../render/layoutModes";
import { treeLayout, deriveTreeParents } from "./treeLayout";
import { radialLayout } from "./radialLayout";
import { geoLayout, hasGeoCoords, GeoCoord } from "./geoLayout";

export type LayoutMode = "force" | "circle" | "radial" | "tree" | "geo";

export interface ResolveLayoutInput {
    mode: LayoutMode;
    pinned: boolean;
    /** Serialized key→[x,y] map from a previous pin, or "" / null. */
    storedPositions: string | null;
    charge: number;
    linkDistance: number;
    /** Per-node parent key for tree/radial modes; null entries are roots. */
    treeParents?: (string | null)[];
    /** Per-node lat/long for geo-route mode; null entries fall to the centroid. */
    geoCoords?: (GeoCoord | null)[];
    /** Render viewport (px). Lets the tree layout fill the vertical space of a wide,
     *  shallow org chart rather than leaving big empty bands under the uniform fit. */
    viewport?: { width: number; height: number };
    /** Approximate rendered node radii/label widths used by tidy and Concentric spacing. */
    nodeRadii?: number[];
    labelWidths?: number[];
    /** Business category/community used to keep peers in contiguous Concentric sectors. */
    ringGroups?: (string | number | null)[];
    /** Cluster id per node — enables the "Group by cluster" force in force mode. */
    community?: number[];
    /** Strength of the cluster grouping force (0 = off). */
    clusterStrength?: number;
}

const SEED_RADIUS = 200;

/** Parse the persisted positions blob. Returns null on absent/invalid JSON. */
export function parseStoredPositions(text: string | null): Map<string, Vec2> | null {
    if (!text) return null;
    try {
        const raw = JSON.parse(text) as Record<string, [number, number]>;
        const map = new Map<string, Vec2>();
        for (const key of Object.keys(raw)) {
            const v = raw[key];
            if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
                map.set(key, { x: v[0], y: v[1] });
            }
        }
        return map.size ? map : null;
    } catch {
        return null;
    }
}

/** Serialize a layout to the persisted blob (key→[x,y]), rounded to cut size. */
export function serializePositions(model: GraphModel, layout: LayoutResult): string {
    const out: Record<string, [number, number]> = {};
    for (let i = 0; i < model.nodes.length; i++) {
        const p = layout.positions[i];
        out[model.nodes[i].key] = [round(p.x), round(p.y)];
    }
    return JSON.stringify(out);
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * The parent-key array the hierarchical layouts (tree, radial) consume. Prefer an
 * explicit Node-parent binding; otherwise derive a readable hierarchy from the
 * graph's own structure (BFS spanning forest) so these modes always lay out a
 * hierarchy instead of silently falling back to force.
 */
function hierarchyOf(model: GraphModel, input: ResolveLayoutInput): (string | null)[] {
    return (input.treeParents && input.treeParents.some((p) => p != null))
        ? input.treeParents
        : deriveTreeParents(model);
}

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

/**
 * Resolve positions for the current render.
 *  - pinned + stored positions → FROZEN replay (no simulation). Nodes absent from
 *    the saved set (added since the pin) get their deterministic seed position, so
 *    the existing graph never moves and new nodes simply appear.
 *  - otherwise → run the chosen layout engine.
 */
export function resolveLayout(model: GraphModel, input: ResolveLayoutInput): LayoutResult {
    if (input.pinned) {
        const stored = parseStoredPositions(input.storedPositions);
        if (stored) {
            const positions: Vec2[] = model.nodes.map((n) =>
                stored.get(n.key) ?? seedPosition(n.key, SEED_RADIUS));
            return { positions, bounds: boundsOf(positions), iterations: 0 };
        }
        // Pinned but nothing saved yet → fall through and compute once; the visual
        // persists the result so the NEXT render is a frozen replay.
    }

    switch (input.mode) {
        case "circle": return circularLayout(model, {
            groups: input.ringGroups,
            nodeRadii: input.nodeRadii,
        });
        case "geo":
            // Needs coordinates; without any, fall back to force so the mode isn't blank.
            if (input.geoCoords && hasGeoCoords(input.geoCoords)) return geoLayout(model, input.geoCoords);
            return computeForceLayout(model, { charge: input.charge, linkDistance: input.linkDistance });
        case "tree": return treeLayout(
            model, hierarchyOf(model, input), input.viewport, input.nodeRadii, input.labelWidths,
        );
        case "radial": return radialLayout(model, hierarchyOf(model, input));
        default: return computeForceLayout(model, {
            charge: input.charge,
            linkDistance: input.linkDistance,
            community: input.community,
            clusterStrength: input.clusterStrength ?? 0,
        });
    }
}
