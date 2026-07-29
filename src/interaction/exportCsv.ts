"use strict";

/**
 * CSV export (N1). Builds the node-metrics and edge-list tables as CSV text —
 * pure string assembly, no DOM, no Power BI imports — handed to the host's
 * downloadService (privilege: ExportContent; the host/tenant policy decides
 * whether the download is allowed, we never bypass it). RFC-4180 quoting.
 */

import { GraphModel } from "../model/graphTypes";
import { NodeAttr } from "../types";

/** Quote a CSV cell when needed (comma, quote, newline). */
function cell(v: string | number | null | undefined): string {
    if (v == null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface NodeCsvInput {
    model: GraphModel;
    attrs: NodeAttr[];
    hasCategory: boolean;
    community: number[] | null;
    centrality: number[] | null;
    centralityLabel: string | null;
}

export type ExportRow = (string | number | null)[];

/** Node data shared by CSV, PDF, and Excel exports. */
export function buildNodeRows(input: NodeCsvInput): ExportRow[] {
    const { model, attrs } = input;
    const head: ExportRow = ["Node", "Degree", "Weighted degree", "Component"];
    if (input.hasCategory) head.push("Category");
    if (input.community) head.push("Cluster");
    if (input.centrality) head.push(input.centralityLabel || "Centrality");

    const rows: ExportRow[] = [head];
    for (let i = 0; i < model.nodes.length; i++) {
        const n = model.nodes[i];
        const row: ExportRow = [n.label, n.degree, round2(n.weightedDegree), n.component + 1];
        if (input.hasCategory) row.push(attrs[i]?.category ?? "");
        if (input.community) row.push(input.community[i] != null ? input.community[i] + 1 : "");
        if (input.centrality) row.push(round2(input.centrality[i] ?? 0));
        rows.push(row);
    }
    return rows;
}

/** The node-metrics table (mirrors the summary-table view). */
export function buildNodesCsv(input: NodeCsvInput): string {
    return buildNodeRows(input).map((row) => row.map(cell).join(",")).join("\r\n");
}

/** Edge data shared by CSV, PDF, and Excel exports. */
export function buildEdgeRows(model: GraphModel, types: (string | null)[]): ExportRow[] {
    const rows: ExportRow[] = [["Source", "Target", "Weight", "Type"]];
    model.links.forEach((l, li) => {
        rows.push([
            model.nodes[l.source].label,
            model.nodes[l.target].label,
            round2(l.weight),
            types[li] ?? "",
        ]);
    });
    return rows;
}

/** The edge-list table (source, target, weight, type). */
export function buildEdgesCsv(model: GraphModel, types: (string | null)[]): string {
    return buildEdgeRows(model, types).map((row) => row.map(cell).join(",")).join("\r\n");
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
