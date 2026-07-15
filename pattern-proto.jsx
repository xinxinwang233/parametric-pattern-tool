import React, { useEffect, useState, useMemo } from "react";
import { Ruler, Layers, Grid3x3, Download, ChevronDown, X, MessageSquare, QrCode, Send, CheckCircle2 } from "lucide-react";

/* ============================================================
   计算几何工具函数
   ============================================================ */

function quadBezierLength(p0, p1, p2, steps = 30) {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const curr = {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
    len += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    prev = curr;
  }
  return len;
}

function quadBezierPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
}

function sampleQuad(points, p0, p1, p2, steps = 12) {
  for (let i = 1; i <= steps; i++) points.push(quadBezierPoint(p0, p1, p2, i / steps));
}

function sampleCubic(points, p0, p1, p2, p3, steps = 12) {
  for (let i = 1; i <= steps; i++) points.push(cubicBezierPoint(p0, p1, p2, p3, i / steps));
}

function clampedSplineSegments(pts, { startSpeed = 1, endSpeed = 0.82 } = {}) {
  const times = [0];
  for (let i = 1; i < pts.length; i++) {
    const chord = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    times.push(times[i - 1] + Math.max(chord, 1e-6));
  }
  const direction = Math.sign(pts[pts.length - 1].x - pts[0].x) || 1;

  const secondDerivatives = (values, startSlope, endSlope) => {
    const n = values.length;
    const a = Array(n).fill(0), b = Array(n).fill(0), c = Array(n).fill(0), rhs = Array(n).fill(0);
    const h0 = times[1] - times[0];
    b[0] = 2 * h0;
    c[0] = h0;
    rhs[0] = 6 * ((values[1] - values[0]) / h0 - startSlope);
    for (let i = 1; i < n - 1; i++) {
      const hPrev = times[i] - times[i - 1];
      const hNext = times[i + 1] - times[i];
      a[i] = hPrev;
      b[i] = 2 * (hPrev + hNext);
      c[i] = hNext;
      rhs[i] = 6 * ((values[i + 1] - values[i]) / hNext - (values[i] - values[i - 1]) / hPrev);
    }
    const hLast = times[n - 1] - times[n - 2];
    a[n - 1] = hLast;
    b[n - 1] = 2 * hLast;
    rhs[n - 1] = 6 * (endSlope - (values[n - 1] - values[n - 2]) / hLast);
    for (let i = 1; i < n; i++) {
      const factor = a[i] / b[i - 1];
      b[i] -= factor * c[i - 1];
      rhs[i] -= factor * rhs[i - 1];
    }
    const result = Array(n).fill(0);
    result[n - 1] = rhs[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) result[i] = (rhs[i] - c[i] * result[i + 1]) / b[i];
    return result;
  };

  const mx = secondDerivatives(pts.map(p => p.x), direction * startSpeed, direction * endSpeed);
  const my = secondDerivatives(pts.map(p => p.y), 0, 0);
  return pts.slice(0, -1).map((p0, i) => {
    const p3 = pts[i + 1];
    const h = times[i + 1] - times[i];
    const dx0 = (p3.x - p0.x) / h - h * (2 * mx[i] + mx[i + 1]) / 6;
    const dy0 = (p3.y - p0.y) / h - h * (2 * my[i] + my[i + 1]) / 6;
    const dx1 = (p3.x - p0.x) / h + h * (mx[i] + 2 * mx[i + 1]) / 6;
    const dy1 = (p3.y - p0.y) / h + h * (my[i] + 2 * my[i + 1]) / 6;
    return {
      p0,
      c1: { x: p0.x + dx0 * h / 3, y: p0.y + dy0 * h / 3 },
      c2: { x: p3.x - dx1 * h / 3, y: p3.y - dy1 * h / 3 },
      p3,
    };
  });
}

// 对闭合轮廓的每条边作等距法线偏移，并以相邻偏移线交点形成缝份轮廓。
function offsetClosedPolygon(vertices, distance) {
  const pts = vertices.filter((p, i) => i === 0 || Math.hypot(p.x - vertices[i - 1].x, p.y - vertices[i - 1].y) > 1e-6);
  // 闭合由算法负责，输入末点若与首点重复会产生零长度边，并在圆顺顶点形成凹口。
  if (pts.length > 1 && Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < 1e-6) pts.pop();
  const n = pts.length;
  // 以闭合轮廓的绕行方向统一确定外法线。不能用“远离中心”逐段判断，
  // 因为袖窿等凹曲线的正确外侧恰好可能朝向轮廓中心区域。
  const signedArea = pts.reduce((area, p, i) => {
    const next = pts[(i + 1) % n];
    return area + p.x * next.y - next.x * p.y;
  }, 0) / 2;
  const normalDirection = signedArea >= 0 ? 1 : -1;
  const edges = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len * normalDirection;
    const ny = -dx / len * normalDirection;
    edges.push({
      a: { x: a.x + nx * distance, y: a.y + ny * distance },
      b: { x: b.x + nx * distance, y: b.y + ny * distance },
    });
  }

  const intersect = (a, b, c, d) => {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const cross = r.x * s.y - r.y * s.x;
    if (Math.abs(cross) < 1e-8) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / cross;
    return { x: a.x + t * r.x, y: a.y + t * r.y };
  };

  return pts.map((vertex, i) => {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    const hit = intersect(prev.a, prev.b, curr.a, curr.b);
    if (hit && Math.hypot(hit.x - vertex.x, hit.y - vertex.y) <= distance * 4) return hit;
    return { x: (prev.b.x + curr.a.x) / 2, y: (prev.b.y + curr.a.y) / 2 };
  });
}

function layoutNonOverlappingLabels(items, width, height) {
  const placed = [];
  const overlaps = (a, b) => !(a.x2 + 3 < b.x1 || a.x1 - 3 > b.x2 || a.y2 + 3 < b.y1 || a.y1 - 3 > b.y2);
  const result = {};

  for (const item of items) {
    const textWidth = Math.max(28, Array.from(item.label).length * 9.5);
    const textHeight = 13;
    const preferred = item.preferred || { dx: 8, dy: -10, anchor: "start" };
    const candidates = [preferred];
    for (const radius of [14, 22, 32, 44, 58, 74, 92]) {
      for (const [ux, uy] of [[1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [1, 0], [-1, 0]]) {
        candidates.push({ dx: ux * radius, dy: uy * radius, anchor: ux < 0 ? "end" : ux > 0 ? "start" : "middle" });
      }
    }

    let chosen = null;
    for (const candidate of candidates) {
      const textX = item.point.x + candidate.dx;
      const textY = item.point.y + candidate.dy;
      const x1 = candidate.anchor === "end" ? textX - textWidth : candidate.anchor === "middle" ? textX - textWidth / 2 : textX;
      const box = { x1, y1: textY - textHeight + 2, x2: x1 + textWidth, y2: textY + 3 };
      if (box.x1 < 3 || box.x2 > width - 3 || box.y1 < 3 || box.y2 > height - 3) continue;
      if (!placed.some(other => overlaps(box, other))) {
        chosen = { ...box, textX, textY, anchor: candidate.anchor };
        break;
      }
    }

    if (!chosen) {
      outer: for (let y = 16; y < height - 4; y += 16) {
        for (let x = 6; x < width - textWidth - 4; x += 20) {
          const box = { x1: x, y1: y - textHeight + 2, x2: x + textWidth, y2: y + 3 };
          if (!placed.some(other => overlaps(box, other))) {
            chosen = { ...box, textX: x, textY: y, anchor: "start" };
            break outer;
          }
        }
      }
    }

    if (chosen) {
      placed.push(chosen);
      const cx = (chosen.x1 + chosen.x2) / 2;
      const cy = (chosen.y1 + chosen.y2) / 2;
      result[item.key] = { ...chosen, showLeader: Math.hypot(cx - item.point.x, cy - item.point.y) > 26, point: item.point };
    }
  }
  return result;
}

function SvgLabelLayer({ items, layout, color = "var(--ink)" }) {
  return (
    <>
      {items.map(item => {
        const pos = layout[item.key];
        if (!pos) return null;
        const leaderX = Math.max(pos.x1, Math.min(item.point.x, pos.x2));
        const leaderY = Math.max(pos.y1, Math.min(item.point.y, pos.y2));
        return (
          <g key={item.key}>
            {pos.showLeader && <line x1={item.point.x} y1={item.point.y} x2={leaderX} y2={leaderY} stroke="var(--muted)" strokeWidth="0.8" />}
            <text x={pos.textX} y={pos.textY} textAnchor={pos.anchor} fontSize="9.5" fontFamily="JetBrains Mono, monospace" fill={color}>{item.label}</text>
          </g>
        );
      })}
    </>
  );
}

function PatternLegend({ printSeam, seam, showPointNames }) {
  return (
    <div className="pp-legend">
      <span><span className="pp-swatch" style={{ background: "var(--ink)" }} />原型轮廓线</span>
      <span><span className="pp-swatch" style={{ height: 0, borderTop: "1px dashed var(--construction)" }} />制图辅助线</span>
      {showPointNames && <span><span className="pp-point-swatch" />坐标点</span>}
      {printSeam && <span><span className="pp-swatch" style={{ height: 0, borderTop: "2px dashed var(--seam)" }} />打印缝份 {seam.toFixed(1)} cm</span>}
    </div>
  );
}

function ScaleReference({ x, y, scale }) {
  const length = 10 * scale;
  return (
    <g className="pp-scale-reference">
      <line x1={x} y1={y} x2={x + length} y2={y} stroke="var(--ink)" strokeWidth="1.4" />
      {[0, 5, 10].map(value => <line key={value} x1={x + value * scale} y1={y - 4} x2={x + value * scale} y2={y + 4} stroke="var(--ink)" strokeWidth="1.2" />)}
      <text x={x + length / 2} y={y - 7} textAnchor="middle" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fill="var(--ink)">参考比例尺 10 cm</text>
    </g>
  );
}

// 可直接输入的无限续调参数：一次拖动结束或直接输入后，以新值重置滑轨中心。
function CenteredParameter({ label, value, onChange, radius, step = 1, disabled = false, minimum = -Infinity, decimals = 0, unit = "" }) {
  const [center, setCenter] = useState(value);
  const formatValue = number => decimals > 0 ? Number(number).toFixed(decimals) : String(Number(number));
  const [draft, setDraft] = useState(formatValue(value));
  const finishAdjustment = () => setCenter(value);
  const updateFromRange = event => {
    const next = Math.max(minimum, Number(event.target.value));
    onChange(next);
    setDraft(formatValue(next));
  };
  const updateFromInput = event => {
    const raw = event.target.value;
    setDraft(raw);
    if (raw.trim() === "" || raw === "-" || raw === "." || raw === "-.") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = Math.max(minimum, parsed);
    onChange(next);
    setCenter(next);
  };
  const finishInput = () => setDraft(formatValue(value));

  return (
    <div className="pp-row" style={{ opacity: disabled ? 0.45 : 1 }}>
      <label>
        <span>{label}</span>
        <span className="pp-number-wrap">
          <input
            className="pp-number-input"
            type="number"
            step={step}
            value={draft}
            onChange={updateFromInput}
            onBlur={finishInput}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
            disabled={disabled}
          />
          {unit}
        </span>
      </label>
      <input
        type="range"
        min={center - radius}
        max={center + radius}
        step={step}
        value={value}
        onChange={updateFromRange}
        onPointerUp={finishAdjustment}
        onPointerCancel={finishAdjustment}
        onKeyUp={finishAdjustment}
        onBlur={finishAdjustment}
        disabled={disabled}
      />
    </div>
  );
}

/* ============================================================
   参考线构图（第一步）—— 来自你参考书的公式
   坐标系：原点=长方形左上角（后中线×上平线交点），
   x 向右（后中→前中），y 向下（上平线→腰围线），单位 cm。
   长方形本身由「背长线」（左边，竖直，长度=背长）和
   「胸围宽线」（上边，水平，长度=B/2+松量）构成。
   ============================================================ */
function computeReferenceLines({ BL, B, ease }) {
  const width = B / 2 + ease;      // 胸围宽：长方形宽度
  const bustLineY = B / 6 + 7;     // 胸围线BL：上平线往下位移量
  const backWidthX = B / 6 + 4.5;  // 背宽线：后中往右位移量
  const chestWidthX = B / 6 + 3;   // 胸宽线：前中往左位移量
  const sideX = width / 2;         // 腋下侧缝线：胸围线中点

  return {
    formulas: { width, bustLineY, backWidthX, chestWidthX, sideX },
    rect: { x0: 0, y0: 0, x1: width, y1: BL },
    bustLine: { x0: 0, x1: width, y: bustLineY },
    backWidthLine: { x: backWidthX, y0: 0, y1: bustLineY },
    chestWidthLine: { x: width - chestWidthX, y0: 0, y1: bustLineY },
    sideSeamLine: { x: sideX, y0: bustLineY, y1: BL },
    keyPoints: {
      CB_TOP: { x: 0, y: 0 },
      CF_TOP: { x: width, y: 0 },
      CB_BUST: { x: 0, y: bustLineY },
      CF_BUST: { x: width, y: bustLineY },
      SIDE_BUST: { x: sideX, y: bustLineY },
      BACKWIDTH_TOP: { x: backWidthX, y: 0 },
      CHESTWIDTH_TOP: { x: width - chestWidthX, y: 0 },
      CB_WAIST: { x: 0, y: BL },
      CF_WAIST: { x: width, y: BL },
      SIDE_WAIST: { x: sideX, y: BL },
    },
  };
}
const REF_POINT_LABELS = {
  CB_TOP: "后颈点BNP", CB_BUST: "后中×胸围线", CF_BUST: "前中×胸围线",
  SIDE_BUST: "腋下侧缝线上端", CB_WAIST: "后中×腰围线", CF_WAIST: "前中×腰围线",
};




/* ============================================================
   计算几何 - 第二步（7, 8, 9, 10 线）
   ============================================================ */
function computeStep2Lines({ B, grid }) {
  const { width, bustLineY, backWidthX, chestWidthX, sideX } = grid.formulas;

  // 7. 后领窝
  const backNeckW = B / 12;
  const backNeckH = backNeckW / 3;
  const BACK_NECK_PT = { x: backNeckW, y: -backNeckH }; // 注意y朝上为负
  const CB_TOP = { x: 0, y: 0 };
  
  // 后领窝弧线控制点 (靠近后中线较平，靠近高点较陡)
  const backNeckC1 = { x: backNeckW * 0.5, y: 0 };
  const backNeckC2 = { x: backNeckW, y: -backNeckH * 0.5 };

  // 8. 前领窝
  const frontNeckW = backNeckW - 0.2;
  const frontNeckD = backNeckW + 1;
  const CF_TOP = { x: width, y: 0 };
  const FRONT_NECK_W_PT = { x: width - frontNeckW, y: 0.5 };
  const FRONT_NECK_D_PT = { x: width, y: frontNeckD };

  // 前领窝长方形左下角点
  const rectBL = { x: width - frontNeckW, y: frontNeckD };
  // 分角线端点 (向右上，45度角)
  const bisectLen = frontNeckW / 2;
  const bisectPt = { 
    x: rectBL.x + bisectLen * Math.cos(Math.PI / 4), 
    y: rectBL.y - bisectLen * Math.sin(Math.PI / 4) 
  };

  // 前领窝弧线 (二次贝塞尔穿过 bisectPt)
  // P(0.5) = 0.25*P0 + 0.5*P1_ctrl + 0.25*P2 = bisectPt
  const frontNeckCtrl = {
    x: 2 * bisectPt.x - 0.5 * FRONT_NECK_W_PT.x - 0.5 * FRONT_NECK_D_PT.x,
    y: 2 * bisectPt.y - 0.5 * FRONT_NECK_W_PT.y - 0.5 * FRONT_NECK_D_PT.y
  };

  // 9. 后肩斜线
  // 背宽线的上顶点下落一个后领窝高，再水平向右位移2
  const BACK_SHOULDER_PT = { x: backWidthX + 2, y: backNeckH };
  const backShoulderLen = Math.hypot(BACK_SHOULDER_PT.x - BACK_NECK_PT.x, BACK_SHOULDER_PT.y - BACK_NECK_PT.y);

  // 10. 前肩斜线
  // 胸宽线的上顶点向下落两个后领窝高
  const frontShoulderY = 2 * backNeckH;
  const R = backShoulderLen - 1.8;
  const dy = frontShoulderY - FRONT_NECK_W_PT.y;
  const dx = Math.sqrt(Math.max(0, R * R - dy * dy));
  const FRONT_SHOULDER_PT = { x: FRONT_NECK_W_PT.x - dx, y: frontShoulderY };

  // 11. 后袖窿
  // 后袖窿宽
  const backArmholeWidth = sideX - backWidthX;
  // 后袖窿深的两等分点
  const backArmholeDepthMidPt = {
    x: backWidthX,
    y: (BACK_SHOULDER_PT.y + bustLineY) / 2
  };
  // 分角线长度与端点
  const backArmholeBisectLen = backArmholeWidth / 2 + 0.5;
  const backArmholeBisectPt = {
    x: backWidthX + backArmholeBisectLen * Math.cos(Math.PI / 4),
    y: bustLineY - backArmholeBisectLen * Math.sin(Math.PI / 4)
  };
  const SIDE_BUST = { x: sideX, y: bustLineY };

  // 后袖窿弧线 (参考前领窝的二次贝塞尔思路，分两段绘制)
  const p0 = BACK_SHOULDER_PT, p1 = backArmholeDepthMidPt, p2 = backArmholeBisectPt, p3 = SIDE_BUST;
  
  // 第一段：P0 -> P2，以 P1 为 t=0.5 处的经过点
  const backArmholeC1 = {
    x: 2 * p1.x - 0.5 * p0.x - 0.5 * p2.x,
    y: 2 * p1.y - 0.5 * p0.y - 0.5 * p2.y
  };
  
  // 第二段：P2 -> P3。必须不越过胸围线 (y <= bustLineY)
  // 取第一段在 P2 处的切线交于 y = bustLineY，保证两段在 P2 处尽可能平滑
  const dy_arm = p2.y - backArmholeC1.y;
  const dx_arm = p2.x - backArmholeC1.x;
  let c2x = p2.x + (dy_arm > 0 ? ((p3.y - p2.y) / dy_arm) * dx_arm : 0);
  
  // 限制 c2x 不越过 p2 和 p3 的 x 坐标范围
  const minX = Math.min(p2.x, p3.x);
  const maxX = Math.max(p2.x, p3.x);
  c2x = Math.max(minX, Math.min(maxX, c2x));
  
  const backArmholeC2 = { x: c2x, y: p3.y };

  // 12. 前袖窿
  const frontWidthX = width - chestWidthX;
  const frontArmholeDepthMidPt = {
    x: frontWidthX,
    y: (FRONT_SHOULDER_PT.y + bustLineY) / 2
  };
  const frontArmholeBisectLen = backArmholeWidth / 2;
  const frontArmholeBisectPt = {
    x: frontWidthX - frontArmholeBisectLen * Math.cos(Math.PI / 4),
    y: bustLineY - frontArmholeBisectLen * Math.sin(Math.PI / 4)
  };

  const fp0 = FRONT_SHOULDER_PT, fp1 = frontArmholeDepthMidPt, fp2 = frontArmholeBisectPt, fp3 = SIDE_BUST;
  const frontArmholeC1 = {
    x: 2 * fp1.x - 0.5 * fp0.x - 0.5 * fp2.x,
    y: 2 * fp1.y - 0.5 * fp0.y - 0.5 * fp2.y
  };
  
  const fdy_arm = fp2.y - frontArmholeC1.y;
  const fdx_arm = fp2.x - frontArmholeC1.x;
  let fc2x = fp2.x + (fdy_arm > 0 ? ((fp3.y - fp2.y) / fdy_arm) * fdx_arm : 0);
  
  const fminX = Math.min(fp2.x, fp3.x);
  const fmaxX = Math.max(fp2.x, fp3.x);
  fc2x = Math.max(fminX, Math.min(fmaxX, fc2x));
  
  const frontArmholeC2 = { x: fc2x, y: fp3.y };

  // 13. 腋下侧缝修正线
  const MODIFIED_SIDE_WAIST = { x: sideX - 2, y: grid.keyPoints.SIDE_WAIST.y };

  // 14. 胸高点 BP
  const bpX = width - chestWidthX / 2 - 0.7;
  const bpY = bustLineY + 4;
  const BP = { x: bpX, y: bpY };
  const BP_TOP = { x: bpX, y: bustLineY };

  // 15. 底摆起翘追加
  const BL_Y = grid.rect.y1;
  const hemDrop = frontNeckW / 2;
  const HEM_CF_DROP = { x: width, y: BL_Y + hemDrop };
  const HEM_BP_INTERSECT = { x: bpX, y: BL_Y + hemDrop };

  const BC = quadBezierLength(BACK_SHOULDER_PT, backArmholeC1, backArmholeBisectPt) + quadBezierLength(backArmholeBisectPt, backArmholeC2, SIDE_BUST);
  const AC = quadBezierLength(FRONT_SHOULDER_PT, frontArmholeC1, frontArmholeBisectPt) + quadBezierLength(frontArmholeBisectPt, frontArmholeC2, SIDE_BUST);

  return {
    formulas: { backNeckW, backNeckH, frontNeckW, frontNeckD, backShoulderLen, R, dx, dy, backArmholeWidth, backArmholeBisectLen, frontArmholeBisectLen, hemDrop, AC, BC },
    points: {
      CB_TOP, BACK_NECK_PT, CF_TOP, FRONT_NECK_W_PT, FRONT_NECK_D_PT, bisectPt, BACK_SHOULDER_PT, FRONT_SHOULDER_PT,
      backArmholeDepthMidPt, backArmholeBisectPt, SIDE_BUST,
      frontArmholeDepthMidPt, frontArmholeBisectPt, MODIFIED_SIDE_WAIST,
      BP, BP_TOP, HEM_CF_DROP, HEM_BP_INTERSECT
    },
    curves: {
      backNeckC1, backNeckC2, frontNeckCtrl, backArmholeC1, backArmholeC2, frontArmholeC1, frontArmholeC2
    }
  };
}

const STEP2_POINT_LABELS = {
  BACK_NECK_PT: "后领窝高点/侧颈点SNP",
  FRONT_NECK_W_PT: "前领窝宽点",
  FRONT_NECK_D_PT: "前领窝深点/前颈点FNP",
  bisectPt: "分角线端点",
  BACK_SHOULDER_PT: "后肩宽点",
  FRONT_SHOULDER_PT: "前肩宽点",
  backArmholeDepthMidPt: "后袖窿深二等分点",
  backArmholeBisectPt: "后袖窿分角点",
  frontArmholeDepthMidPt: "前袖窿深二等分点",
  frontArmholeBisectPt: "前袖窿分角点",
  MODIFIED_SIDE_WAIST: "腋下侧缝修正点",
  BP: "胸高点BP",
  HEM_CF_DROP: "前中底摆下落点",
  HEM_BP_INTERSECT: "底摆BP垂线交点",
};

/* ============================================================
   UI
   ============================================================ */
const POINT_LABEL_OFFSETS = {
  CB_TOP: { dx: -8, dy: -12, anchor: "end" },
  CF_TOP: { dx: 8, dy: -28, anchor: "start" },
  BACKWIDTH_TOP: { dx: 0, dy: -26, anchor: "middle" },
  CHESTWIDTH_TOP: { dx: 0, dy: -26, anchor: "middle" },
  BACK_NECK_PT: { dx: 7, dy: -10, anchor: "start" },
  FRONT_NECK_W_PT: { dx: -8, dy: -14, anchor: "end" },
  FRONT_NECK_D_PT: { dx: 8, dy: 18, anchor: "start" },
  bisectPt: { dx: 8, dy: -10, anchor: "start" },
  BACK_SHOULDER_PT: { dx: -8, dy: 18, anchor: "end" },
  FRONT_SHOULDER_PT: { dx: -8, dy: 18, anchor: "end" },
  CB_BUST: { dx: 8, dy: 16, anchor: "start" },
  CF_BUST: { dx: -8, dy: 16, anchor: "end" },
  SIDE_BUST: { dx: 8, dy: -10, anchor: "start" },
  backArmholeDepthMidPt: { dx: -8, dy: -10, anchor: "end" },
  backArmholeBisectPt: { dx: 8, dy: 18, anchor: "start" },
  frontArmholeDepthMidPt: { dx: 8, dy: -10, anchor: "start" },
  frontArmholeBisectPt: { dx: -8, dy: 18, anchor: "end" },
  CB_WAIST: { dx: 8, dy: -8, anchor: "start" },
  CF_WAIST: { dx: -8, dy: -8, anchor: "end" },
  SIDE_WAIST: { dx: 8, dy: 16, anchor: "start" },
  MODIFIED_SIDE_WAIST: { dx: -8, dy: -10, anchor: "end" },
  BP: { dx: 8, dy: -10, anchor: "start" },
  HEM_CF_DROP: { dx: -8, dy: 18, anchor: "end" },
  HEM_BP_INTERSECT: { dx: 8, dy: 18, anchor: "start" },
};

const SLEEVE_POINT_LABEL_OFFSETS = {
  CAP_TOP: { dx: 8, dy: -10, anchor: "start" },
  CROSS_CENTER: { dx: 8, dy: 16, anchor: "start" },
  FRONT_WIDTH_PT: { dx: 8, dy: -8, anchor: "start" },
  BACK_WIDTH_PT: { dx: -8, dy: -8, anchor: "end" },
  BACK_MATCH_PT: { dx: -8, dy: 18, anchor: "end" },
  BACK_HEM_CURVE_PT: { dx: -8, dy: 18, anchor: "end" },
  HEM_CENTER_CURVE_PT: { dx: 8, dy: 18, anchor: "start" },
  FRONT_HEM_CURVE_PT: { dx: 8, dy: -10, anchor: "start" },
};

export default function PatternPrototype() {
  const [B, setB] = useState(88);
  const [BL, setBL] = useState(38);
  const [SL, setSL] = useState(58);
  const [ease, setEase] = useState(5);
  const [seam, setSeam] = useState(1);
  const [printSeam, setPrintSeam] = useState(true);
  const [exportFormat, setExportFormat] = useState("pdf-a4");
  const [labelMode, setLabelMode] = useState("points");
  const [showPatternOnly, setShowPatternOnly] = useState(false);
  const [separatePieces, setSeparatePieces] = useState(false);
  const [showPatternRequest, setShowPatternRequest] = useState(false);
  const [patternRequest, setPatternRequest] = useState("");
  const [contact, setContact] = useState("");
  const [requestStatus, setRequestStatus] = useState("idle");
  const [requestError, setRequestError] = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const showPointNames = labelMode === "points";
  const showLineNames = labelMode === "lines";

  useEffect(() => {
    let visitorId = localStorage.getItem("patternVisitorId");
    if (!visitorId) {
      visitorId = crypto.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem("patternVisitorId", visitorId);
    }
    fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, page: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showPatternRequest) return undefined;
    const onKeyDown = event => { if (event.key === "Escape") setShowPatternRequest(false); };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [showPatternRequest]);

  const scale = 7, ox = 92, oy = 60;
  const gx = (x) => ox + x * scale;
  const gy = (y) => oy + y * scale;

  const grid = useMemo(() => computeReferenceLines({ BL, B, ease }), [BL, B, ease]);
  const step2 = useMemo(() => computeStep2Lines({ B, grid }), [B, grid]);

  const gf = grid.formulas;
  const s2 = step2.points;
  const s2c = step2.curves;
  const svgH = gy(BL) + 80;
  const svgW = Math.max(560, gx(gf.width) + 90);

  const sleeve = useMemo(() => {
    const frontAH = step2.formulas.AC;
    const backAH = step2.formulas.BC;
    const AH = frontAH + backAH;
    const capHeight = AH / 3 - 1;
    
    const CAP_TOP = { x: 0, y: 0 };
    const CROSS_CENTER = { x: 0, y: capHeight };
    const HEM_CENTER = { x: 0, y: SL };
    
    const dxFront = Math.sqrt(Math.max(0, frontAH * frontAH - capHeight * capHeight));
    const FRONT_WIDTH_PT = { x: dxFront, y: capHeight };
    
    const backR = backAH + 1;
    const dxBack = Math.sqrt(Math.max(0, backR * backR - capHeight * capHeight));
    const BACK_WIDTH_PT = { x: -dxBack, y: capHeight };
    
    const FRONT_HEM_PT = { x: dxFront, y: SL };
    const BACK_HEM_PT = { x: -dxBack, y: SL };

    // 袖口弧线：后袖口中点下落 1，袖口中心下落 0.3，前袖口中点上抬 0.5。
    const BACK_HEM_MID = { x: (BACK_HEM_PT.x + HEM_CENTER.x) / 2, y: SL };
    const BACK_HEM_CURVE_PT = { x: BACK_HEM_MID.x, y: SL + 1 };
    const HEM_CENTER_CURVE_PT = { x: HEM_CENTER.x, y: SL + 0.3 };
    const FRONT_HEM_MID = { x: (HEM_CENTER.x + FRONT_HEM_PT.x) / 2, y: SL };
    const FRONT_HEM_CURVE_PT = { x: FRONT_HEM_MID.x, y: SL - 0.5 };
    const sleeveHemPoints = [BACK_HEM_PT, BACK_HEM_CURVE_PT, HEM_CENTER_CURVE_PT, FRONT_HEM_CURVE_PT, FRONT_HEM_PT];

    const elbowY = SL / 2 + 2.5;
    const ELBOW_FRONT_PT = { x: dxFront, y: elbowY };
    const ELBOW_BACK_PT = { x: -dxBack, y: elbowY };

    // 前袖山弧线
    const fdX = dxFront;
    const fdY = capHeight;
    const fLen = Math.hypot(fdX, fdY);
    const fUx = fdX / fLen;
    const fUy = fdY / fLen;
    const fNx = fUy; // 法线右上
    const fNy = -fUx;

    const fQ1 = { x: CAP_TOP.x + fdX * 0.25, y: CAP_TOP.y + fdY * 0.25 };
    const fQ2 = { x: CAP_TOP.x + fdX * 0.5, y: CAP_TOP.y + fdY * 0.5 };
    const fQ3 = { x: CAP_TOP.x + fdX * 0.75, y: CAP_TOP.y + fdY * 0.75 };

    const fP1 = { x: fQ1.x + fNx * 1.8, y: fQ1.y + fNy * 1.8 };
    const fP2 = { x: fQ3.x - fNx * 1.5, y: fQ3.y - fNy * 1.5 };

    // 计算平滑曲线的控制点 (近似)
    // 我们可以直接在渲染时用 path 画出，将这五个点存储下来
    const frontCapPoints = [CAP_TOP, fP1, fQ2, fP2, FRONT_WIDTH_PT];

    // 后袖山弧线：斜线 1/4 处左上垂线、斜线中点朝后侧袖宽点移动得到对位点、
    // 对位点至后侧袖宽点中段的右下垂线，依序连成顺弧线。
    const bdX = BACK_WIDTH_PT.x - CAP_TOP.x;
    const bdY = BACK_WIDTH_PT.y - CAP_TOP.y;
    const bLen = Math.hypot(bdX, bdY) || 1;
    const bUx = bdX / bLen;
    const bUy = bdY / bLen;
    const bLeftUpNx = -bUy;
    const bLeftUpNy = bUx;
    const bQ1 = { x: CAP_TOP.x + bdX * 0.25, y: CAP_TOP.y + bdY * 0.25 };
    const bP1 = { x: bQ1.x + bLeftUpNx * 1.5, y: bQ1.y + bLeftUpNy * 1.5 };
    const bSlopeMid = { x: CAP_TOP.x + bdX * 0.5, y: CAP_TOP.y + bdY * 0.5 };
    const BACK_MATCH_PT = {
      x: bSlopeMid.x + bUx * 2.5,
      y: bSlopeMid.y + bUy * 2.5
    };
    const bLowerMid = {
      x: (BACK_MATCH_PT.x + BACK_WIDTH_PT.x) / 2,
      y: (BACK_MATCH_PT.y + BACK_WIDTH_PT.y) / 2
    };
    const bP2 = { x: bLowerMid.x - bLeftUpNx * 0.5, y: bLowerMid.y - bLeftUpNy * 0.5 };
    const backCapPoints = [CAP_TOP, bP1, BACK_MATCH_PT, bP2, BACK_WIDTH_PT];

    return {
      formulas: { AH, capHeight, frontAH, backAH, backR, elbowY },
      points: { CAP_TOP, CROSS_CENTER, FRONT_WIDTH_PT, BACK_WIDTH_PT, HEM_CENTER, FRONT_HEM_PT, BACK_HEM_PT, BACK_HEM_MID, BACK_HEM_CURVE_PT, HEM_CENTER_CURVE_PT, FRONT_HEM_MID, FRONT_HEM_CURVE_PT, ELBOW_FRONT_PT, ELBOW_BACK_PT, fQ1, fQ2, fQ3, fP1, fP2, bQ1, bP1, bSlopeMid, BACK_MATCH_PT, bLowerMid, bP2 },
      frontCapPoints,
      backCapPoints,
      sleeveHemPoints
    };
  }, [step2.formulas.AC, step2.formulas.BC, SL]);

  // 工具：夹持三次样条（C2 连续），再转换为 SVG 三次贝塞尔。
  // 相邻段不仅切线连续，曲率也连续；所有打版构造点仍严格落在弧线上。
  const clampedSplineToBezier = (pts, options) => {
    const segments = clampedSplineSegments(pts, options);
    return [`M ${sgx(pts[0].x)},${sgy(pts[0].y)}`, ...segments.map(seg => `C ${sgx(seg.c1.x)},${sgy(seg.c1.y)} ${sgx(seg.c2.x)},${sgy(seg.c2.y)} ${sgx(seg.p3.x)},${sgy(seg.p3.y)}`)].join(" ");
  };

  const sleeveSvgH = Math.max(200, SL * scale + 100);
  const sox = svgW / 2;
  const soy = 40;
  const sgx = (x) => sox + x * scale;
  const sgy = (y) => soy + y * scale;

  const bodyOutline = (() => {
    const points = [{ ...s2.CB_TOP }];
    sampleCubic(points, s2.CB_TOP, s2c.backNeckC1, s2c.backNeckC2, s2.BACK_NECK_PT);
    points.push(s2.BACK_SHOULDER_PT);
    sampleQuad(points, s2.BACK_SHOULDER_PT, s2c.backArmholeC1, s2.backArmholeBisectPt);
    sampleQuad(points, s2.backArmholeBisectPt, s2c.backArmholeC2, s2.SIDE_BUST);
    sampleQuad(points, s2.SIDE_BUST, s2c.frontArmholeC2, s2.frontArmholeBisectPt);
    sampleQuad(points, s2.frontArmholeBisectPt, s2c.frontArmholeC1, s2.FRONT_SHOULDER_PT);
    points.push(s2.FRONT_NECK_W_PT);
    sampleQuad(points, s2.FRONT_NECK_W_PT, s2c.frontNeckCtrl, s2.FRONT_NECK_D_PT);
    points.push(s2.HEM_CF_DROP, s2.HEM_BP_INTERSECT, s2.MODIFIED_SIDE_WAIST, { x: 0, y: BL });
    return points;
  })();

  const separatedFrontShift = 8;
  const backPieceOutline = (() => {
    const points = [{ ...s2.CB_TOP }];
    sampleCubic(points, s2.CB_TOP, s2c.backNeckC1, s2c.backNeckC2, s2.BACK_NECK_PT);
    points.push(s2.BACK_SHOULDER_PT);
    sampleQuad(points, s2.BACK_SHOULDER_PT, s2c.backArmholeC1, s2.backArmholeBisectPt);
    sampleQuad(points, s2.backArmholeBisectPt, s2c.backArmholeC2, s2.SIDE_BUST);
    points.push(s2.MODIFIED_SIDE_WAIST, { x: 0, y: BL });
    return points;
  })();

  const frontPieceOutline = (() => {
    const points = [{ ...s2.SIDE_BUST }];
    sampleQuad(points, s2.SIDE_BUST, s2c.frontArmholeC2, s2.frontArmholeBisectPt);
    sampleQuad(points, s2.frontArmholeBisectPt, s2c.frontArmholeC1, s2.FRONT_SHOULDER_PT);
    points.push(s2.FRONT_NECK_W_PT);
    sampleQuad(points, s2.FRONT_NECK_W_PT, s2c.frontNeckCtrl, s2.FRONT_NECK_D_PT);
    points.push(s2.HEM_CF_DROP, s2.HEM_BP_INTERSECT, s2.MODIFIED_SIDE_WAIST);
    return points;
  })();

  const sleeveOutline = (() => {
    const points = [{ ...sleeve.points.CAP_TOP }];
    for (const seg of clampedSplineSegments(sleeve.frontCapPoints)) sampleCubic(points, seg.p0, seg.c1, seg.c2, seg.p3, 10);
    points.push(sleeve.points.FRONT_HEM_PT);

    const hemForward = [{ ...sleeve.sleeveHemPoints[0] }];
    for (const seg of clampedSplineSegments(sleeve.sleeveHemPoints, { startSpeed: 0.7, endSpeed: 0.7 })) sampleCubic(hemForward, seg.p0, seg.c1, seg.c2, seg.p3, 8);
    points.push(...hemForward.reverse());
    points.push(sleeve.points.BACK_WIDTH_PT);

    const backForward = [{ ...sleeve.backCapPoints[0] }];
    for (const seg of clampedSplineSegments(sleeve.backCapPoints)) sampleCubic(backForward, seg.p0, seg.c1, seg.c2, seg.p3, 10);
    points.push(...backForward.reverse());
    return points;
  })();

  const bodySeam = printSeam ? offsetClosedPolygon(bodyOutline, seam) : [];
  const backPieceSeam = printSeam ? offsetClosedPolygon(backPieceOutline, seam) : [];
  const frontPieceSeam = printSeam ? offsetClosedPolygon(frontPieceOutline, seam) : [];
  const sleeveSeam = printSeam ? offsetClosedPolygon(sleeveOutline, seam) : [];
  const bodySeamPath = bodySeam.length ? bodySeam.map((p, i) => `${i ? "L" : "M"} ${gx(p.x)},${gy(p.y)}`).join(" ") + " Z" : "";
  const backPieceSeamPath = backPieceSeam.length ? backPieceSeam.map((p, i) => `${i ? "L" : "M"} ${gx(p.x)},${gy(p.y)}`).join(" ") + " Z" : "";
  const frontPieceSeamPath = frontPieceSeam.length ? frontPieceSeam.map((p, i) => `${i ? "L" : "M"} ${gx(p.x + separatedFrontShift)},${gy(p.y)}`).join(" ") + " Z" : "";
  const sleeveSeamPath = sleeveSeam.length ? sleeveSeam.map((p, i) => `${i ? "L" : "M"} ${sgx(p.x)},${sgy(p.y)}`).join(" ") + " Z" : "";
  const sleevePatternPath = sleeveOutline.map((p, i) => `${i ? "L" : "M"} ${sgx(p.x)},${sgy(p.y)}`).join(" ") + " Z";

  const bodyPointItems = Object.entries({ ...REF_POINT_LABELS, ...STEP2_POINT_LABELS }).flatMap(([key, label]) => {
    const raw = grid.keyPoints[key] || step2.points[key];
    return raw ? [{ key, label, point: { x: gx(raw.x), y: gy(raw.y) }, preferred: POINT_LABEL_OFFSETS[key] }] : [];
  });
  const bodyPointLayout = layoutNonOverlappingLabels(bodyPointItems, svgW, svgH);

  const sleevePointDefinitions = [
    ["CAP_TOP", "袖山高点"], ["FRONT_WIDTH_PT", "前侧袖宽点"], ["BACK_WIDTH_PT", "后侧袖宽点"],
  ];
  const sleevePointItems = sleevePointDefinitions.map(([key, label]) => ({ key, label, point: { x: sgx(sleeve.points[key].x), y: sgy(sleeve.points[key].y) }, preferred: SLEEVE_POINT_LABEL_OFFSETS[key] }));
  const sleevePointLayout = layoutNonOverlappingLabels(sleevePointItems, svgW, sleeveSvgH);

  const bodyLineItems = [
    { key: "cb", label: "后中线 / 背长线", point: { x: gx(0), y: gy(BL * 0.55) }, preferred: { dx: 10, dy: -10, anchor: "start" } },
    { key: "cf", label: "前中线", point: { x: gx(gf.width), y: gy(BL * 0.45) }, preferred: { dx: -10, dy: -10, anchor: "end" } },
    { key: "back_neck", label: "后领窝弧线", point: { x: gx(s2.BACK_NECK_PT.x * 0.55), y: gy(-step2.formulas.backNeckH * 0.2) }, preferred: { dx: 0, dy: -12, anchor: "middle" } },
    { key: "back_shoulder", label: "后肩斜线", point: { x: gx((s2.BACK_NECK_PT.x + s2.BACK_SHOULDER_PT.x) / 2), y: gy((s2.BACK_NECK_PT.y + s2.BACK_SHOULDER_PT.y) / 2) }, preferred: { dx: 0, dy: -12, anchor: "middle" } },
    { key: "front_neck", label: "前领窝弧线", point: { x: gx((s2.FRONT_NECK_W_PT.x + s2.FRONT_NECK_D_PT.x) / 2), y: gy((s2.FRONT_NECK_W_PT.y + s2.FRONT_NECK_D_PT.y) / 2) }, preferred: { dx: -12, dy: 0, anchor: "end" } },
    { key: "front_shoulder", label: "前肩斜线", point: { x: gx((s2.FRONT_NECK_W_PT.x + s2.FRONT_SHOULDER_PT.x) / 2), y: gy((s2.FRONT_NECK_W_PT.y + s2.FRONT_SHOULDER_PT.y) / 2) }, preferred: { dx: 0, dy: -12, anchor: "middle" } },
    { key: "back_armhole", label: "后袖窿弧线", point: { x: gx(s2.backArmholeBisectPt.x), y: gy(s2.backArmholeBisectPt.y) }, preferred: { dx: -12, dy: 0, anchor: "end" } },
    { key: "front_armhole", label: "前袖窿弧线", point: { x: gx(s2.frontArmholeBisectPt.x), y: gy(s2.frontArmholeBisectPt.y) }, preferred: { dx: 12, dy: 0, anchor: "start" } },
    { key: "front_neck_box", label: "前领窝宽深辅助框", point: { x: gx(s2.FRONT_NECK_W_PT.x), y: gy((s2.CF_TOP.y + s2.FRONT_NECK_D_PT.y) / 2) } },
    { key: "front_shoulder_guide", label: "前肩水平参考线", point: { x: gx(gf.width - gf.chestWidthX), y: gy(s2.FRONT_SHOULDER_PT.y) } },
    { key: "modified_side", label: "腋下侧缝修正线", point: { x: gx((s2.SIDE_BUST.x + s2.MODIFIED_SIDE_WAIST.x) / 2), y: gy((s2.SIDE_BUST.y + s2.MODIFIED_SIDE_WAIST.y) / 2) } },
    { key: "front_drop", label: "前中底摆下落线", point: { x: gx(gf.width), y: gy((BL + s2.HEM_CF_DROP.y) / 2) }, preferred: { dx: -8, dy: 0, anchor: "end" } },
    { key: "hem", label: "底摆线", point: { x: gx((s2.HEM_BP_INTERSECT.x + s2.MODIFIED_SIDE_WAIST.x) / 2), y: gy((s2.HEM_BP_INTERSECT.y + s2.MODIFIED_SIDE_WAIST.y) / 2) }, preferred: { dx: 0, dy: 18, anchor: "middle" } },
    ...(printSeam && bodySeam.length ? [{ key: "body_seam_allowance", label: `缝份线 ${seam.toFixed(1)} cm`, point: { x: gx(bodySeam[Math.floor(bodySeam.length * 0.7)].x), y: gy(bodySeam[Math.floor(bodySeam.length * 0.7)].y) } }] : []),
  ];
  const bodyLineLayout = layoutNonOverlappingLabels(bodyLineItems, svgW, svgH);

  const sleeveLineItems = [
    { key: "sleeve_length", label: "袖长线 SL", point: { x: sgx(0), y: sgy(SL * 0.55) }, preferred: { dx: 8, dy: 0, anchor: "start" } },
    { key: "biceps", label: "袖肥线", point: { x: sgx(0), y: sgy(sleeve.points.CROSS_CENTER.y) }, preferred: { dx: 8, dy: -8, anchor: "start" } },
    { key: "hem_base", label: "袖口宽基准线", point: { x: sgx(0), y: sgy(SL) }, preferred: { dx: 8, dy: -8, anchor: "start" } },
    { key: "front_cap_diag", label: "前袖山斜线", point: { x: sgx(sleeve.points.FRONT_WIDTH_PT.x / 2), y: sgy(sleeve.points.FRONT_WIDTH_PT.y / 2) } },
    { key: "back_cap_diag", label: "后袖山斜线", point: { x: sgx(sleeve.points.BACK_WIDTH_PT.x / 2), y: sgy(sleeve.points.BACK_WIDTH_PT.y / 2) } },
    { key: "front_cap", label: "前袖山弧线", point: { x: sgx(sleeve.points.fQ2.x), y: sgy(sleeve.points.fQ2.y) }, preferred: { dx: 12, dy: -12, anchor: "start" } },
    { key: "back_cap", label: "后袖山弧线", point: { x: sgx(sleeve.points.BACK_MATCH_PT.x), y: sgy(sleeve.points.BACK_MATCH_PT.y) }, preferred: { dx: -12, dy: -12, anchor: "end" } },
    { key: "front_seam", label: "前袖底缝线", point: { x: sgx(sleeve.points.FRONT_WIDTH_PT.x), y: sgy((sleeve.points.FRONT_WIDTH_PT.y + SL) / 2) }, preferred: { dx: -8, dy: 0, anchor: "end" } },
    { key: "back_seam", label: "后袖底缝线", point: { x: sgx(sleeve.points.BACK_WIDTH_PT.x), y: sgy((sleeve.points.BACK_WIDTH_PT.y + SL) / 2) }, preferred: { dx: 8, dy: 0, anchor: "start" } },
    { key: "elbow", label: "袖肘线 EL（袖衬线）", point: { x: sgx(0), y: sgy(sleeve.formulas.elbowY) }, preferred: { dx: 8, dy: -8, anchor: "start" } },
    { key: "hem_curve", label: "袖口弧线", point: { x: sgx(0), y: sgy(sleeve.points.HEM_CENTER_CURVE_PT.y) }, preferred: { dx: 8, dy: 18, anchor: "start" } },
    ...(printSeam && sleeveSeam.length ? [{ key: "sleeve_seam_allowance", label: `缝份线 ${seam.toFixed(1)} cm`, point: { x: sgx(sleeveSeam[Math.floor(sleeveSeam.length * 0.25)].x), y: sgy(sleeveSeam[Math.floor(sleeveSeam.length * 0.25)].y) } }] : []),
  ];
  const sleeveLineLayout = layoutNonOverlappingLabels(sleeveLineItems, svgW, sleeveSvgH);

  const patternPath = useMemo(() => {
    return [
      `M ${gx(0)},${gy(0)}`,
      `C ${gx(s2c.backNeckC1.x)},${gy(s2c.backNeckC1.y)} ${gx(s2c.backNeckC2.x)},${gy(s2c.backNeckC2.y)} ${gx(s2.BACK_NECK_PT.x)},${gy(s2.BACK_NECK_PT.y)}`,
      `L ${gx(s2.BACK_SHOULDER_PT.x)},${gy(s2.BACK_SHOULDER_PT.y)}`,
      `Q ${gx(s2c.backArmholeC1.x)},${gy(s2c.backArmholeC1.y)} ${gx(s2.backArmholeBisectPt.x)},${gy(s2.backArmholeBisectPt.y)} Q ${gx(s2c.backArmholeC2.x)},${gy(s2c.backArmholeC2.y)} ${gx(s2.SIDE_BUST.x)},${gy(s2.SIDE_BUST.y)}`,
      `Q ${gx(s2c.frontArmholeC2.x)},${gy(s2c.frontArmholeC2.y)} ${gx(s2.frontArmholeBisectPt.x)},${gy(s2.frontArmholeBisectPt.y)} Q ${gx(s2c.frontArmholeC1.x)},${gy(s2c.frontArmholeC1.y)} ${gx(s2.FRONT_SHOULDER_PT.x)},${gy(s2.FRONT_SHOULDER_PT.y)}`,
      `L ${gx(s2.FRONT_NECK_W_PT.x)},${gy(s2.FRONT_NECK_W_PT.y)}`,
      `Q ${gx(s2c.frontNeckCtrl.x)},${gy(s2c.frontNeckCtrl.y)} ${gx(s2.FRONT_NECK_D_PT.x)},${gy(s2.FRONT_NECK_D_PT.y)}`,
      `L ${gx(gf.width)},${gy(s2.HEM_CF_DROP.y)}`,
      `L ${gx(s2.HEM_BP_INTERSECT.x)},${gy(s2.HEM_BP_INTERSECT.y)}`,
      `L ${gx(s2.MODIFIED_SIDE_WAIST.x)},${gy(s2.MODIFIED_SIDE_WAIST.y)}`,
      `L ${gx(0)},${gy(BL)}`,
      `Z`
    ].join(" ");
  }, [gx, gy, s2, s2c, gf, BL]);

  const backPiecePath = [
    `M ${gx(s2.CB_TOP.x)},${gy(s2.CB_TOP.y)}`,
    `C ${gx(s2c.backNeckC1.x)},${gy(s2c.backNeckC1.y)} ${gx(s2c.backNeckC2.x)},${gy(s2c.backNeckC2.y)} ${gx(s2.BACK_NECK_PT.x)},${gy(s2.BACK_NECK_PT.y)}`,
    `L ${gx(s2.BACK_SHOULDER_PT.x)},${gy(s2.BACK_SHOULDER_PT.y)}`,
    `Q ${gx(s2c.backArmholeC1.x)},${gy(s2c.backArmholeC1.y)} ${gx(s2.backArmholeBisectPt.x)},${gy(s2.backArmholeBisectPt.y)}`,
    `Q ${gx(s2c.backArmholeC2.x)},${gy(s2c.backArmholeC2.y)} ${gx(s2.SIDE_BUST.x)},${gy(s2.SIDE_BUST.y)}`,
    `L ${gx(s2.MODIFIED_SIDE_WAIST.x)},${gy(s2.MODIFIED_SIDE_WAIST.y)}`,
    `L ${gx(0)},${gy(BL)} Z`,
  ].join(" ");

  const fgx = x => gx(x + separatedFrontShift);
  const frontPiecePath = [
    `M ${fgx(s2.SIDE_BUST.x)},${gy(s2.SIDE_BUST.y)}`,
    `Q ${fgx(s2c.frontArmholeC2.x)},${gy(s2c.frontArmholeC2.y)} ${fgx(s2.frontArmholeBisectPt.x)},${gy(s2.frontArmholeBisectPt.y)}`,
    `Q ${fgx(s2c.frontArmholeC1.x)},${gy(s2c.frontArmholeC1.y)} ${fgx(s2.FRONT_SHOULDER_PT.x)},${gy(s2.FRONT_SHOULDER_PT.y)}`,
    `L ${fgx(s2.FRONT_NECK_W_PT.x)},${gy(s2.FRONT_NECK_W_PT.y)}`,
    `Q ${fgx(s2c.frontNeckCtrl.x)},${gy(s2c.frontNeckCtrl.y)} ${fgx(s2.FRONT_NECK_D_PT.x)},${gy(s2.FRONT_NECK_D_PT.y)}`,
    `L ${fgx(s2.HEM_CF_DROP.x)},${gy(s2.HEM_CF_DROP.y)}`,
    `L ${fgx(s2.HEM_BP_INTERSECT.x)},${gy(s2.HEM_BP_INTERSECT.y)}`,
    `L ${fgx(s2.MODIFIED_SIDE_WAIST.x)},${gy(s2.MODIFIED_SIDE_WAIST.y)} Z`,
  ].join(" ");

  const recordDownload = () => {
    const visitorId = localStorage.getItem("patternVisitorId") || "unknown";
    fetch("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId,
        pattern: "世界经典服装设计与纸样·女装上衣原型",
        format: exportFormat.startsWith("pdf-") ? "pdf" : exportFormat,
      }),
      keepalive: true,
    }).catch(() => {});
  };

  const submitPatternRequest = async event => {
    event.preventDefault();
    const message = patternRequest.trim();
    if (message.length < 4) {
      setRequestError("请再多写一点，告诉我你希望更新的具体版型。");
      return;
    }
    setRequestStatus("sending");
    setRequestError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: localStorage.getItem("patternVisitorId") || "unknown",
          message,
          contact: contact.trim(),
          currentPattern: "世界经典服装设计与纸样·女装上衣原型",
        }),
      });
      if (!response.ok) throw new Error("提交失败");
      setRequestStatus("success");
      setPatternRequest("");
      setContact("");
    } catch {
      setRequestStatus("error");
      setRequestError("暂时没能提交，请稍后再试，或通过微信直接告诉我。");
    }
  };

  const exportActualSizePdf = async () => {
    const { createPatternPdf, downloadPdfBlob } = await import("./src/pdf-export.mjs");
    const isA4Pdf = exportFormat === "pdf-a4";
    const bodyPieces = isA4Pdf || separatePieces
      ? [
          { label: "后片", outline: backPieceOutline, seam: printSeam ? backPieceSeam : [] },
          { label: "前片", outline: frontPieceOutline, seam: printSeam ? frontPieceSeam : [] },
        ]
      : [{
          label: "衣身",
          outline: bodyOutline,
          seam: printSeam ? bodySeam : [],
          lines: [[s2.SIDE_BUST, s2.MODIFIED_SIDE_WAIST]],
        }];
    const result = await createPatternPdf({
      mode: exportFormat === "pdf-single" ? "single" : "a4",
      pieces: [
        ...bodyPieces,
        { label: "袖片", outline: sleeveOutline, seam: printSeam ? sleeveSeam : [] },
      ],
    });
    downloadPdfBlob(result.blob, `pattern-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExport = async () => {
    if (isExportingPdf) return;
    recordDownload();
    if (exportFormat.startsWith("pdf-")) {
      setIsExportingPdf(true);
      try {
        await exportActualSizePdf();
      } catch (error) {
        console.error("PDF export failed:", error);
        window.alert("PDF 生成失败，请刷新页面后重试。");
      } finally {
        setIsExportingPdf(false);
      }
      return;
    }

    const sleeveMinX = Math.min(...sleeveOutline.map(p => p.x));
    const bodyExportWidth = gf.width + (separatePieces ? separatedFrontShift : 0);
    const sleeveOffsetX = bodyExportWidth + 10 - sleeveMinX;
    const bodyGroups = separatePieces ? [
      { name: "BACK_PIECE_OUTLINE", points: backPieceOutline, closed: true },
      { name: "FRONT_PIECE_OUTLINE", points: frontPieceOutline.map(p => ({ x: p.x + separatedFrontShift, y: p.y })), closed: true },
      ...(printSeam ? [
        { name: "BACK_PIECE_SEAM_ALLOWANCE", points: backPieceSeam, closed: true },
        { name: "FRONT_PIECE_SEAM_ALLOWANCE", points: frontPieceSeam.map(p => ({ x: p.x + separatedFrontShift, y: p.y })), closed: true },
      ] : []),
    ] : [
      { name: "BODY_OUTLINE", points: bodyOutline, closed: true },
      { name: "UNDERARM_SIDE_SEAM_CORRECTION", points: [s2.SIDE_BUST, s2.MODIFIED_SIDE_WAIST], closed: false },
      ...(printSeam ? [{ name: "BODY_SEAM_ALLOWANCE", points: bodySeam, closed: true }] : []),
    ];
    const groups = [
      ...bodyGroups,
      { name: "SLEEVE_OUTLINE", points: sleeveOutline.map(p => ({ x: p.x + sleeveOffsetX, y: p.y })), closed: true },
      ...(printSeam ? [
        { name: "SLEEVE_SEAM_ALLOWANCE", points: sleeveSeam.map(p => ({ x: p.x + sleeveOffsetX, y: p.y })), closed: true },
      ] : []),
    ];
    const piecePoints = groups.flatMap(group => group.points);
    const pieceMinX = Math.min(...piecePoints.map(p => p.x));
    const pieceMaxY = Math.max(...piecePoints.map(p => p.y));
    groups.push({
      name: "REFERENCE_10CM_SQUARE",
      closed: true,
      points: [
        { x: pieceMinX, y: pieceMaxY + 4 },
        { x: pieceMinX + 10, y: pieceMaxY + 4 },
        { x: pieceMinX + 10, y: pieceMaxY + 14 },
        { x: pieceMinX, y: pieceMaxY + 14 },
      ],
    });
    const all = groups.flatMap(group => group.points);
    const minX = Math.min(...all.map(p => p.x));
    const minY = Math.min(...all.map(p => p.y));
    const maxX = Math.max(...all.map(p => p.x));
    const maxY = Math.max(...all.map(p => p.y));
    const margin = 2;
    const normalize = p => ({ x: p.x - minX + margin, y: p.y - minY + margin });
    const fileBase = `pattern-${new Date().toISOString().slice(0, 10)}`;
    let content = "";
    let mime = "text/plain;charset=utf-8";
    let extension = exportFormat;

    if (exportFormat === "svg") {
      const width = maxX - minX + margin * 2;
      const height = maxY - minY + margin * 2;
      const polylines = groups.map(group => {
        const points = group.points.map(p => { const q = normalize(p); return `${q.x.toFixed(3)},${q.y.toFixed(3)}`; }).join(" ");
        const isSeam = group.name.includes("SEAM");
        const isReference = group.name.includes("REFERENCE");
        const tag = group.closed ? "polygon" : "polyline";
        return `<${tag} id="${group.name}" points="${points}" fill="none" stroke="${isSeam ? "#b8823a" : isReference ? "#3d6f96" : "#20293f"}" stroke-width="0.12" ${isSeam ? 'stroke-dasharray="0.6 0.3"' : ""} />`;
      }).join("\n  ");
      const reference = normalize({ x: pieceMinX + 5, y: pieceMaxY + 4 });
      content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}cm" height="${height.toFixed(2)}cm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}">\n  ${polylines}\n  <text x="${reference.x.toFixed(3)}" y="${(reference.y - 0.4).toFixed(3)}" text-anchor="middle" font-size="0.45" fill="#20293f">10 cm calibration square</text>\n</svg>`;
      mime = "image/svg+xml;charset=utf-8";
    } else if (exportFormat === "dxf") {
      const entities = groups.map(group => {
        const vertices = group.points.map(p => {
          const x = (p.x - minX + margin) * 10;
          const y = (maxY - p.y + margin) * 10;
          return `10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}`;
        }).join("\n");
        return `0\nLWPOLYLINE\n8\n${group.name}\n90\n${group.points.length}\n70\n${group.closed ? 1 : 0}\n${vertices}`;
      }).join("\n");
      content = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF`;
      mime = "application/dxf;charset=utf-8";
    } else if (exportFormat === "plt") {
      const paths = groups.map(group => {
        const coords = group.points.map(p => {
          const x = Math.round((p.x - minX + margin) * 400);
          const y = Math.round((maxY - p.y + margin) * 400);
          return `${x},${y}`;
        });
        const drawCoords = group.closed ? [...coords.slice(1), coords[0]] : coords.slice(1);
        return `PU${coords[0]};PD${drawCoords.join(",")};PU;`;
      }).join("");
      content = `IN;SP1;${paths}SP0;`;
      mime = "application/vnd.hp-hpgl;charset=utf-8";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileBase}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pp-root">
      <style>{`
        .pp-root {
          --paper:#eae5d6; --grid:#d7cfb8; --ink:#20293f; --construction:#3d6f96;
          --dart:#a8423f; --seam:#b8823a; --gS:#4f7ea8; --gL:#a85f8a; --text:#2b2a24; --muted:#7a7568;
          font-family:'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif; color:var(--text); background:var(--paper);
          min-height:100vh; padding:28px; box-sizing:border-box;
        }
        .pp-root * { box-sizing:border-box; }
        .pp-head { margin-bottom:20px; }
        .pp-eyebrow { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.12em; color:var(--construction); text-transform:uppercase; }
        .pp-title { font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:32px; letter-spacing:.01em; margin:2px 0 4px; }
        .pp-sub { font-size:13.5px; color:var(--muted); max-width:720px; line-height:1.65; }
        .pp-version-bar { display:flex; align-items:center; gap:10px; margin-top:14px; padding:9px 10px 9px 12px; width:max-content; max-width:100%; background:#f4f0e4; border:1px solid var(--grid); border-radius:6px; }
        .pp-version-label { font:500 10px 'JetBrains Mono',monospace; letter-spacing:.08em; color:var(--muted); text-transform:uppercase; white-space:nowrap; }
        .pp-version-name { font-size:12.5px; font-weight:600; color:var(--ink); }
        .pp-more-btn { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--construction); border-radius:4px; background:transparent; color:var(--construction); padding:6px 9px; font:600 12px 'Inter',sans-serif; cursor:pointer; white-space:nowrap; }
        .pp-more-btn:hover { color:#fffdf6; background:var(--construction); }

        .pp-modal-backdrop { position:fixed; inset:0; z-index:50; display:grid; place-items:center; padding:20px; background:rgba(24,29,38,.54); backdrop-filter:blur(3px); }
        .pp-modal { width:min(720px, 100%); max-height:calc(100vh - 40px); overflow:auto; background:#f4f0e4; border:1px solid var(--grid); border-radius:10px; box-shadow:0 24px 80px rgba(20,25,34,.28); }
        .pp-modal-head { display:flex; justify-content:space-between; gap:20px; padding:22px 24px 16px; border-bottom:1px solid var(--grid); }
        .pp-modal-kicker { font:500 10px 'JetBrains Mono',monospace; color:var(--construction); letter-spacing:.12em; text-transform:uppercase; }
        .pp-modal h2 { margin:3px 0 5px; font:700 25px 'Barlow Condensed',sans-serif; color:var(--ink); }
        .pp-modal-intro { margin:0; font-size:12.5px; line-height:1.55; color:var(--muted); }
        .pp-icon-btn { flex:0 0 auto; width:32px; height:32px; display:grid; place-items:center; border:1px solid var(--grid); border-radius:50%; color:var(--ink); background:transparent; cursor:pointer; }
        .pp-icon-btn:hover { background:#e7e1d1; }
        .pp-modal-body { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(220px,.75fr); gap:0; }
        .pp-request-form { padding:22px 24px 24px; border-right:1px solid var(--grid); }
        .pp-field { display:block; margin-bottom:14px; font-size:12px; font-weight:600; color:var(--ink); }
        .pp-field small { float:right; font-weight:400; color:var(--muted); }
        .pp-field textarea, .pp-field input { display:block; width:100%; margin-top:7px; border:1px solid var(--grid); border-radius:5px; background:#fffdf6; color:var(--text); padding:10px 11px; font:12.5px/1.5 'Inter',sans-serif; resize:vertical; }
        .pp-field textarea:focus, .pp-field input:focus { outline:2px solid rgba(61,111,150,.2); border-color:var(--construction); }
        .pp-submit { display:inline-flex; align-items:center; justify-content:center; gap:7px; width:100%; border:0; border-radius:5px; background:var(--ink); color:#fffdf6; padding:10px 12px; font:600 12.5px 'Inter',sans-serif; cursor:pointer; }
        .pp-submit:disabled { opacity:.55; cursor:wait; }
        .pp-form-error { margin:8px 0 0; font-size:11.5px; line-height:1.45; color:var(--dart); }
        .pp-success { min-height:235px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:var(--construction); }
        .pp-success h3 { margin:10px 0 5px; font-size:16px; color:var(--ink); }
        .pp-success p { margin:0; max-width:250px; font-size:12px; line-height:1.5; color:var(--muted); }
        .pp-socials { padding:22px; }
        .pp-socials-title { margin:0 0 12px; font-size:12px; font-weight:600; color:var(--ink); }
        .pp-qr-list { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .pp-qr-card { text-align:center; }
        .pp-qr-placeholder { aspect-ratio:1; display:grid; place-items:center; background:#fffdf6; border:1px dashed #aaa28e; border-radius:5px; color:var(--muted); }
        .pp-qr-card b { display:block; margin-top:7px; font-size:11.5px; color:var(--ink); }
        .pp-qr-card span { display:block; margin-top:2px; font-size:10.5px; line-height:1.35; color:var(--muted); }

        .pp-layout { display:grid; grid-template-columns:minmax(0, 1fr) 280px; gap:20px; align-items:start; }
        .pp-workspace { grid-column:1; grid-row:1; min-width:0; }
        .pp-sidebar { grid-column:2; grid-row:1; }
        @media (max-width:860px) { .pp-layout { grid-template-columns:1fr; } }
        @media (max-width:860px) { .pp-workspace, .pp-sidebar { grid-column:1; } .pp-workspace { grid-row:1; } .pp-sidebar { grid-row:2; } }
        @media (max-width:620px) { .pp-version-bar { align-items:flex-start; flex-wrap:wrap; } .pp-version-name { width:calc(100% - 72px); } .pp-more-btn { margin-left:72px; } .pp-modal-body { grid-template-columns:1fr; } .pp-request-form { border-right:0; border-bottom:1px solid var(--grid); } }

        .pp-card { background:#f4f0e4; border:1px solid var(--grid); border-radius:6px; padding:16px 16px 18px; margin-bottom:16px; }
        .pp-card h3 { font-family:'Barlow Condensed',sans-serif; font-size:15px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; margin:0 0 12px; display:flex; align-items:center; gap:6px; color:var(--ink); }
        .pp-row { margin-bottom:14px; }
        .pp-row:last-child { margin-bottom:0; }
        .pp-row label { display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:5px; }
        .pp-row label span:last-child { font-family:'JetBrains Mono',monospace; color:var(--construction); font-weight:500; }
        .pp-row input[type=range] { width:100%; accent-color:var(--construction); }
        .pp-number-wrap { display:inline-flex; align-items:center; justify-content:flex-end; gap:3px; }
        .pp-number-input { width:64px; height:24px; border:1px solid transparent; border-radius:3px; background:transparent; color:var(--construction); padding:1px 4px; text-align:right; font:500 12px 'JetBrains Mono',monospace; }
        .pp-number-input:hover { border-color:var(--grid); background:#fffdf6; }
        .pp-number-input:focus { outline:none; border-color:var(--construction); background:#fffdf6; }
        .pp-toggle { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 0; cursor:pointer; }
        .pp-toggle input { accent-color:var(--construction); }
        .pp-export-options { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
        .pp-select { width:100%; height:34px; border:1px solid var(--grid); border-radius:4px; background:#fffdf6; color:var(--ink); padding:0 9px; font:12.5px 'Inter',sans-serif; }
        .pp-export-btn { width:100%; border:0; border-radius:4px; background:var(--ink); color:#fffdf6; padding:10px 12px; font:600 12.5px 'Inter',sans-serif; cursor:pointer; }
        .pp-export-btn:hover { background:#31405e; }

        .pp-formulas { font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.9; color:#4a4638; }
        .pp-formulas div { display:flex; justify-content:space-between; gap:8px; }
        .pp-formulas b { color:var(--ink); font-weight:500; }

        .pp-canvas-wrap { background:#f4f0e4; border:1px solid var(--grid); border-radius:6px; padding:14px; }
        .pp-legend { display:flex; flex-wrap:wrap; gap:14px; font-size:11.5px; margin-top:10px; padding-top:10px; border-top:1px solid var(--grid); }
        .pp-legend span { display:inline-flex; align-items:center; gap:6px; }
        .pp-swatch { width:16px; height:2px; display:inline-block; }
        .pp-point-swatch { width:6px; height:6px; border-radius:50%; display:inline-block; background:var(--ink); }

        .pp-table { width:100%; border-collapse:collapse; font-family:'JetBrains Mono',monospace; font-size:11.5px; margin-top:14px; }
        .pp-table th { text-align:left; font-family:'Barlow Condensed',sans-serif; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border-bottom:1px solid var(--grid); padding:4px 8px 6px; }
        .pp-table td { padding:4px 8px; border-bottom:1px solid #e4ddc8; }

      `}</style>

      <div className="pp-head">
        <div className="pp-eyebrow">Pattern-Making</div>
        <div className="pp-title">参数化打版原型 — 参考线构图</div>
        <div className="pp-sub">让经典纸样从书页走进真实尺寸：调整身体数据，即时看见每一条结构线如何生成，在理解制版逻辑的同时，得到一份可以继续创作、打印与裁剪的基础纸样。</div>
        <div className="pp-version-bar" aria-label="版型选择">
          <span className="pp-version-label">当前版型</span>
          <span className="pp-version-name">世界经典服装设计与纸样·女装上衣原型</span>
          <button type="button" className="pp-more-btn" onClick={() => { setShowPatternRequest(true); setRequestStatus("idle"); setRequestError(""); }} aria-haspopup="dialog">
            更多版型 <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {showPatternRequest && (
        <div className="pp-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowPatternRequest(false); }}>
          <div className="pp-modal" role="dialog" aria-modal="true" aria-labelledby="pattern-request-title">
            <div className="pp-modal-head">
              <div>
                <div className="pp-modal-kicker">Pattern Wishlist</div>
                <h2 id="pattern-request-title">你希望下一个版型是什么？</h2>
                <p className="pp-modal-intro">目前只开放女装上衣原型。你的建议会帮助我决定下一次更新。</p>
              </div>
              <button type="button" className="pp-icon-btn" onClick={() => setShowPatternRequest(false)} aria-label="关闭弹窗"><X size={17} /></button>
            </div>
            <div className="pp-modal-body">
              <form className="pp-request-form" onSubmit={submitPatternRequest}>
                {requestStatus === "success" ? (
                  <div className="pp-success">
                    <CheckCircle2 size={34} />
                    <h3>建议已经收到</h3>
                    <p>谢谢你一起完善这套工具。每一条具体的建议，都会成为后续更新的重要参考。</p>
                  </div>
                ) : (
                  <>
                    <label className="pp-field">
                      想要更新的版型
                      <small>{patternRequest.length}/500</small>
                      <textarea rows="6" maxLength="500" value={patternRequest} onChange={event => setPatternRequest(event.target.value)} placeholder="例如：希望增加文化式女装原型、男装衬衫原型，或某本书中的具体版型……" required />
                    </label>
                    <label className="pp-field">
                      联系方式 <small>选填</small>
                      <input type="text" maxLength="100" value={contact} onChange={event => setContact(event.target.value)} placeholder="微信 / 邮箱，方便进一步沟通" />
                    </label>
                    <button className="pp-submit" type="submit" disabled={requestStatus === "sending"}>
                      {requestStatus === "sending" ? "正在提交…" : <><Send size={14} /> 提交版型建议</>}
                    </button>
                    {requestError && <p className="pp-form-error">{requestError}</p>}
                  </>
                )}
              </form>
              <aside className="pp-socials">
                <p className="pp-socials-title"><MessageSquare size={13} style={{ verticalAlign: -2, marginRight: 5 }} />也可以直接找到我</p>
                <div className="pp-qr-list">
                  <div className="pp-qr-card">
                    <div className="pp-qr-placeholder" aria-label="微信二维码预留区域"><QrCode size={38} strokeWidth={1.2} /></div>
                    <b>微信</b><span>扫码聊天<br />告诉我你的想法</span>
                  </div>
                  <div className="pp-qr-card">
                    <div className="pp-qr-placeholder" aria-label="小红书二维码预留区域"><QrCode size={38} strokeWidth={1.2} /></div>
                    <b>小红书</b><span>扫码关注<br />查看更新动态</span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      <div className="pp-layout">
        <div className="pp-sidebar">
          <div className="pp-card">
            <h3><Download size={14} />导出</h3>
            <div className="pp-row">
              <label><span>导出文件格式</span></label>
              <select className="pp-select" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
                <option value="pdf-a4">PDF（A4 分页 1:1）</option>
                <option value="pdf-single">PDF（完整单页 1:1）</option>
                <option value="svg">SVG（矢量版型）</option>
                <option value="dxf">DXF（服装 CAD 通用）</option>
                <option value="plt">PLT / HPGL（绘图仪）</option>
              </select>
            </div>
            <div className="pp-export-options">
              <label className="pp-toggle"><input type="checkbox" checked={printSeam} onChange={e => setPrintSeam(e.target.checked)} />导出缝份</label>
              <label className="pp-toggle"><input type="checkbox" checked={separatePieces} onChange={e => { setSeparatePieces(e.target.checked); if (e.target.checked) { setShowPatternOnly(true); setLabelMode("none"); } }} />分开前后片</label>
            </div>
            <CenteredParameter label="缝份宽度" value={seam} onChange={setSeam} radius={1} step={0.1} minimum={0} decimals={1} unit="cm" disabled={!printSeam} />
            <button type="button" className="pp-export-btn" onClick={handleExport} disabled={isExportingPdf}>{isExportingPdf ? "正在生成 PDF…" : "导出打印文件"}</button>
            <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45, color: "var(--muted)" }}>PDF 始终仅显示原型；A4 分页强制分开前后片，其他格式遵循“分开前后片”开关。缝份由上方开关控制。打印时请选择“实际大小 / 100%”，不要使用“适合页面”。</div>
          </div>

          <div className="pp-card">
            <h3><Ruler size={14} />测量参数 (cm) — 第一步只用这三个</h3>
            <CenteredParameter label="背长 BL" value={BL} onChange={setBL} radius={5} minimum={1} />
            <CenteredParameter label="胸围 B" value={B} onChange={setB} radius={16} minimum={1} />
            <CenteredParameter label="胸围松量" value={ease} onChange={setEase} radius={5} step={0.5} decimals={1} />
          </div>

          <div className="pp-card">
            <h3><Ruler size={14} />袖子参数 (cm)</h3>
            <CenteredParameter label="袖长 SL" value={SL} onChange={setSL} radius={15} minimum={1} />
          </div>

          <div className="pp-card">
            <h3><Layers size={14} />显示选项</h3>
            <label className="pp-toggle"><input type="radio" name="labelMode" value="points" checked={labelMode === "points"} onChange={() => { setLabelMode("points"); setShowPatternOnly(false); setSeparatePieces(false); }} />显示坐标点名称</label>
            <label className="pp-toggle"><input type="radio" name="labelMode" value="lines" checked={labelMode === "lines"} onChange={() => { setLabelMode("lines"); setShowPatternOnly(false); setSeparatePieces(false); }} />显示线名称</label>
            <div style={{ marginTop: 10, borderTop: "1px dashed var(--grid)", paddingTop: 10 }}>
              <label className="pp-toggle"><input type="checkbox" checked={showPatternOnly} onChange={e => { setShowPatternOnly(e.target.checked); if (e.target.checked) setLabelMode("none"); else setSeparatePieces(false); }} />仅显示原型模式 (隐藏骨架与辅助线)</label>
              <label className="pp-toggle"><input type="checkbox" checked={separatePieces} onChange={e => { setSeparatePieces(e.target.checked); if (e.target.checked) { setShowPatternOnly(true); setLabelMode("none"); } }} />分开显示前后片</label>
            </div>
          </div>

          <div className="pp-card">
            <h3><Grid3x3 size={14} />参考线公式</h3>
            <div className="pp-formulas">
              <div><span>背长线（竖，左边）</span><b>{BL.toFixed(2)}</b></div>
              <div><span>胸围宽 = B/2+松量</span><b>{gf.width.toFixed(2)}</b></div>
              <div><span>胸围线BL = B/6+7</span><b>{gf.bustLineY.toFixed(2)}</b></div>
              <div><span>背宽线 = B/6+4.5</span><b>{gf.backWidthX.toFixed(2)}</b></div>
              <div><span>胸宽线 = B/6+3</span><b>{gf.chestWidthX.toFixed(2)}</b></div>
              <div><span>腋下侧缝线 = 胸围宽/2</span><b>{gf.sideX.toFixed(2)}</b></div>
            </div>
          </div>

          <div className="pp-card">
            <h3><Grid3x3 size={14} />袖窿弧长 (自动计算)</h3>
            <div className="pp-formulas">
              <div><span>前AH</span><b>{step2.formulas.AC.toFixed(2)}</b></div>
              <div><span>后AH</span><b>{step2.formulas.BC.toFixed(2)}</b></div>
              <div><span>前后袖窿弧线AH</span><b>{(step2.formulas.AC + step2.formulas.BC).toFixed(2)}</b></div>
            </div>
          </div>
        </div>

        <div className="pp-workspace">
          <div className="pp-canvas-wrap">
            <svg className="pp-pattern-svg" viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ display: "block", "--print-width": `${svgW / scale}cm` }}>
              <defs>
                <pattern id="ppGrid" width={scale * 5} height={scale * 5} patternUnits="userSpaceOnUse">
                  <path d={`M ${scale * 5} 0 L 0 0 0 ${scale * 5}`} fill="none" stroke="var(--grid)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={svgW} height={svgH} fill="url(#ppGrid)" />

              {showPatternOnly && (
                separatePieces ? (
                  <>
                    <path d={backPiecePath} fill="#fdfbf4" stroke="var(--ink)" strokeWidth="1.8" />
                    <path d={frontPiecePath} fill="#fdfbf4" stroke="var(--ink)" strokeWidth="1.8" />
                  </>
                ) : (
                  <>
                    <path d={patternPath} fill="#fdfbf4" stroke="var(--ink)" strokeWidth="1.8" />
                    <line x1={gx(s2.SIDE_BUST.x)} y1={gy(s2.SIDE_BUST.y)} x2={gx(s2.MODIFIED_SIDE_WAIST.x)} y2={gy(s2.MODIFIED_SIDE_WAIST.y)} stroke="var(--ink)" strokeWidth="1.8" />
                  </>
                )
              )}

              {!showPatternOnly && (
                <>
                  {/* 基础长方形中属于最终原型的部分：仅保留后中线 */}
                  <line x1={gx(0)} y1={gy(0)} x2={gx(0)} y2={gy(BL)} stroke="var(--ink)" strokeWidth="1.8" />

                  {/* 背宽线：竖直，从胸围线到顶部 */}
                  <line x1={gx(gf.backWidthX)} y1={gy(0)} x2={gx(gf.backWidthX)} y2={gy(gf.bustLineY)}
                    stroke="var(--construction)" strokeWidth="1.2" strokeDasharray="5 3" />

                  {/* 胸宽线：竖直，从胸围线到顶部 */}
                  <line x1={gx(gf.width - gf.chestWidthX)} y1={gy(0)} x2={gx(gf.width - gf.chestWidthX)} y2={gy(gf.bustLineY)}
                    stroke="var(--construction)" strokeWidth="1.2" strokeDasharray="5 3" />

                  {/* 腋下侧缝线：竖直，从胸围线中点到底边 */}
                  <line x1={gx(gf.sideX)} y1={gy(gf.bustLineY)} x2={gx(gf.sideX)} y2={gy(BL)}
                    stroke="var(--dart)" strokeWidth="1.3" strokeDasharray="5 3" />

                  {/* Step 2: 后领窝弧线 */}
                  <path d={`M ${gx(s2.CB_TOP.x)},${gy(s2.CB_TOP.y)} C ${gx(s2c.backNeckC1.x)},${gy(s2c.backNeckC1.y)} ${gx(s2c.backNeckC2.x)},${gy(s2c.backNeckC2.y)} ${gx(s2.BACK_NECK_PT.x)},${gy(s2.BACK_NECK_PT.y)}`} fill="none" stroke="var(--ink)" strokeWidth="1.8" />
                  
                  {/* Step 2: 后肩斜线辅助 */}
                  <polyline points={`${gx(gf.backWidthX)},${gy(0)} ${gx(gf.backWidthX)},${gy(s2.BACK_SHOULDER_PT.y)} ${gx(s2.BACK_SHOULDER_PT.x)},${gy(s2.BACK_SHOULDER_PT.y)}`} fill="none" stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />

                  {/* Step 2: 后肩斜线 */}
                  <line x1={gx(s2.BACK_NECK_PT.x)} y1={gy(s2.BACK_NECK_PT.y)} x2={gx(s2.BACK_SHOULDER_PT.x)} y2={gy(s2.BACK_SHOULDER_PT.y)} stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 前领窝长方形和分角线 */}
                  <rect x={gx(s2.FRONT_NECK_W_PT.x)} y={gy(s2.CF_TOP.y)} width={gx(s2.FRONT_NECK_D_PT.x) - gx(s2.FRONT_NECK_W_PT.x)} height={gy(s2.FRONT_NECK_D_PT.y) - gy(s2.CF_TOP.y)} fill="none" stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                  <line x1={gx(s2.FRONT_NECK_W_PT.x)} y1={gy(s2.FRONT_NECK_D_PT.y)} x2={gx(s2.bisectPt.x)} y2={gy(s2.bisectPt.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />

                  {/* Step 2: 前领窝弧线 */}
                  <path d={`M ${gx(s2.FRONT_NECK_W_PT.x)},${gy(s2.FRONT_NECK_W_PT.y)} Q ${gx(s2c.frontNeckCtrl.x)},${gy(s2c.frontNeckCtrl.y)} ${gx(s2.FRONT_NECK_D_PT.x)},${gy(s2.FRONT_NECK_D_PT.y)}`} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 前肩水平参考线和肩斜线辅助 */}
                  <line x1={gx(gf.width - gf.chestWidthX)} y1={gy(0)} x2={gx(gf.width - gf.chestWidthX)} y2={gy(s2.FRONT_SHOULDER_PT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                  <line x1={gx(s2.FRONT_SHOULDER_PT.x - 2)} y1={gy(s2.FRONT_SHOULDER_PT.y)} x2={gx(gf.width - gf.chestWidthX)} y2={gy(s2.FRONT_SHOULDER_PT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                  
                  {/* Step 2: 前肩斜线 */}
                  <line x1={gx(s2.FRONT_NECK_W_PT.x)} y1={gy(s2.FRONT_NECK_W_PT.y)} x2={gx(s2.FRONT_SHOULDER_PT.x)} y2={gy(s2.FRONT_SHOULDER_PT.y)} stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 后袖窿深二等分点与分角线的辅助线 */}
                  <line x1={gx(s2.BACK_SHOULDER_PT.x)} y1={gy(s2.BACK_SHOULDER_PT.y)} x2={gx(s2.backArmholeDepthMidPt.x)} y2={gy(s2.backArmholeDepthMidPt.y)} stroke="none" />
                  <line x1={gx(gf.backWidthX)} y1={gy(gf.bustLineY)} x2={gx(s2.backArmholeBisectPt.x)} y2={gy(s2.backArmholeBisectPt.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />

                  {/* Step 2: 后袖窿弧线 */}
                  <path d={`M ${gx(s2.BACK_SHOULDER_PT.x)},${gy(s2.BACK_SHOULDER_PT.y)} Q ${gx(s2c.backArmholeC1.x)},${gy(s2c.backArmholeC1.y)} ${gx(s2.backArmholeBisectPt.x)},${gy(s2.backArmholeBisectPt.y)} Q ${gx(s2c.backArmholeC2.x)},${gy(s2c.backArmholeC2.y)} ${gx(s2.SIDE_BUST.x)},${gy(s2.SIDE_BUST.y)}`} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 前袖窿辅助线 */}
                  <line x1={gx(s2.FRONT_SHOULDER_PT.x)} y1={gy(s2.FRONT_SHOULDER_PT.y)} x2={gx(s2.frontArmholeDepthMidPt.x)} y2={gy(s2.frontArmholeDepthMidPt.y)} stroke="none" />
                  <line x1={gx(gf.width - gf.chestWidthX)} y1={gy(gf.bustLineY)} x2={gx(s2.frontArmholeBisectPt.x)} y2={gy(s2.frontArmholeBisectPt.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />

                  {/* Step 2: 前袖窿弧线 */}
                  <path d={`M ${gx(s2.FRONT_SHOULDER_PT.x)},${gy(s2.FRONT_SHOULDER_PT.y)} Q ${gx(s2c.frontArmholeC1.x)},${gy(s2c.frontArmholeC1.y)} ${gx(s2.frontArmholeBisectPt.x)},${gy(s2.frontArmholeBisectPt.y)} Q ${gx(s2c.frontArmholeC2.x)},${gy(s2c.frontArmholeC2.y)} ${gx(s2.SIDE_BUST.x)},${gy(s2.SIDE_BUST.y)}`} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 腋下侧缝修正线 */}
                  <line x1={gx(s2.SIDE_BUST.x)} y1={gy(s2.SIDE_BUST.y)} x2={gx(s2.MODIFIED_SIDE_WAIST.x)} y2={gy(s2.MODIFIED_SIDE_WAIST.y)} stroke="var(--ink)" strokeWidth="1.8" />

                  {/* Step 2: 胸高点辅助线 */}
                  <line x1={gx(s2.BP_TOP.x)} y1={gy(s2.BP_TOP.y)} x2={gx(s2.BP.x)} y2={gy(s2.BP.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />

                  {/* Step 2: 底摆起翘追加 */}
                  <line x1={gx(s2.BP.x)} y1={gy(s2.BP.y)} x2={gx(s2.HEM_BP_INTERSECT.x)} y2={gy(s2.HEM_BP_INTERSECT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                  <line x1={gx(s2.FRONT_NECK_D_PT.x)} y1={gy(s2.FRONT_NECK_D_PT.y)} x2={gx(gf.width)} y2={gy(BL)} stroke="var(--ink)" strokeWidth="1.8" />
                  <line x1={gx(gf.width)} y1={gy(BL)} x2={gx(s2.HEM_CF_DROP.x)} y2={gy(s2.HEM_CF_DROP.y)} stroke="var(--ink)" strokeWidth="1.8" />
                  <polyline points={`${gx(s2.HEM_CF_DROP.x)},${gy(s2.HEM_CF_DROP.y)} ${gx(s2.HEM_BP_INTERSECT.x)},${gy(s2.HEM_BP_INTERSECT.y)} ${gx(s2.MODIFIED_SIDE_WAIST.x)},${gy(s2.MODIFIED_SIDE_WAIST.y)}`} fill="none" stroke="var(--ink)" strokeWidth="1.8" />
                  <line x1={gx(s2.MODIFIED_SIDE_WAIST.x)} y1={gy(s2.MODIFIED_SIDE_WAIST.y)} x2={gx(0)} y2={gy(BL)} stroke="var(--ink)" strokeWidth="1.8" />

                </>
              )}

              {printSeam && (
                separatePieces ? (
                  <>
                    <path d={backPieceSeamPath} fill="none" stroke="var(--seam)" strokeWidth="1.2" strokeDasharray="6 3" />
                    <path d={frontPieceSeamPath} fill="none" stroke="var(--seam)" strokeWidth="1.2" strokeDasharray="6 3" />
                  </>
                ) : (
                  <path d={bodySeamPath} fill="none" stroke="var(--seam)" strokeWidth="1.2" strokeDasharray="6 3" />
                )
              )}
              {showLineNames && <SvgLabelLayer items={bodyLineItems} layout={bodyLineLayout} />}
              {showPointNames && (
                <>
                  {bodyPointItems.map(item => <circle key={item.key} cx={item.point.x} cy={item.point.y} r="2.6" fill="var(--ink)" />)}
                  <SvgLabelLayer items={bodyPointItems} layout={bodyPointLayout} />
                </>
              )}
              <ScaleReference x={16} y={svgH - 16} scale={scale} />
            </svg>

            <PatternLegend printSeam={printSeam} seam={seam} showPointNames={showPointNames} />
          </div>

          <div className="pp-canvas-wrap" style={{ marginTop: 20 }}>
            <div className="pp-eyebrow" style={{ marginBottom: 10 }}>Sleeve Pattern - 袖子画板</div>
            <svg className="pp-pattern-svg" viewBox={`0 0 ${svgW} ${sleeveSvgH}`} width="100%" style={{ display: "block", "--print-width": `${svgW / scale}cm` }}>
              <defs>
                <pattern id="ppGridSleeve" width={scale * 5} height={scale * 5} patternUnits="userSpaceOnUse" x={sox % (scale * 5)}>
                  <path d={`M ${scale * 5} 0 L 0 0 0 ${scale * 5}`} fill="none" stroke="var(--grid)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={svgW} height={sleeveSvgH} fill="url(#ppGridSleeve)" />

              {showPatternOnly && <path d={sleevePatternPath} fill="#fdfbf4" stroke="none" />}
              
              {!showPatternOnly && (
                <>
                  {/* 十字、袖肥线、袖口基准线与前后袖山斜线 */}
                  <line x1={sgx(0)} y1={sgy(-5)} x2={sgx(0)} y2={sgy(SL + 10)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="4 3" />
                  <line x1={sgx(sleeve.points.BACK_WIDTH_PT.x - 3)} y1={sgy(sleeve.points.CROSS_CENTER.y)} x2={sgx(sleeve.points.FRONT_WIDTH_PT.x + 3)} y2={sgy(sleeve.points.CROSS_CENTER.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="4 3" />
                  <line x1={sgx(sleeve.points.BACK_WIDTH_PT.x - 3)} y1={sgy(SL)} x2={sgx(sleeve.points.FRONT_WIDTH_PT.x + 3)} y2={sgy(SL)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="4 3" />
                  <line x1={sgx(sleeve.points.CAP_TOP.x)} y1={sgy(sleeve.points.CAP_TOP.y)} x2={sgx(sleeve.points.FRONT_WIDTH_PT.x)} y2={sgy(sleeve.points.FRONT_WIDTH_PT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                  <line x1={sgx(sleeve.points.CAP_TOP.x)} y1={sgy(sleeve.points.CAP_TOP.y)} x2={sgx(sleeve.points.BACK_WIDTH_PT.x)} y2={sgy(sleeve.points.BACK_WIDTH_PT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="2 3" />
                </>
              )}

              {!showPatternOnly && (
                <>
                  {/* 前袖山辅助点及垂线 */}
                  <line x1={sgx(sleeve.points.fQ1.x)} y1={sgy(sleeve.points.fQ1.y)} x2={sgx(sleeve.points.fP1.x)} y2={sgy(sleeve.points.fP1.y)} stroke="var(--construction)" strokeWidth="1" />
                  <line x1={sgx(sleeve.points.fQ3.x)} y1={sgy(sleeve.points.fQ3.y)} x2={sgx(sleeve.points.fP2.x)} y2={sgy(sleeve.points.fP2.y)} stroke="var(--construction)" strokeWidth="1" />
                </>
              )}
              
              {/* 前袖山弧线 */}
              <path d={clampedSplineToBezier(sleeve.frontCapPoints)} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

              {!showPatternOnly && (
                <>
                  {/* 后袖山辅助点及垂线 */}
                  <line x1={sgx(sleeve.points.bQ1.x)} y1={sgy(sleeve.points.bQ1.y)} x2={sgx(sleeve.points.bP1.x)} y2={sgy(sleeve.points.bP1.y)} stroke="var(--construction)" strokeWidth="1" />
                  <line x1={sgx(sleeve.points.bSlopeMid.x)} y1={sgy(sleeve.points.bSlopeMid.y)} x2={sgx(sleeve.points.BACK_MATCH_PT.x)} y2={sgy(sleeve.points.BACK_MATCH_PT.y)} stroke="var(--construction)" strokeWidth="1" />
                  <line x1={sgx(sleeve.points.bLowerMid.x)} y1={sgy(sleeve.points.bLowerMid.y)} x2={sgx(sleeve.points.bP2.x)} y2={sgy(sleeve.points.bP2.y)} stroke="var(--construction)" strokeWidth="1" />
                </>
              )}

              {/* 后袖山弧线 */}
              <path d={clampedSplineToBezier(sleeve.backCapPoints)} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

              {/* 前后袖底缝线 */}
              <line x1={sgx(sleeve.points.FRONT_WIDTH_PT.x)} y1={sgy(sleeve.points.FRONT_WIDTH_PT.y)} x2={sgx(sleeve.points.FRONT_HEM_PT.x)} y2={sgy(sleeve.points.FRONT_HEM_PT.y)} stroke="var(--ink)" strokeWidth="1.8" />
              <line x1={sgx(sleeve.points.BACK_WIDTH_PT.x)} y1={sgy(sleeve.points.BACK_WIDTH_PT.y)} x2={sgx(sleeve.points.BACK_HEM_PT.x)} y2={sgy(sleeve.points.BACK_HEM_PT.y)} stroke="var(--ink)" strokeWidth="1.8" />

              {!showPatternOnly && (
                <>
                  {/* 袖口弧线辅助取点 */}
                  <line x1={sgx(sleeve.points.BACK_HEM_MID.x)} y1={sgy(sleeve.points.BACK_HEM_MID.y)} x2={sgx(sleeve.points.BACK_HEM_CURVE_PT.x)} y2={sgy(sleeve.points.BACK_HEM_CURVE_PT.y)} stroke="var(--construction)" strokeWidth="1" />
                  <line x1={sgx(sleeve.points.HEM_CENTER.x)} y1={sgy(sleeve.points.HEM_CENTER.y)} x2={sgx(sleeve.points.HEM_CENTER_CURVE_PT.x)} y2={sgy(sleeve.points.HEM_CENTER_CURVE_PT.y)} stroke="var(--construction)" strokeWidth="1" />
                  <line x1={sgx(sleeve.points.FRONT_HEM_MID.x)} y1={sgy(sleeve.points.FRONT_HEM_MID.y)} x2={sgx(sleeve.points.FRONT_HEM_CURVE_PT.x)} y2={sgy(sleeve.points.FRONT_HEM_CURVE_PT.y)} stroke="var(--construction)" strokeWidth="1" />
                </>
              )}

              {/* 袖口顺弧线 */}
              <path d={clampedSplineToBezier(sleeve.sleeveHemPoints, { startSpeed: 0.7, endSpeed: 0.7 })} fill="none" stroke="var(--ink)" strokeWidth="1.8" />

              {/* 袖衬线 */}
              {!showPatternOnly && <line x1={sgx(sleeve.points.ELBOW_BACK_PT.x)} y1={sgy(sleeve.points.ELBOW_BACK_PT.y)} x2={sgx(sleeve.points.ELBOW_FRONT_PT.x)} y2={sgy(sleeve.points.ELBOW_FRONT_PT.y)} stroke="var(--construction)" strokeWidth="1" strokeDasharray="4 3" />}
              {printSeam && <path d={sleeveSeamPath} fill="none" stroke="var(--seam)" strokeWidth="1.2" strokeDasharray="6 3" />}
              {showLineNames && <SvgLabelLayer items={sleeveLineItems} layout={sleeveLineLayout} />}
              {showPointNames && (
                <>
                  {sleevePointItems.map(item => <circle key={item.key} cx={item.point.x} cy={item.point.y} r="3" fill="var(--ink)" />)}
                  <SvgLabelLayer items={sleevePointItems} layout={sleevePointLayout} />
                </>
              )}
              <ScaleReference x={16} y={sleeveSvgH - 16} scale={scale} />
            </svg>
            <PatternLegend printSeam={printSeam} seam={seam} showPointNames={showPointNames} />
          </div>
        </div>
      </div>
    </div>
  );
}
