"use strict";

/**
 * Barnes-Hut quadtree for O(n log n) many-body repulsion. A naive force layout
 * computes every node-pair repulsion (O(n²)) and melts down past a few hundred
 * nodes — exactly why the free Microsoft network visuals take 20-300+ seconds on
 * ~13k records (see research/phase-1-idea-validation.md). This approximates the
 * repulsive force from a distant cluster of nodes by their centre of mass,
 * gated by the Barnes-Hut opening criterion (s/d < theta), which is what makes
 * the 2k-node / 5k-edge interactive budget reachable.
 *
 * Fully deterministic: build order and traversal order are fixed by node index,
 * and all arithmetic is pure. No DOM, no Power BI dependencies.
 */

import { Vec2 } from "./graphTypes";

interface QuadNode {
    // Region bounds.
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    // Aggregate mass (node count) and centre of mass.
    mass: number;
    cx: number;
    cy: number;
    // Exactly one of these is set for a populated cell.
    bodyIndex: number; // leaf holding a single body, else -1
    children: (QuadNode | null)[] | null; // [NW, NE, SW, SE] for internal cells
}

function makeCell(x0: number, y0: number, x1: number, y1: number): QuadNode {
    return { x0, y0, x1, y1, mass: 0, cx: 0, cy: 0, bodyIndex: -1, children: null };
}

/** Build a quadtree over the given positions. Bounds are squared-off to keep
 *  the four quadrants uniform (stabilises the opening criterion). */
export function buildQuadtree(positions: Vec2[]): QuadNode {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) {
        minX = minY = -1;
        maxX = maxY = 1;
    }
    // Pad and square the root so the domain is non-degenerate.
    const size = Math.max(maxX - minX, maxY - minY, 1e-6) * 1.01;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const root = makeCell(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);

    for (let i = 0; i < positions.length; i++) insert(root, positions, i);
    return root;
}

function insert(cell: QuadNode, positions: Vec2[], i: number): void {
    // Empty leaf: park the body here.
    if (cell.mass === 0 && cell.bodyIndex === -1 && cell.children === null) {
        cell.bodyIndex = i;
        cell.mass = 1;
        cell.cx = positions[i].x;
        cell.cy = positions[i].y;
        return;
    }
    // Leaf with a resident body: subdivide and push the resident down first.
    if (cell.children === null) {
        const resident = cell.bodyIndex;
        cell.children = [null, null, null, null];
        cell.bodyIndex = -1;
        if (resident >= 0) placeIntoChild(cell, positions, resident);
    }
    placeIntoChild(cell, positions, i);
    // Update aggregate centre of mass incrementally.
    const m = cell.mass;
    cell.cx = (cell.cx * m + positions[i].x) / (m + 1);
    cell.cy = (cell.cy * m + positions[i].y) / (m + 1);
    cell.mass = m + 1;
}

function placeIntoChild(cell: QuadNode, positions: Vec2[], i: number): void {
    const midX = (cell.x0 + cell.x1) / 2;
    const midY = (cell.y0 + cell.y1) / 2;
    const east = positions[i].x >= midX;
    const south = positions[i].y >= midY;
    const q = (south ? 2 : 0) + (east ? 1 : 0); // 0=NW,1=NE,2=SW,3=SE
    if (!cell.children![q]) {
        cell.children![q] = makeCell(
            east ? midX : cell.x0,
            south ? midY : cell.y0,
            east ? cell.x1 : midX,
            south ? cell.y1 : midY,
        );
    }
    insert(cell.children![q]!, positions, i);
}

/**
 * Accumulate the repulsive force on body `i` at position `p`. `strength` is the
 * (negative) charge; `theta` is the Barnes-Hut opening threshold (smaller = more
 * accurate, slower). A soft `epsilon` avoids singularities when nodes coincide.
 */
export function accumulateRepulsion(
    root: QuadNode,
    i: number,
    p: Vec2,
    strength: number,
    theta: number,
    force: Vec2,
): void {
    const theta2 = theta * theta;
    const eps2 = 1e-6;

    const visit = (cell: QuadNode | null): void => {
        if (!cell || cell.mass === 0) return;
        // Skip self-only leaf.
        if (cell.bodyIndex === i && cell.mass === 1) return;

        const dx = cell.cx - p.x;
        const dy = cell.cy - p.y;
        let d2 = dx * dx + dy * dy;
        const width = cell.x1 - cell.x0;

        // Opening criterion: treat a far-enough cell as a single point mass.
        if (cell.children === null || (width * width) / (d2 + eps2) < theta2) {
            if (d2 < eps2) d2 = eps2; // soften coincident nodes
            // Charge model: w = strength·mass / d². `strength` is negative, and
            // (dx, dy) points from the body toward the mass, so (dx·w, dy·w)
            // pushes the body *away* — repulsion, with inverse-square falloff.
            const w = (strength * cell.mass) / d2;
            force.x += dx * w;
            force.y += dy * w;
            return;
        }
        for (const c of cell.children) visit(c);
    };

    visit(root);
}
