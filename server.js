const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildDashboardStats } = require("./src/backend-stats.cjs");
const { isAdminRequestAllowed, loadAccessConfig } = require("./src/admin-access.cjs");

const PORT = Number(process.env.PORT) || 3001;
const DIST_DIR = path.join(__dirname, "dist");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const ADMIN_ACCESS_FILE = process.env.ADMIN_ACCESS_CONFIG || path.join(__dirname, "config", "admin-access.json");
const MAX_BODY_SIZE = 16 * 1024;
const feedbackRateLimit = new Map();

const emptyData = () => ({
  visitors: [],
  downloads: { total: 0, byFormat: {}, events: [] },
  feedback: [],
});

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData(), null, 2));
  }
}

function readData() {
  ensureDataFile();
  try {
    return { ...emptyData(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
  } catch (error) {
    console.error("Unable to read data store:", error.message);
    return emptyData();
  }
}

function writeData(data) {
  ensureDataFile();
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(html);
}

function readAdminAccessConfig() {
  try {
    return loadAccessConfig(ADMIN_ACCESS_FILE);
  } catch (error) {
    console.error("Unable to read admin IP whitelist:", error.message);
    return { allowedIps: [], trustedProxyIps: [] };
  }
}

function rejectAdminRequest(response, apiRequest) {
  if (apiRequest) return sendJson(response, 403, { error: "Forbidden" });
  return sendHtml(response, 403, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>访问受限</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f1eee5;color:#20293f;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.box{margin:24px;padding:28px 32px;border:1px solid #ddd6c3;border-radius:12px;background:#fffdf8;text-align:center}.box h1{margin:0 0 8px;font-size:22px}.box p{margin:0;color:#777468;font-size:13px}</style></head><body><div class="box"><h1>访问受限</h1><p>当前网络地址没有后台访问权限。</p></div></body></html>`);
}

function formatDashboardTime(value) {
  if (!value) return "暂无活动";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: process.env.DASHBOARD_TIME_ZONE || "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return "刚刚更新";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAdminDashboard(data) {
  const stats = buildDashboardStats(data);
  const actionRows = stats.actions.length ? stats.actions.map(action => {
    const width = Math.max(6, Math.round(action.people / stats.maxPeople * 100));
    return `<li class="action-row">
      <div class="action-copy">
        <strong>${action.label}</strong>
        <span>${action.people} 人 · ${action.events} ${action.unit}</span>
      </div>
      <div class="bar" aria-hidden="true"><i style="width:${width}%"></i></div>
    </li>`;
  }).join("") : `<li class="empty">还没有活动数据</li>`;
  const suggestionRows = stats.suggestions.length ? stats.suggestions.map(suggestion => `<li class="suggestion">
    <p>${escapeHtml(suggestion.message)}</p>
    <time>${formatDashboardTime(suggestion.createdAt)}</time>
  </li>`).join("") : `<li class="empty">暂时还没有收到版型建议</li>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>纸样工具 · 使用概览</title>
  <style>
    :root { color-scheme: light; --bg:#f1eee5; --card:#fffdf8; --ink:#20293f; --muted:#777468; --line:#ddd6c3; --blue:#3d6f96; --gold:#b8823a; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
    main { width:min(880px, calc(100% - 32px)); margin:0 auto; padding:48px 0 64px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; }
    .eyebrow { margin:0 0 5px; color:var(--blue); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    h1 { margin:0; font-size:30px; letter-spacing:-.02em; }
    .updated { color:var(--muted); font-size:12px; white-space:nowrap; }
    .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
    .card, .panel { background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 28px rgba(32,41,63,.05); }
    .card { padding:18px; }
    .card span { display:block; margin-bottom:8px; color:var(--muted); font-size:12px; }
    .card b { font-size:28px; line-height:1; }
    .card small { margin-left:4px; color:var(--muted); font-size:12px; font-weight:500; }
    .panel { padding:22px; }
    .panel h2 { margin:0 0 4px; font-size:17px; }
    .panel-intro { margin:0 0 18px; color:var(--muted); font-size:12px; }
    .actions { list-style:none; margin:0; padding:0; }
    .action-row { display:grid; grid-template-columns:minmax(210px, .8fr) 1.2fr; align-items:center; gap:24px; padding:15px 0; border-top:1px solid #e9e4d7; }
    .action-row:first-child { border-top:0; }
    .action-copy { display:flex; justify-content:space-between; align-items:baseline; gap:16px; }
    .action-copy strong { font-size:14px; }
    .action-copy span { color:var(--muted); font-size:12px; white-space:nowrap; }
    .bar { height:9px; overflow:hidden; border-radius:99px; background:#e8e4d9; }
    .bar i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--blue),#6d98b8); }
    .empty { padding:36px 0; color:var(--muted); text-align:center; font-size:13px; }
    .suggestion-panel { margin-top:16px; }
    .suggestions { display:grid; grid-template-columns:1fr 1fr; gap:10px; list-style:none; margin:16px 0 0; padding:0; }
    .suggestion { min-width:0; padding:15px 16px; border:1px solid #e5dfd0; border-radius:9px; background:#faf7ef; }
    .suggestion p { margin:0; color:var(--ink); font-size:13px; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; }
    .suggestion time { display:block; margin-top:10px; color:var(--muted); font-size:11px; }
    footer { margin-top:14px; color:var(--muted); font-size:11px; text-align:right; }
    @media (max-width:700px) { main { padding-top:28px; } header { align-items:flex-start; flex-direction:column; } .cards { grid-template-columns:1fr 1fr; } .action-row { grid-template-columns:1fr; gap:10px; } .suggestions { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><p class="eyebrow">Activity overview</p><h1>纸样工具使用概览</h1></div>
      <div class="updated">最近活动：${formatDashboardTime(stats.lastActivityAt)}</div>
    </header>
    <section class="cards" aria-label="总体数据">
      <div class="card"><span>使用人数</span><b>${stats.people}</b><small>人</small></div>
      <div class="card"><span>页面访问</span><b>${stats.totalVisits}</b><small>次</small></div>
      <div class="card"><span>纸样导出</span><b>${stats.totalDownloads}</b><small>次</small></div>
      <div class="card"><span>版型建议</span><b>${stats.feedbackCount}</b><small>条</small></div>
    </section>
    <section class="panel">
      <h2>大家做了什么</h2>
      <p class="panel-intro">仅展示匿名汇总，不显示访客编号或个人明细。</p>
      <ul class="actions">${actionRows}</ul>
    </section>
    <section class="panel suggestion-panel">
      <h2>具体版型建议</h2>
      <p class="panel-intro">显示最近 10 条建议正文，不展示提交者身份和联系方式。</p>
      <ul class="suggestions">${suggestionRows}</ul>
    </section>
    <footer>页面每 60 秒自动刷新</footer>
  </main>
</body>
</html>`;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(new Error("BODY_TOO_LARGE"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function requestIdentity(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = cleanText(Array.isArray(forwarded) ? forwarded[0] : (forwarded || request.socket.remoteAddress), 100).split(",")[0].trim();
  return crypto.createHash("sha256").update(`${process.env.VISITOR_HASH_SALT || "pattern-tool"}:${ip}`).digest("hex").slice(0, 20);
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/stats") {
    const data = readData();
    const dashboard = buildDashboardStats(data);
    return sendJson(response, 200, {
      people: dashboard.people,
      totalVisits: dashboard.totalVisits,
      totalDownloads: dashboard.totalDownloads,
      feedbackCount: dashboard.feedbackCount,
      actions: dashboard.actions,
      dashboard: "/admin",
    });
  }

  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return sendJson(response, error.message === "BODY_TOO_LARGE" ? 413 : 400, { error: "Invalid request body" });
  }

  const now = new Date().toISOString();
  const visitorId = cleanText(body.visitorId, 100) || "unknown";
  const ipHash = requestIdentity(request);
  const data = readData();

  if (pathname === "/api/visits") {
    const existing = data.visitors.find(visitor => visitor.visitorId === visitorId);
    if (existing) {
      existing.lastSeenAt = now;
      existing.visitCount += 1;
      existing.lastPage = cleanText(body.page, 200) || "/";
    } else {
      data.visitors.push({
        visitorId,
        ipHash,
        firstSeenAt: now,
        lastSeenAt: now,
        visitCount: 1,
        lastPage: cleanText(body.page, 200) || "/",
        userAgent: cleanText(request.headers["user-agent"], 300),
        referrer: cleanText(request.headers.referer, 300),
      });
    }
    writeData(data);
    return sendJson(response, 201, { ok: true });
  }

  if (pathname === "/api/downloads") {
    const format = cleanText(body.format, 12).toLowerCase();
    if (!["pdf", "svg", "dxf", "plt"].includes(format)) return sendJson(response, 400, { error: "Invalid format" });
    data.downloads.total += 1;
    data.downloads.byFormat[format] = (data.downloads.byFormat[format] || 0) + 1;
    data.downloads.events.push({
      id: crypto.randomUUID(),
      visitorId,
      ipHash,
      format,
      pattern: cleanText(body.pattern, 150),
      createdAt: now,
    });
    if (data.downloads.events.length > 10000) data.downloads.events = data.downloads.events.slice(-10000);
    writeData(data);
    return sendJson(response, 201, { ok: true, total: data.downloads.total });
  }

  if (pathname === "/api/feedback") {
    const recent = (feedbackRateLimit.get(ipHash) || []).filter(timestamp => Date.now() - timestamp < 60_000);
    if (recent.length >= 5) return sendJson(response, 429, { error: "Too many requests" });
    const message = cleanText(body.message, 500);
    if (message.length < 4) return sendJson(response, 400, { error: "Message is too short" });
    recent.push(Date.now());
    feedbackRateLimit.set(ipHash, recent);
    data.feedback.push({
      id: crypto.randomUUID(),
      visitorId,
      ipHash,
      message,
      contact: cleanText(body.contact, 100),
      currentPattern: cleanText(body.currentPattern, 150),
      createdAt: now,
      status: "new",
    });
    writeData(data);
    return sendJson(response, 201, { ok: true });
  }

  return sendJson(response, 404, { error: "Not found" });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(DIST_DIR, `.${requestedPath}`);
  const safePath = filePath.startsWith(`${DIST_DIR}${path.sep}`) ? filePath : path.join(DIST_DIR, "index.html");
  const finalPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile() ? safePath : path.join(DIST_DIR, "index.html");

  if (!fs.existsSync(finalPath)) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Frontend has not been built. Run npm run build first.");
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(finalPath)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(finalPath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    const protectedApi = url.pathname === "/api/stats";
    const protectedPage = url.pathname === "/admin" || url.pathname === "/stats";
    if ((protectedApi || protectedPage) && !isAdminRequestAllowed(request, readAdminAccessConfig())) {
      return rejectAdminRequest(response, protectedApi);
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url.pathname);
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/stats")) {
      return sendHtml(response, 200, renderAdminDashboard(readData()));
    }
    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed" });
    return serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Pattern tool server running at http://localhost:${PORT}`);
});
