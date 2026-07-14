export const A4_WIDTH_CM = 21;
export const A4_HEIGHT_CM = 29.7;
export const TILE_OVERLAP_CM = 1;

function positiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function createTilePlan(widthCm, heightCm, overlapCm = TILE_OVERLAP_CM) {
  const width = positiveNumber(widthCm, "widthCm");
  const height = positiveNumber(heightCm, "heightCm");
  if (!Number.isFinite(overlapCm) || overlapCm < 0 || overlapCm >= Math.min(A4_WIDTH_CM, A4_HEIGHT_CM)) {
    throw new Error("overlapCm must fit inside an A4 page");
  }

  const stepX = A4_WIDTH_CM - overlapCm;
  const stepY = A4_HEIGHT_CM - overlapCm;
  const columns = width <= A4_WIDTH_CM ? 1 : Math.ceil((width - A4_WIDTH_CM) / stepX) + 1;
  const rows = height <= A4_HEIGHT_CM ? 1 : Math.ceil((height - A4_HEIGHT_CM) / stepY) + 1;
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        row,
        column,
        offsetX: column * stepX,
        offsetY: row * stepY,
      });
    }
  }

  return {
    width,
    height,
    overlapCm,
    stepX,
    stepY,
    columns,
    rows,
    tiles,
    coveredWidth: A4_WIDTH_CM + (columns - 1) * stepX,
    coveredHeight: A4_HEIGHT_CM + (rows - 1) * stepY,
  };
}
