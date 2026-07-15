import { jsPDF } from "jspdf";
import { PAGE_MARGIN_CM, RULER_ZONE_HEIGHT_CM, createTilePlan } from "./print-layout.mjs";

const RASTER_DPI = 180;
const INK = "#20293f";
const SEAM = "#b8823a";
const TITLE = "世界经典服装设计与纸样·女装上衣原型";
const PIECE_GAP_CM = 3;
const STROKE_SAFETY_CM = 0.1;

function boundsFor(piece) {
  const points = [piece.outline, piece.seam || [], ...(piece.lines || [])].flat();
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

function polygon(points, dx, dy, seam = false) {
  if (!points?.length) return "";
  const data = points.map(point => `${(point.x + dx).toFixed(4)},${(point.y + dy).toFixed(4)}`).join(" ");
  return `<polygon points="${data}" fill="none" stroke="${seam ? SEAM : INK}" stroke-width="${seam ? 0.12 : 0.16}"${seam ? ' stroke-dasharray="0.6 0.3"' : ""}/>`;
}

function openLines(lines, dx, dy) {
  return (lines || []).map(points => {
    const data = points.map(point => `${(point.x + dx).toFixed(4)},${(point.y + dy).toFixed(4)}`).join(" ");
    return `<polyline points="${data}" fill="none" stroke="${INK}" stroke-width="0.16"/>`;
  }).join("");
}

function svgDocument(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}cm" height="${height}cm" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#fff"/>
    <g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif" fill="${INK}">${content}</g>
  </svg>`;
}

async function renderSvgPage(source, widthCm, heightCm) {
  const pixelsPerCm = RASTER_DPI / 2.54;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(widthCm * pixelsPerCm);
  canvas.height = Math.ceil(heightCm * pixelsPerCm);
  const context = canvas.getContext("2d");
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 1;
    canvas.height = 1;
  }
}

function footerSvg(plan, pieceLabel) {
  const zoneTop = plan.pageHeight - PAGE_MARGIN_CM - RULER_ZONE_HEIGHT_CM;
  const barX = PAGE_MARGIN_CM;
  const barY = zoneTop + 0.55;
  const divisions = Array.from({ length: 4 }, (_, index) => {
    const x = barX + index + 1;
    return `<line x1="${x}" y1="${barY}" x2="${x}" y2="${barY + 1}" stroke="${INK}" stroke-width="0.04"/>`;
  }).join("");
  return `
    <rect x="${PAGE_MARGIN_CM}" y="${PAGE_MARGIN_CM}" width="${plan.pageWidth - PAGE_MARGIN_CM * 2}" height="${plan.pageHeight - PAGE_MARGIN_CM * 2}" fill="none" stroke="${INK}" stroke-width="0.03"/>
    <line x1="${PAGE_MARGIN_CM}" y1="${zoneTop}" x2="${plan.pageWidth - PAGE_MARGIN_CM}" y2="${zoneTop}" stroke="#c8c8c8" stroke-width="0.03"/>
    <text x="${barX + 2.5}" y="${barY - 0.18}" text-anchor="middle" font-size="0.34">1cm参考</text>
    <rect x="${barX}" y="${barY}" width="5" height="1" fill="none" stroke="${INK}" stroke-width="0.05"/>${divisions}
    <text x="${barX + 5.5}" y="${barY + 0.62}" font-size="0.27">${escapeXml(TITLE)}</text>
    <text x="${plan.pageWidth - PAGE_MARGIN_CM}" y="${barY + 0.62}" text-anchor="end" font-size="0.36" font-weight="600">${escapeXml(pieceLabel)}</text>`;
}

function a4PageSvg(piece, bounds, plan, tile) {
  const dx = PAGE_MARGIN_CM + STROKE_SAFETY_CM - bounds.minX - tile.offsetX;
  const dy = PAGE_MARGIN_CM + STROKE_SAFETY_CM - bounds.minY - tile.offsetY;
  const clipId = `content-${tile.row}-${tile.column}`;
  const paths = polygon(piece.outline, dx, dy) + openLines(piece.lines, dx, dy) + polygon(piece.seam, dx, dy, true);
  return svgDocument(plan.pageWidth, plan.pageHeight, `
    <defs><clipPath id="${clipId}"><rect x="${PAGE_MARGIN_CM}" y="${PAGE_MARGIN_CM}" width="${plan.contentWidth}" height="${plan.contentHeight}"/></clipPath></defs>
    <g clip-path="url(#${clipId})">${paths}</g>${footerSvg(plan, piece.label)}`);
}

async function createA4Pdf(pieces) {
  const prepared = pieces.map(piece => {
    const bounds = boundsFor(piece);
    return { piece, bounds, plan: createTilePlan(bounds.width + STROKE_SAFETY_CM * 2, bounds.height + STROKE_SAFETY_CM * 2) };
  });
  let pdf;
  for (const { piece, bounds, plan } of prepared) {
    for (const tile of plan.tiles) {
      const png = await renderSvgPage(a4PageSvg(piece, bounds, plan, tile), plan.pageWidth, plan.pageHeight);
      if (!pdf) {
        pdf = new jsPDF({ orientation: plan.orientation, unit: "cm", format: "a4", compress: true, precision: 4 });
      } else {
        pdf.addPage("a4", plan.orientation);
      }
      pdf.addImage(png, "PNG", 0, 0, plan.pageWidth, plan.pageHeight, undefined, "FAST");
    }
  }
  return { blob: pdf.output("blob"), pageCount: pdf.getNumberOfPages(), plans: prepared.map(item => ({ label: item.piece.label, ...item.plan })) };
}

function createSinglePageLayout(pieces) {
  const entries = pieces.map(piece => ({ piece, bounds: boundsFor(piece) }));
  const piecesWidth = entries.reduce((sum, entry) => sum + entry.bounds.width, 0) + PIECE_GAP_CM * (entries.length - 1);
  const piecesHeight = Math.max(...entries.map(entry => entry.bounds.height));
  const width = Math.max(12, piecesWidth) + PAGE_MARGIN_CM * 2;
  const calibrationY = PAGE_MARGIN_CM + piecesHeight + PIECE_GAP_CM;
  const height = calibrationY + 10 + PAGE_MARGIN_CM;
  let cursorX = PAGE_MARGIN_CM;
  const patternSvg = entries.map(({ piece, bounds }) => {
    const result = polygon(piece.outline, cursorX - bounds.minX, PAGE_MARGIN_CM - bounds.minY)
      + openLines(piece.lines, cursorX - bounds.minX, PAGE_MARGIN_CM - bounds.minY)
      + polygon(piece.seam, cursorX - bounds.minX, PAGE_MARGIN_CM - bounds.minY, true);
    cursorX += bounds.width + PIECE_GAP_CM;
    return result;
  }).join("");
  const calibrationSvg = `<rect x="${PAGE_MARGIN_CM}" y="${calibrationY}" width="10" height="10" fill="none" stroke="${INK}" stroke-width="0.08"/>`;
  return { width, height, svg: svgDocument(width, height, patternSvg + calibrationSvg) };
}

async function createSinglePagePdf(pieces) {
  const page = createSinglePageLayout(pieces);
  const png = await renderSvgPage(page.svg, page.width, page.height);
  const pdf = new jsPDF({ orientation: page.width > page.height ? "landscape" : "portrait", unit: "cm", format: [page.width, page.height], compress: true, precision: 4 });
  pdf.addImage(png, "PNG", 0, 0, page.width, page.height, undefined, "FAST");
  return { blob: pdf.output("blob"), pageCount: 1, pageSize: { widthCm: page.width, heightCm: page.height } };
}

export async function createPatternPdf({ pieces, mode = "a4" }) {
  if (!Array.isArray(pieces) || pieces.length < 2) throw new Error("PDF export requires body and sleeve pieces");
  if (mode === "a4" && pieces.length !== 3) throw new Error("A4 PDF export requires separate back, front and sleeve pieces");
  return mode === "single" ? createSinglePagePdf(pieces) : createA4Pdf(pieces);
}

export function downloadPdfBlob(blob, filename) {
  const safeFilename = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
