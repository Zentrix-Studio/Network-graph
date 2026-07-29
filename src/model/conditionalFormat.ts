"use strict";

/**
 * Conditional formatting rule engine (R-cf). Only Powerviz & Inforiver offer
 * rule-based node colouring in the Power BI field — and NONE key rules off a
 * *computed* graph metric. Here an author builds ANY number of rules, each firing
 * on a numeric field (degree / weighted / size / centrality) with ≥ > ≤ < = ≠, OR
 * on a text field (node name / category) with is / is not / contains / starts
 * with… — no DAX. Rules are stored as a serialized list (not fixed slots), so the
 * count is unbounded. Pure, deterministic, Power-BI-free.
 */

import { GraphModel } from "./graphTypes";
import { NodeAttr } from "../types";

export type CFFieldType = "num" | "text";
export interface CFFieldDef { id: string; label: string; type: CFFieldType }

/** The fields a rule can test. Numeric ones read metrics; text ones read strings. */
export const CF_FIELDS: CFFieldDef[] = [
    { id: "degree", label: "Degree", type: "num" },
    { id: "weighted", label: "Value", type: "num" },
    { id: "size", label: "Node value", type: "num" },
    { id: "centrality", label: "Importance", type: "num" },
    { id: "name", label: "Name", type: "text" },
    { id: "category", label: "Category", type: "text" },
];

/** [id, glyph] operator lists, by field type. */
export const CF_NUM_OPS: [CFOperator, string][] = [
    ["gte", "≥"], ["gt", ">"], ["lte", "≤"], ["lt", "<"], ["eq", "="], ["ne", "≠"],
];
export const CF_TEXT_OPS: [CFOperator, string][] = [
    ["is", "is"], ["isnot", "is not"], ["contains", "contains"],
    ["ncontains", "doesn’t contain"], ["starts", "starts with"], ["nstarts", "doesn’t start with"],
];

export type CFOperator =
    | "gte" | "gt" | "lte" | "lt" | "eq" | "ne"
    | "is" | "isnot" | "contains" | "ncontains" | "starts" | "nstarts";

/** value is stored as a string (JSON-friendly); numeric rules parse it at eval. */
export interface CFRule {
    enabled: boolean;
    field: string;
    op: CFOperator;
    value: string;
    color: string;
}

const TEXT_OPS = new Set<CFOperator>(["is", "isnot", "contains", "ncontains", "starts", "nstarts"]);
export function isTextOp(op: CFOperator): boolean { return TEXT_OPS.has(op); }
export function fieldType(fieldId: string): CFFieldType {
    return CF_FIELDS.find((f) => f.id === fieldId)?.type ?? "num";
}
/** Operators valid for a field, so the UI can offer the right set. */
export function operatorsFor(fieldId: string): [CFOperator, string][] {
    return fieldType(fieldId) === "text" ? CF_TEXT_OPS : CF_NUM_OPS;
}

export function numMatch(v: number, op: CFOperator, value: number): boolean {
    switch (op) {
        case "gte": return v >= value;
        case "gt": return v > value;
        case "lte": return v <= value;
        case "lt": return v < value;
        case "eq": return v === value;
        case "ne": return v !== value;
        default: return false;
    }
}

export function textMatch(v: string, op: CFOperator, value: string): boolean {
    const a = v.toLowerCase(), b = value.toLowerCase();
    switch (op) {
        case "is": return a === b;
        case "isnot": return a !== b;
        case "contains": return a.includes(b);
        case "ncontains": return !a.includes(b);
        case "starts": return a.startsWith(b);
        case "nstarts": return !a.startsWith(b);
        default: return false;
    }
}

/**
 * First enabled rule that matches wins → its colour, else null (keep base colour).
 * `resolve` maps a field id to the node's value (number for metrics, string for
 * name/category, null = unavailable → that rule is skipped).
 */
export function conditionalColor(
    rules: CFRule[], resolve: (field: string) => number | string | null,
): string | null {
    for (const r of rules) {
        if (!r.enabled || !r.color) continue;
        const v = resolve(r.field);
        if (v == null || v === "") continue;
        if (isTextOp(r.op)) {
            if (textMatch(String(v), r.op, r.value)) return r.color;
        } else {
            const n = typeof v === "number" ? v : Number(v);
            const t = Number(r.value);
            if (Number.isFinite(n) && Number.isFinite(t) && numMatch(n, r.op, t)) return r.color;
        }
    }
    return null;
}

/** Resolve a node's value for a CF field id — the single place field ids map to data. */
export function resolveNodeField(
    model: GraphModel, attrs: NodeAttr[], centrality: number[] | null, i: number, field: string,
): number | string | null {
    switch (field) {
        case "degree": return model.nodes[i].degree;
        case "weighted": return model.nodes[i].weightedDegree;
        case "size": return attrs[i]?.size ?? model.nodes[i].weightedDegree;
        case "centrality": return centrality ? centrality[i] : null;
        case "name": return model.nodes[i].key;
        case "category": return attrs[i]?.category ?? null;
        default: return null;
    }
}

/** Parse the persisted rules blob → validated rules (empty on absent/invalid). */
export function parseRules(blob: string | null | undefined): CFRule[] {
    if (!blob) return [];
    try {
        const raw = JSON.parse(blob);
        if (!Array.isArray(raw)) return [];
        const validField = new Set(CF_FIELDS.map((f) => f.id));
        return raw
            .filter((r) => r && typeof r === "object" && validField.has(r.field))
            .map((r): CFRule => ({
                enabled: !!r.enabled,
                field: String(r.field),
                op: r.op as CFOperator,
                value: r.value == null ? "" : String(r.value),
                color: typeof r.color === "string" ? r.color : "",
            }))
            .filter((r) => operatorsFor(r.field).some((o) => o[0] === r.op));
    } catch {
        return [];
    }
}

export function serializeRules(rules: CFRule[]): string {
    return JSON.stringify(rules);
}

/** A fresh rule with sensible defaults (used by the editor's "Add rule"). */
export function defaultRule(color: string): CFRule {
    return { enabled: true, field: "degree", op: "gte", value: "5", color };
}
