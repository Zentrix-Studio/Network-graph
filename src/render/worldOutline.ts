"use strict";

/**
 * Outline-map backdrop for Geo-route layout — a faint world map (simplified
 * continent silhouettes + a lat/long graticule) drawn UNDER the graph so a
 * flight / supply-chain / telecom network reads on its real geography.
 *
 * Certifiable by construction: the coastline data is EMBEDDED here as plain
 * [lon,lat] coordinate rings and PROJECTED arithmetically (equirectangular, the
 * exact projection `geoLayout` uses). Nothing here fetches a map tile, image, or
 * external resource — that would need the `map` privilege and break certification.
 * Pure: no Power BI imports, no `getBBox`, no DOM measurement.
 *
 * The land is deliberately low-fidelity (a recognisable silhouette, ~20-40 points
 * per continent), which is all a faint backdrop needs and keeps the bundle small.
 * It is projected with the SAME fit transform as the nodes (`geo.scale/tx/ty`), so
 * every continent sits exactly beneath the cities placed on it, and a regional
 * dataset (e.g. only European nodes) zooms the map to that region for free.
 */

import { Selection } from "d3";
import { GraphGeometry } from "./graph";

type G = Selection<SVGGElement, unknown, null, undefined>;

/** A closed ring of [longitude, latitude] pairs (degrees). */
type Ring = ReadonlyArray<readonly [number, number]>;

/**
 * Simplified land silhouettes, one ring per landmass. Coordinates are
 * [lon (-180..180), lat (-90..90)]. Rings are stylised — correct in position,
 * size and gross shape, not survey-accurate — which is exactly right for a faint
 * backdrop and keeps the embedded data compact. Antarctica is omitted (a bottom
 * band that rarely carries nodes and only crowds the fit).
 */
export const LAND: ReadonlyArray<Ring> = [
    // North America
    [[-168, 66], [-166, 69], [-156, 71], [-140, 70], [-125, 70], [-108, 68], [-95, 70], [-85, 73],
     [-80, 70], [-95, 62], [-83, 58], [-79, 52], [-80, 60], [-70, 62], [-64, 60], [-57, 52], [-53, 47],
     [-62, 46], [-70, 43], [-74, 40], [-76, 36], [-81, 31], [-80, 26], [-83, 29], [-90, 29], [-97, 28],
     [-97, 22], [-91, 18], [-88, 21], [-90, 20], [-88, 16], [-84, 10], [-78, 8], [-83, 12], [-92, 15],
     [-96, 16], [-105, 19], [-110, 23], [-113, 27], [-117, 32], [-122, 37], [-124, 43], [-124, 48],
     [-130, 54], [-140, 59], [-150, 59], [-160, 58], [-164, 60], [-168, 66]],
    // Greenland
    [[-45, 60], [-30, 68], [-20, 70], [-18, 76], [-30, 82], [-45, 83], [-58, 76], [-55, 68], [-50, 62], [-45, 60]],
    // South America
    [[-81, 7], [-76, 8], [-70, 12], [-62, 10], [-50, 0], [-44, -3], [-35, -6], [-39, -14], [-48, -25],
     [-55, -34], [-62, -40], [-66, -45], [-69, -52], [-66, -55], [-72, -52], [-73, -44], [-71, -33],
     [-71, -24], [-70, -18], [-75, -15], [-80, -6], [-81, -2], [-81, 7]],
    // Africa
    [[-17, 15], [-16, 21], [-10, 27], [-5, 32], [0, 35], [10, 37], [11, 34], [20, 32], [30, 31], [33, 28],
     [35, 24], [38, 18], [43, 12], [51, 12], [45, 5], [41, -2], [40, -8], [34, -18], [32, -24], [26, -32],
     [20, -35], [18, -33], [15, -24], [13, -16], [10, -4], [9, 3], [5, 6], [-4, 5], [-8, 5], [-13, 9],
     [-16, 12], [-17, 15]],
    // Madagascar
    [[44, -16], [50, -15], [50, -25], [46, -25], [43, -22], [44, -16]],
    // Europe (blob; internal seas omitted, silhouette only)
    [[-10, 36], [-9, 44], [0, 49], [-5, 50], [2, 51], [8, 54], [6, 58], [5, 62], [12, 65], [18, 69],
     [26, 71], [30, 67], [24, 60], [28, 58], [30, 60], [27, 54], [20, 55], [12, 54], [13, 45], [18, 42],
     [24, 40], [20, 40], [14, 44], [6, 43], [-1, 44], [-9, 37], [-10, 36]],
    // Great Britain
    [[-5, 50], [-3, 53], [-3, 58], [-5, 57], [-6, 55], [-5, 50]],
    // Asia (blob from ~26E east to the Pacific; Arabia + India + SE Asia + Siberia)
    [[26, 36], [30, 40], [36, 45], [30, 45], [40, 47], [48, 47], [55, 50], [60, 54], [68, 55], [66, 62],
     [60, 68], [70, 72], [80, 73], [100, 77], [115, 74], [130, 73], [140, 72], [160, 70], [170, 68],
     [178, 66], [165, 60], [155, 52], [143, 50], [140, 52], [135, 44], [130, 43], [128, 40], [122, 40],
     [121, 37], [122, 31], [118, 24], [110, 21], [108, 15], [105, 9], [104, 1], [100, 6], [98, 10],
     [98, 16], [94, 16], [90, 22], [88, 22], [80, 13], [77, 8], [73, 17], [70, 21], [65, 25], [60, 25],
     [57, 25], [50, 29], [48, 30], [42, 30], [35, 30], [35, 36], [40, 37], [34, 36], [28, 37], [26, 36]],
    // Japan
    [[131, 31], [135, 34], [140, 36], [142, 40], [141, 43], [138, 37], [133, 34], [131, 31]],
    // Sumatra
    [[95, 5], [100, 0], [106, -6], [102, -5], [96, 2], [95, 5]],
    // Borneo
    [[109, 2], [117, 4], [119, -1], [114, -4], [109, -1], [109, 2]],
    // New Guinea
    [[131, -1], [141, -3], [150, -6], [147, -9], [138, -8], [132, -5], [131, -1]],
    // Australia
    [[114, -22], [113, -26], [115, -34], [123, -34], [130, -32], [135, -35], [138, -35], [141, -38],
     [147, -38], [150, -37], [153, -31], [153, -26], [146, -19], [142, -11], [137, -12], [136, -15],
     [130, -13], [126, -14], [122, -18], [114, -22]],
    // New Zealand
    [[173, -35], [178, -38], [174, -41], [170, -44], [167, -46], [171, -42], [173, -35]],
];

/** Longitude/latitude bounds a graticule is drawn to (the whole world). */
const LON_MIN = -180, LON_MAX = 180, LAT_MIN = -60, LAT_MAX = 80;

export interface BasemapPaths {
    /** SVG `d` for the filled land silhouettes (one path, many subpaths). */
    land: string;
    /** SVG `d` for the lat/long graticule grid lines. */
    graticule: string;
}

/**
 * Project [lon,lat] into pixel space with the graph's fit transform — identical to
 * how nodes are placed (geoLayout projects lon→x, -lat→y; fitTransform scales+shifts),
 * so continents land exactly under their cities. Pure arithmetic.
 */
function px(lon: number, lat: number, geo: GraphGeometry): [number, number] {
    return [lon * geo.scale + geo.tx, -lat * geo.scale + geo.ty];
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Build the backdrop `d` strings for the current fit. `graticuleStep` is the grid
 * spacing in degrees (0 = no graticule). Pure — no DOM, safe under jsdom.
 */
export function basemapPaths(geo: GraphGeometry, graticuleStep = 30): BasemapPaths {
    let land = "";
    for (const ring of LAND) {
        for (let i = 0; i < ring.length; i++) {
            const [x, y] = px(ring[i][0], ring[i][1], geo);
            land += (i === 0 ? "M" : "L") + r2(x) + "," + r2(y);
        }
        land += "Z";
    }

    let graticule = "";
    if (graticuleStep > 0) {
        // Meridians (constant longitude, vertical), then parallels (constant latitude).
        for (let lon = LON_MIN; lon <= LON_MAX; lon += graticuleStep) {
            const a = px(lon, LAT_MAX, geo), b = px(lon, LAT_MIN, geo);
            graticule += "M" + r2(a[0]) + "," + r2(a[1]) + "L" + r2(b[0]) + "," + r2(b[1]);
        }
        for (let lat = LAT_MIN; lat <= LAT_MAX; lat += graticuleStep) {
            const a = px(LON_MIN, lat, geo), b = px(LON_MAX, lat, geo);
            graticule += "M" + r2(a[0]) + "," + r2(a[1]) + "L" + r2(b[0]) + "," + r2(b[1]);
        }
    }
    return { land, graticule };
}

export interface BasemapStyle {
    /** Land fill colour (drawn at low opacity). */
    landFill: string;
    /** Coastline + graticule stroke colour. */
    stroke: string;
    /** Land fill opacity 0..1. */
    fillOpacity?: number;
    /** Graticule spacing in degrees (0 = grid off). */
    graticuleStep?: number;
}

/**
 * Draw the outline-map backdrop into a pre-created, pre-cleared group. Two paths
 * only (graticule under land), so it costs almost nothing and never touches the
 * node/edge DOM. The caller owns the gate (geo mode + toggle) and clears the group
 * when the map is off.
 */
export function renderBasemap(group: G, geo: GraphGeometry, style: BasemapStyle): void {
    group.selectAll("*").remove();
    const { land, graticule } = basemapPaths(geo, style.graticuleStep ?? 30);
    if (graticule) {
        group.append("path")
            .attr("d", graticule)
            .attr("fill", "none")
            .attr("stroke", style.stroke)
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.18)
            .attr("pointer-events", "none");
    }
    group.append("path")
        .attr("d", land)
        .attr("fill", style.landFill)
        .attr("fill-opacity", style.fillOpacity ?? 0.14)
        .attr("stroke", style.stroke)
        .attr("stroke-width", 0.75)
        .attr("stroke-opacity", 0.35)
        .attr("pointer-events", "none");
}
