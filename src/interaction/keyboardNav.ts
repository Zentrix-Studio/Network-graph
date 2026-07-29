"use strict";

/**
 * Arrow-key node-to-node navigation (NG-081, accessibility). Given the on-screen
 * node positions and a focused node, pick the best node to move focus to in a
 * compass direction. Pure & deterministic — no DOM, no Power BI deps — so it's
 * unit-testable and safe in the jsdom sweep.
 *
 * A candidate must lie inside a 45° cone around the requested direction (screen
 * space: y grows downward). Among cone candidates the nearest wins; ties break to
 * the lowest index so focus order is stable. Returns -1 when nothing lies that way.
 */

export type NavDirection = "up" | "down" | "left" | "right";

const UNIT: Record<NavDirection, [number, number]> = {
    right: [1, 0],
    left: [-1, 0],
    up: [0, -1],
    down: [0, 1],
};

/** Map a KeyboardEvent.key to a direction, or null if it isn't an arrow key. */
export function arrowDirection(key: string): NavDirection | null {
    switch (key) {
        case "ArrowRight": return "right";
        case "ArrowLeft": return "left";
        case "ArrowUp": return "up";
        case "ArrowDown": return "down";
        default: return null;
    }
}

export function pickDirectionalNeighbor(
    points: { x: number; y: number }[], from: number, direction: NavDirection,
): number {
    if (from < 0 || from >= points.length) return -1;
    const [ux, uy] = UNIT[direction];
    const o = points[from];
    let best = -1, bestDist = Infinity;
    for (let j = 0; j < points.length; j++) {
        if (j === from) continue;
        const dx = points[j].x - o.x, dy = points[j].y - o.y;
        const along = dx * ux + dy * uy;          // component toward the direction
        if (along <= 0) continue;                  // behind or sideways-only → skip
        const perp = Math.abs(dx * -uy + dy * ux); // perpendicular distance
        if (perp > along) continue;                // outside the 45° cone
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist - 1e-9) { bestDist = dist; best = j; }
    }
    return best;
}
