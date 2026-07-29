"use strict";

/**
 * Insight alternate view (NG-125). A full-canvas, plain-English read-out of the
 * network — the third segment of the Graph / Table / Insight switch. It answers
 * "so what does this graph actually say?" in ordinary sentences: how big the
 * network is, who the central players are, whether it holds together, what would
 * break it, and how tightly knit it is.
 *
 * Mirrors the summary-table dashboard chrome (stat-card look, soft cards, zebra-
 * free) so the two alternate views read as one system. Built with
 * createElement + textContent — never innerHTML (certifiable by construction).
 */

import { GraphNarrative, InsightTone } from "../insights/graphInsights";
import { Surface, fontFamily, accent, posSafe, negSafe } from "../theme/zentrixTokens";

const SERIF = "Georgia, 'Times New Roman', serif";

/** Chrome palette derived from the surface — same recipe as the summary table. */
function chrome(surface: Surface, hc: boolean) {
    const light = surface.bg === "#FFFFFF";
    if (hc) {
        return { pageBg: surface.bg, cardBg: surface.bg, border: surface.fg, shadow: "none" };
    }
    return light
        ? { pageBg: "#F0F1F7", cardBg: "#FFFFFF", border: "#E8EAF2", shadow: "0 2px 10px rgba(11,16,32,0.06)" }
        : { pageBg: surface.bg, cardBg: "#15161E", border: "#2A2B36", shadow: "0 2px 10px rgba(0,0,0,0.45)" };
}

/** Tone → dot colour. HC strips the colour cue (bold still carries importance). */
function toneColor(t: InsightTone, surface: Surface, hc: boolean): string {
    if (hc) return surface.fg;
    return t === "positive" ? posSafe : t === "negative" ? negSafe : surface.muted;
}

/**
 * Render the insight view into `host`, returning the mounted root so the caller
 * can remove it on view-switch (the summary-table pattern).
 */
export function renderInsightView(
    host: HTMLElement,
    narrative: GraphNarrative,
    surface: Surface,
    hc = false,
): HTMLDivElement {
    const c = chrome(surface, hc);

    const wrap = document.createElement("div");
    wrap.className = "zx-insight";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Network insight");
    wrap.style.cssText = `position:absolute;inset:0;overflow:auto;background:${c.pageBg};` +
        `color:${surface.fg};font:13px ${fontFamily};padding:22px;box-sizing:border-box`;

    // --- hero: eyebrow label + big headline sentence -------------------------
    const hero = document.createElement("div");
    hero.style.cssText = "max-width:820px;margin:0 auto 20px auto";
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "NETWORK INSIGHT";
    eyebrow.style.cssText = `font:700 11px ${fontFamily};letter-spacing:1.8px;color:${accent};margin-bottom:10px`;
    const headline = document.createElement("div");
    headline.textContent = narrative.headline;
    headline.style.cssText = `font:600 24px/1.35 ${SERIF};color:${surface.fg};letter-spacing:0.2px`;
    hero.appendChild(eyebrow);
    hero.appendChild(headline);
    // Metadata subhead — the bare counts, demoted below the insight headline.
    if (narrative.subhead) {
        const subhead = document.createElement("div");
        subhead.textContent = narrative.subhead;
        subhead.style.cssText = `font:400 13px ${fontFamily};color:${surface.muted};margin-top:8px;letter-spacing:0.3px`;
        hero.appendChild(subhead);
    }
    wrap.appendChild(hero);

    // --- section cards (responsive grid) -------------------------------------
    const grid = document.createElement("div");
    grid.style.cssText = "max-width:820px;margin:0 auto;display:grid;gap:14px;" +
        "grid-template-columns:repeat(auto-fit,minmax(240px,1fr))";
    wrap.appendChild(grid);

    for (const section of narrative.sections) {
        const card = document.createElement("div");
        card.className = "zx-insight-card";
        card.style.cssText = `background:${c.cardBg};border:1px solid ${c.border};border-radius:12px;` +
            `box-shadow:${c.shadow};padding:16px 18px`;

        const title = document.createElement("div");
        title.textContent = section.title.toUpperCase();
        title.style.cssText = `font:700 10px ${fontFamily};letter-spacing:1.4px;color:${surface.muted};margin-bottom:12px`;
        card.appendChild(title);

        // Prominent metric — the big number leads the card; supporting sentences
        // sit below it in smaller text (UI & writing feedback).
        if (section.metric) {
            const m = section.metric;
            const metricWrap = document.createElement("div");
            metricWrap.style.cssText = "margin-bottom:12px";
            const value = document.createElement("div");
            value.textContent = m.value;
            value.style.cssText = `font:700 34px/1.05 ${fontFamily};color:${toneColor(m.tone, surface, hc)};letter-spacing:-0.5px`;
            const label = document.createElement("div");
            label.textContent = m.label;
            label.style.cssText = `font:600 12px/1.35 ${fontFamily};color:${surface.fg};opacity:0.85;margin-top:4px`;
            metricWrap.appendChild(value);
            metricWrap.appendChild(label);
            if (m.sub) {
                const sub = document.createElement("div");
                sub.textContent = m.sub;
                sub.style.cssText = `font:400 11px ${fontFamily};color:${surface.muted};margin-top:3px`;
                metricWrap.appendChild(sub);
            }
            card.appendChild(metricWrap);
        }

        for (const line of section.lines) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:flex-start;gap:10px;margin-bottom:9px";
            const dot = document.createElement("span");
            dot.setAttribute("aria-hidden", "true");
            dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:50%;margin-top:6px;` +
                `background:${toneColor(line.tone, surface, hc)}`;
            const text = document.createElement("div");
            text.textContent = line.text;
            text.style.cssText = `font:${line.strong ? "600 " : ""}14px/1.5 ${fontFamily};color:${surface.fg}` +
                (line.strong ? "" : `;opacity:0.9`);
            row.appendChild(dot);
            row.appendChild(text);
            card.appendChild(row);
        }
        grid.appendChild(card);
    }

    host.appendChild(wrap);
    return wrap;
}
