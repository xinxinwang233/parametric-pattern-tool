import test from "node:test";
import assert from "node:assert/strict";
import { PAGE_MARGIN_CM, RULER_ZONE_HEIGHT_CM, createTilePlan, pageMetrics } from "../src/print-layout.mjs";

test("A4 content area keeps 1 cm margins and an independent ruler zone", () => {
  const portrait = pageMetrics("portrait");
  assert.equal(portrait.contentWidth, 21 - PAGE_MARGIN_CM * 2);
  assert.equal(portrait.contentHeight, 29.7 - PAGE_MARGIN_CM * 2 - RULER_ZONE_HEIGHT_CM);

  const landscape = pageMetrics("landscape");
  assert.equal(landscape.contentWidth, 29.7 - PAGE_MARGIN_CM * 2);
  assert.equal(landscape.contentHeight, 21 - PAGE_MARGIN_CM * 2 - RULER_ZONE_HEIGHT_CM);
});

test("each piece chooses the orientation with fewer A4 pages", () => {
  const wide = createTilePlan(54, 15);
  assert.equal(wide.orientation, "landscape");
  assert.equal(wide.pageCount, 2);

  const tall = createTilePlan(18, 50);
  assert.equal(tall.orientation, "portrait");
  assert.equal(tall.pageCount, 2);
});

test("tile offsets cover a piece without mixing page dimensions", () => {
  const plan = createTilePlan(40, 50);
  assert.equal(plan.tiles.length, plan.columns * plan.rows);
  assert.ok(plan.columns * plan.contentWidth >= plan.width);
  assert.ok(plan.rows * plan.contentHeight >= plan.height);
  assert.equal(plan.tiles.at(-1).offsetX, (plan.columns - 1) * plan.contentWidth);
  assert.equal(plan.tiles.at(-1).offsetY, (plan.rows - 1) * plan.contentHeight);
});
