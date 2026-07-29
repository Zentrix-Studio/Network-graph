"use strict";

/**
 * Classic layered tree layout (Enterprise E4, org-chart/tree mode). Nodes use
 * the original fixed-width leaf sweep and independently centred depth rows that
 * shipped before NG-224. Pure and deterministic; malformed hierarchies cannot
 * hang or throw.
 */

import { GraphModel, LayoutResult, Vec2 } from "./graphTypes";

const LEVEL_H = 80;
const LEAF_W = 90;

/**
 * @param parentKey per node index: the parent node's natural key, or null.
 * A parent that is missing, self-referential, or forms a cycle makes the node a root.
 * @param viewport optional render viewport used only for the established
 * space-around treatment of shallow/wide hierarchies.
 */
export function treeLayout(
    model: GraphModel,
    parentKey: (string | null)[],
    viewport?: { width: number; height: number },
    nodeRadii?: number[],
    labelWidths?: number[],
): LayoutResult {
    // Retained in the public signature for resolveLayout/report compatibility.
    // The restored classic geometry intentionally does not vary with marker/label size.
    void nodeRadii;
    void labelWidths;
    const n = model.nodes.length;
    if (n === 0) {
        return { positions: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, iterations: 0 };
    }
    const children: number[][] = model.nodes.map(() => []);
    const parentIdx = new Array<number>(n).fill(-1);

    for (let i = 0; i < n; i++) {
        const pk = parentKey[i];
        if (pk == null) continue;
        const p = model.indexByKey.get(pk);
        if (p === undefined || p === i) continue; // missing / self → root
        parentIdx[i] = p;
    }

    // Break cycles: if walking up from a node returns to it, treat it as a root.
    for (let i = 0; i < n; i++) {
        let steps = 0;
        let at = parentIdx[i];
        const guard = n + 1;
        while (at !== -1 && steps++ < guard) {
            if (at === i) { parentIdx[i] = -1; break; }
            at = parentIdx[at];
        }
    }

    const roots: number[] = [];
    for (let i = 0; i < n; i++) {
        if (parentIdx[i] === -1) roots.push(i);
        else children[parentIdx[i]].push(i);
    }

    // Original in-order leaf sweep, implemented iteratively so a very deep tree
    // cannot overflow the JavaScript call stack.
    const preorder: number[] = [];
    const depth = new Array<number>(n).fill(0);
    const stack = roots.slice().reverse();
    while (stack.length) {
        const at = stack.pop()!;
        preorder.push(at);
        for (let k = children[at].length - 1; k >= 0; k--) {
            const child = children[at][k];
            depth[child] = depth[at] + 1;
            stack.push(child);
        }
    }
    const positions: Vec2[] = new Array(n);
    let leaf = 0;
    for (const i of preorder) {
        if (children[i].length === 0) {
            positions[i] = { x: leaf++ * LEAF_W, y: depth[i] * LEVEL_H };
        }
    }
    for (let p = preorder.length - 1; p >= 0; p--) {
        const i = preorder[p];
        if (positions[i]) continue;
        const first = positions[children[i][0]].x;
        const last = positions[children[i][children[i].length - 1]].x;
        positions[i] = { x: (first + last) / 2, y: depth[i] * LEVEL_H };
    }

    // Restore the former row-by-row centring. It keeps every hierarchy level
    // visually balanced in the tile and is the appearance existing authors know.
    const byDepth = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const row = byDepth.get(depth[i]);
        if (row) row.push(i);
        else byDepth.set(depth[i], [i]);
    }
    for (const row of byDepth.values()) {
        let min = Infinity, max = -Infinity;
        for (const i of row) {
            min = Math.min(min, positions[i].x);
            max = Math.max(max, positions[i].x);
        }
        const shift = -(min + max) / 2;
        for (const i of row) positions[i].x += shift;
    }

    if (viewport) spaceAroundLevels(positions, viewport.width, viewport.height);
    return { positions, bounds: boundsOf(positions), iterations: 0 };
}

function boundsOf(positions: Vec2[]): LayoutResult["bounds"] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
    return { minX, minY, maxX, maxY };
}

/**
 * Distribute the depth levels vertically SPACE-AROUND (not space-between), and grow
 * a narrow tree's width to fill the viewport. Deterministic; scales about the
 * bounding-box centre so the tree stays centred. Same input ⇒ same output.
 *
 * The wide/shallow case is the important one. The final uniform (circle-preserving)
 * fitTransform width-binds such a tree, so we only control how tall the level band
 * ends up. If we grew it to fill the height edge-to-edge, a parent→child chart would
 * glue its two rows to the top and bottom borders ("space-between") with a vast empty
 * middle. Instead we size the vertical extent so that, once the fit width-binds, the
 * L depth levels span exactly (L-1)/L of the viewport height — leaving equal half-gap
 * margins above the first level and below the last. That is CSS `space-around`: two
 * levels land at ¼ and ¾ height, three at ⅙/½/⅚, and so on. As L grows this tends
 * back toward filling the height, which is what a deep tree wants.
 *
 * Because the target span is < the viewport height by construction, the fit always
 * width-binds and the levels can never blow apart to the edges — so no stretch cap is
 * needed here (the old MAX guard existed only to tame the edge-to-edge stretch).
 */
function spaceAroundLevels(positions: Vec2[], vw: number, vh: number): void {
    if (!(vw > 0) || !(vh > 0) || positions.length < 2) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const gw = maxX - minX, gh = maxY - minY;
    if (!(gw > 0)) return; // single column — no width to anchor the aspect to
    const targetAspect = vw / vh;
    const contentAspect = gh > 0 ? gw / gh : Infinity;

    if (contentAspect > targetAspect) {
        // Wide/shallow → the fit width-binds. Size the vertical band so the L levels
        // span (L-1)/L of the viewport height ⇒ space-around margins. Needs gh > 0
        // (≥ 2 distinct levels) to scale; a single level has nothing to distribute.
        const L = distinctLevels(positions);
        if (L < 2 || !(gh > 0)) return;
        const desiredGh = (vh * gw / vw) * (L - 1) / L; // width-bound span target
        const f = desiredGh / gh;
        const cy = (minY + maxY) / 2;
        for (const p of positions) p.y = cy + (p.y - cy) * f;
    } else if (contentAspect < targetAspect) {
        // Too tall/narrow → grow width to fill. Scale X about the horizontal centre.
        const f = Math.min(12, targetAspect / contentAspect);
        const cx = (minX + maxX) / 2;
        for (const p of positions) p.x = cx + (p.x - cx) * f;
    }
}

/** Number of distinct depth levels (distinct y positions) present in the layout. */
function distinctLevels(positions: Vec2[]): number {
    const ys = new Set<number>();
    for (const p of positions) ys.add(p.y);
    return ys.size;
}

/**
 * Derive the original readable hierarchy from graph structure when no explicit
 * Node-parent role is bound: highest-degree root per component, followed by a
 * deterministic breadth-first spanning forest.
 *
 * @returns a parent-key array parallel to `model.nodes` (null = a component root),
 * in the exact shape `treeLayout`/`resolveLayout` already consume.
 */
export function deriveTreeParents(model: GraphModel): (string | null)[] {
    const n = model.nodes.length;
    const adj: number[][] = model.nodes.map(() => []);
    for (const l of model.links) {
        if (l.source === l.target) continue; // self-loops carry no hierarchy
        adj[l.source].push(l.target);
        adj[l.target].push(l.source);
    }

    const parentIdx = new Array<number>(n).fill(-1);
    const visited = new Array<boolean>(n).fill(false);

    // Resolve one component at a time, retaining the former degree-first root.
    for (let seed = 0; seed < n; seed++) {
        if (visited[seed]) continue;
        const component: number[] = [];
        const discover = [seed];
        const inComponent = new Set<number>([seed]);
        for (let head = 0; head < discover.length; head++) {
            const u = discover[head];
            component.push(u);
            for (const v of adj[u]) if (!inComponent.has(v)) {
                inComponent.add(v);
                discover.push(v);
            }
        }
        const start = component.slice().sort((a, b) =>
            (model.nodes[b].degree - model.nodes[a].degree) || (a - b))[0];

        visited[start] = true;
        const queue = [start]; // BFS from this component's root
        for (let head = 0; head < queue.length; head++) {
            const u = queue[head];
            const neighbors = [...new Set(adj[u])].sort((a, b) =>
                (model.nodes[b].degree - model.nodes[a].degree)
                || model.nodes[a].label.localeCompare(model.nodes[b].label) || (a - b));
            for (const v of neighbors) {
                if (visited[v]) continue;
                visited[v] = true;
                parentIdx[v] = u;
                queue.push(v);
            }
        }
    }

    return model.nodes.map((node, i) => (parentIdx[i] === -1 ? null : model.nodes[parentIdx[i]].key));
}
