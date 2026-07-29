"use strict";

import { bytesToBase64, utf8Bytes } from "./exportFiles";

export interface VisualSnapshot {
    pngBase64: string;
    jpegBase64: string;
    width: number;
    height: number;
}

function dataPart(url: string): string {
    const comma = url.indexOf(",");
    return comma >= 0 ? url.slice(comma + 1) : url;
}

function imageFromSvg(svg: SVGSVGElement): Promise<HTMLImageElement> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const width = Math.max(1, Math.round(svg.getBoundingClientRect().width || svg.clientWidth || 1));
    const height = Math.max(1, Math.round(svg.getBoundingClientRect().height || svg.clientHeight || 1));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.style.display = "block";
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;base64,${bytesToBase64(utf8Bytes(serialized))}`;

    return new Promise((resolve, reject) => {
        const img = document.createElement("img");
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("The visual snapshot could not be rasterized."));
        img.src = url;
    });
}

/**
 * Composite the current underlay canvas (large-graph mode) and SVG layers into
 * one raster snapshot. The 2× output is capped at 4096 px to stay below the
 * host download API's 30 MB limit.
 */
export async function captureVisualSnapshot(
    svg: SVGSVGElement,
    underlay: HTMLCanvasElement | null,
    viewportWidth: number,
    viewportHeight: number,
    background: string,
): Promise<VisualSnapshot> {
    const width = Math.max(1, Math.round(viewportWidth));
    const height = Math.max(1, Math.round(viewportHeight));
    const scale = Math.min(2, 4096 / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas export is unavailable in this host.");

    ctx.fillStyle = background || "#FFFFFF";
    ctx.fillRect(0, 0, outW, outH);
    if (underlay && underlay.width > 0 && underlay.height > 0 && underlay.style.display !== "none") {
        ctx.drawImage(underlay, 0, 0, outW, outH);
    }
    const svgImage = await imageFromSvg(svg);
    ctx.drawImage(svgImage, 0, 0, outW, outH);

    return {
        pngBase64: dataPart(canvas.toDataURL("image/png")),
        jpegBase64: dataPart(canvas.toDataURL("image/jpeg", 0.92)),
        width: outW,
        height: outH,
    };
}
