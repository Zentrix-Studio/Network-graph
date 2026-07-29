"use strict";

/**
 * Semantic node-icon catalog.
 *
 * The persisted value is a stable `zx:<id>` token, not a font glyph. SVG paths
 * render identically across Power BI hosts and inherit the node colour. Keep
 * this catalog entity-only: warning/check/alert/etc. are statuses and belong in
 * a badge layer, not in the primary node marker.
 */

export type IconCategory =
    "People" | "Organization" | "Technology" | "Communication" | "Documents" |
    "Finance" | "Locations" | "Supply Chain" | "Projects" | "Network";

export interface SemanticIcon {
    id: string;
    value: string;
    label: string;
    category: IconCategory;
    keywords: string;
    /** SVG path data in a 24 × 24 viewBox. Icons are stroked, never filled. */
    paths: string[];
}

const icon = (
    id: string, label: string, category: IconCategory, keywords: string, paths: string[],
): SemanticIcon => ({ id, value: `zx:${id}`, label, category, keywords, paths });

export const SEMANTIC_ICONS: readonly SemanticIcon[] = [
    // People
    icon("person", "Person", "People", "user individual contact influencer author", [
        "M20 21a8 8 0 0 0-16 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    ]),
    icon("customer", "Customer", "People", "client buyer consumer person account holder", [
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
        "M19 8v6", "M22 11h-6",
    ]),
    icon("employee", "Employee", "People", "staff worker role professional", [
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
        "M16 3.13a4 4 0 0 1 0 7.75", "M22 21v-2a4 4 0 0 0-3-3.87",
    ]),
    icon("group", "Group", "People", "team users people community audience", [
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
        "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75",
    ]),

    // Organization
    icon("company", "Company", "Organization", "organization business corporate headquarters enterprise", [
        "M3 21h18", "M6 21V4h12v17", "M9 8h2", "M13 8h2", "M9 12h2", "M13 12h2", "M9 16h2", "M13 16h2",
    ]),
    icon("department", "Department", "Organization", "division team unit hierarchy org chart", [
        "M12 3v6", "M5 21v-6h14v6", "M5 15v-3h14v3", "M9 12V9h6v3",
        "M3 21h4", "M10 21h4", "M17 21h4",
    ]),
    icon("building", "Building", "Organization", "office branch institution campus", [
        "M3 21h18", "M5 21V7l7-4 7 4v14", "M9 9h1", "M14 9h1", "M9 13h1", "M14 13h1", "M10 21v-4h4v4",
    ]),
    icon("government", "Government", "Organization", "institution public agency landmark authority", [
        "M3 10h18", "M5 10v8", "M9 10v8", "M15 10v8", "M19 10v8", "M2 21h20", "M12 3 2 8h20z",
    ]),

    // Technology
    icon("computer", "Computer", "Technology", "desktop laptop workstation device endpoint", [
        "M4 4h16v12H4z", "M8 20h8", "M12 16v4",
    ]),
    icon("mobile", "Mobile device", "Technology", "phone smartphone tablet device endpoint", [
        "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M11 18h2",
    ]),
    icon("server", "Server", "Technology", "host machine infrastructure compute", [
        "M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01", "M12 7h4", "M12 17h4",
    ]),
    icon("database", "Database", "Technology", "data storage sql repository warehouse", [
        "M4 6c0 2 3.58 4 8 4s8-2 8-4-3.58-4-8-4-8 2-8 4z", "M4 6v6c0 2 3.58 4 8 4s8-2 8-4V6",
        "M4 12v6c0 2 3.58 4 8 4s8-2 8-4v-6",
    ]),
    icon("cloud", "Cloud", "Technology", "saas hosting internet compute platform", [
        "M17.5 19H7a5 5 0 1 1 1.4-9.8A7 7 0 0 1 21 13.5 5.5 5.5 0 0 1 17.5 19z",
    ]),
    icon("application", "Application", "Technology", "app software web app service program", [
        "M3 4h18v16H3z", "M3 9h18", "M7 6h.01", "M10 6h.01",
    ]),
    icon("api", "API", "Technology", "integration endpoint interface service code", [
        "M8 3 3 8l5 5", "M16 3l5 5-5 5", "M14 2l-4 20",
    ]),
    icon("router", "Router", "Technology", "gateway switch network wifi connectivity", [
        "M4 13h16v7H4z", "M8 16h.01", "M12 16h.01", "M16 16h.01",
        "M8 9a6 6 0 0 1 8 0", "M10 11a3 3 0 0 1 4 0", "M12 12h.01",
    ]),

    // Communication
    icon("email", "Email", "Communication", "mail envelope contact", [
        "M3 5h18v14H3z", "m3 7 9 6 9-6",
    ]),
    icon("message", "Message", "Communication", "chat comment conversation social", [
        "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
    ]),
    icon("phone", "Phone", "Communication", "call telephone support contact", [
        "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z",
    ]),

    // Documents
    icon("document", "Document", "Documents", "file article knowledge text", [
        "M6 2h9l5 5v15H6z", "M14 2v6h6", "M9 13h6", "M9 17h6",
    ]),
    icon("folder", "Folder", "Documents", "directory collection files archive", [
        "M3 5h6l2 2h10v12H3z",
    ]),
    icon("report", "Report", "Documents", "analytics chart dashboard insight", [
        "M5 3h14v18H5z", "M9 17v-4", "M12 17V9", "M15 17v-7",
    ]),
    icon("contract", "Contract", "Documents", "agreement legal signed invoice", [
        "M6 2h9l5 5v15H6z", "M14 2v6h6", "M9 13h6", "M9 17c2-2 4 2 6 0",
    ]),

    // Finance
    icon("bank", "Bank", "Finance", "financial institution treasury", [
        "M3 10h18", "M5 10v8", "M9 10v8", "M15 10v8", "M19 10v8", "M2 21h20", "M12 3 2 8h20z",
    ]),
    icon("wallet", "Account / wallet", "Finance", "account money balance funds", [
        "M4 6h15a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13v3", "M16 12h5v4h-5a2 2 0 0 1 0-4z",
    ]),
    icon("card", "Credit card", "Finance", "payment debit merchant finance", [
        "M3 5h18v14H3z", "M3 10h18", "M7 15h2",
    ]),
    icon("transaction", "Transaction", "Finance", "transfer payment exchange movement", [
        "M7 7h11l-3-3", "M18 7l-3 3", "M17 17H6l3 3", "M6 17l3-3",
    ]),

    // Locations
    icon("location", "Location pin", "Locations", "map place city country site address", [
        "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z", "M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
    ]),
    icon("globe", "Globe", "Locations", "world country global internet web", [
        "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M2 12h20", "M12 2a15 15 0 0 1 0 20", "M12 2a15 15 0 0 0 0 20",
    ]),
    icon("store", "Store", "Locations", "shop merchant retail branch location", [
        "M3 9l2-6h14l2 6", "M5 13v8h14v-8", "M9 21v-6h6v6", "M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0",
    ]),

    // Supply chain
    icon("supplier", "Supplier", "Supply Chain", "vendor partner source procurement", [
        "M4 5h16v14H4z", "M8 9h8", "M8 13h5", "M2 8h2", "M20 8h2",
    ]),
    icon("factory", "Factory", "Supply Chain", "plant manufacturing production warehouse", [
        "M3 21V9l6 3V8l6 4V5l6 4v12z", "M7 17h.01", "M11 17h.01", "M15 17h.01",
    ]),
    icon("truck", "Truck", "Supply Chain", "delivery shipping logistics carrier freight", [
        "M3 6h11v11H3z", "M14 10h4l3 4v3h-7z", "M7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4", "M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
    ]),
    icon("ship", "Ship", "Supply Chain", "cargo vessel ocean port maritime", [
        "M12 2v7", "M8 5h8", "M5 10l7-3 7 3-2 8H7z", "M3 21c2-2 4 0 6 0s4-2 6 0 4 0 6 0",
    ]),
    icon("package", "Product / package", "Supply Chain", "product box parcel inventory artifact", [
        "M21 8 12 3 3 8v10l9 5 9-5z", "M3 8l9 5 9-5", "M12 13v10",
    ]),

    // Projects
    icon("calendar", "Calendar / event", "Projects", "date meeting schedule milestone", [
        "M3 5h18v16H3z", "M3 10h18", "M8 2v6", "M16 2v6", "M8 14h.01", "M12 14h.01", "M16 14h.01",
    ]),
    icon("project", "Project", "Projects", "portfolio initiative work briefcase", [
        "M4 7h16v13H4z", "M9 7V4h6v3", "M4 12h16", "M10 12v2h4v-2",
    ]),
    icon("task", "Task", "Projects", "todo work item checklist ticket", [
        "M9 5h11", "M9 12h11", "M9 19h11", "M3 5l1 1 2-2", "M3 12l1 1 2-2", "M3 19l1 1 2-2",
    ]),
    icon("workflow", "Workflow", "Projects", "process pipeline automation flow", [
        "M5 3v12", "M19 9v12", "M5 15c0 3 2 6 7 6h7", "M9 3H3v6h6z", "M21 9h-6v6h6z",
    ]),

    // Network structure
    icon("generic", "Generic node", "Network", "circle default entity node", [
        "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    ]),
    icon("hub", "Hub", "Network", "central junction connector network", [
        "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0", "M12 9V3", "M12 21v-6", "M9 12H3", "M21 12h-6",
        "M5 5l4 4", "M19 5l-4 4", "M5 19l4-4", "M19 19l-4-4",
    ]),
    icon("endpoint", "Endpoint", "Network", "terminal target destination device", [
        "M4 4h16v16H4z", "M8 12h8", "M13 8l4 4-4 4",
    ]),
    icon("gateway", "Gateway", "Network", "entry exit portal bridge router", [
        "M4 3h12v18H4z", "M16 12h6", "M19 9l3 3-3 3", "M9 12h.01",
    ]),
    icon("external", "External entity", "Network", "outside third party outbound", [
        "M14 3h7v7", "M10 14 21 3", "M21 14v7H3V3h7",
    ]),
    icon("unknown", "Unknown entity", "Network", "unclassified other question unidentified", [
        "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4", "M12 18h.01",
    ]),
];

export const ICON_CATEGORIES: readonly IconCategory[] = [
    "People", "Organization", "Technology", "Communication", "Documents",
    "Finance", "Locations", "Supply Chain", "Projects", "Network",
];

const BY_VALUE = new Map<string, SemanticIcon>();
for (const entry of SEMANTIC_ICONS) {
    BY_VALUE.set(entry.value, entry);
    BY_VALUE.set(entry.id, entry);
    BY_VALUE.set(entry.label.toLowerCase(), entry);
}

const ALIASES: Record<string, string> = {
    user: "person", influencer: "person", author: "person", manager: "employee",
    administrator: "employee", admin: "employee", team: "group",
    organization: "company", organisation: "company", division: "department", office: "building",
    branch: "building", institution: "government", laptop: "computer", desktop: "computer",
    device: "computer", smartphone: "mobile", host: "server", data: "database",
    software: "application", app: "application", "web app": "application",
    notification: "message", article: "document", file: "document", invoice: "contract",
    clipboard: "task", briefcase: "project", crowd: "group",
    account: "wallet", merchant: "store", city: "location", country: "location",
    warehouse: "factory", product: "package", event: "calendar", milestone: "calendar",
    source: "endpoint", target: "endpoint", node: "generic", other: "unknown",
};

/** Resolve a persisted token, plain id/label, or common field value to an icon. */
export function getSemanticIcon(value: string | null | undefined): SemanticIcon | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const direct = BY_VALUE.get(raw) || BY_VALUE.get(lower);
    if (direct) return direct;
    const alias = ALIASES[lower];
    return alias ? BY_VALUE.get(alias) ?? null : null;
}

/**
 * Infer an icon from a node-type/category value. Exact labels and aliases win;
 * otherwise match whole searchable keywords. Unknown values intentionally use
 * the explicit Unknown entity marker rather than silently guessing.
 */
export function inferSemanticIcon(value: string | null | undefined): string {
    const raw = String(value ?? "").trim().toLowerCase();
    const direct = getSemanticIcon(raw);
    if (direct) return direct.value;
    const words = raw.split(/[^a-z0-9]+/).filter(Boolean);
    for (const entry of SEMANTIC_ICONS) {
        const haystack = `${entry.id} ${entry.label} ${entry.keywords}`.toLowerCase().split(/[^a-z0-9]+/);
        if (words.some((word) => haystack.includes(word))) return entry.value;
    }
    return "zx:unknown";
}

/** DOM helper shared by the settings picker. No innerHTML or external assets. */
export function createSemanticIconSvg(value: string, size = 20): SVGSVGElement | null {
    const entry = getSemanticIcon(value);
    if (!entry) return null;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of entry.paths) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

export const SEMANTIC_ICON_VALUES: string[] = ["", ...SEMANTIC_ICONS.map((entry) => entry.value)];
export const SEMANTIC_ICON_NAMES: Record<string, string> = Object.fromEntries([
    ["", "none"],
    ...SEMANTIC_ICONS.map((entry) => [entry.value, `${entry.label} ${entry.keywords}`.toLowerCase()]),
]);
