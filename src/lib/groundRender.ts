/**
 * 画地面图 —— `Sector/RJJJ/Plugins/GroundMap/src/GroundMap.cpp` 的 canvas 版。
 *
 * 插件在 EuroScope 里用 Direct2D 画，这里用 2D canvas 画同一份 ground.json，
 * **画法一比一照抄**：一样的 LOD 判据（视野宽度海里）、一样的三遍描边（先全部
 * 边线、再全部道面、最后中线）、一样的标签底板尺寸（按字数估，不量字宽）。
 *
 * 两处是 Direct2D 的脾气，抄的时候容易漏，漏了就不像：
 *
 * - **虚线段长是描边宽度的倍数**。D2D 的 dash 数组以 stroke width 为单位，
 *   `{6,5}` 配 1.6 px 的跑道中线画出来是 9.6/8 px；canvas 的 `setLineDash` 是
 *   绝对像素，所以要自己乘回去。
 * - **线帽是平的、拐角是尖的**（D2D 默认 flat cap + miter join）。滑行道就是靠
 *   这个在路口拼得上，换成圆头立刻变样。
 *
 * 投影用等距圆柱、按视野中心纬度压扁经度 —— 机场尺度上和 EuroScope 的
 * `ConvertCoordFromPositionToPixel` 看不出差别，而它让"视野宽度海里"这个 LOD
 * 判据算起来和插件里那一行完全一致。
 */
import type {
  GroundDoc,
  LatLon,
  LayerStyle,
  MapLayer,
  Rgba,
  StrokeGeom,
  StyleSheet,
  Bounds,
} from "@/lib/groundMap";

export interface View {
  /** 视野中心。 */
  lat: number;
  lon: number;
  /** 每纬度一度多少 CSS 像素。 */
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface RenderOptions {
  background: string;
  /** 关掉的图层 id，对应 ASR 里的 `GroundMap_<id>` 开关。 */
  hidden?: Set<string>;
  /** ASR 的 `Airport` 键：只画这一个机场。 */
  only?: string | null;
}

export interface RenderStats {
  viewNm: number;
  layers: number;
  elements: number;
  airports: number;
}

/** 插件那一行：一度纬度 60 海里，一海里 1852 米。 */
const M_PER_DEG = 60 * 1852;

const rad = (d: number) => (d * Math.PI) / 180;

function css(c: Rgba): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(4)})`;
}

/** 视野宽度，海里 —— 插件用它挑图层，也是这个页面唯一的"缩放级别"。 */
export function viewWidthNm(view: View, viewport: Viewport): number {
  return (viewport.width / view.scale) * 60;
}

/** 反过来：要这么宽的视野，`scale` 该是多少。 */
export function scaleForWidthNm(nm: number, viewport: Viewport): number {
  return (viewport.width / Math.max(nm, 1e-6)) * 60;
}

export function project(
  view: View,
  viewport: Viewport,
  lat: number,
  lon: number,
): { x: number; y: number } {
  const kx = Math.cos(rad(view.lat));
  return {
    x: viewport.width / 2 + (lon - view.lon) * kx * view.scale,
    y: viewport.height / 2 - (lat - view.lat) * view.scale,
  };
}

export function unproject(
  view: View,
  viewport: Viewport,
  x: number,
  y: number,
): LatLon {
  const kx = Math.cos(rad(view.lat));
  return [
    view.lat + (viewport.height / 2 - y) / view.scale,
    view.lon + (x - viewport.width / 2) / (kx * view.scale),
  ];
}

/** 把一个包围盒放进画布，四边留一点余量。 */
export function fitBounds(
  bounds: Bounds,
  viewport: Viewport,
  pad = 0.06,
): View {
  const [minLat, minLon, maxLat, maxLon] = bounds;
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  const kx = Math.cos(rad(lat));
  const latSpan = Math.max(maxLat - minLat, 1e-6);
  const lonSpan = Math.max((maxLon - minLon) * kx, 1e-6);
  const scale = Math.min(viewport.height / latSpan, viewport.width / lonSpan);
  return { lat, lon, scale: scale * (1 - pad) };
}

/**
 * 文档（或其中一个机场）的包围盒；什么都没有就返回 null。
 *
 * 一个机场都没有时退回去量 `world` 的几何 —— 只拖了 `NavData/*.geojson` 进来
 * 的那种情况，机场包围盒是空的，没有这条退路画布就停在一片空白上，连缩放的
 * 落脚点都没有。
 */
export function docBounds(doc: GroundDoc, only?: string | null): Bounds | null {
  const entries = Object.entries(doc.airports).filter(
    ([icao]) => !only || icao === only,
  );
  if (entries.length) {
    let [minLat, minLon, maxLat, maxLon] = entries[0][1].bounds;
    for (const [, ap] of entries.slice(1)) {
      minLat = Math.min(minLat, ap.bounds[0]);
      minLon = Math.min(minLon, ap.bounds[1]);
      maxLat = Math.max(maxLat, ap.bounds[2]);
      maxLon = Math.max(maxLon, ap.bounds[3]);
    }
    return [minLat, minLon, maxLat, maxLon];
  }

  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const layer of doc.world) {
    for (const g of layer.geom ?? []) {
      for (const [lat, lon] of Array.isArray(g) ? g : g.p) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  return Number.isFinite(minLat) ? [minLat, minLon, maxLat, maxLon] : null;
}

/** 这一层在当前视野下画不画：LOD 之外和被关掉的都不画。 */
export function layerVisible(
  layer: MapLayer,
  viewNm: number,
  hidden?: Set<string>,
): boolean {
  if (hidden?.has(layer.id)) return false;
  return viewNm >= layer.lod[0] && viewNm <= layer.lod[1];
}

export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  doc: GroundDoc,
  styles: StyleSheet,
  view: View,
  opts: RenderOptions,
): RenderStats {
  const { width, height } = viewport;
  ctx.save();
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const viewNm = viewWidthNm(view, viewport);
  // 米 -> 像素，描边宽度要用。和插件同一条式子。
  const pxPerM = view.scale / M_PER_DEG;
  const [maxLat, minLon] = unproject(view, viewport, 0, 0);
  const [minLat, maxLon] = unproject(view, viewport, width, height);

  const px = (lat: number, lon: number) => project(view, viewport, lat, lon);
  const stats: RenderStats = { viewNm, layers: 0, elements: 0, airports: 0 };

  const draw = (layer: MapLayer, style: LayerStyle) => {
    stats.layers++;
    if (layer.kind === "polygon") drawPolygons(layer, style);
    else if (layer.kind === "text") drawTexts(layer, style);
    else drawStrokes(layer, style);
  };

  function path(points: LatLon[], close: boolean): Path2D {
    const p = new Path2D();
    const first = px(points[0][0], points[0][1]);
    p.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const q = px(points[i][0], points[i][1]);
      p.lineTo(q.x, q.y);
    }
    if (close) p.closePath();
    return p;
  }

  function dash(style: LayerStyle, w: number) {
    // D2D 的 dash 长度以描边宽度为单位，canvas 的是绝对像素
    ctx.setLineDash(style.dashed ? [6 * w, 5 * w] : []);
  }

  function drawPolygons(layer: MapLayer, style: LayerStyle) {
    for (const g of layer.geom ?? []) {
      const pts = Array.isArray(g) ? g : g.p;
      if (pts.length < 3) continue;
      stats.elements++;
      const p = path(pts, true);
      if (style.fill) {
        ctx.fillStyle = css(style.fill);
        ctx.fill(p);
      }
      if (style.line) {
        ctx.strokeStyle = css(style.line);
        ctx.lineWidth = style.lineWidth;
        dash(style, style.lineWidth);
        ctx.stroke(p);
      }
    }
    ctx.setLineDash([]);
  }

  /**
   * 描边类图层。`stroke` 是有实际宽度的道面（滑行道），`line` 是固定像素宽的
   * 线（站位、等待位置、跑道中线、边线）。
   *
   * 三遍的顺序是有代价换来的：一条一条"先边线后道面"地画，后一条的边线会压在
   * 前一条的道面上，路口就被切成一段一段。
   */
  function drawStrokes(layer: MapLayer, style: LayerStyle) {
    const paths: Path2D[] = [];
    const widths: number[] = [];
    for (const g of layer.geom ?? []) {
      const pts = Array.isArray(g) ? g : g.p;
      if (pts.length < 2) continue;
      if (offScreen(pts)) continue;
      stats.elements++;
      paths.push(path(pts, false));
      widths.push(
        layer.kind === "stroke"
          ? Math.max((g as StrokeGeom).w * pxPerM, 1)
          : style.lineWidth,
      );
    }
    if (!paths.length) return;

    if (layer.kind !== "stroke") {
      ctx.strokeStyle = css(style.fill ?? style.line ?? [255, 255, 255, 255]);
      for (let i = 0; i < paths.length; i++) {
        ctx.lineWidth = widths[i];
        dash(style, widths[i]);
        ctx.stroke(paths[i]);
      }
      ctx.setLineDash([]);
      return;
    }

    ctx.setLineDash([]);
    const edge = style.line ? style.lineWidth : 0;
    if (edge > 0 && style.line) {
      ctx.strokeStyle = css(style.line);
      for (let i = 0; i < paths.length; i++) {
        if (widths[i] <= 3) continue;
        ctx.lineWidth = widths[i];
        ctx.stroke(paths[i]);
      }
    }
    ctx.strokeStyle = css(style.fill ?? [255, 255, 255, 255]);
    for (let i = 0; i < paths.length; i++) {
      const w = widths[i];
      ctx.lineWidth = Math.max(edge > 0 && w > 3 ? w - 2 * edge : w, 1);
      ctx.stroke(paths[i]);
    }
    if (style.centreWidth > 0) {
      ctx.strokeStyle = css(style.centre);
      ctx.lineWidth = style.centreWidth;
      for (let i = 0; i < paths.length; i++) {
        if (widths[i] > 6) ctx.stroke(paths[i]);
      }
    }
  }

  function drawTexts(layer: MapLayer, style: LayerStyle) {
    ctx.font = `600 ${style.fontSize}px "Segoe UI", system-ui, sans-serif`;
    for (const it of layer.items ?? []) {
      const p = px(it.p[0], it.p[1]);
      if (p.x < -60 || p.x > width + 60 || p.y < -20 || p.y > height + 20) {
        continue;
      }
      stats.elements++;
      // 插件不量字宽，按字数估 —— 底板尺寸跟着这条估算走，量了反而不像
      const halfW = style.fontSize * 0.34 * it.t.length + 2.5;
      const halfH = style.fontSize * 0.62;
      if (style.textBg) {
        ctx.fillStyle = css(style.textBg);
        ctx.fillRect(p.x - halfW, p.y - halfH, halfW * 2, halfH * 2);
      }
      ctx.fillStyle = css(style.text);
      ctx.fillText(it.t, p.x, p.y);
    }
  }

  /**
   * 世界图层有几万段，先用包围盒把看不见的挑掉再建路径。
   *
   * 边界往外放 100 像素：一条整体在屏外的线，描边宽度仍可能把它蹭进画面。
   */
  function offScreen(pts: LatLon[]): boolean {
    const m = 100 / view.scale;
    let y0 = pts[0][0];
    let y1 = pts[0][0];
    let x0 = pts[0][1];
    let x1 = pts[0][1];
    for (const [y, x] of pts) {
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    return (
      y1 < minLat - m || y0 > maxLat + m || x1 < minLon - m || x0 > maxLon + m
    );
  }

  for (const layer of doc.world) {
    if (!layerVisible(layer, viewNm, opts.hidden)) continue;
    const style = styles[layer.style];
    if (!style) continue;
    draw(layer, style);
  }

  for (const [icao, ap] of Object.entries(doc.airports)) {
    if (opts.only && icao !== opts.only) continue;
    const [apMinLat, apMinLon, apMaxLat, apMaxLon] = ap.bounds;
    if (
      apMaxLat < minLat ||
      apMinLat > maxLat ||
      apMaxLon < minLon ||
      apMinLon > maxLon
    ) {
      continue;
    }
    stats.airports++;
    for (const layer of ap.layers) {
      if (!layerVisible(layer, viewNm, opts.hidden)) continue;
      const style = styles[layer.style];
      if (!style) continue;
      draw(layer, style);
    }
  }

  ctx.restore();
  return stats;
}
