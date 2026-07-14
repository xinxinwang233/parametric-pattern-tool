const DOWNLOAD_LABELS = {
  pdf: "导出 PDF 纸样",
  svg: "导出 SVG 纸样",
  dxf: "导出 DXF 纸样",
  plt: "导出 PLT 纸样",
};

function actorKey(record, fallback) {
  return record?.ipHash || record?.visitorId || record?.id || fallback;
}

function uniqueActors(records, prefix) {
  return new Set(records.map((record, index) => actorKey(record, `${prefix}-${index}`)));
}

function latestDate(records, fields) {
  const timestamps = records.flatMap(record => fields.map(field => Date.parse(record?.[field])).filter(Number.isFinite));
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function buildDashboardStats(data) {
  const visitors = Array.isArray(data?.visitors) ? data.visitors : [];
  const downloads = Array.isArray(data?.downloads?.events) ? data.downloads.events : [];
  const feedback = Array.isArray(data?.feedback) ? data.feedback : [];
  const allRecords = [...visitors, ...downloads, ...feedback];
  const totalVisits = visitors.reduce((sum, visitor) => sum + (Number(visitor.visitCount) || 0), 0);
  const actions = [];

  if (visitors.length || totalVisits) {
    actions.push({
      key: "visits",
      label: "访问纸样工具",
      people: uniqueActors(visitors, "visitor").size,
      events: totalVisits,
      unit: "次访问",
    });
  }

  const formats = new Map();
  for (const event of downloads) {
    const format = String(event?.format || "other").toLowerCase();
    if (!formats.has(format)) formats.set(format, []);
    formats.get(format).push(event);
  }
  for (const [format, events] of formats) {
    actions.push({
      key: `download-${format}`,
      label: DOWNLOAD_LABELS[format] || `导出 ${format.toUpperCase()} 纸样`,
      people: uniqueActors(events, `download-${format}`).size,
      events: events.length,
      unit: "次导出",
    });
  }

  if (feedback.length) {
    actions.push({
      key: "feedback",
      label: "提交版型建议",
      people: uniqueActors(feedback, "feedback").size,
      events: feedback.length,
      unit: "条建议",
    });
  }

  return {
    people: uniqueActors(allRecords, "activity").size,
    totalVisits,
    totalDownloads: downloads.length,
    feedbackCount: feedback.length,
    actions,
    suggestions: feedback
      .slice()
      .sort((a, b) => (Date.parse(b?.createdAt) || 0) - (Date.parse(a?.createdAt) || 0))
      .slice(0, 10)
      .map(item => ({
        message: String(item?.message || "").trim().slice(0, 500),
        createdAt: item?.createdAt || null,
      }))
      .filter(item => item.message),
    maxPeople: Math.max(1, ...actions.map(action => action.people)),
    lastActivityAt: latestDate(allRecords, ["lastSeenAt", "createdAt", "firstSeenAt"]),
  };
}

module.exports = { buildDashboardStats };
