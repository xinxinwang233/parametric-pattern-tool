import test from "node:test";
import assert from "node:assert/strict";
import { A4_HEIGHT_CM, A4_WIDTH_CM, createTilePlan } from "../src/print-layout.mjs";

test("A4 tile plan covers the complete source without gaps", () => {
  const plan = createTilePlan(80, 72.3);

  assert.equal(plan.columns, 4);
  assert.equal(plan.rows, 3);
  assert.equal(plan.tiles.length, 12);
  assert.ok(plan.coveredWidth >= plan.width);
  assert.ok(plan.coveredHeight >= plan.height);
  assert.equal(plan.tiles.at(-1).offsetX + A4_WIDTH_CM, plan.coveredWidth);
  assert.equal(plan.tiles.at(-1).offsetY + A4_HEIGHT_CM, plan.coveredHeight);

  for (let column = 1; column < plan.columns; column += 1) {
    const previousRightEdge = plan.tiles[column - 1].offsetX + A4_WIDTH_CM;
    assert.equal(previousRightEdge - plan.tiles[column].offsetX, 1);
  }
  for (let row = 1; row < plan.rows; row += 1) {
    const previousBottomEdge = plan.tiles[(row - 1) * plan.columns].offsetY + A4_HEIGHT_CM;
    assert.equal(previousBottomEdge - plan.tiles[row * plan.columns].offsetY, 1);
  }
});

test("small sources still produce one A4 tile", () => {
  const plan = createTilePlan(10, 10);
  assert.equal(plan.columns, 1);
  assert.equal(plan.rows, 1);
  assert.equal(plan.tiles.length, 1);
});
