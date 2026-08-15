/**
 * Ground 数据的解析与合并 —— `Ground/tools/merge.py` 的浏览器版。
 *
 * 这个站不碰 Ground 仓库，也不带任何地面数据：文件是使用者自己拖进来的，全部
 * 在浏览器里解析。之所以要在这里重做一遍合并，是因为**手工编辑的是每机场文
 * 件**（`Ground/<FIR>/airports/<ICAO>.json`），而插件读的是合并产物
 * （`Sector/<FIR>/Plugins/GroundMap/ground.json`）—— 改一笔要跑一次 merge.py
 * 再开 EuroScope 才看得见，这个来回是这个页面要消掉的东西。
 *
 * **逐行照着 merge.py 抄，包括它的常量和它的怪癖**（见 `dp()` 在 world 图层上
 * 的调用）。这里"更正确"一点，预览就和真正装到管制员机器上的那份对不上了 ——
 * 那正是一个预览工具唯一不能犯的错。两边的分工写在根 CLAUDE.md 的跨仓库契约
 * 那一节：merge.py 是源头，改了那边这边要跟。
 *
 * 只有一处是**近似**，而且只在缺料时才发生：merge.py 的跑道矩形来自扇区文件
 * 的 `[RUNWAY]` 跑道头，站位号在 OSM 没有时来自 `GRpluginStands.txt`。两份文
 * 件都可以一起拖进来（`parseSct` / `parseStands`），拖了就走和 merge.py 完全
 * 一样的路；没拖才退回用 OSM 跑道中心线的两端撑出矩形。
 */

export type LatLon = [number, number];
export type Bounds = [number, number, number, number];
export type LayerKind = "polygon" | "stroke" | "line" | "text";

/** 每机场文件里的一条 OSM 元素：`a` 是 aeroway，`w` 宽度，`r` 编号，`g` 几何。 */
export interface SourceFeature {
  a?: string | null;
  w?: string | number | null;
  r?: string | null;
  /** 手工数据用它把 `painted_line` 分成边线和滑行道中线。 */
  t?: string | null;
  g: LatLon[];
}

/** `kind: "stroke"` 的几何带实际宽度（米），画出来是有宽度的道面。 */
export interface StrokeGeom {
  w: number;
  p: LatLon[];
}

export type Geometry = LatLon[] | StrokeGeom;

export interface TextItem {
  t: string;
  p: LatLon;
}

export interface MapLayer {
  id: string;
  style: string;
  kind: LayerKind;
  /** `[min, max]`，单位是视野宽度海里 —— 插件按它决定这一层值不值得画。 */
  lod: [number, number];
  geom?: Geometry[];
  items?: TextItem[];
}

export interface AirportDoc {
  bounds: Bounds;
  layers: MapLayer[];
}

export interface GroundDoc {
  airports: Record<string, AirportDoc>;
  world: MapLayer[];
}

// ---------------------------------------------------------------- 样式

export type Rgba = [number, number, number, number];

/**
 * 一个样式名解出来的东西，字段和 `GroundMap.cpp` 的 `struct Style` 一一对应。
 * `fill` / `line` / `textBg` 用 `null` 表示"这份样式里没有这一项"，也就是 C++
 * 那边的 `hasFill` / `hasLine` / `hasTextBg`。
 */
export interface LayerStyle {
  fill: Rgba | null;
  line: Rgba | null;
  text: Rgba;
  textBg: Rgba | null;
  centre: Rgba;
  lineWidth: number;
  centreWidth: number;
  dashed: boolean;
  fontSize: number;
}

export type StyleSheet = Record<string, LayerStyle>;

/**
 * `Ground/<FIR>/style.json` 的内容。十个 FIR 的这份文件逐字相同，所以带一份在
 * 身上：没拖 style.json 进来时用它，拖了就用拖进来的那份。
 */
export const DEFAULT_STYLE_DOC: Record<string, unknown> = {
  version: 2,
  colors: {
    field: [122, 122, 122],
    apron: [135, 135, 135],
    "apron-edge": [96, 104, 128],
    terminal: [77, 77, 77],
    runway: [84, 84, 84],
    "runway-mark": [235, 235, 235],
    pavement: [109, 109, 109],
    "twy-edge": [74, 86, 124],
    "twy-centre": [200, 200, 200],
    "twy-line": [214, 186, 74],
    "edge-line": [196, 196, 196],
    stand: [135, 135, 135],
    "stand-centre": [170, 170, 170],
    holding: [255, 120, 0],
    black: [0, 0, 0],
    white: [245, 245, 245],
    "label-bg": [18, 18, 18],
    orange: [255, 184, 108],
    "rwy-centre": [240, 240, 240],
    grass: [92, 104, 78],
    building: [84, 84, 84],
    "bldg-edge": [110, 110, 110],
    "rwy-mark": [238, 238, 238],
    "term-edge": [122, 122, 122],
    "acc-bound": [120, 120, 120],
    "tracon-bound": [150, 150, 150],
  },
  layers: {
    aerodrome: { fill: "field", line: "apron-edge", "line-width": 1.0 },
    apron: { fill: "apron", line: "apron-edge", "line-width": 1.0 },
    terminal: { fill: "terminal" },
    runway: { fill: "runway", line: "runway-mark", "line-width": 1.5 },
    taxiway: {
      fill: "pavement",
      line: "twy-edge",
      centre: "twy-centre",
      "centre-width": 1.0,
      "line-width": 1.4,
    },
    taxiwayplain: { fill: "pavement", line: "twy-edge", "line-width": 1.4 },
    taxiline: { line: "twy-line", "line-width": 1.1 },
    edgeline: { line: "edge-line", "line-width": 1.0 },
    stand: { line: "stand-centre", "line-width": 1.6 },
    holding: { line: "holding", "line-width": 2.5 },
    twylabel: {
      text: "white",
      "text-bg": "black",
      "text-outline": "white",
      "font-size": 12.0,
    },
    standlabel: { text: "white", "font-size": 11.0 },
    runwaylabel: {
      text: "white",
      "text-bg": "black",
      "text-outline": "white",
      "font-size": 16.0,
    },
    holdinglabel: {
      text: "orange",
      "text-bg": "black",
      "text-outline": "orange",
      "font-size": 12.0,
    },
    runavaillabel: { text: "orange", "text-bg": "black", "font-size": 11.0 },
    runwaycentre: { line: "rwy-centre", "line-width": 1.6, dash: true },
    grass: { fill: "grass" },
    building: { fill: "building", line: "bldg-edge", "line-width": 1.0 },
    runwaymark: { fill: "rwy-mark", line: "rwy-mark", "line-width": 1.2 },
    terminalline: { line: "term-edge", "line-width": 1.0 },
    accbound: { line: "acc-bound", "line-width": 1.2 },
    traconbound: { line: "tracon-bound", "line-width": 1.0 },
  },
};

const WHITE: Rgba = [255, 255, 255, 255];

function toColor(v: unknown): Rgba | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const c = (i: number, d: number) =>
    typeof v[i] === "number" ? (v[i] as number) : d;
  return [c(0, 255), c(1, 255), c(2, 255), v.length > 3 ? c(3, 255) : 255];
}

/** 解 style.json —— 和 `StyleSheet::load` 一样，颜色可以是名字也可以是字面量。 */
export function parseStyleSheet(doc: unknown): StyleSheet {
  const root = (doc ?? {}) as Record<string, unknown>;
  const colors = (root.colors ?? {}) as Record<string, unknown>;
  const layers = (root.layers ?? {}) as Record<string, unknown>;

  const pick = (v: unknown, fallback: Rgba | null): Rgba | null => {
    if (Array.isArray(v)) return toColor(v) ?? fallback;
    if (typeof v === "string" && v in colors) return toColor(colors[v]);
    return fallback;
  };
  const numOr = (v: unknown, d: number) => (typeof v === "number" ? v : d);

  const out: StyleSheet = {};
  for (const [name, raw] of Object.entries(layers)) {
    const L = (raw ?? {}) as Record<string, unknown>;
    out[name] = {
      fill: "fill" in L ? pick(L.fill, WHITE) : null,
      line: "line" in L ? pick(L.line, WHITE) : null,
      text: pick(L.text, WHITE) ?? WHITE,
      textBg: "text-bg" in L ? pick(L["text-bg"], WHITE) : null,
      centre: pick(L.centre, WHITE) ?? WHITE,
      lineWidth: numOr(L["line-width"], 1.0),
      centreWidth: numOr(L["centre-width"], 0.0),
      dashed: L.dash === true,
      fontSize: numOr(L["font-size"], 12.0),
    };
  }
  return out;
}

export const DEFAULT_STYLE: StyleSheet = parseStyleSheet(DEFAULT_STYLE_DOC);

// ---------------------------------------------------------------- 图层表

/** merge.py 的 `LAYERS`：顺序就是绘制顺序，先画的在下面。 */
export const LAYER_TABLE: {
  key: string;
  style: string;
  kind: LayerKind;
  lod: [number, number];
}[] = [
  { key: "ad", style: "aerodrome", kind: "polygon", lod: [0, 80] },
  { key: "apron", style: "apron", kind: "polygon", lod: [0, 30] },
  { key: "term", style: "terminal", kind: "polygon", lod: [0, 20] },
  { key: "twy", style: "taxiway", kind: "stroke", lod: [0, 12] },
  { key: "std", style: "stand", kind: "line", lod: [0, 3] },
  { key: "rwy", style: "runway", kind: "polygon", lod: [0, 80] },
  { key: "rwyctr", style: "runwaycentre", kind: "line", lod: [0, 25] },
  { key: "edge", style: "edgeline", kind: "line", lod: [0, 8] },
  { key: "mark", style: "taxiline", kind: "line", lod: [0, 6] },
  { key: "hld", style: "holding", kind: "line", lod: [0, 5] },
  // 标牌的上限跟着它所标注的几何走，不让任何东西无名地画出来：机位号原来
  // 2 NM 就消失而机位中线画到 3 NM，而 96 个 GMC 屏幕里有 15 个开屏就宽于
  // 2 NM，一载入全部机位号已经是隐藏的。跑道号跟着它所在的中线。
  { key: "rwylbl", style: "runwaylabel", kind: "text", lod: [0, 25] },
  // 跑道长度，来自 .ese —— 和 rwylbl 标的是同一处几何，且稀疏（每机场约 3 个），
  // 所以共用它的上限
  { key: "runlbl", style: "runavaillabel", kind: "text", lod: [0, 25] },
  { key: "twylbl", style: "twylabel", kind: "text", lod: [0, 6] },
  { key: "hldlbl", style: "holdinglabel", kind: "text", lod: [0, 5] },
  { key: "stdlbl", style: "standlabel", kind: "text", lod: [0, 3] },
];

const GEOM_KEYS = [
  "ad",
  "apron",
  "term",
  "twy",
  "std",
  "rwy",
  "rwyctr",
  "edge",
  "mark",
  "hld",
] as const;
const TEXT_KEYS = ["rwylbl", "runlbl", "twylbl", "hldlbl", "stdlbl"] as const;

const TOL_M = 3.0;
const WORLD_TOL_M = 60.0;
const TWY_LABEL_SPACING_M = 550;
const STD_LABEL_SPACING_M = 25;
// 站位表里的机位离 OSM 已经放好的标牌这么近，就是同一个机位
const STD_NAME_MERGE_M = 20;
const DEFAULT_RWY_WIDTH = 45.0;
const DEFAULT_TWY_WIDTH = 23.0;
/** merge.py 全程按 1 度纬度 = 111000 米算，这里也是 —— 换个数就对不上了。 */
const M_PER_DEG = 111000.0;

// ---------------------------------------------------------------- 小工具

const rad = (d: number) => (d * Math.PI) / 180;
/**
 * merge.py 的 `round(v, 7)`，不是 `Math.round(v * 1e7) / 1e7`。
 *
 * 后者先乘再取整，乘出来的浮点误差会把末位翻过去 —— 逐机场比对 merge.py 的产
 * 物时，差别正好落在这一位上（10⁻⁷ 度，一厘米）。`toFixed` 走的是十进制舍入，
 * 和 Python 对齐。
 */
const r7 = (v: number) => Number(v.toFixed(7));
const r6 = (v: number) => Number(v.toFixed(6));
const key7 = (p: LatLon) => `${r7(p[0])},${r7(p[1])}`;

/** `common.num`：从 `"60"`、`"45 m"` 这种 OSM 值里取头一个数。 */
function num(v: unknown, fallback: number): number {
  const m = /^[\d.]+/.exec(String(v ?? ""));
  const n = m ? Number.parseFloat(m[0]) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Douglas–Peucker，容差按米。`protect` 里的点不许被抽掉，也不许跨过 —— 滑行道
 * 的交叉口顶点靠它留住，否则相邻两条道会在路口错开。
 */
function dp(
  pts: LatLon[],
  tolM: number,
  lat0: number,
  protect?: Set<string>,
): LatLon[] {
  if (pts.length < 3) return pts;
  const cuts = [0];
  if (protect && protect.size) {
    for (let i = 1; i < pts.length - 1; i++) {
      if (protect.has(key7(pts[i]))) cuts.push(i);
    }
  }
  cuts.push(pts.length - 1);

  const kx = Math.cos(rad(lat0));
  const tol = tolM / M_PER_DEG;
  const out: LatLon[] = [];

  for (let c = 0; c < cuts.length - 1; c++) {
    const seg = pts.slice(cuts[c], cuts[c + 1] + 1);
    let piece: LatLon[];
    if (seg.length < 3) {
      piece = seg;
    } else {
      const keep = new Array<boolean>(seg.length).fill(false);
      keep[0] = keep[seg.length - 1] = true;
      const stack: [number, number][] = [[0, seg.length - 1]];
      while (stack.length) {
        const [i, j] = stack.pop() as [number, number];
        if (j <= i + 1) continue;
        const [ay, axRaw] = seg[i];
        const [by, bxRaw] = seg[j];
        const dy = by - ay;
        const dx = (bxRaw - axRaw) * kx;
        const dd = dy * dy + dx * dx;
        let dmax = -1;
        let idx = i;
        for (let k = i + 1; k < j; k++) {
          const [py, pxRaw] = seg[k];
          let dist: number;
          if (dd === 0) {
            dist = Math.hypot(py - ay, (pxRaw - axRaw) * kx);
          } else {
            const t = Math.max(
              0,
              Math.min(1, ((py - ay) * dy + (pxRaw - axRaw) * kx * dx) / dd),
            );
            dist = Math.hypot(py - ay - t * dy, (pxRaw - axRaw) * kx - t * dx);
          }
          if (dist > dmax) {
            dmax = dist;
            idx = k;
          }
        }
        if (dmax > tol) {
          keep[idx] = true;
          stack.push([i, idx], [idx, j]);
        }
      }
      piece = seg.filter((_, i) => keep[i]);
    }
    if (out.length === 0) out.push(...piece);
    else out.push(...piece.slice(1));
  }
  return out;
}

/** 由两个跑道头和宽度撑出跑道矩形，和 merge.py 的 `rwy_rect` 同一份算术。 */
function rwyRect(
  la1: number,
  lo1: number,
  la2: number,
  lo2: number,
  w: number,
): LatLon[] | null {
  const latm = (la1 + la2) / 2;
  const kx = Math.cos(rad(latm));
  const dy = la2 - la1;
  const dx = (lo2 - lo1) * kx;
  const n = Math.hypot(dy, dx);
  if (n === 0) return null;
  const hw = w / 2 / M_PER_DEG;
  const py = (-dx / n) * hw;
  const px = (dy / n) * hw;
  const f = (la: number, lo: number, sy: number, sx: number): LatLon => [
    r7(la + sy),
    r7(lo + sx / kx),
  ];
  return [
    f(la1, lo1, py, px),
    f(la2, lo2, py, px),
    f(la2, lo2, -py, -px),
    f(la1, lo1, -py, -px),
  ];
}

function bearing(a: LatLon, b: LatLon, kx: number): number {
  return (
    ((Math.atan2((b[1] - a[1]) * kx, b[0] - a[0]) * 180) / Math.PI + 180) % 180
  );
}

/** 同名标签之间留出最小间距，密集处只留一个 —— merge.py 的 `thin`。 */
function thin(items: TextItem[], minM: number, kx: number): TextItem[] {
  const kept: TextItem[] = [];
  const by = new Map<string, LatLon[]>();
  for (const it of items) {
    const seen = by.get(it.t) ?? [];
    const [y, x] = it.p;
    const close = seen.some(
      ([py, px]) =>
        Math.hypot((y - py) * M_PER_DEG, (x - px) * M_PER_DEG * kx) < minM,
    );
    if (close) continue;
    seen.push(it.p);
    by.set(it.t, seen);
    kept.push(it);
  }
  return kept;
}

// ---------------------------------------------------------------- 扇区包侧的两份料

export interface SctRunway {
  n1: string;
  n2: string;
  la1: number;
  lo1: number;
  la2: number;
  lo2: number;
}

export interface FreetextLabel {
  kind: string; // GATE / TXL / HP / RWY / RUN
  text: string;
  lat: number;
  lon: number;
}

export interface StandRow {
  name: string;
  lat: number;
  lon: number;
}

/** `N023.22.50.491` → 23.3806…；`common.dms`。 */
function dms(s: string): number {
  const parts = s.slice(1).split(".");
  if (parts.length < 4) return Number.NaN;
  const [d, m, sec, ms] = parts;
  const v =
    Number(d) + Number(m) / 60 + (Number(sec) + Number(ms) / 1000) / 3600;
  return "SW".includes(s[0]) ? -v : v;
}

/** 扇区文件的 `[RUNWAY]` 段：跑道头才是 merge.py 画跑道矩形用的那两个点。 */
export function parseSct(text: string): Record<string, SctRunway[]> {
  const out: Record<string, SctRunway[]> = {};
  let cur = "";
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.replace(/\s+$/, "");
    if (t.startsWith("[") && t.endsWith("]")) {
      cur = t.trim();
      continue;
    }
    if (cur !== "[RUNWAY]") continue;
    const p = t.split(";")[0].trim().split(/\s+/);
    if (p.length < 9) continue;
    const row = {
      n1: p[0],
      n2: p[1],
      la1: dms(p[4]),
      lo1: dms(p[5]),
      la2: dms(p[6]),
      lo2: dms(p[7]),
    };
    if (!Number.isFinite(row.la1) || !Number.isFinite(row.la2)) continue;
    (out[p[8]] ??= []).push(row);
  }
  return out;
}

/** 旧地面插件的站位表 —— OSM 没有机位号时，merge.py 从这里补。 */
/**
 * `.ese` 的 `[FREETEXT]` 标签，按 `<ICAO>-<KIND>` 分组。
 *
 * 上游中国扇区包自己的地面标牌就放在这里，两个仓库都从没读过它。HP（等待点）和
 * RUN（跑道长度）没有别的来源 —— OSM 的 851 个 holding position 只有 28 个带名字，
 * 也完全不含跑道长度，而这里有 4202 和 395 条。
 */
export function parseEse(text: string): Record<string, FreetextLabel[]> {
  const out: Record<string, FreetextLabel[]> = {};
  let cur = "";
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.replace(/\s+$/, "");
    if (t.startsWith("[") && t.endsWith("]")) {
      cur = t.trim();
      continue;
    }
    if (cur !== "[FREETEXT]" || !t.trim()) continue;
    const p = t.split(":");
    if (p.length < 4) continue;
    const grp = p[2];
    if (grp.length < 6 || grp[4] !== "-") continue;
    const lat = dms(p[0]);
    const lon = dms(p[1]);
    const label = p.slice(3).join(":").trim();
    if (lat === null || lon === null || !label) continue;
    const icao = grp.slice(0, 4);
    (out[icao] ??= []).push({ kind: grp.slice(5), text: label, lat, lon });
  }
  return out;
}

export function parseStands(text: string): Record<string, StandRow[]> {
  const out: Record<string, StandRow[]> = {};
  for (const raw of text.split(/\r?\n/)) {
    const p = raw.trim().split(":");
    if (p.length < 5 || p[0] !== "STAND") continue;
    const lat = dms(p[3]);
    const lon = dms(p[4]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    (out[p[1]] ??= []).push({ name: p[2], lat, lon });
  }
  return out;
}

// ---------------------------------------------------------------- 合并

/** 这一次预览里，哪些东西没有按 merge.py 的正路走。 */
export interface BuildNotes {
  /** 跑道是用 OSM 中心线两端近似出来的（没有扇区文件）。 */
  runwaysFromOsm: boolean;
  /** OSM 和 `GRpluginStands.txt` 都没有机位号，站位标签是空的。 */
  standNamesMissing: boolean;
}

export interface AirportBuild {
  icao: string;
  airport: AirportDoc | null;
  notes: BuildNotes;
}

/**
 * 每机场文件 → 一个机场的图层，`merge.py` 的 `build_airport`。
 *
 * `runways` / `stands` 有就走 merge.py 的正路；没有就近似跑道、放弃机位号，并
 * 在 `notes` 里说清楚 —— 预览可以近似，但不能不说。
 *
 * 两个参数的 `undefined` 和 `[]` **不是一回事**：`undefined` 是"没有扇区文
 * 件"，要近似；`[]` 是"扇区文件在，但它没有这个机场的跑道行"，那就照 merge.py
 * 一条都不画。ZL02、ZL03 这些只在站位表里、不在 `.sct` 里的场，产物里本来就没
 * 有跑道层。
 */
export function buildAirportFromSource(
  icao: string,
  els: SourceFeature[],
  runways?: SctRunway[],
  stands?: StandRow[],
  freetext?: FreetextLabel[],
): AirportBuild {
  const notes: BuildNotes = {
    runwaysFromOsm: false,
    standNamesMissing: false,
  };
  const usable = els.filter((e) => Array.isArray(e?.g) && e.g.length > 0);
  if (!usable.length) return { icao, airport: null, notes };

  const la0 = usable[0].g[0][0];
  const kx = Math.cos(rad(la0));

  const L: Record<string, Geometry[]> = {};
  const texts: Record<string, TextItem[]> = {};
  const push = (k: string, v: Geometry) => (L[k] ??= []).push(v);
  const label = (k: string, v: TextItem) => (texts[k] ??= []).push(v);

  // 滑行道的公共顶点 = 路口，抽稀时要留住
  const counts = new Map<string, number>();
  for (const e of usable) {
    if (e.a !== "taxiway") continue;
    for (const q of e.g) counts.set(key7(q), (counts.get(key7(q)) ?? 0) + 1);
  }
  const junc = new Set(
    [...counts.entries()].filter(([, v]) => v > 1).map(([k]) => k),
  );

  const round7 = (pts: LatLon[]): LatLon[] =>
    pts.map(([y, x]) => [r7(y), r7(x)] as LatLon);

  for (const e of usable) {
    const a = e.a;
    const g = e.g;
    if (
      (a === "aerodrome" || a === "apron" || a === "terminal") &&
      g.length >= 4
    ) {
      const r = dp(g, TOL_M, la0);
      while (
        r.length > 3 &&
        r[0][0] === r[r.length - 1][0] &&
        r[0][1] === r[r.length - 1][1]
      ) {
        r.pop();
      }
      push(
        a === "aerodrome" ? "ad" : a === "apron" ? "apron" : "term",
        round7(r),
      );
    } else if (a === "taxiway" && g.length >= 2) {
      const pts = dp(g, TOL_M, la0, junc);
      push("twy", { w: num(e.w, DEFAULT_TWY_WIDTH), p: round7(pts) });
      if (e.r) {
        // 标签放在最长的一段上，短碎段上放不下
        let best: LatLon | null = null;
        let bl = -1;
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i];
          const q = pts[i + 1];
          const d = Math.hypot(
            (q[0] - p[0]) * M_PER_DEG,
            (q[1] - p[1]) * M_PER_DEG * kx,
          );
          if (d > bl) {
            bl = d;
            best = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          }
        }
        if (best && bl > 40) {
          label("twylbl", { t: e.r, p: [r7(best[0]), r7(best[1])] });
        }
      }
    } else if (a === "parking_position" && g.length >= 2) {
      const pts = dp(g, TOL_M, la0);
      push("std", round7(pts));
      if (e.r) {
        const p = pts[pts.length - 1];
        label("stdlbl", { t: e.r, p: [r7(p[0]), r7(p[1])] });
      }
    } else if (a === "painted_line" && g.length >= 2) {
      push(e.t === "edge" ? "edge" : "mark", round7(dp(g, TOL_M, la0)));
    } else if (a === "stand_label" && e.r) {
      label("stdlbl", { t: e.r, p: [r7(g[0][0]), r7(g[0][1])] });
    } else if (a === "twy_label" && e.r) {
      label("twylbl", { t: e.r, p: [r7(g[0][0]), r7(g[0][1])] });
    }
  }

  // 跑道。有扇区文件就照 merge.py：跑道头来自 [RUNWAY]，宽度从最平行的那条
  // OSM 跑道上取；没有就退回 OSM 中心线的两端。
  const osmRwy = usable.filter((e) => e.a === "runway" && e.g.length >= 2);
  const thresholds: {
    n1: string | null;
    n2: string | null;
    la1: number;
    lo1: number;
    la2: number;
    lo2: number;
    width: number | null;
  }[] = [];

  if (runways) {
    for (const r of runways) {
      thresholds.push({
        n1: r.n1,
        n2: r.n2,
        la1: r.la1,
        lo1: r.lo1,
        la2: r.la2,
        lo2: r.lo2,
        width: null,
      });
    }
  } else {
    notes.runwaysFromOsm = osmRwy.length > 0;
    for (const e of osmRwy) {
      const a = e.g[0];
      const b = e.g[e.g.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) {
        // 闭合的 way 是把跑道画成了面，直接当多边形用
        push("rwy", round7(e.g));
        continue;
      }
      const ids = designators(e.r, a, b, kx);
      thresholds.push({
        n1: ids?.[0] ?? null,
        n2: ids?.[1] ?? null,
        la1: a[0],
        lo1: a[1],
        la2: b[0],
        lo2: b[1],
        width: num(e.w, DEFAULT_RWY_WIDTH),
      });
    }
  }

  for (const rw of thresholds) {
    const mid: LatLon = [(rw.la1 + rw.la2) / 2, (rw.lo1 + rw.lo2) / 2];
    const brg = bearing([rw.la1, rw.lo1], [rw.la2, rw.lo2], kx);
    let width = rw.width;
    if (width === null) {
      let best: SourceFeature | null = null;
      let bd = 1e9;
      for (const e of osmRwy) {
        const gg = e.g;
        const em: LatLon = [
          gg.reduce((s, p) => s + p[0], 0) / gg.length,
          gg.reduce((s, p) => s + p[1], 0) / gg.length,
        ];
        const eb = bearing(gg[0], gg[gg.length - 1], kx);
        if (Math.min(Math.abs(eb - brg), 180 - Math.abs(eb - brg)) > 12) {
          continue;
        }
        const d = Math.hypot(
          (em[0] - mid[0]) * M_PER_DEG,
          (em[1] - mid[1]) * M_PER_DEG * kx,
        );
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      width =
        best && bd < 1500 ? num(best.w, DEFAULT_RWY_WIDTH) : DEFAULT_RWY_WIDTH;
    }

    const rect = rwyRect(rw.la1, rw.lo1, rw.la2, rw.lo2, width);
    if (rect) push("rwy", rect);

    const dist = Math.hypot(
      (rw.la2 - rw.la1) * M_PER_DEG,
      (rw.lo2 - rw.lo1) * M_PER_DEG * kx,
    );
    if (dist > 300) {
      const f = 120.0 / dist;
      if (rw.n1) {
        label("rwylbl", {
          t: "RW" + rw.n1,
          p: [
            r7(rw.la1 + (rw.la2 - rw.la1) * f),
            r7(rw.lo1 + (rw.lo2 - rw.lo1) * f),
          ],
        });
      }
      if (rw.n2) {
        label("rwylbl", {
          t: "RW" + rw.n2,
          p: [
            r7(rw.la2 - (rw.la2 - rw.la1) * f),
            r7(rw.lo2 - (rw.lo2 - rw.lo1) * f),
          ],
        });
      }
      const e = 90.0 / dist;
      push("rwyctr", [
        [
          r7(rw.la1 + (rw.la2 - rw.la1) * e),
          r7(rw.lo1 + (rw.lo2 - rw.lo1) * e),
        ],
        [
          r7(rw.la2 - (rw.la2 - rw.la1) * e),
          r7(rw.lo2 - (rw.lo2 - rw.lo1) * e),
        ],
      ]);
    }
  }

  // 等待位置：源数据有画好的横杆就用，只有一个点就在最近的滑行道中线上横一道
  for (const e of usable) {
    if (e.a !== "holding_position") continue;
    const gg = e.g;
    if (gg.length >= 2) {
      push("hld", round7(gg));
      continue;
    }
    const c = gg[0];
    let brg: number | null = null;
    let bd = 9e9;
    for (const s of (L.twy ?? []) as StrokeGeom[]) {
      const pts = s.p;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        if (Math.abs(p[0] - c[0]) > 0.01 || Math.abs(p[1] - c[1]) > 0.01) {
          continue;
        }
        const dy = q[0] - p[0];
        const dx = (q[1] - p[1]) * kx;
        const dd = dy * dy + dx * dx;
        if (dd === 0) continue;
        const t = Math.max(
          0,
          Math.min(1, ((c[0] - p[0]) * dy + (c[1] - p[1]) * kx * dx) / dd),
        );
        const d =
          Math.hypot(c[0] - p[0] - t * dy, (c[1] - p[1]) * kx - t * dx) *
          M_PER_DEG;
        if (d < bd) {
          bd = d;
          brg = Math.atan2(dx, dy);
        }
      }
    }
    if (brg === null || bd > 120) brg = 0.0;
    const perp = brg + Math.PI / 2;
    const h = 11.0 / M_PER_DEG;
    const dy = Math.cos(perp) * h;
    const dx = (Math.sin(perp) * h) / kx;
    push("hld", [
      [r7(c[0] - dy), r7(c[1] - dx)],
      [r7(c[0] + dy), r7(c[1] + dx)],
    ]);
  }

  // 机位号：OSM 只有少数中国机场有，其余靠旧地面插件的站位表。按机位合并，不是
  // 全有或全无 —— 以前只要 OSM 给出一个机位名，整份站位表就全被丢掉，ZGGG 于是
  // 画了 370 个机位却只有 21 个号。
  //
  // 两个来源基本是同一次测量，所以按名字去重：ZGSZ 全部 363 个名字和坐标完全一
  // 致，ZGGG 那 21 个 OSM 名字也都能在站位表里 70 m 内找到 —— 位置上够不着，硬
  // 按位置去重会连隔壁机位一起吞掉。再加一个很紧的位置兜底，管的是两边命名体系
  // 不同的少数场（ZHHH 的 P1..P13 对站位表的数字号），那里「别在已有标牌上再压
  // 一个」比「哪个名字胜出」更重要。
  const rows = stands ?? [];
  if (rows.length) {
    const named = new Set((texts.stdlbl ?? []).map((it) => it.t));
    const anchors = (texts.stdlbl ?? []).map((it) => it.p);
    for (const s of rows) {
      if (named.has(s.name)) continue;
      if (
        anchors.some(
          ([py, px]) =>
            Math.hypot(
              (s.lat - py) * M_PER_DEG,
              (s.lon - px) * M_PER_DEG * kx,
            ) < STD_NAME_MERGE_M,
        )
      )
        continue;
      label("stdlbl", { t: s.name, p: [r7(s.lat), r7(s.lon)] });
    }
  }
  if (!texts.stdlbl?.length && L.std?.length) {
    notes.standNamesMissing = true;
  }

  // 等待点名称与跑道长度，来自 .ese 的 [FREETEXT]。这两个没有别的来源：OSM 的 851
  // 个 holding position 只有 28 个带名字，且完全不含跑道长度，而扇区文件有 4202 和
  // 395 条。两者都对应原版 DxRender 早就定义好的文字样式（橙字黑底，`holding` 与
  // `run-avail`），所以这是把大陆屏幕原来画得出、GroundMap 从来没画的标牌补回来。
  for (const [kind, key] of [
    ["HP", "hldlbl"],
    ["RUN", "runlbl"],
  ] as const) {
    for (const f of freetext ?? []) {
      if (f.kind === kind) {
        label(key, { t: f.text, p: [r7(f.lat), r7(f.lon)] });
      }
    }
  }

  const layers: MapLayer[] = [];
  for (const key of GEOM_KEYS) {
    const geom = L[key];
    if (!geom?.length) continue;
    const meta = LAYER_TABLE.find((l) => l.key === key)!;
    layers.push({
      id: key,
      style: meta.style,
      kind: meta.kind,
      lod: meta.lod,
      geom,
    });
  }
  for (const key of TEXT_KEYS) {
    const items = texts[key];
    if (!items?.length) continue;
    const spacing =
      key === "rwylbl" || key === "runlbl"
        ? 5.0
        : key === "twylbl"
          ? TWY_LABEL_SPACING_M
          : STD_LABEL_SPACING_M;
    const meta = LAYER_TABLE.find((l) => l.key === key)!;
    layers.push({
      id: key,
      style: meta.style,
      kind: meta.kind,
      lod: meta.lod,
      items: thin(items, spacing, kx),
    });
  }

  const ys: number[] = [];
  const xs: number[] = [];
  for (const lay of layers) {
    for (const it of lay.geom ?? []) {
      for (const [y, x] of Array.isArray(it) ? it : it.p) {
        ys.push(y);
        xs.push(x);
      }
    }
    for (const it of lay.items ?? []) {
      ys.push(it.p[0]);
      xs.push(it.p[1]);
    }
  }
  if (!ys.length) return { icao, airport: null, notes };

  return {
    icao,
    airport: {
      bounds: [
        Math.min(...ys),
        Math.min(...xs),
        Math.max(...ys),
        Math.max(...xs),
      ],
      layers,
    },
    notes,
  };
}

/**
 * `"02L/20R"` 里哪一头对着 way 的起点。
 *
 * 只有近似跑道时才用得上：OSM way 的方向是任意的，而编号本身就是航向除以十，
 * 拿起点→终点的真航向去比一下就知道哪个号在哪头（磁差十度以内，编号选不错）。
 */
function designators(
  ref: string | null | undefined,
  a: LatLon,
  b: LatLon,
  kx: number,
): [string, string] | null {
  if (!ref) return null;
  const parts = ref.split("/").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const nums = parts.map((p) => /^(\d{1,2})/.exec(p)?.[1]);
  if (!nums[0] || !nums[1]) return null;
  const brg =
    ((Math.atan2((b[1] - a[1]) * kx, b[0] - a[0]) * 180) / Math.PI + 360) % 360;
  const off = (n: string) => {
    const d = Math.abs(((((Number(n) * 10 - brg) % 360) + 540) % 360) - 180);
    return d;
  };
  return off(nums[0]) <= off(nums[1])
    ? [parts[0], parts[1]]
    : [parts[1], parts[0]];
}

// ---------------------------------------------------------------- world 图层

function rings(geometry: {
  type?: string;
  coordinates?: unknown;
}): number[][][] {
  const c = geometry.coordinates as number[][][] | number[][][][] | undefined;
  if (!c) return [];
  if (geometry.type === "Polygon") return c as number[][][];
  if (geometry.type === "MultiPolygon") {
    return (c as number[][][][]).flat();
  }
  return [];
}

/**
 * `NavData/*.geojson` → 一层边界线。merge.py 的 `_world_layer`，**连它把
 * `kx=cos(36°)` 当纬度传给 `dp()` 那一处也照抄** —— 那个值决定抽稀的精度，改
 * 掉这里就和真正装机的 ground.json 差出几十米来。
 */
export function buildWorldLayer(
  fc: unknown,
  which: "acc" | "tracon",
  icaos: Set<string>,
): MapLayer | null {
  const features = ((fc as { features?: unknown[] })?.features ?? []) as {
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }[];
  if (!features.length) return null;

  const pick = (p: Record<string, unknown>): string | null => {
    if (which === "acc") {
      return p.division === "VATPRC" ? ((p.id as string) ?? null) : null;
    }
    const prefixes = (p.prefix as unknown[] | undefined) ?? [];
    if (!icaos.size) {
      return prefixes.some((x) => String(x).startsWith("Z"))
        ? ((p.id as string) ?? null)
        : null;
    }
    return prefixes.some((x) => icaos.has(String(x)))
      ? ((p.id as string) ?? null)
      : null;
  };

  const kx = Math.cos(rad(36.0));
  const geom: Geometry[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const name = pick(f.properties ?? {});
    if (!name || seen.has(name)) continue;
    seen.add(name);
    for (const r of rings(f.geometry ?? {})) {
      const pts = r.map((p) => [p[1], p[0]] as LatLon); // geojson 是 lon,lat
      const q = dp(pts, WORLD_TOL_M, kx);
      if (
        q.length &&
        (q[0][0] !== q[q.length - 1][0] || q[0][1] !== q[q.length - 1][1])
      ) {
        q.push(q[0]);
      }
      if (q.length >= 3) geom.push(q.map(([y, x]) => [r6(y), r6(x)] as LatLon));
    }
  }
  if (!geom.length) return null;

  return which === "acc"
    ? { id: "acc", style: "accbound", kind: "line", lod: [0, 9999], geom }
    : { id: "tracon", style: "traconbound", kind: "line", lod: [0, 150], geom };
}

// ---------------------------------------------------------------- 认文件

export type FileKind =
  | "ground"
  | "source"
  | "style"
  | "boundaries"
  | "tracon"
  | "sct"
  | "stands"
  | "ese";

/**
 * 拖进来的是什么？**只看内容，不看扩展名** —— `.json` 这一个后缀底下装着四种
 * 完全不同的东西（合并产物、每机场源文件、样式、边界 GeoJSON），而扇区文件和
 * 站位表又都是以 `;` 注释开头的纯文本。
 */
export function classify(_name: string, text: string): FileKind | null {
  if (/\[RUNWAY\]/.test(text) && /\[AIRPORT\]/.test(text)) return "sct";
  if (/^STAND:/m.test(text)) return "stands";
  // .ese 认 [FREETEXT]/[POSITIONS]；它没有 [RUNWAY]/[AIRPORT]，和 .sct 不会撞
  if (/\[FREETEXT\]/.test(text) || /\[POSITIONS\]/.test(text)) return "ese";

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(doc)) {
    const first = doc.find((e) => e && typeof e === "object") as
      | Record<string, unknown>
      | undefined;
    return first && "g" in first ? "source" : null;
  }
  if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    if (o.airports && typeof o.airports === "object") return "ground";
    if (o.colors && o.layers) return "style";
    if (o.type === "FeatureCollection") {
      const feats =
        (o.features as { properties?: Record<string, unknown> }[]) ?? [];
      return feats.some((f) => f?.properties && "prefix" in f.properties)
        ? "tracon"
        : "boundaries";
    }
  }
  return null;
}

/** 文件名去掉目录和扩展名 —— 每机场文件的 ICAO 只写在文件名上。 */
export function icaoFromName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.json$/i, "").toUpperCase();
}
