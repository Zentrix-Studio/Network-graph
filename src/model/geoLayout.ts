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

/**
 * Full equirectangular world extent, in the layout's projected space (x = lon,
 * y = -lat). Geo mode always frames THIS, never the data's bounding box, so the
 * world basemap stays fully intact at a fixed scale whether there are 3 nodes or
 * 3,000 — no zoom-to-fit (geo layout only). Must match the graticule range in
 * render/worldOutline.ts (LON_MIN/MAX = ±180, LAT_MIN/MAX = -60..80; y = -lat).
 */
const WORLD_MIN_X = -180, WORLD_MAX_X = 180;   // longitude
const WORLD_MIN_Y = -80, WORLD_MAX_Y = 60;     // y = -latitude, for lat 80..-60

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

    // Start from the full world extent and only ever grow it, so the fit always
    // shows the whole map. A node outside the map band (lat >80 / <-60) still
    // stays on-screen because the bounds expand to include it, but the common
    // case leaves the extent exactly at the full world — no zoom in on sparse data.
    let minX = WORLD_MIN_X, minY = WORLD_MIN_Y, maxX = WORLD_MAX_X, maxY = WORLD_MAX_Y;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    return { positions, bounds: { minX, minY, maxX, maxY }, iterations: 0 };
}
