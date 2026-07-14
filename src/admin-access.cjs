const fs = require("node:fs");

function normalizeIp(value) {
  let ip = typeof value === "string" ? value.trim() : "";
  if (!ip) return "";
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip.toLowerCase();
}

function normalizedList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeIp).filter(Boolean))];
}

function loadAccessConfig(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    allowedIps: normalizedList(parsed.allowedIps),
    trustedProxyIps: normalizedList(parsed.trustedProxyIps),
  };
}

function firstForwardedIp(header) {
  const value = Array.isArray(header) ? header[0] : header;
  return normalizeIp(typeof value === "string" ? value.split(",")[0] : "");
}

function getClientIp(request, config) {
  const remoteIp = normalizeIp(request?.socket?.remoteAddress);
  if (config.trustedProxyIps.includes(remoteIp)) {
    return firstForwardedIp(request?.headers?.["x-forwarded-for"]) || remoteIp;
  }
  return remoteIp;
}

function isAdminRequestAllowed(request, config) {
  const clientIp = getClientIp(request, config);
  return Boolean(clientIp && config.allowedIps.includes(clientIp));
}

module.exports = { getClientIp, isAdminRequestAllowed, loadAccessConfig, normalizeIp };
