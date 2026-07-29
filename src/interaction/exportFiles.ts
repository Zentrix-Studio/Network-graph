"use strict";

/**
 * Binary export builders used by the action-bar export menu.
 *
 * The Power BI download API accepts binary files as a base64 string. These
 * builders deliberately have no DOM or Power BI dependencies so their output
 * can be validated as ordinary files in unit tests.
 */

export type ExportCell = string | number | null | undefined;
export interface ExportSheet { name: string; rows: ExportCell[][]; }

/** Small UTF-8 encoder kept local so exports also work in older WebView/jsdom hosts. */
export function utf8Bytes(value: string): Uint8Array {
    const bytes: number[] = [];
    for (const ch of value) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp <= 0x7f) bytes.push(cp);
        else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
        else if (cp <= 0xffff) bytes.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
        else bytes.push(0xf0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 0x3f), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return new Uint8Array(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
    let size = 0;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

function u16(v: number): Uint8Array {
    return new Uint8Array([v & 255, (v >>> 8) & 255]);
}

function u32(v: number): Uint8Array {
    return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal standards-compliant ZIP writer (stored entries, no compression). */
function makeZip(files: { name: string; content: string }[]): Uint8Array {
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
        const name = utf8Bytes(file.name);
        const data = utf8Bytes(file.content);
        const crc = crc32(data);
        // UTF-8 names, stored data, fixed 1980-01-01 DOS date for deterministic output.
        const local = concat([
            u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x0021),
            u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
            name, data,
        ]);
        locals.push(local);
        centrals.push(concat([
            u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x0021),
            u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
            u16(0), u16(0), u16(0), u32(0), u32(offset), name,
        ]));
        offset += local.length;
    }

    const central = concat(centrals);
    return concat([
        ...locals,
        central,
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(central.length), u32(offset), u16(0),
    ]);
}

function xml(v: string): string {
    return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number): string {
    let n = index + 1;
    let out = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

function worksheetXml(rows: ExportCell[][]): string {
    const body = rows.map((row, ri) => {
        const cells = row.map((value, ci) => {
            const ref = `${columnName(ci)}${ri + 1}`;
            const style = ri === 0 ? ' s="1"' : "";
            if (typeof value === "number" && Number.isFinite(value)) {
                return `<c r="${ref}"${style} t="n"><v>${value}</v></c>`;
            }
            const text = value == null ? "" : String(value);
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
        }).join("");
        return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>` +
        `<sheetData>${body}</sheetData><autoFilter ref="A1:${columnName(Math.max(0, (rows[0]?.length ?? 1) - 1))}${Math.max(1, rows.length)}"/>` +
        `</worksheet>`;
}

/** Build a real Office Open XML workbook with one worksheet per input table. */
export function buildWorkbookBase64(sheets: ExportSheet[]): string {
    const safeSheets = sheets.slice(0, 20).map((sheet, i) => ({
        name: (sheet.name || `Sheet ${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
        rows: sheet.rows,
    }));
    const overrides = safeSheets.map((_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");
    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        overrides + `</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        safeSheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        safeSheets.map((_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        ).join("") +
        `<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    const files = [
        { name: "[Content_Types].xml", content: contentTypes },
        { name: "_rels/.rels", content: rootRels },
        { name: "xl/workbook.xml", content: workbook },
        { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
        { name: "xl/styles.xml", content: styles },
        ...safeSheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: worksheetXml(s.rows) })),
    ];
    return bytesToBase64(makeZip(files));
}

function pdfText(value: string): string {
    return value.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function streamObject(dictionary: string, data: Uint8Array): Uint8Array {
    return concat([
        utf8Bytes(`<< ${dictionary}${dictionary ? " " : ""}/Length ${data.length} >>\nstream\n`),
        data,
        utf8Bytes("\nendstream"),
    ]);
}

function wrapLine(line: string, max = 96): string[] {
    if (!line) return [""];
    const out: string[] = [];
    for (let at = 0; at < line.length; at += max) out.push((at ? "  " : "") + line.slice(at, at + max));
    return out;
}

function dataPages(nodesCsv: string, edgesCsv: string): { title: string; lines: string[] }[] {
    const pages: { title: string; lines: string[] }[] = [];
    for (const section of [
        { title: "Node metrics CSV", csv: nodesCsv },
        { title: "Edge list CSV", csv: edgesCsv },
    ]) {
        const lines: string[] = [];
        for (const source of section.csv.split(/\r?\n/)) {
            lines.push(...wrapLine(source));
        }
        for (let at = 0; at < lines.length; at += 61) {
            pages.push({
                title: at ? `${section.title} (continued)` : section.title,
                lines: lines.slice(at, at + 61),
            });
        }
    }
    return pages;
}

export interface PdfExportInput {
    jpegBase64: string;
    imageWidth: number;
    imageHeight: number;
    nodesCsv: string;
    edgesCsv: string;
}

/** Build a PDF: visual snapshot first, followed by the complete CSV data. */
export function buildPdfBase64(input: PdfExportInput): string {
    const objects: Uint8Array[] = [new Uint8Array(), new Uint8Array()]; // catalog + pages, filled last
    const add = (body: string | Uint8Array): number => {
        objects.push(typeof body === "string" ? utf8Bytes(body) : body);
        return objects.length;
    };

    const jpeg = base64ToBytes(input.jpegBase64);
    const imageRef = add(streamObject(
        `/Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(input.imageWidth))} ` +
        `/Height ${Math.max(1, Math.round(input.imageHeight))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        jpeg,
    ));
    const bodyFontRef = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
    const titleFontRef = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const pageRefs: number[] = [];

    const pageW = 595, pageH = 842, margin = 36;
    const maxW = pageW - margin * 2, maxH = pageH - 118;
    const scale = Math.min(maxW / Math.max(1, input.imageWidth), maxH / Math.max(1, input.imageHeight));
    const drawW = input.imageWidth * scale, drawH = input.imageHeight * scale;
    const imageX = (pageW - drawW) / 2, imageY = pageH - 76 - drawH;
    const coverOps = `BT /F2 18 Tf ${margin} ${pageH - 42} Td (Network visual export) Tj ET\n` +
        `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${imageX.toFixed(2)} ${Math.max(margin, imageY).toFixed(2)} cm /Im1 Do Q\n` +
        `BT /F1 8 Tf ${margin} 20 Td (Node and edge CSV tables follow this snapshot.) Tj ET`;
    const coverContent = add(streamObject("", utf8Bytes(coverOps)));
    const coverPage = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /Font << /F1 ${bodyFontRef} 0 R /F2 ${titleFontRef} 0 R >> /XObject << /Im1 ${imageRef} 0 R >> >> ` +
        `/Contents ${coverContent} 0 R >>`);
    pageRefs.push(coverPage);

    for (const page of dataPages(input.nodesCsv, input.edgesCsv)) {
        const ops = [
            `BT /F2 15 Tf ${margin} ${pageH - 42} Td (${pdfText(page.title)}) Tj ET`,
            `BT /F1 8 Tf 10 TL ${margin} ${pageH - 64} Td`,
            ...page.lines.map((line, i) => `${i ? "T* " : ""}(${pdfText(line)}) Tj`),
            "ET",
        ].join("\n");
        const contentRef = add(streamObject("", utf8Bytes(ops)));
        const pageRef = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
            `/Resources << /Font << /F1 ${bodyFontRef} 0 R /F2 ${titleFontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
        pageRefs.push(pageRef);
    }

    objects[0] = utf8Bytes("<< /Type /Catalog /Pages 2 0 R >>");
    objects[1] = utf8Bytes(`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] >>`);

    const header = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]);
    const parts: Uint8Array[] = [header];
    const offsets: number[] = [0];
    let offset = header.length;
    objects.forEach((body, i) => {
        offsets.push(offset);
        const obj = concat([utf8Bytes(`${i + 1} 0 obj\n`), body, utf8Bytes("\nendobj\n")]);
        parts.push(obj);
        offset += obj.length;
    });
    const xrefAt = offset;
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.slice(1).map((v) => `${String(v).padStart(10, "0")} 00000 n \n`).join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    parts.push(utf8Bytes(xref));
    return bytesToBase64(concat(parts));
}
