"use strict";

/**
 * Geo-route layout (domain mode). Places nodes at their real geographic position
 * from Latitude/Longitude roles, so a flight / rail / supply-chain / telecom
 * network reads on its geography — the enterprise "route map" use case. Pure and
 * certifiable-by-construction: it PROJECTS coordinates arithmetically and never
 * fetches map tiles or makes an external call (that would need the map privilege
 * and break certification). An equirectangular projection keeps the code trivial
 * and the shape recognisable at country/continent scale.
 *
 * Nodes without coordinates fall to the centroid of the known ones, so a partly
 * geocoded dataset still renders instead of exploding the bounds.
 */

import { GraphModel, LayoutResult, Vec2 } from "./graphTypes";

export interface GeoCoord { lat: number; lon: number }

/** Equirectangular projection: x = longitude, y = -latitude (north points up). */
function project(c: GeoCoord): Vec2 {
    return { x: c.lon, y: -c.lat };
}

/** True when at least one node carries a coordinate (else geo mode has nothing to place). */
export function hasGeoCoords(coords: (GeoCoord | null)[]): boolean {
    return coords.some((c) => c != null);
}

export function geoLayout(model: GraphModel, coords: (GeoCoord | null)[]): LayoutResult {
    // Centroid of the known coordinates → fallback for un-geocoded nodes.
    let sx = 0, sy = 0, k = 0;
    for (const c of coords) {
        if (!c) continue;
        const p = project(c);
        sx += p.x; sy += p.y; k++;
    }
    const cx = k ? sx / k : 0, cy = k ? sy / k : 0;

    const positions: Vec2[] = model.nodes.map((_, i) => (coords[i] ? project(coords[i]!) : { x: cx, y: cy }));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0; }
    // Guard a zero-extent (all nodes at one point) so fitTransform doesn't divide by ~0.
    if (maxX - minX < 1e-6) { minX -= 1; maxX += 1; }
    if (maxY - minY < 1e-6) { minY -= 1; maxY += 1; }

    return { positions, bounds: { minX, minY, maxX, maxY }, iterations: 0 };
}
