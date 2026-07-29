"use strict";

/**
 * On-canvas annotation renderer (NG-074). Draws each note anchored to its node:
 * a numbered marker on the node, an optional callout box offset in NODE-RADIUS
 * units (so it holds position across resize/zoom), and an optional leader line.
 *
 * Drawn into a group inside the zoom layer so notes pan/zoom with the graph.
 * Arithmetic text layout only (no getBBox) so the jsdom sweep stays valid; never
 * innerHTML (certification). Unset per-note style falls back to the theme.
 */

import { Selection } from "d3";
import { Note, AnnotationTheme } from "../notes/store";

type G = Selection<SVGGElement, unknown, null, undefined>;

export interface AnchorPos { x: number; y: number; r: number; }

const PAD = 6;
const LINE_H = 1.35;
const MAX_LINE_CHARS = 26;
const MAX_LINES = 6;

/** Wrap text into lines by character budget (arithmetic — no measurement). */
function wrapText(text: string): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
        if (cur && (cur.length + 1 + w.length) > MAX_LINE_CHARS) { lines.push(cur); cur = w; }
        else cur = cur ? `${cur} ${w}` : w;
        if (lines.length >= MAX_LINES) break;
    }
    if (cur && lines.length < MAX_LINES) lines.push(cur);
    return lines.length ? lines : [""];
}

/**
 * Render all notes whose anchor resolves to a visible node. `posOf(anchor)` returns
 * the node's centre + radius, or null when the node isn't on screen. `numberOf`
 * gives the note's stable 1-based index (from the store's deterministic order).
 */
export function renderNotes(
    group: G,
    notes: Note[],
    posOf: (anchor: string) => AnchorPos | null,
    numberOf: (note: Note) => number,
    theme: AnnotationTheme,
): void {
    group.selectAll("*").remove();

    for (const note of notes) {
        const p = posOf(note.anchor);
        if (!p) continue;
        const showText = note.mode === "text" || note.mode === "arrow" || note.mode === "all";
        const showLeader = note.mode === "arrow" || note.mode === "all";
        const showMarker = note.mode === "marker" || note.mode === "all";

        // Callout anchor: offset in radius units from the node centre.
        const cx = p.x + note.dx * p.r;
        const cy = p.y + note.dy * p.r;

        const size = note.style.size ?? 12;
        const fg = note.style.color ?? theme.fg;
        const bg = note.style.bg ?? theme.bg;
        const border = note.style.border ?? theme.line;
        const arrowCol = note.style.arrow ?? theme.accent;

        if (showText) {
            const lines = wrapText(note.text);
            const charW = size * 0.58;
            const boxW = Math.max(24, Math.max(...lines.map((l) => l.length)) * charW + PAD * 2);
            const lineH = size * LINE_H;
            const boxH = lines.length * lineH + PAD * 2;
            const bx = cx - boxW / 2, by = cy - boxH / 2;

            if (showLeader) {
                group.append("line")
                    .attr("x1", p.x).attr("y1", p.y).attr("x2", cx).attr("y2", cy)
                    .attr("stroke", arrowCol).attr("stroke-width", 1.5).attr("stroke-opacity", 0.8);
            }
            group.append("rect")
                .attr("x", bx).attr("y", by).attr("width", boxW).attr("height", boxH)
                .attr("rx", 5).attr("ry", 5)
                .attr("fill", bg).attr("fill-opacity", 0.97)
                .attr("stroke", border).attr("stroke-width", 1);
            const text = group.append("text")
                .attr("x", bx + PAD).attr("y", by + PAD + size * 0.9)
                .attr("font-family", theme.font).attr("font-size", size).attr("fill", fg)
                .attr("font-weight", note.style.bold ? 700 : 400)
                .attr("font-style", note.style.italic ? "italic" : null);
            lines.forEach((ln, i) => {
                text.append("tspan").attr("x", bx + PAD).attr("dy", i === 0 ? 0 : lineH).text(ln);
            });
        }

        if (showMarker) {
            const mr = Math.max(7, p.r * 0.5);
            group.append("circle")
                .attr("cx", p.x).attr("cy", p.y).attr("r", mr)
                .attr("fill", theme.accent).attr("stroke", theme.bg).attr("stroke-width", 1.5);
            group.append("text")
                .attr("x", p.x).attr("y", p.y).attr("text-anchor", "middle").attr("dominant-baseline", "central")
                .attr("font-family", theme.font).attr("font-size", mr * 1.1).attr("font-weight", 700)
                .attr("fill", theme.bg).attr("pointer-events", "none")
                .text(String(numberOf(note)));
        }
    }
}
