"use strict";

/**
 * Node-parent hierarchy helpers for expand/collapse (folding subtrees) and drill-down.
 * A parent-key accessor (from the Node-parent role, or a derived spanning forest) gives
 * each node its parent; from that we build children lists and, for a set of collapsed
 * parents, the set of hidden descendants. Pure, deterministic, defensive against cycles
 * / missing / self parents (same contract as treeLayout). No Power BI / DOM deps.
 */

import { GraphModel } from "./graphTypes";

export interface Hierarchy {
    /** children[i] = node indices whose parent is i. */
    children: number[][];
    /** parentIdx[i] = parent node index, or -1 for a root. */
    parentIdx: number[];
}

/** Build children lists + parent index from a per-node parent-key accessor. */
export function buildHierarchy(model: GraphModel, parentKeyOf: (i: number) => string | null): Hierarchy {
    const n = model.nodes.length;
    const parentIdx = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
        const pk = parentKeyOf(i);
        if (pk == null) continue;
        const p = model.indexByKey.get(pk);
        if (p === undefined || p === i) continue; // missing / self → root
        parentIdx[i] = p;
    }
    // Break cycles: if walking up from a node returns to it, root it.
    for (let i = 0; i < n; i++) {
        let at = parentIdx[i], steps = 0;
        const guard = n + 1;
        while (at !== -1 && steps++ < guard) {
            if (at === i) { parentIdx[i] = -1; break; }
            at = parentIdx[at];
        }
    }
    const children: number[][] = model.nodes.map(() => []);
    for (let i = 0; i < n; i++) if (parentIdx[i] !== -1) children[parentIdx[i]].push(i);
    return { children, parentIdx };
}

/** True for nodes that have at least one child (the foldable / drillable nodes). */
export function isParentNode(h: Hierarchy, i: number): boolean {
    return h.children[i].length > 0;
}

/**
 * All node indices hidden because a collapsed ancestor folds them away. A node is hidden
 * iff any ancestor is collapsed. Iterative DFS from each collapsed node; a node collapsed
 * inside another collapsed subtree adds nothing new. O(n + edges), stack-safe.
 */
export function hiddenByCollapse(h: Hierarchy, isCollapsed: (i: number) => boolean): Set<number> {
    const hidden = new Set<number>();
    for (let root = 0; root < h.children.length; root++) {
        if (!isCollapsed(root)) continue;
        const stack = [...h.children[root]];
        while (stack.length) {
            const c = stack.pop()!;
            if (hidden.has(c)) continue;
            hidden.add(c);
            for (const cc of h.children[c]) stack.push(cc);
        }
    }
    return hidden;
}

/** A node plus all its descendants — the visible set when drilled into `root`. */
export function subtreeSet(h: Hierarchy, root: number): Set<number> {
    const s = new Set<number>([root]);
    const stack = [...h.children[root]];
    while (stack.length) {
        const c = stack.pop()!;
        if (s.has(c)) continue;
        s.add(c);
        for (const cc of h.children[c]) stack.push(cc);
    }
    return s;
}

/**
 * Depth (0-based level) of every node from a parent-index array — 0 for roots
 * (`parentIdx === -1`), parent-depth + 1 otherwise. Memoised walk-to-root; cycles are
 * already broken by `buildHierarchy` (a self-referential chain would root itself), and a
 * defensive step guard caps the walk so a stray cycle still terminates. Pure and
 * deterministic: identical `parentIdx` ⇒ identical depths, independent of iteration order.
 * This is what `level` colour mode / "By node level" colours by.
 */
export function computeDepth(parentIdx: number[]): number[] {
    const n = parentIdx.length;
    const depth = new Array<number>(n).fill(-1);
    const resolve = (i: number): number => {
        if (depth[i] !== -1) return depth[i];
        let at = i, steps = 0;
        const chain: number[] = [];
        // Walk up to the first node with a known depth or a root, collecting the chain.
        while (at !== -1 && depth[at] === -1 && steps++ <= n) {
            chain.push(at);
            at = parentIdx[at];
        }
        let base = at === -1 ? -1 : depth[at]; // depth just above the chain's top
        // Assign downward from the top of the chain.
        for (let k = chain.length - 1; k >= 0; k--) depth[chain[k]] = ++base;
        return depth[i];
    };
    for (let i = 0; i < n; i++) resolve(i);
    return depth;
}

/** Count all descendants of node i (used by hierarchy metrics and tests). */
export function descendantCount(h: Hierarchy, i: number): number {
    let count = 0;
    const stack = [...h.children[i]];
    while (stack.length) {
        const c = stack.pop()!;
        count++;
        for (const cc of h.children[c]) stack.push(cc);
    }
    return count;
}
