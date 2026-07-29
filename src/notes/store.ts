"use strict";

import type { GraphNode } from "../model/graphTypes";

/**
 * The NETWORK-GRAPH-SPECIFIC half of the annotation system (NG-074).
 *
 * `./core.ts` is a mirror of `@zentrix/visual-annotations` and is generic: it knows
 * about a `Note` with an opaque `anchor` string, and nothing else. THIS file is the
 * one thing the shared package deliberately cannot own — how a graph node turns into
 * an anchor.
 *
 * Everything else (store, editor model, blob format, caps, validation) is shared.
 * Keep it that way: a graph-shaped assumption leaking into core.ts is what stops the
 * calendar / bar / bullet charts from inheriting this.
 */

export * from "./core";

/**
 * The anchor key for a graph node: its NATURAL KEY — the node identifier (the source/
 * target category value), exactly as `buildGraphModel` interns it.
 *
 * This is a natural key, NOT a selectionId. Selection ids here are built from a row
 * index into the edge table (`dataTransform.ts` / `buildSelectionIds`): the index
 * churns on every data refresh and is many-per-node, so a selectionId-keyed note could
 * not survive a refresh and could never attach cleanly to a single node. A node's key
 * IS its identity — a refresh re-derives the same key, so the note re-attaches.
 */
export function nodeNoteKey(node: GraphNode): string {
    return node.key;
}
