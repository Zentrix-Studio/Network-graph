"use strict";

/**
 * Radial (radial-tree) layout — a root at the centre with its hierarchy fanning
 * outward in concentric rings. This is the "star" / hub-and-spoke reading of a
 * network: centre an entity, inspect what radiates from it. Canonically called
 * "Radial" by every major toolkit (yFiles, KeyLines, ZoomCharts), which is why
 * that is the user-facing label.
 *
 * It is `treeLayout` in polar coordinates and shares its input contract exactly:
 * a parent-key array parallel to `model.nodes`, from either the Node-parent role
 * or `deriveTreeParents`. Depth becomes radius, sibling order becomes angle.
 *
 * Each subtree owns an angular WEDGE sized by its leaf count, so a heavy branch
 * gets proportionally more of the circle and children stay clustered under their
 * own parent (the balloon-like reading) instead of being smeared around a shared
 * global ring.
 *
 * Pure, deterministic, no Power BI deps. Cycles, missing parents, disconnected
 * components and empty graphs are all handled defensively — never throws, never
 * hangs, never emits NaN.
 */

import { GraphModel, LayoutResult, Vec2 } from "./graphTypes";

/** Base radius added per depth level. */
const RING_GAP = 90;
/**
 * Minimum arc length between adjacent nodes on the same ring. Rings grow beyond
 * RING_GAP when a level is crowded, so a wide level spreads outward rather than
 * overlapping. This also keeps inner-ring edges long enough to be traceable —
 * radial link-following degrades badly when edges are short relative to the
 * canvas, so we buy length with radius.
 */
const MIN_ARC = 46;

export function radialLayout(model: GraphModel, parentKey: (string | null)[]): LayoutResult {
    const n = model.nodes.length;
    const positions: Vec2[] = new Array(n);
    if (n === 0) return { positions, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, iterations: 0 };

    const { children, roots } = buildForest(model, parentKey, n);

    // A single root sits dead centre. With several (disconnected components, or a
    // genuine multi-root hierarchy) a virtual centre holds them one ring out, so
    // every component is laid out radially rather than one being privileged.
    const rootDepth = roots.length === 1 ? 0 : 1;

    const leaves = leafWeights(children, roots, n);
    const depth = new Array<number>(n).fill(-1);
    const angle = new Array<number>(n).fill(0);

    // Sweep the circle: each root takes a wedge proportional to its own leaf count.
    let totalLeaves = 0;
    for (const r of roots) totalLeaves += leaves[r];
    if (totalLeaves <= 0) totalLeaves = roots.length || 1;

    if (roots.length === 1) {
        // A single root sits dead centre and fans its children over the circle. Size
        // the sweep as if there were one extra phantom leaf, leaving an angular gap so
        // the fan never closes into a full 2π. Without the gap a root with exactly two
        // equal children places them at π/2 and 3π/2 — antipodal, hence collinear with
        // the centre root, so a ~3-node single component collapses to a straight line
        // (G1-002) instead of a star. The gap is wide when children are few (it breaks
        // the degeneracy) and shrinks toward nothing as the leaf count grows, so a wide
        // star is visually unchanged.
        const r = roots[0];
        const span = (2 * Math.PI * leaves[r]) / (totalLeaves + 1);
        assignWedge(r, 0, span, rootDepth, children, leaves, depth, angle);
    } else {
        let cursor = 0;
        for (const r of roots) {
            const span = (2 * Math.PI * leaves[r]) / totalLeaves;
            assignWedge(r, cursor, cursor + span, rootDepth, children, leaves, depth, angle);
            cursor += span;
        }
    }

    // Nodes the sweep never reached (defensive — buildForest should make them roots).
    let orphan = 0;
    for (let i = 0; i < n; i++) {
        if (depth[i] === -1) { depth[i] = 1; angle[i] = orphan++ * 0.6; }
    }

    const radii = ringRadii(depth, n);
    for (let i = 0; i < n; i++) {
        const r = radii[depth[i]];
        positions[i] = { x: r * Math.cos(angle[i]), y: r * Math.sin(angle[i]) };
    }

    return { positions, bounds: boundsOf(positions), iterations: 0 };
}

/**
 * Parent-key array → children lists + root set. Mirrors `treeLayout`'s defence:
 * a missing, self-referential or cyclic parent demotes the node to a root, so a
 * malformed hierarchy degrades into a forest instead of hanging.
 */
function buildForest(model: GraphModel, parentKey: (string | null)[], n: number):
    { children: number[][]; roots: number[] } {
    const children: number[][] = model.nodes.map(() => []);
    const parentIdx = new Array<number>(n).fill(-1);

    for (let i = 0; i < n; i++) {
        const pk = parentKey[i];
        if (pk == null) continue;
        const p = model.indexByKey.get(pk);
        if (p === undefined || p === i) continue; // missing / self → root
        parentIdx[i] = p;
    }

    for (let i = 0; i < n; i++) {
        let steps = 0;
        let at = parentIdx[i];
        const guard = n + 1;
        while (at !== -1 && steps++ < guard) {
            if (at === i) { parentIdx[i] = -1; break; } // cycle → root
            at = parentIdx[at];
        }
    }

    const roots: number[] = [];
    for (let i = 0; i < n; i++) {
        if (parentIdx[i] === -1) roots.push(i);
        else children[parentIdx[i]].push(i);
    }
    return { children, roots };
}

/**
 * Leaf count per subtree — the wedge weight. A branch with more leaves needs more
 * of the circle; sizing by leaves rather than by child count is what stops a deep
 * narrow branch from crowding out a wide shallow one. Iterative post-order so a
 * deep hierarchy can't overflow the stack.
 */
function leafWeights(children: number[][], roots: number[], n: number): number[] {
    const w = new Array<number>(n).fill(0);
    const visited = new Array<boolean>(n).fill(false);

    for (const root of roots) {
        if (visited[root]) continue;
        visited[root] = true;
        const stack: { node: number; ptr: number }[] = [{ node: root, ptr: 0 }];
        while (stack.length) {
            const f = stack[stack.length - 1];
            if (f.ptr < children[f.node].length) {
                const c = children[f.node][f.ptr++];
                if (!visited[c]) { visited[c] = true; stack.push({ node: c, ptr: 0 }); }
            } else {
                const kids = children[f.node];
                if (kids.length === 0) w[f.node] = 1;
                else { let s = 0; for (const c of kids) s += w[c]; w[f.node] = s || 1; }
                stack.pop();
            }
        }
    }
    for (let i = 0; i < n; i++) if (w[i] === 0) w[i] = 1;
    return w;
}

/**
 * Hand each subtree an angular wedge and place its node at the wedge's midpoint.
 * Children subdivide the parent's wedge by leaf weight, so a node always sits
 * over its own children. Iterative for the same stack-depth reason as above.
 */
function assignWedge(
    root: number, a0: number, a1: number, rootDepth: number,
    children: number[][], leaves: number[],
    depth: number[], angle: number[],
): void {
    const stack: { node: number; a0: number; a1: number; d: number }[] = [{ node: root, a0, a1, d: rootDepth }];
    const seen = new Set<number>();
    while (stack.length) {
        const f = stack.pop()!;
        if (seen.has(f.node)) continue;
        seen.add(f.node);

        depth[f.node] = f.d;
        angle[f.node] = (f.a0 + f.a1) / 2;

        const kids = children[f.node];
        if (kids.length === 0) continue;
        let total = 0;
        for (const c of kids) total += leaves[c];
        if (total <= 0) total = kids.length;

        let at = f.a0;
        const width = f.a1 - f.a0;
        for (const c of kids) {
            const span = (width * leaves[c]) / total;
            stack.push({ node: c, a0: at, a1: at + span, d: f.d + 1 });
            at += span;
        }
    }
}

/**
 * Radius per depth. Starts at `depth * RING_GAP` but expands any ring that is too
 * crowded to satisfy MIN_ARC, then forces the sequence monotonically increasing
 * so an expanded inner ring can never swallow the one outside it.
 */
function ringRadii(depth: number[], n: number): number[] {
    let maxD = 0;
    for (let i = 0; i < n; i++) if (depth[i] > maxD) maxD = depth[i];

    const count = new Array<number>(maxD + 1).fill(0);
    for (let i = 0; i < n; i++) count[depth[i]]++;

    const radii = new Array<number>(maxD + 1).fill(0);
    for (let d = 0; d <= maxD; d++) {
        const needed = (count[d] * MIN_ARC) / (2 * Math.PI);
        radii[d] = Math.max(d * RING_GAP, d === 0 ? 0 : needed);
        if (d > 0 && radii[d] <= radii[d - 1]) radii[d] = radii[d - 1] + RING_GAP;
    }
    return radii;
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
