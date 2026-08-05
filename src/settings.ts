"use strict";

/**
 * Typed formatting model. Each slice `name` MUST equal the matching property name
 * under its object in capabilities.json, and each Card `name` MUST equal the
 * object name — that string identity is the persistence contract.
 *
 * MVP note: the shipping design (kickoff) makes an in-visual gear bar the primary
 * settings surface and force-reduces the native Format pane to `{ toolbar, branding }`.
 * Everything else is edited via the in-visual gear.
 */

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { accent } from "./theme/zentrixTokens";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import NumUpDown = formattingSettings.NumUpDown;
import ColorPicker = formattingSettings.ColorPicker;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

const item = (value: string, displayName: string) => ({ value, displayName });

/** Shared node-pattern library. Keep this aligned with capabilities.json,
 *  settingsSchema.ts and render/graph.ts. */
const patternItems = (noneLabel = "Solid") => [
    item("none", noneLabel),
    item("dots", "Dots"),
    item("rings", "Circles"),
    item("diagonal", "Diagonal lines"),
    item("crosshatch", "Crosshatch"),
    item("grid", "Grid"),
    item("horizontal", "Horizontal lines"),
    item("vertical", "Vertical lines"),
    item("checker", "Checker"),
    item("diamonds", "Diamonds"),
    item("zigzag", "Zigzag"),
    item("waves", "Waves"),
];

/**
 * Shared font list — the SAME set every Zentrix visual should expose (see
 * docs/UNIQUE-VALUE-AND-ROADMAP.md §5: promote to @zentrix/visual-formatting).
 * Only web-safe / host-guaranteed stacks so the label renders identically in
 * Desktop and Service without embedding fonts.
 */
export const LABEL_FONT_ITEMS = [
    item("Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif", "Segoe UI"),
    item("Arial, Helvetica, sans-serif", "Arial"),
    item("'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica"),
    item("Verdana, Geneva, sans-serif", "Verdana"),
    item("Tahoma, Geneva, sans-serif", "Tahoma"),
    item("'Trebuchet MS', Tahoma, sans-serif", "Trebuchet MS"),
    item("Georgia, 'Times New Roman', serif", "Georgia"),
    item("'Times New Roman', Times, serif", "Times New Roman"),
    item("Consolas, ui-monospace, monospace", "Consolas"),
];
const DEFAULT_LABEL_FONT = LABEL_FONT_ITEMS[0];

// --- Layout -----------------------------------------------------------------
class LayoutCard extends Card {
    mode = new ItemDropdown({
        name: "mode", displayName: "Layout",
        items: [item("force", "Force-directed"), item("circle", "Concentric"),
            item("ring", "Circular"), item("grid", "Grid"),
            item("tree", "Tree / org-chart"), item("geo", "Geo-route (lat/long)")],
        value: item("force", "Force-directed"),
    });
    charge = new NumUpDown({ name: "charge", displayName: "Repulsion", value: 30 });
    linkDistance = new NumUpDown({ name: "linkDistance", displayName: "Edge length", value: 30 });
    // Outline map (Geo-route mode only): a faint world silhouette + lat/long grid
    // drawn under the graph so a geographic network reads on its map. Embedded,
    // projected arithmetically — no map tiles / external calls (cert-safe).
    showBasemap = new ToggleSwitch({ name: "showBasemap", displayName: "Show outline map", value: true });

    name = "layout";
    displayName = "Layout";
    slices = [this.mode, this.charge, this.linkDistance, this.showBasemap];
}

// --- Pin (feature C2 — the flagship wedge) ----------------------------------
// `positions` is written by the visual via persistProperties (a serialized
// key→[x,y] map) and read back from dataView.metadata.objects; it has no slice
// here on purpose — it is machine state, not a user control.
class PinCard extends Card {
    pinned = new ToggleSwitch({ name: "pinned", displayName: "Pin layout", value: false });

    name = "pin";
    displayName = "Pinned layout";
    slices = [this.pinned];
}

// --- Nodes ------------------------------------------------------------------
class NodesCard extends Card {
    sizeBy = new ItemDropdown({
        name: "sizeBy", displayName: "Size nodes",
        items: [item("degree", "Degree"), item("measure", "Node value"),
            item("centrality", "Importance"), item("uniform", "Same size")],
        value: item("degree", "Degree"),
    });
    // Auto-fit node radii to the canvas (NG-264). ON by default: the Min/Max below act
    // as the 4–40px caps and the visual scales the range down on small tiles / dense
    // graphs so nodes never swamp a short canvas. OFF: the Min/Max are honoured exactly.
    autoSize = new ToggleSwitch({ name: "autoSize", displayName: "Auto size to canvas", value: true });
    minRadius = new NumUpDown({ name: "minRadius", displayName: "Min radius", value: 4 });
    maxRadius = new NumUpDown({ name: "maxRadius", displayName: "Max radius", value: 40 });
    sizeScale = new NumUpDown({ name: "sizeScale", displayName: "Size scale %", value: 100 });
    shape = new ItemDropdown({
        name: "shape", displayName: "Shape",
        items: [item("circle", "Circle"), item("square", "Square"), item("diamond", "Diamond"),
            item("triangle", "Triangle"), item("hexagon", "Hexagon"), item("donut", "Donut")],
        value: item("circle", "Circle"),
    });
    // Node type (NG-113): "halo" draws a soft translucent glow ring of the node's
    // colour behind each marker (+ a thicker chip stroke); "flat" is the plain disc.
    style = new ItemDropdown({
        name: "style", displayName: "Node type",
        items: [item("halo", "Halo (soft glow)"), item("flat", "Flat")],
        value: item("halo", "Halo (soft glow)"),
    });
    fillPattern = new ItemDropdown({
        name: "fillPattern", displayName: "Fill pattern",
        items: patternItems(),
        value: item("none", "Solid"),
    });
    fillPatternMode = new ItemDropdown({
        name: "fillPatternMode", displayName: "Apply pattern",
        items: [item("all", "Same on every node"), item("level", "By level (hierarchy)")],
        value: item("all", "Same on every node"),
    });
    fillPatternL0 = new ItemDropdown({
        name: "fillPatternL0", displayName: "Root (level 0)",
        items: patternItems("None"), value: item("none", "None"),
    });
    fillPatternL1 = new ItemDropdown({
        name: "fillPatternL1", displayName: "Level 1",
        items: patternItems("None"), value: item("dots", "Dots"),
    });
    fillPatternL2 = new ItemDropdown({
        name: "fillPatternL2", displayName: "Level 2",
        items: patternItems("None"), value: item("rings", "Circles"),
    });
    fillPatternL3 = new ItemDropdown({
        name: "fillPatternL3", displayName: "Level 3",
        items: patternItems("None"), value: item("diagonal", "Diagonal lines"),
    });
    fillPatternL4 = new ItemDropdown({
        name: "fillPatternL4", displayName: "Level 4+ (deeper)",
        items: patternItems("None"), value: item("crosshatch", "Crosshatch"),
    });
    // A global semantic icon id rendered in place of the node's shape/pattern marker.
    // Text remains the persistence type so legacy glyph values continue to round-trip.
    icon = new TextInput({ name: "icon", displayName: "Entity icon", value: "", placeholder: "e.g. zx:person" });
    // Icon application: one icon on every node, automatic semantic matching from
    // Node category, values from the Icon role, or a distinct icon per hierarchy depth.
    iconMode = new ItemDropdown({
        name: "iconMode", displayName: "Apply icon",
        items: [item("all", "Same on every node"), item("type", "By node type"),
            item("field", "By field value"), item("level", "By hierarchy level")],
        value: item("all", "Same on every node"),
    });
    // Per-level glyphs (0-based depth). L0 = root/grandparent, L1 = parent, L2 = child, …
    // Depth beyond L4 reuses the L4 ("deeper") glyph. Blank = no icon at that level.
    iconL0 = new TextInput({ name: "iconL0", displayName: "Root (level 0)", value: "", placeholder: "e.g. zx:company" });
    iconL1 = new TextInput({ name: "iconL1", displayName: "Level 1", value: "", placeholder: "e.g. zx:department" });
    iconL2 = new TextInput({ name: "iconL2", displayName: "Level 2", value: "", placeholder: "e.g. zx:person" });
    iconL3 = new TextInput({ name: "iconL3", displayName: "Level 3", value: "", placeholder: "e.g. zx:generic" });
    iconL4 = new TextInput({ name: "iconL4", displayName: "Level 4+ (deeper)", value: "", placeholder: "e.g. zx:endpoint" });
    defaultColor = new ColorPicker({ name: "defaultColor", displayName: "Default node colour", value: { value: accent } });
    animate = new ToggleSwitch({ name: "animate", displayName: "Animate adjustments", value: true });
    initialAnimation = new ToggleSwitch({ name: "initialAnimation", displayName: "Initial growth animation", value: true });
    // Avoid overlap (NG-112): deterministic collision relaxation after layout, so
    // growing the radius range never stacks circles on top of each other.
    collide = new ToggleSwitch({ name: "collide", displayName: "Avoid overlap", value: true });
    // Minimum edge-to-edge clearance applied by the collision pass in fitted pixels.
    nodeGap = new NumUpDown({ name: "nodeGap", displayName: "Node gap", value: 10 });
    // Value inside the node (formatted). Blank source shows nothing.
    showValue = new ToggleSwitch({ name: "showValue", displayName: "Show value in node", value: true });
    valueSource = new ItemDropdown({
        name: "valueSource", displayName: "Value",
        items: [item("size", "Node value"), item("degree", "Degree"), item("weighted", "Value"), item("centrality", "Importance")],
        value: item("weighted", "Value"),
    });
    valueDecimals = new NumUpDown({ name: "valueDecimals", displayName: "Decimals", value: 0 });
    // Merge duplicate nodes (N9). ON (default): one node per name — folds spelling/
    // case/whitespace variants AND keeps a name's incoming and outgoing edges on a
    // single vertex (the analysis view). OFF: keep them separate — exact-match identity,
    // and a name's outgoing role (as a source) and incoming role (as a target) split
    // into two vertices, so a name that is both a hub and a sink renders as two hubs
    // (the raw, un-collapsed directed view). Default ON so the standard picture stays
    // merged; turn OFF for the split view.
    mergeDuplicates = new ToggleSwitch({ name: "mergeDuplicates", displayName: "Merge duplicate nodes", value: true });
    // Full-height information panel on node click. The default node-click action (NG-248):
    // ON so a click surfaces the node's full detail out of the box; the On-click selector
    // lets the author switch to cross-filter-only, expand/collapse, or drill-down instead.
    showFullInfoOnClick = new ToggleSwitch({
        name: "showFullInfoOnClick", displayName: "Show full info on click", value: true,
    });

    name = "nodes";
    displayName = "Nodes";
    slices = [this.sizeBy, this.autoSize, this.minRadius, this.maxRadius, this.sizeScale, this.shape, this.style,
        this.fillPattern, this.fillPatternMode, this.fillPatternL0, this.fillPatternL1,
        this.fillPatternL2, this.fillPatternL3, this.fillPatternL4, this.icon,
        this.iconMode, this.iconL0, this.iconL1, this.iconL2, this.iconL3, this.iconL4,
        this.defaultColor, this.animate, this.initialAnimation, this.collide, this.nodeGap,
        this.showValue, this.valueSource, this.valueDecimals, this.mergeDuplicates,
        this.showFullInfoOnClick];
}

// --- Parent-node emphasis (hierarchy styling) -------------------------------
// A "parent" is any node referenced as another node's Node-parent. When emphasis is
// on, parents get their own border, an optional fill override, and a size boost so the
// hierarchy's structural nodes read distinctly from leaves.
class ParentsCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Emphasise parent nodes", value: false });
    borderColor = new ColorPicker({ name: "borderColor", displayName: "Parent border", value: { value: "#1C2330" } });
    borderWidth = new NumUpDown({ name: "borderWidth", displayName: "Border width", value: 3 });
    // Blank = keep the node's normal fill; set to override just the parents' colour.
    fill = new ColorPicker({ name: "fill", displayName: "Parent fill (blank = auto)", value: { value: "" } });
    sizeBoost = new NumUpDown({ name: "sizeBoost", displayName: "Parent size", value: 140 }); // % of normal radius

    name = "parents";
    displayName = "Parent nodes";
    slices = [this.show, this.borderColor, this.borderWidth, this.fill, this.sizeBoost];
}

// Appearance for nodes that carry a bound Node-image (base64 data: URI). Cosmetic — free.
class NodeImagesCard extends Card {
    // Fill crops the image to fill the circle (avatar look); Fit shows the whole image.
    fit = new ItemDropdown({
        name: "fit", displayName: "Image fit",
        items: [item("cover", "Fill (crop)"), item("contain", "Fit (whole image)")],
        value: item("cover", "Fill (crop)"),
    });
    showBorder = new ToggleSwitch({ name: "showBorder", displayName: "Border", value: true });
    // Blank = ring matches the node's resolved colour.
    borderColor = new ColorPicker({ name: "borderColor", displayName: "Border colour (blank = node colour)", value: { value: "" } });
    borderWidth = new NumUpDown({ name: "borderWidth", displayName: "Border width", value: 2 });

    name = "nodeImages";
    displayName = "Node images";
    slices = [this.fit, this.showBorder, this.borderColor, this.borderWidth];
}

// --- Colours (R1: colour management) ----------------------------------------
class ColorsCard extends Card {
    mode = new ItemDropdown({
        name: "mode", displayName: "Colour by",
        // Structure modes (Component / By level) join Single/Category/Measure/Cluster — the
        // analytical edge Powerviz lacks. The gear groups these by intent; here they are flat.
        items: [item("single", "Single"), item("category", "Category"), item("measure", "Value (gradient)"),
            item("cluster", "Cluster"), item("component", "Component"), item("level", "By level")],
        // Default to a single brand colour — the safe, predictable default. Colour-by
        // category/community is opt-in (CEO 2026-08-06); it was surprising as a default.
        value: item("single", "Single"),
    });
    palette = new ItemDropdown({
        name: "palette", displayName: "Palette",
        items: [item("brand", "Zentrix"), item("colorblind", "Colorblind-safe"), item("cool", "Cool"),
            item("warm", "Warm"), item("vibrant", "Vibrant"), item("pastel", "Pastel"), item("earth", "Earth"),
            item("classic10", "Classic 10"), item("tableau", "Tableau"), item("category", "Category"),
            item("dark", "Dark"), item("set2", "Set 2"), item("set3", "Set 3"), item("paired", "Paired"),
            item("accent", "Accent"), item("ocean", "Ocean"), item("sunset", "Sunset"), item("forest", "Forest"),
            item("berry", "Berry"), item("teal", "Teal"), item("coral", "Coral"), item("mint", "Mint"),
            item("violet", "Violet"), item("slate", "Slate"), item("autumn", "Autumn"), item("spring", "Spring"),
            item("neon", "Neon"), item("muted", "Muted"), item("jewel", "Jewel"), item("candy", "Candy"),
            item("steel", "Steel"), item("tropical", "Tropical"), item("grayscale", "Grayscale"),
            item("contrast", "High contrast"), item("highviz", "High-visibility"),
            // Continuous scales (measure / level-ramp). "custom" = the 2-stop gradient below.
            item("custom", "Custom gradient"),
            item("viridis", "Viridis"), item("mako", "Mako"), item("violetSeq", "Violet ramp"),
            item("tealSeq", "Teal ramp"), item("amber", "Amber"), item("rose", "Rose"),
            item("slateSeq", "Slate ramp"), item("ember", "Ember"),
            item("violetTeal", "Violet–Teal"), item("coolWarm", "Cool–Warm"), item("blueOrange", "Blue–Orange"),
            item("pinkGreen", "Pink–Green"), item("tealRose", "Teal–Rose"), item("spectral", "Spectral")],
        value: item("brand", "Zentrix"),
    });
    gradientLow = new ColorPicker({ name: "gradientLow", displayName: "Gradient low", value: { value: "#EEE9FF" } });
    gradientHigh = new ColorPicker({ name: "gradientHigh", displayName: "Gradient high", value: { value: accent } });
    // Custom multi-stop node gradient (gear-only, Gradient tab). When on, every node is
    // painted along [Start, …mids…, End] positioned by the Colour driver value — this
    // OVERRIDES "Colour by". Start/End reuse gradientLow/gradientHigh; the mids below add
    // 0–5 intermediate stops. gradientMids is how many mid stops are active.
    customGradient = new ToggleSwitch({ name: "customGradient", displayName: "Custom node gradient", value: false });
    gradientMids = new NumUpDown({ name: "gradientMids", displayName: "Midpoints", value: 1 });
    gradientMid1 = new ColorPicker({ name: "gradientMid1", displayName: "Gradient mid 1", value: { value: "#B59CFF" } });
    gradientMid2 = new ColorPicker({ name: "gradientMid2", displayName: "Gradient mid 2", value: { value: "#8E6FFF" } });
    gradientMid3 = new ColorPicker({ name: "gradientMid3", displayName: "Gradient mid 3", value: { value: "#6E4FE0" } });
    gradientMid4 = new ColorPicker({ name: "gradientMid4", displayName: "Gradient mid 4", value: { value: "#5B3FD6" } });
    gradientMid5 = new ColorPicker({ name: "gradientMid5", displayName: "Gradient mid 5", value: { value: "#4B2E9E" } });
    // Keep the established `showLegend` property for the node/category legend so
    // reports saved with the old single legend switch retain their preference.
    showLegend = new ToggleSwitch({ name: "showLegend", displayName: "Category legend", value: true });
    showEdgeLegend = new ToggleSwitch({ name: "showEdgeLegend", displayName: "Edge legend", value: false });
    // Legend corner (auto = bottom-left, the historical default). Gear-only, lives in
    // the "Overlays" category alongside the other chrome placements.
    legendPosition = new ItemDropdown({
        name: "legendPosition", displayName: "Legend position",
        items: [item("auto", "Auto"), item("tl", "Top-left"), item("tr", "Top-right"),
            item("bl", "Bottom-left"), item("br", "Bottom-right")],
        value: item("auto", "Auto"),
    });
    // Reverse the active palette/scale order (R1 — parity + a genuine convenience).
    reverse = new ToggleSwitch({ name: "reverse", displayName: "Reverse colours", value: false });
    // Filter the gear's palette list to colour-vision-deficiency-safe palettes only.
    cvdOnly = new ToggleSwitch({ name: "cvdOnly", displayName: "CVD-safe palettes only", value: false });
    // Node fill opacity (%). Applied as fill-opacity so hit-testing math is untouched.
    opacity = new NumUpDown({ name: "opacity", displayName: "Node opacity", value: 100 });
    // For `level` mode: distinct colour per depth, or a sequential ramp across depth.
    levelStyle = new ItemDropdown({
        name: "levelStyle", displayName: "Level colours",
        items: [item("distinct", "Distinct per level"), item("ramp", "Ramp by depth")],
        value: item("distinct", "Distinct per level"),
    });
    // For `measure` mode: which value drives the ramp (decoupled from Analysis centrality).
    colorDriver = new ItemDropdown({
        name: "colorDriver", displayName: "Colour driver",
        items: [item("size", "Node value"), item("degree", "Degree"), item("weighted", "Value"),
            item("centrality", "Importance"), item("betweenness", "Bridges"), item("pagerank", "Influence")],
        value: item("size", "Node value"),
    });

    name = "colors";
    displayName = "Colours";
    slices = [this.mode, this.palette, this.gradientLow, this.gradientHigh, this.showLegend, this.showEdgeLegend, this.legendPosition,
        this.reverse, this.cvdOnly, this.opacity, this.levelStyle, this.colorDriver,
        this.customGradient, this.gradientMids,
        this.gradientMid1, this.gradientMid2, this.gradientMid3, this.gradientMid4, this.gradientMid5];
}

// --- Tooltips (Zentrix branded card vs. Power BI native) ---------------------
class TooltipCard extends Card {
    // "card"  = our rich in-visual branded overlay (Zentrix golden-source card).
    // "report" = defer to Power BI's NATIVE tooltip service: hover hands the point's
    //   dataItems + selection identities to the host, and the report's native
    //   Format-pane setting (General ▸ Tooltips ▸ Type = Default / Report page) fully
    //   controls what shows. We do NOT re-implement report-page routing ourselves.
    // "off"   = no hover tooltip at all. The native General ▸ Tooltips toggle can only
    //   suppress the host service ("report" mode) — it cannot reach our hand-rolled DOM
    //   card, and Power BI exposes no readable state for that toggle (NG-129). So this
    //   is the ONE control that reliably turns BOTH tooltip styles off.
    type = new ItemDropdown({
        name: "type", displayName: "Tooltip",
        items: [item("card", "Zentrix card"), item("report", "Native"), item("off", "Off")],
        value: item("card", "Zentrix card"),
    });
    contentMode = new ItemDropdown({
        name: "contentMode", displayName: "Node information",
        items: [item("business", "Business fields"), item("combined", "Business + network"),
            item("network", "Network metrics")],
        value: item("combined", "Business + network"),
    });

    name = "tooltip";
    displayName = "Tooltip";
    slices = [this.type, this.contentMode];
}

// --- Edges (incl. R2: flow) -------------------------------------------------
class EdgesCard extends Card {
    // Link visibility. Off hides all edges; when off, `showOnHover` (below) can still
    // reveal a node's incident links on hover — the gear surfaces that as a follow-up.
    show = new ToggleSwitch({ name: "show", displayName: "Show links", value: true });
    showOnHover = new ToggleSwitch({ name: "showOnHover", displayName: "Show links on hover", value: true });
    // Link colour source (NG-133). auto = current behaviour (typed-edge palette, else
    // theme grey). source/target paint each link its endpoint node's colour; gradient
    // ramps source→target — the screenshot-2 look that keeps dense bundles traceable.
    colorMode = new ItemDropdown({
        name: "colorMode", displayName: "Link colour",
        items: [item("auto", "Automatic"), item("single", "Single colour"),
            item("source", "Source node colour"), item("target", "Target node colour"),
            item("gradient", "Source → target gradient")],
        value: item("auto", "Automatic"),
    });
    // Used only in "single" mode; blank = theme edge colour.
    color = new ColorPicker({ name: "color", displayName: "Colour", value: { value: "" } });
    showArrows = new ToggleSwitch({ name: "showArrows", displayName: "Directional arrows", value: true });
    // Off = preserve A→B and B→A as two separated one-way links. On = consolidate
    // the reciprocal records into one link with an arrowhead at each end.
    bidirectional = new ToggleSwitch({ name: "bidirectional", displayName: "Merge two-way links", value: false });
    // "Width" is the UPPER limit — the heaviest link's px width; the lightest scales down
    // to 20% of it (NG-133d). A 2px default keeps the graph crisp while arrows carry
    // direction out of the box.
    thickness = new NumUpDown({ name: "thickness", displayName: "Width", value: 2 });
    // Scale each link's width by its Edge-weight value (86d3wdnav). On by default so a
    // bound Edge weight visibly drives thickness (heaviest link = Width, lightest = 20%);
    // off renders every link at the flat Width. No effect when no Edge weight is bound.
    scaleByWeight = new ToggleSwitch({ name: "scaleByWeight", displayName: "Scale width by weight", value: true });
    // Global edge curvature 0..100 (NG-075). 0 = straight; parallel edges always fan apart.
    curve = new NumUpDown({ name: "curve", displayName: "Curvature", value: 0 });
    // Edge (link) labels at the midpoint — the weight, or the bound Edge-type value.
    showLabels = new ToggleSwitch({ name: "showLabels", displayName: "Link labels", value: false });
    labelSource = new ItemDropdown({
        name: "labelSource", displayName: "Link label",
        items: [item("weight", "Weight"), item("type", "Edge type"),
            item("weightPct", "Weight % of total"), item("betweenness", "Edge betweenness"),
            item("names", "Source → target")],
        value: item("weight", "Weight"),
    });
    flow = new ToggleSwitch({ name: "flow", displayName: "Animate flow", value: false });
    flowSpeed = new NumUpDown({ name: "flowSpeed", displayName: "Flow speed", value: 3 });

    name = "edges";
    displayName = "Edges";
    slices = [this.show, this.showOnHover, this.colorMode, this.color, this.showArrows, this.bidirectional, this.thickness, this.scaleByWeight, this.curve, this.showLabels, this.labelSource, this.flow, this.flowSpeed];
}

// --- Labels (full text control — font / size / style / colour / wrap) -------
class LabelsCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show labels", value: true });
    // What the label says (N4): the node name, a value, both, or directed flow totals.
    content = new ItemDropdown({
        name: "content", displayName: "Label content",
        items: [item("name", "Name"), item("value", "Value"), item("nameValue", "Name (value)"),
            item("inflow", "Inflow"), item("outflow", "Outflow"), item("flow", "Total flow")],
        value: item("name", "Name"),
    });
    outerValueFormat = new ItemDropdown({
        name: "outerValueFormat", displayName: "Outer-label display units",
        items: [item("auto", "Auto (K/M/B)"), item("none", "Full number"),
            item("thousands", "Thousands (K)"), item("millions", "Millions (M)"),
            item("billions", "Billions (B)")],
        value: item("auto", "Auto (K/M/B)"),
    });
    maxLabels = new NumUpDown({ name: "maxLabels", displayName: "Max labels", value: 40 });
    fontFamily = new ItemDropdown({
        name: "fontFamily", displayName: "Font", items: LABEL_FONT_ITEMS,
        value: LABEL_FONT_ITEMS.find((font) => font.displayName === "Trebuchet MS") ?? DEFAULT_LABEL_FONT,
    });
    fontSize = new NumUpDown({ name: "fontSize", displayName: "Text size", value: 9 });
    bold = new ToggleSwitch({ name: "bold", displayName: "Bold", value: false });
    italic = new ToggleSwitch({ name: "italic", displayName: "Italic", value: true });
    underline = new ToggleSwitch({ name: "underline", displayName: "Underline", value: false });
    color = new ColorPicker({ name: "color", displayName: "Colour (blank = auto)", value: { value: "#000000" } });
    position = new ItemDropdown({
        name: "position", displayName: "Position",
        items: [item("auto", "Auto (best fit)"), item("right", "Right"), item("left", "Left"), item("top", "Top"), item("bottom", "Bottom")],
        value: item("auto", "Auto (best fit)"),
    });
    wrap = new ItemDropdown({
        name: "wrap", displayName: "Wrap",
        items: [item("off", "Off"), item("on", "On (per word)"), item("auto", "Auto")],
        value: item("off", "Off"),
    });
    // Halo behind the outer node labels — keeps them legible when a best-fit
    // placement lands over an edge. Off by default (unchanged look until asked for).
    bgShow = new ToggleSwitch({ name: "bgShow", displayName: "Background", value: false });
    bgType = new ItemDropdown({
        name: "bgType", displayName: "Background style",
        items: [item("card", "Card"), item("highlight", "Highlight"), item("pill", "Pill")],
        value: item("card", "Card"),
    });
    bgColor = new ColorPicker({ name: "bgColor", displayName: "Background colour", value: { value: "#FFFFFF" } });
    bgWidth = new NumUpDown({ name: "bgWidth", displayName: "Background width", value: 3 });
    // Text drawn inside a node is a separate value layer, so it needs its own
    // typography instead of silently inheriting the outer-label font.
    innerValueFormat = new ItemDropdown({
        name: "innerValueFormat", displayName: "Inner-label display units",
        items: [item("auto", "Auto (K/M/B)"), item("none", "Full number"),
            item("thousands", "Thousands (K)"), item("millions", "Millions (M)"),
            item("billions", "Billions (B)")],
        value: item("auto", "Auto (K/M/B)"),
    });
    innerFontFamily = new ItemDropdown({
        name: "innerFontFamily", displayName: "Inner-label font",
        items: LABEL_FONT_ITEMS,
        value: LABEL_FONT_ITEMS.find((font) => font.displayName === "Verdana") ?? DEFAULT_LABEL_FONT,
    });
    // Acts as the requested size / maximum: the renderer still shrinks text when
    // necessary to keep it inside the node.
    innerFontSize = new NumUpDown({ name: "innerFontSize", displayName: "Inner-label size", value: 9 });
    innerBold = new ToggleSwitch({ name: "innerBold", displayName: "Inner-label bold", value: true });
    innerItalic = new ToggleSwitch({ name: "innerItalic", displayName: "Inner-label italic", value: false });
    innerUnderline = new ToggleSwitch({ name: "innerUnderline", displayName: "Inner-label underline", value: false });
    // Blank keeps the automatic contrast colour derived from the node fill.
    innerColor = new ColorPicker({ name: "innerColor", displayName: "Inner-label colour (blank = auto)", value: { value: "" } });

    name = "labels";
    displayName = "Labels";
    slices = [this.show, this.content, this.outerValueFormat, this.maxLabels, this.fontFamily, this.fontSize,
        this.bold, this.italic, this.underline, this.color, this.position, this.wrap,
        this.bgShow, this.bgType, this.bgColor, this.bgWidth,
        this.innerValueFormat, this.innerFontFamily, this.innerFontSize, this.innerBold, this.innerItalic,
        this.innerUnderline, this.innerColor];
}

// --- Ranking / filter (R-rank: Top/Bottom-N) --------------------------------
class RankingCard extends Card {
    mode = new ItemDropdown({
        name: "mode", displayName: "Show",
        items: [item("off", "All nodes"), item("top", "Top N"), item("bottom", "Bottom N")],
        // Large networks are unreadable on their first paint. Top 500 keeps a
        // broad network overview while small graphs remain complete because the
        // ranking engine is a no-op whenever N covers the whole graph.
        value: item("top", "Top N"),
    });
    action = new ItemDropdown({
        name: "action", displayName: "Action",
        items: [item("filter", "Filter"), item("highlight", "Highlight")],
        value: item("filter", "Filter"),
    });
    by = new ItemDropdown({
        name: "by", displayName: "Rank by",
        items: [item("degree", "Degree"), item("weighted", "Value"),
            item("size", "Node value"), item("centrality", "Importance")],
        value: item("degree", "Degree"),
    });
    count = new NumUpDown({ name: "count", displayName: "N", value: 500 });

    name = "ranking";
    displayName = "Ranking / filter";
    slices = [this.mode, this.action, this.by, this.count];
}

// --- Centrality (Enterprise moat: real graph analytics) ---------------------
class CentralityCard extends Card {
    metric = new ItemDropdown({
        name: "metric", displayName: "Importance calculation",
        items: [item("none", "Off"), item("degree", "Degree"), item("betweenness", "Bridges"),
            item("closeness", "Reach"), item("pagerank", "Influence")],
        value: item("none", "Off"),
    });

    name = "centrality";
    displayName = "Importance (Enterprise)";
    slices = [this.metric];
}

// --- Conditional formatting (R-cf: no-DAX rule engine on node colour) --------
// The rules themselves are an unbounded serialized list (machine-state property
// `cformat.rules`, edited via the in-visual Rules panel — see rulesPanel.ts), so
// only the editor-visibility toggle lives here as a slice.
class CFormatCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Rules editor", value: false });

    name = "cformat";
    displayName = "Conditional formatting";
    slices = [this.show];
}

// --- Clusters (Enterprise E2) -----------------------------------------------
class ClustersCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show clusters", value: false });
    // Detection source: Auto = Louvain community detection; Category = group by the
    // bound Node-category value; Component = group by connected component.
    clusterBy = new ItemDropdown({
        name: "clusterBy", displayName: "Cluster by",
        items: [item("auto", "Auto (communities)"), item("category", "Category field"), item("component", "Connected components")],
        value: item("auto", "Auto (communities)"),
    });
    // Granularity: Louvain resolution γ × 100. 100 = classic modularity (unchanged);
    // higher → more, smaller clusters; lower → fewer, coarser ones. Auto mode only.
    resolution = new NumUpDown({ name: "resolution", displayName: "Granularity", value: 100 });
    // Fold clusters below this many nodes into a shared "Other" bucket (1 = off).
    minClusterSize = new NumUpDown({ name: "minClusterSize", displayName: "Min cluster size", value: 1 });
    // Keep only the N largest clusters; the rest fold into "Other" (0 = unlimited).
    maxClusters = new NumUpDown({ name: "maxClusters", displayName: "Max clusters", value: 0 });

    // Collapse each community into a single meta-node (NG-078). Click a meta-node to
    // cross-filter its whole community.
    collapse = new ToggleSwitch({ name: "collapse", displayName: "Collapse to meta-nodes", value: false });

    // --- Hull appearance (the shaded region behind each cluster) ---
    showHulls = new ToggleSwitch({ name: "showHulls", displayName: "Show hulls", value: true });
    hullStyle = new ItemDropdown({
        name: "hullStyle", displayName: "Hull style",
        items: [item("rounded", "Rounded"), item("convex", "Convex (sharp)")],
        value: item("rounded", "Rounded"),
    });
    hullPadding = new NumUpDown({ name: "hullPadding", displayName: "Padding", value: 14 });
    fillOpacity = new NumUpDown({ name: "fillOpacity", displayName: "Fill opacity %", value: 12 });
    borderWidth = new NumUpDown({ name: "borderWidth", displayName: "Border width", value: 2 });
    borderOpacity = new NumUpDown({ name: "borderOpacity", displayName: "Border opacity %", value: 35 });
    colorSource = new ItemDropdown({
        name: "colorSource", displayName: "Hull colour",
        items: [item("palette", "Per-cluster palette"), item("single", "Single tint")],
        value: item("palette", "Per-cluster palette"),
    });
    tint = new ColorPicker({ name: "tint", displayName: "Hull tint", value: { value: "#7C5CFF" } });

    // --- Cluster captions ---
    showLabels = new ToggleSwitch({ name: "showLabels", displayName: "Cluster labels", value: false });
    showSizes = new ToggleSwitch({ name: "showSizes", displayName: "Show sizes", value: false });
    // Caption typography (NG-246). Own controls so cluster captions can be styled apart
    // from node labels; colour blank = the theme foreground.
    labelFont = new ItemDropdown({
        name: "labelFont", displayName: "Label font", items: LABEL_FONT_ITEMS,
        value: LABEL_FONT_ITEMS.find((font) => font.displayName === "Trebuchet MS") ?? DEFAULT_LABEL_FONT,
    });
    labelSize = new NumUpDown({ name: "labelSize", displayName: "Label size", value: 12 });
    labelBold = new ToggleSwitch({ name: "labelBold", displayName: "Label bold", value: true });
    labelItalic = new ToggleSwitch({ name: "labelItalic", displayName: "Label italic", value: false });
    // Auto = each caption takes its own cluster's colour (so a label maps to its region at a
    // glance); Manual = the fixed colour below (NG-247).
    labelColorMode = new ItemDropdown({
        name: "labelColorMode", displayName: "Label colour",
        items: [item("auto", "Auto (match cluster)"), item("manual", "Manual")],
        value: item("auto", "Auto (match cluster)"),
    });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Custom label colour", value: { value: "" } });

    // --- Layout influence ---
    groupByCluster = new ToggleSwitch({ name: "groupByCluster", displayName: "Group by cluster", value: false });
    groupingStrength = new NumUpDown({ name: "groupingStrength", displayName: "Grouping strength", value: 30 });

    // --- Interaction ---
    clickToFilter = new ToggleSwitch({ name: "clickToFilter", displayName: "Click hull to filter", value: false });
    hoverEmphasis = new ToggleSwitch({ name: "hoverEmphasis", displayName: "Hover to emphasise", value: false });

    name = "clusters";
    displayName = "Clusters (Enterprise)";
    slices = [this.show, this.clusterBy, this.resolution, this.minClusterSize, this.maxClusters, this.collapse,
        this.showHulls, this.hullStyle, this.hullPadding, this.fillOpacity, this.borderWidth, this.borderOpacity,
        this.colorSource, this.tint, this.showLabels, this.showSizes,
        this.labelFont, this.labelSize, this.labelBold, this.labelItalic, this.labelColorMode, this.labelColor,
        this.groupByCluster, this.groupingStrength,
        this.clickToFilter, this.hoverEmphasis];
}

// --- Hierarchy: expand/collapse + drill-down (Node-parent) ------------------
class HierarchyCard extends Card {
    // Fold subtrees: click a parent to collapse/expand it in place.
    foldable = new ToggleSwitch({ name: "foldable", displayName: "Expand / collapse", value: false });
    startCollapsed = new ToggleSwitch({ name: "startCollapsed", displayName: "Start collapsed", value: false });
    // Drill-down: click a parent to descend into its sub-network (NG-072).
    drilldown = new ToggleSwitch({ name: "drilldown", displayName: "Drill-down", value: false });

    name = "hierarchy";
    displayName = "Hierarchy";
    slices = [this.foldable, this.startCollapsed, this.drilldown];
}

// --- Scale mode (Enterprise E1) ---------------------------------------------
class ScaleCard extends Card {
    // Zero means "all available edges". A positive value is an author-selected
    // performance cap; structural truncation is never the untouched default.
    maxEdges = new NumUpDown({ name: "maxEdges", displayName: "Max edges (0 = All)", value: 0 });
    // Progressive loading (T11): keep requesting 30k-row segments until the edge
    // budget is met — the graph is no longer hard-capped at one data window.
    fetchMore = new ToggleSwitch({ name: "fetchMore", displayName: "Load beyond 30k rows", value: true });
    minimap = new ToggleSwitch({ name: "minimap", displayName: "Minimap", value: true });
    // Renderer: Auto switches to the GPU-friendly canvas path once the graph passes
    // `canvasThreshold` nodes/edges; SVG stays per-element (max interactivity); Canvas
    // forces the fast path. Full control so authors can trade interactivity vs. scale.
    renderMode = new ItemDropdown({
        name: "renderMode", displayName: "Renderer",
        items: [item("auto", "Auto"), item("svg", "SVG (interactive)"), item("canvas", "Canvas (fast)")],
        value: item("auto", "Auto"),
    });
    canvasThreshold = new NumUpDown({ name: "canvasThreshold", displayName: "Canvas above (nodes)", value: 1200 });

    name = "scale";
    displayName = "Scale (Enterprise)";
    slices = [this.maxEdges, this.fetchMore, this.minimap, this.renderMode, this.canvasThreshold];
}

// --- Insights (Enterprise E6) -----------------------------------------------
class InsightsCard extends Card {
    show = new ToggleSwitch({
        name: "show", displayName: "Show insights", value: true,
        description: "Add an Insight segment to the floating view switch — a plain-English read-out of what the network shows (hubs, connectivity, bridges, density).",
    });

    name = "insights";
    displayName = "Insights (Enterprise)";
    slices = [this.show];
}

// --- Find / search (R4) -----------------------------------------------------
class FindCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Search box", value: false });

    name = "find";
    displayName = "Find (Enterprise)";
    slices = [this.show];
}

// --- Explore mode (Enterprise E3) -------------------------------------------
class ExploreCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Explore mode", value: false });

    name = "explore";
    displayName = "Explore (Enterprise)";
    slices = [this.show];
}

// --- Path analysis (Enterprise E5) ------------------------------------------
class PathCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Path analysis", value: false });
    // Weight-aware routing: minimise total edge weight (cost) instead of hop count.
    weighted = new ToggleSwitch({ name: "weighted", displayName: "Use values (lowest cost)", value: false });

    name = "path";
    displayName = "Path (Enterprise)";
    slices = [this.show, this.weighted];
}

// --- Annotations (author-written on-canvas notes; NG-074) -------------------
// NOTE: the note DATA lives on the `notesStore` capabilities object, which has NO
// Card here — a Card would be wiped by the gear's Reset (removeObject over every
// card), destroying every note a user ever wrote. This card holds only display prefs.
class AnnotationsCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show annotations", value: true });
    defaultMode = new ItemDropdown({
        name: "defaultMode", displayName: "Default style",
        items: [item("marker", "Marker only"), item("text", "Text"), item("arrow", "Text + arrow"), item("all", "Marker + text + arrow")],
        value: item("all", "Marker + text + arrow"),
    });

    name = "annotations";
    displayName = "Annotations";
    slices = [this.show, this.defaultMode];
}

// --- Temporal (dynamic graph over a Time role) ------------------------------
class TemporalCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Time animation", value: false });

    name = "temporal";
    displayName = "Time (Enterprise)";
    slices = [this.show];
}

// --- Toolbar (controls the in-visual settings bar) --------------------------
// --- Summary table / view switch ---------------------------------------------
// Mirrors the heatmap's SummaryTableCard: governs the floating view switch
// (bottom right, interaction/viewToggle.ts) that flips the canvas between the
// graph and the node-metrics table. The flip itself is session-local by design
// (it must work in Reading view, where persistProperties would not survive);
// this setting only shows/hides the switch. Gear-only.
class SummaryTableCard extends Card {
    show = new ToggleSwitch({
        name: "show", displayName: "Show summary table", value: true,
        description: "Add a Table segment to the floating view switch, letting anyone viewing the report flip the canvas to the node-metrics table.",
    });
    // Corner for the floating Graph / Table / Insight view switch. Auto keeps the
    // legacy bottom-right dodge (beside the gear / above the watermark).
    position = new ItemDropdown({
        name: "position", displayName: "View switch position",
        items: [item("auto", "Auto"), item("tl", "Top-left"), item("tr", "Top-right"),
            item("bl", "Bottom-left"), item("br", "Bottom-right")],
        value: item("auto", "Auto"),
    });
    name = "summaryTable";
    displayName = "Summary table";
    slices = [this.show, this.position];
}

class ToolbarCard extends Card {
    showOverlays = new ToggleSwitch({
        name: "showOverlays",
        displayName: "Show all overlays",
        value: true,
        description: "Turn off to show only the graph, hiding the gear, quick actions, panels, legend, branding, view switch, and other visual overlays.",
    });
    show = new ToggleSwitch({ name: "show", displayName: "Show settings bar", value: true });
    closeOnClickAway = new ToggleSwitch({ name: "closeOnClickAway", displayName: "Close on click-away", value: true });
    actions = new ToggleSwitch({ name: "actions", displayName: "Quick actions (zoom, undo, redo, reset)", value: true });
    position = new ItemDropdown({
        name: "position", displayName: "Gear position",
        items: [item("auto", "Auto"), item("bl", "Bottom-left"), item("br", "Bottom-right"), item("tl", "Top-left"), item("tr", "Top-right")],
        value: item("auto", "Auto"),
    });

    // Object name stays "toolbar" (the persistence contract in capabilities.json — never
    // rename that). The Format-pane label describes the whole chrome group now that one
    // persisted switch can hide every overlay at once (NG-169).
    name = "toolbar";
    displayName = "Visual overlays";
    slices = [this.showOverlays, this.show, this.closeOnClickAway, this.actions, this.position];
}

// --- Branding ---------------------------------------------------------------
class BrandingCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show Zentrix mark", value: true });

    name = "branding";
    displayName = "Zentrix branding";
    slices = [this.show];
}

/**
 * The in-visual gear is the primary settings surface; the native Format pane is
 * force-reduced to two cards: "Visual overlays" controls all visual chrome (plus
 * its individual gear/actions), and Branding controls the removable mark.
 */
const PANE_CARDS = new Set<string>(["toolbar", "branding"]);

export class VisualFormattingSettingsModel extends Model {
    layout = new LayoutCard();
    pin = new PinCard();
    nodes = new NodesCard();
    parents = new ParentsCard();
    nodeImages = new NodeImagesCard();
    colors = new ColorsCard();
    edges = new EdgesCard();
    tooltip = new TooltipCard();
    labels = new LabelsCard();
    ranking = new RankingCard();
    centrality = new CentralityCard();
    cformat = new CFormatCard();
    clusters = new ClustersCard();
    hierarchy = new HierarchyCard();
    scale = new ScaleCard();
    insights = new InsightsCard();
    find = new FindCard();
    explore = new ExploreCard();
    path = new PathCard();
    temporal = new TemporalCard();
    annotations = new AnnotationsCard();
    summaryTable = new SummaryTableCard();
    toolbar = new ToolbarCard();
    branding = new BrandingCard();

    cards = [this.layout, this.pin, this.nodes, this.parents, this.nodeImages, this.colors, this.edges, this.tooltip, this.labels, this.ranking, this.centrality,
        this.cformat, this.clusters, this.hierarchy, this.scale, this.insights, this.find, this.explore, this.path, this.temporal, this.annotations, this.summaryTable, this.toolbar, this.branding];

    constructor() {
        super();
        // Hide the gear-only cards from the native Format pane (they still populate
        // from persisted objects and are edited via the in-visual gear).
        for (const card of this.cards) {
            (card as unknown as { visible?: boolean }).visible = PANE_CARDS.has((card as unknown as { name: string }).name);
        }
    }
}
