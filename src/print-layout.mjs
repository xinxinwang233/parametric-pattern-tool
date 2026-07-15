export const A4_WIDTH_CM = 21;
export const A4_HEIGHT_CM = 29.7;
export const PAGE_MARGIN_CM = 1;
export const RULER_ZONE_HEIGHT_CM = 1.7;

function positiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function pageMetrics(orientation = "portrait") {
  const landscape = orientation === "landscape";
  const pageWidth = landscape ? A4_HEIGHT_CM : A4_WIDTH_CM;
  const pageHeight = landscape ? A4_WIDTH_CM : A4_HEIGHT_CM;
  return {
    orientation: landscape ? "landscape" : "portrait",
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PAGE_MARGIN_CM * 2,
    contentHeight: pageHeight - PAGE_MARGIN_CM * 2 - RULER_ZONE_HEIGHT_CM,
  };
}

function planForOrientation(width, height, orientation) {
  const metrics = pageMetrics(orientation);
  const columns = Math.max(1, Math.ceil(width / metrics.contentWidth));
  const rows = Math.max(1, Math.ceil(height / metrics.contentHeight));
  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        row,
        column,
        offsetX: column * metrics.contentWidth,
        offsetY: row * metrics.contentHeight,
      });
    }
  }
  return { ...metrics, width, height, columns, rows, pageCount: columns * rows, tiles };
}

/** Choose A4 orientation independently for one pattern piece. Portrait wins ties. */
export function createTilePlan(widthCm, heightCm) {
  const width = positiveNumber(widthCm, "widthCm");
  const height = positiveNumber(heightCm, "heightCm");
  const portrait = planForOrientation(width, height, "portrait");
  const landscape = planForOrientation(width, height, "landscape");
  return landscape.pageCount < portrait.pageCount ? landscape : portrait;
}
