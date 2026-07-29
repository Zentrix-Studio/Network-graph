"use strict";

/**
 * Deterministic hashing + PRNG — the backbone of the visual's hard determinism
 * requirement. The force simulation must produce identical positions for the
 * same DataView, so every source of "randomness" (initial node placement, the
 * tiny jiggle that separates coincident nodes) is derived here from the node's
 * natural key — NEVER from `Math.random`, `Date.now`, or iteration wall-clock.
 *
 * Why this matters commercially: ZoomCharts (the market leader) re-solves its
 * force layout non-deterministically and cannot save a layout, so the graph
 * "dances" on every refresh — the single most-cited network-visual complaint.
 * Deterministic seeding is the foundation that makes our pinned-layout mode
 * (feature-reference.md wedge #1) possible.
 */

/**
 * xmur3 string hash → a 32-bit seed. Fast, well-distributed, dependency-free.
 * Same string always yields the same seed on every platform (pure integer math).
 */
export function hashKey(str: string): number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32 PRNG. Given a 32-bit seed, returns a function yielding a
 * deterministic sequence of floats in [0, 1). Seeded from `hashKey`, this gives
 * each node a stable, reproducible starting position and jiggle.
 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stable float in [0, 1) for a given key (single draw). */
export function unitForKey(key: string): number {
    return mulberry32(hashKey(key))();
}

/**
 * Seeded initial position for a node, spread over a disk of the given radius.
 * Deterministic in the node key alone — two runs over the same nodes place them
 * identically, and adding/removing other nodes never moves this one's seed.
 */
export function seedPosition(key: string, radius: number): { x: number; y: number } {
    const rand = mulberry32(hashKey(key));
    // Uniform-over-disk: r = R·√u keeps points from clumping at the centre.
    const r = radius * Math.sqrt(rand());
    const theta = 2 * Math.PI * rand();
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}
