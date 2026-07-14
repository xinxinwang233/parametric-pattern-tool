const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDashboardStats } = require("../src/backend-stats.cjs");

test("dashboard aggregates people by anonymous actor without exposing identifiers", () => {
  const data = {
    visitors: [
      { visitorId: "first-browser", ipHash: "same-person", visitCount: 3, lastSeenAt: "2026-07-14T10:00:00Z" },
      { visitorId: "second-browser", ipHash: "same-person", visitCount: 2, lastSeenAt: "2026-07-14T11:00:00Z" },
      { visitorId: "another-person", ipHash: "another-person", visitCount: 1, lastSeenAt: "2026-07-14T12:00:00Z" },
    ],
    downloads: {
      events: [
        { visitorId: "first-browser", ipHash: "same-person", format: "pdf", createdAt: "2026-07-14T12:30:00Z" },
        { visitorId: "another-person", ipHash: "another-person", format: "svg", createdAt: "2026-07-14T13:00:00Z" },
      ],
    },
    feedback: [{
      id: "feedback-secret-id",
      visitorId: "another-person",
      ipHash: "another-person",
      contact: "private-contact",
      message: "希望增加连衣裙基础版型",
      createdAt: "2026-07-14T14:00:00Z",
    }],
  };

  const result = buildDashboardStats(data);
  assert.equal(result.people, 2);
  assert.equal(result.totalVisits, 6);
  assert.equal(result.totalDownloads, 2);
  assert.equal(result.feedbackCount, 1);
  assert.deepEqual(result.actions.map(action => [action.label, action.people, action.events]), [
    ["访问纸样工具", 2, 6],
    ["导出 PDF 纸样", 1, 1],
    ["导出 SVG 纸样", 1, 1],
    ["提交版型建议", 1, 1],
  ]);
  assert.equal(JSON.stringify(result).includes("first-browser"), false);
  assert.equal(JSON.stringify(result).includes("same-person"), false);
  assert.deepEqual(result.suggestions, [{ message: "希望增加连衣裙基础版型", createdAt: "2026-07-14T14:00:00Z" }]);
  assert.equal(JSON.stringify(result).includes("private-contact"), false);
  assert.equal(JSON.stringify(result).includes("feedback-secret-id"), false);
});

test("dashboard handles an empty data store", () => {
  const result = buildDashboardStats({});
  assert.equal(result.people, 0);
  assert.equal(result.actions.length, 0);
  assert.equal(result.lastActivityAt, null);
});
