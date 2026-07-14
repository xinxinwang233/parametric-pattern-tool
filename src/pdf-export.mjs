import { jsPDF } from "jspdf";
import { createTilePlan } from "./print-layout.mjs";

const RASTER_DPI = 150;

const PDF_COLORS = {
  "--paper": "#eae5d6",
  "--grid": "#d7cfb8",
  "--ink": "#20293f",
  "--construction": "#3d6f96",
  "--dart": "#a8423f",
  "--seam": "#b8823a",
  "--muted": "#7a7568",
};

function orientationFor(width, height) {
  return width > height ? "landscape" : "portrait";
}

function prepareSvg(source, suffix, widthCm, heightCm) {
  const clone = source.cloneNode(true);
  const renamedIds = new Map();
  clone.querySelectorAll("[id]").forEach(element => {
    const oldId = element.id;
    const newId = `${oldId}-${suffix}`;
    renamedIds.set(oldId, newId);
    element.id = newId;
  });
  clone.querySelectorAll("*").forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      renamedIds.forEach((newId, oldId) => { value = value.replaceAll(`#${oldId}`, `#${newId}`); });
      Object.entries(PDF_COLORS).forEach(([variable, color]) => { value = value.replaceAll(`var(${variable})`, color); });
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", `${widthCm}cm`);
  clone.setAttribute("height", `${heightCm}cm`);
  clone.style.width = `${widthCm}cm`;
  clone.style.height = `${heightCm}cm`;
  clone.style.maxWidth = "none";
  return clone;
}

async function renderSvgToPng(svg, widthCm, heightCm) {
  const pixelsPerCm = RASTER_DPI / 2.54;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(widthCm * pixelsPerCm);
  canvas.height = Math.ceil(heightCm * pixelsPerCm);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function createPatternPdf({ bodySvg, sleeveSvg, bodySize, sleeveSize }) {
  const bodyPlan = createTilePlan(bodySize.widthCm, bodySize.heightCm);
  const sleevePlan = createTilePlan(sleeveSize.widthCm, sleeveSize.heightCm);
  const body = prepareSvg(bodySvg, "body-pdf", bodySize.widthCm, bodySize.heightCm);
  const sleeve = prepareSvg(sleeveSvg, "sleeve-pdf", sleeveSize.widthCm, sleeveSize.heightCm);
  const bodyPng = await renderSvgToPng(body, bodySize.widthCm, bodySize.heightCm);
  const sleevePng = await renderSvgToPng(sleeve, sleeveSize.widthCm, sleeveSize.heightCm);

  const pdf = new jsPDF({
    orientation: orientationFor(bodySize.widthCm, bodySize.heightCm),
    unit: "cm",
    format: [bodySize.widthCm, bodySize.heightCm],
    compress: true,
    putOnlyUsedFonts: true,
    precision: 4,
  });

  // Pages 1-2: complete, unscaled, actual-size canvases.
  pdf.addImage(bodyPng, "PNG", 0, 0, bodySize.widthCm, bodySize.heightCm, "body-pattern", "FAST");
  pdf.addPage([sleeveSize.widthCm, sleeveSize.heightCm], orientationFor(sleeveSize.widthCm, sleeveSize.heightCm));
  pdf.addImage(sleevePng, "PNG", 0, 0, sleeveSize.widthCm, sleeveSize.heightCm, "sleeve-pattern", "FAST");

  // Remaining pages: deterministic A4 tiles with a 1 cm shared overlap.
  // for (const tile of bodyPlan.tiles) {
  //   pdf.addPage("a4", "portrait");
  //   pdf.addImage(bodyPng, "PNG", -tile.offsetX, -tile.offsetY, bodySize.widthCm, bodySize.heightCm, "body-pattern", "FAST");
  // }
  // for (const tile of sleevePlan.tiles) {
  //   pdf.addPage("a4", "portrait");
  //   pdf.addImage(sleevePng, "PNG", -tile.offsetX, -tile.offsetY, sleeveSize.widthCm, sleeveSize.heightCm, "sleeve-pattern", "FAST");
  // }

  return {
    blob: pdf.output("blob"),
    pageCount: pdf.getNumberOfPages(),
    bodyPlan,
    sleevePlan,
  };
}

export function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
