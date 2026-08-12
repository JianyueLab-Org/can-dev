<script setup lang="ts">
/**
 * 地面图预览 —— 把 Ground 仓库的 json 按地面插件的画法画出来。
 *
 * **整件事发生在浏览器里，文件不上传，也没有一个后端路由**。这是有意的：地面
 * 数据跟着扇区包走，不属于这个站，而这个站是公开的 —— 一个"传上来我帮你渲染"
 * 的按钮，等于让还没发布的扇区数据落到服务器上。顺带的好处是它不需要登录，
 * 画图的人不必先是这里的成员。
 *
 * 两条路进来，走的是同一个渲染器：
 *
 * - **合并产物** `Sector/<FIR>/Plugins/GroundMap/ground.json`：插件读什么就画
 *   什么，一比一。
 * - **每机场源文件** `Ground/<FIR>/airports/<ICAO>.json`：先在浏览器里跑一遍
 *   `merge.py`（`lib/groundMap.ts`），再画。手工改完一个机场，拖进来就能看，
 *   不用先合并再开 EuroScope。
 *
 * 源文件这条路上，跑道头和机位号本来在扇区包那边（`.sct` 的 `[RUNWAY]` 和
 * `GRpluginStands.txt`）。两份文件一起拖进来就和 merge.py 走同一条路；不拖也
 * 能看，但跑道是拿 OSM 中心线两端撑出来的 —— 那时候上面会挂一条提示，预览可
 * 以近似，但不能让人以为那就是装机的样子。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import AlertBox from "@/components/ui/AlertBox.vue";
import Icon from "@/components/ui/Icon.vue";
import {
  buildAirportFromSource,
  buildWorldLayer,
  classify,
  DEFAULT_STYLE_DOC,
  icaoFromName,
  parseSct,
  parseStands,
  parseEse,
  parseStyleSheet,
  type FileKind,
  type GroundDoc,
  type MapLayer,
  type SctRunway,
  type SourceFeature,
  type StandRow,
  type FreetextLabel,
} from "@/lib/groundMap";
import {
  docBounds,
  fitBounds,
  layerVisible,
  render,
  scaleForWidthNm,
  unproject,
  viewWidthNm,
  type RenderStats,
  type View,
  type Viewport,
} from "@/lib/groundRender";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

/** 背景色。插件自己不画背景，画在什么上面由雷达屏决定，所以这里给两档。 */
const BACKGROUNDS = [
  { key: "dark", value: "#000000" },
  { key: "topsky", value: "#98aaab" },
] as const;

const LAYER_ORDER = [
  "acc",
  "tracon",
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
  "rwylbl",
  "runlbl",
  "twylbl",
  "hldlbl",
  "stdlbl",
];

interface LoadedFile {
  name: string;
  kind: FileKind | null;
  detail: string;
}

const files = ref<LoadedFile[]>([]);
const sources = ref(new Map<string, SourceFeature[]>());
const merged = ref<GroundDoc[]>([]);
const sct = ref<Record<string, SctRunway[]> | null>(null);
const stands = ref<Record<string, StandRow[]> | null>(null);
const ese = ref<Record<string, FreetextLabel[]> | null>(null);
const styleDoc = ref<Record<string, unknown> | null>(null);
const geo = ref<{ boundaries?: unknown; tracon?: unknown }>({});
const rejected = ref<string[]>([]);

const only = ref<string | null>(null);
const hidden = ref(new Set<string>());
const background = ref<string>(BACKGROUNDS[0].value);
const view = ref<View | null>(null);
const cursor = ref<[number, number] | null>(null);
const stats = ref<RenderStats | null>(null);
const dragging = ref(false);
const dropping = ref(false);
const busy = ref(false);

const canvas = ref<HTMLCanvasElement | null>(null);
const frame = ref<HTMLElement | null>(null);
const viewport = ref<Viewport>({ width: 960, height: 560 });

const styles = computed(() =>
  parseStyleSheet(styleDoc.value ?? DEFAULT_STYLE_DOC),
);

/** 源文件走 merge.py 那条路：有扇区文件就用它，`[]` 和 `undefined` 不一样。 */
const built = computed(() => {
  const airports: GroundDoc["airports"] = {};
  const notes = { runwaysFromOsm: false, standNamesMissing: false };
  for (const [icao, els] of sources.value) {
    const b = buildAirportFromSource(
      icao,
      els,
      sct.value ? (sct.value[icao] ?? []) : undefined,
      stands.value ? (stands.value[icao] ?? []) : undefined,
      ese.value ? (ese.value[icao] ?? []) : undefined,
    );
    if (b.airport) airports[icao] = b.airport;
    notes.runwaysFromOsm ||= b.notes.runwaysFromOsm;
    notes.standNamesMissing ||= b.notes.standNamesMissing;
  }
  return { airports, notes };
});

const doc = computed<GroundDoc>(() => {
  const airports: GroundDoc["airports"] = {};
  const world = new Map<string, MapLayer>();
  for (const g of merged.value) {
    for (const [icao, ap] of Object.entries(g.airports)) airports[icao] = ap;
    for (const layer of g.world) world.set(layer.id, layer);
  }
  // 源文件盖过合并产物：正在改的那一份才是要看的那一份
  for (const [icao, ap] of Object.entries(built.value.airports)) {
    airports[icao] = ap;
  }
  const icaos = new Set(Object.keys(airports));
  if (geo.value.boundaries) {
    const l = buildWorldLayer(geo.value.boundaries, "acc", icaos);
    if (l) world.set(l.id, l);
  }
  if (geo.value.tracon) {
    const l = buildWorldLayer(geo.value.tracon, "tracon", icaos);
    if (l) world.set(l.id, l);
  }
  return { airports, world: [...world.values()] };
});

const icaos = computed(() => Object.keys(doc.value.airports).sort());
const empty = computed(() => !icaos.value.length && !doc.value.world.length);

/** 图层清单：id、样式名、LOD、图元数 —— 和 ASR 里的 `GroundMap_<id>` 一一对应。 */
const layers = computed(() => {
  const seen = new Map<
    string,
    { style: string; lod: [number, number]; count: number }
  >();
  const add = (l: MapLayer) => {
    const n = (l.geom?.length ?? 0) + (l.items?.length ?? 0);
    const prev = seen.get(l.id);
    if (prev) prev.count += n;
    else seen.set(l.id, { style: l.style, lod: l.lod, count: n });
  };
  for (const l of doc.value.world) add(l);
  for (const [icao, ap] of Object.entries(doc.value.airports)) {
    if (only.value && icao !== only.value) continue;
    for (const l of ap.layers) add(l);
  }
  const rank = (id: string) => {
    const i = LAYER_ORDER.indexOf(id);
    return i < 0 ? LAYER_ORDER.length : i;
  };
  return [...seen.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([id, v]) => ({
      id,
      ...v,
      lit: view.value
        ? layerVisible(
            { id, style: v.style, kind: "line", lod: v.lod },
            viewWidthNm(view.value, viewport.value),
          )
        : true,
    }));
});

const currentNm = computed(() =>
  view.value ? viewWidthNm(view.value, viewport.value) : 0,
);

// ---------------------------------------------------------------- 读文件

async function ingest(list: File[]) {
  if (!list.length) return;
  busy.value = true;
  const bad: string[] = [];
  for (const file of list) {
    try {
      const text = await file.text();
      const kind = classify(file.name, text);
      if (!kind) {
        bad.push(file.name);
        continue;
      }
      let detail = "";
      if (kind === "source") {
        const els = JSON.parse(text) as SourceFeature[];
        const icao = icaoFromName(file.name);
        sources.value.set(icao, els);
        detail = `${icao} · ${els.length}`;
      } else if (kind === "ground") {
        const g = JSON.parse(text) as GroundDoc;
        merged.value = [
          ...merged.value,
          { airports: g.airports ?? {}, world: g.world ?? [] },
        ];
        detail = String(Object.keys(g.airports ?? {}).length);
      } else if (kind === "style") {
        styleDoc.value = JSON.parse(text) as Record<string, unknown>;
      } else if (kind === "sct") {
        const rw = parseSct(text);
        sct.value = rw;
        detail = String(Object.keys(rw).length);
      } else if (kind === "ese") {
        // [FREETEXT] 里的等待点名称和跑道长度，没有别的来源
        const ft = parseEse(text);
        ese.value = ft;
        detail = String(Object.keys(ft).length);
      } else if (kind === "stands") {
        const st = parseStands(text);
        stands.value = st;
        detail = String(Object.keys(st).length);
      } else if (kind === "boundaries" || kind === "tracon") {
        geo.value = { ...geo.value, [kind]: JSON.parse(text) };
      }
      files.value = [
        ...files.value.filter((f) => f.name !== file.name),
        { name: file.name, kind, detail },
      ];
    } catch {
      // 一个文件坏了不该拖垮同一次拖进来的其它文件
      bad.push(file.name);
    }
  }
  // 源文件是响应式 Map，替换一次好让 computed 重算
  sources.value = new Map(sources.value);
  busy.value = false;
  rejected.value = bad;
  if (!view.value || !only.value) autoFocus();
}

function autoFocus() {
  const first = icaos.value[0] ?? null;
  only.value = first;
  fit();
}

function clearAll() {
  files.value = [];
  sources.value = new Map();
  merged.value = [];
  sct.value = null;
  stands.value = null;
  ese.value = null;
  styleDoc.value = null;
  geo.value = {};
  rejected.value = [];
  only.value = null;
  view.value = null;
  stats.value = null;
  hidden.value = new Set();
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  void ingest([...(input.files ?? [])]);
  input.value = "";
}

function onDrop(event: DragEvent) {
  dropping.value = false;
  void ingest([...(event.dataTransfer?.files ?? [])]);
}

// ---------------------------------------------------------------- 视野

function fit() {
  const b = docBounds(doc.value, only.value) ?? docBounds(doc.value, null);
  if (!b) {
    view.value = null;
    return;
  }
  view.value = fitBounds(b, viewport.value);
}

function clampNm(nm: number) {
  return Math.min(Math.max(nm, 0.05), 4000);
}

function zoomBy(factor: number, ax?: number, ay?: number) {
  const v = view.value;
  if (!v) return;
  const anchor =
    ax !== undefined && ay !== undefined
      ? unproject(v, viewport.value, ax, ay)
      : null;
  const nm = clampNm(viewWidthNm(v, viewport.value) / factor);
  const next: View = { ...v, scale: scaleForWidthNm(nm, viewport.value) };
  if (anchor) {
    const after = unproject(next, viewport.value, ax!, ay!);
    next.lat += anchor[0] - after[0];
    next.lon += anchor[1] - after[1];
  }
  view.value = next;
}

function setNm(value: number) {
  const v = view.value;
  if (!v || !Number.isFinite(value)) return;
  view.value = { ...v, scale: scaleForWidthNm(clampNm(value), viewport.value) };
}

function onWheel(event: WheelEvent) {
  if (!view.value) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  zoomBy(
    Math.exp(-event.deltaY * 0.0015),
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
}

let last: { x: number; y: number } | null = null;

function onPointerDown(event: PointerEvent) {
  if (!view.value) return;
  dragging.value = true;
  last = { x: event.clientX, y: event.clientY };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  const v = view.value;
  if (!v) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  cursor.value = unproject(
    v,
    viewport.value,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
  if (!dragging.value || !last) return;
  const dx = event.clientX - last.x;
  const dy = event.clientY - last.y;
  last = { x: event.clientX, y: event.clientY };
  const kx = Math.cos((v.lat * Math.PI) / 180);
  view.value = {
    ...v,
    lat: v.lat + dy / v.scale,
    lon: v.lon - dx / (kx * v.scale),
  };
}

function onPointerUp(event: PointerEvent) {
  dragging.value = false;
  last = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

function toggle(id: string) {
  const next = new Set(hidden.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  hidden.value = next;
}

// ---------------------------------------------------------------- 画

let pending = 0;

function schedule() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    draw();
  });
}

function draw() {
  const el = canvas.value;
  const v = view.value;
  if (!el) return;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = viewport.value;
  const w = Math.max(Math.round(width * dpr), 1);
  const h = Math.max(Math.round(height * dpr), 1);
  if (el.width !== w || el.height !== h) {
    el.width = w;
    el.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!v) {
    ctx.clearRect(0, 0, width, height);
    stats.value = null;
    return;
  }
  stats.value = render(ctx, viewport.value, doc.value, styles.value, v, {
    background: background.value,
    hidden: hidden.value,
    only: only.value,
  });
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  const el = frame.value;
  if (!el) return;
  observer = new ResizeObserver(() => {
    const rect = el.getBoundingClientRect();
    viewport.value = {
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
    };
  });
  observer.observe(el);
  const rect = el.getBoundingClientRect();
  viewport.value = {
    width: Math.max(rect.width, 1),
    height: Math.max(rect.height, 1),
  };
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (pending) cancelAnimationFrame(pending);
});

watch(
  [doc, styles, view, hidden, only, background, viewport],
  () => schedule(),
  { deep: false },
);

watch(only, () => fit());
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <!-- 画布。整块都是投放区，拖到哪儿都收。 -->
    <div
      class="card relative overflow-hidden p-0"
      @dragover.prevent="dropping = true"
      @dragleave="dropping = false"
      @drop.prevent="onDrop"
    >
      <div
        ref="frame"
        class="relative h-[26rem] w-full sm:h-[34rem] lg:h-[38rem]"
      >
        <canvas
          ref="canvas"
          role="img"
          :aria-label="t('canvasLabel')"
          class="block h-full w-full touch-none"
          :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @pointerleave="cursor = null"
        ></canvas>

        <!-- 空状态：说清楚它吃哪些文件，以及它们在仓库里的位置 -->
        <div
          v-if="empty"
          class="absolute inset-0 flex items-center justify-center bg-surface p-6"
        >
          <div class="max-w-lg text-center">
            <Icon name="mapPin" class="mx-auto size-8 text-faint" />
            <p class="mt-3 font-semibold text-ink">{{ t("empty.title") }}</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">
              {{ t("empty.detail") }}
            </p>
            <ul class="mt-4 space-y-1 text-left text-xs text-muted">
              <li
                v-for="k in [
                  'source',
                  'ground',
                  'sct',
                  'stands',
                  'style',
                  'geo',
                ]"
                :key="k"
              >
                <code class="text-faint">{{ t(`empty.paths.${k}.path`) }}</code>
                — {{ t(`empty.paths.${k}.what`) }}
              </li>
            </ul>
            <label class="btn btn-primary mt-5 cursor-pointer">
              {{ t("pick") }}
              <input type="file" multiple class="sr-only" @change="onPick" />
            </label>
            <p class="mt-3 text-xs text-faint">{{ t("local") }}</p>
          </div>
        </div>

        <!-- 拖拽反馈 -->
        <div
          v-else-if="dropping"
          class="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/80 text-sm font-semibold text-ink"
        >
          {{ t("drop") }}
        </div>

        <!-- 读数：视野宽度就是 LOD 的判据，光标坐标是手改 json 时要抄的东西 -->
        <div
          v-if="!empty && view"
          class="pointer-events-none absolute bottom-2 left-2 rounded-control bg-surface-overlay/90 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted shadow-card"
        >
          <div>{{ t("hud.width", { nm: currentNm.toFixed(2) }) }}</div>
          <div v-if="cursor">
            {{ cursor[0].toFixed(6) }}, {{ cursor[1].toFixed(6) }}
          </div>
        </div>

        <div v-if="!empty" class="absolute right-2 top-2 flex gap-1">
          <button
            type="button"
            class="btn btn-secondary size-8 p-0 text-base"
            :aria-label="t('view.zoomIn')"
            @click="zoomBy(1.6)"
          >
            +
          </button>
          <button
            type="button"
            class="btn btn-secondary size-8 p-0 text-base"
            :aria-label="t('view.zoomOut')"
            @click="zoomBy(1 / 1.6)"
          >
            −
          </button>
          <button
            type="button"
            class="btn btn-secondary h-8 px-3 text-xs"
            @click="fit()"
          >
            {{ t("view.fit") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 侧栏 -->
    <div class="flex flex-col gap-4">
      <div v-if="rejected.length">
        <AlertBox variant="warning">
          {{ t("errors.rejected", { names: rejected.join("、") }) }}
        </AlertBox>
      </div>

      <AlertBox v-if="built.notes.runwaysFromOsm" variant="info">
        {{ t("notes.runwaysFromOsm") }}
      </AlertBox>
      <AlertBox v-else-if="built.notes.standNamesMissing" variant="info">
        {{ t("notes.standNamesMissing") }}
      </AlertBox>

      <!-- 文件 -->
      <section class="card p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-ink">{{ t("files.title") }}</h2>
          <button
            v-if="files.length"
            type="button"
            class="btn btn-ghost h-7 px-2 text-xs"
            @click="clearAll()"
          >
            {{ t("files.clear") }}
          </button>
        </div>
        <ul v-if="files.length" class="mt-3 space-y-1.5">
          <li
            v-for="f in files"
            :key="f.name"
            class="flex items-center gap-2 text-xs"
          >
            <span
              class="badge-info shrink-0 rounded-control px-1.5 py-0.5 text-[10px] font-semibold"
            >
              {{ t(`kinds.${f.kind}`) }}
            </span>
            <span class="min-w-0 flex-1 truncate text-muted" :title="f.name">
              {{ f.name }}
            </span>
            <span v-if="f.detail" class="shrink-0 font-mono text-faint">
              {{ f.detail }}
            </span>
          </li>
        </ul>
        <p v-else class="mt-2 text-xs text-muted">{{ t("files.empty") }}</p>
        <label class="btn btn-secondary mt-3 w-full cursor-pointer text-xs">
          <span v-if="busy">{{ t("busy") }}</span>
          <span v-else>{{ t("files.add") }}</span>
          <input type="file" multiple class="sr-only" @change="onPick" />
        </label>
      </section>

      <!-- 视野 -->
      <section v-if="!empty" class="card p-4">
        <h2 class="text-sm font-semibold text-ink">{{ t("view.title") }}</h2>

        <label class="mt-3 block text-xs font-medium text-muted">
          {{ t("view.airport") }}
          <select v-model="only" class="input mt-1 w-full text-sm">
            <option :value="null">{{ t("view.allAirports") }}</option>
            <option v-for="icao in icaos" :key="icao" :value="icao">
              {{ icao }}
            </option>
          </select>
        </label>
        <p class="mt-1 text-[11px] leading-relaxed text-faint">
          {{ t("view.airportHint") }}
        </p>

        <label class="mt-3 block text-xs font-medium text-muted">
          {{ t("view.width") }}
          <input
            class="input mt-1 w-full text-sm"
            type="number"
            min="0.05"
            max="4000"
            step="0.5"
            :value="currentNm.toFixed(2)"
            @change="setNm(Number(($event.target as HTMLInputElement).value))"
          />
        </label>

        <div class="mt-3 text-xs font-medium text-muted">
          {{ t("view.background") }}
          <div class="mt-1 flex items-center gap-1">
            <button
              v-for="b in BACKGROUNDS"
              :key="b.key"
              type="button"
              class="btn h-8 flex-1 px-2 text-[11px]"
              :class="background === b.value ? 'btn-primary' : 'btn-secondary'"
              @click="background = b.value"
            >
              {{ t(`view.backgrounds.${b.key}`) }}
            </button>
            <input
              v-model="background"
              type="color"
              class="h-8 w-10 shrink-0 cursor-pointer rounded-control border border-subtle bg-surface"
              :aria-label="t('view.backgrounds.custom')"
            />
          </div>
        </div>

        <dl
          v-if="stats"
          class="mt-4 grid grid-cols-3 gap-2 border-t border-subtle pt-3 text-center"
        >
          <div>
            <dt class="text-[11px] text-faint">{{ t("stats.airports") }}</dt>
            <dd class="font-mono text-sm text-ink">{{ stats.airports }}</dd>
          </div>
          <div>
            <dt class="text-[11px] text-faint">{{ t("stats.layers") }}</dt>
            <dd class="font-mono text-sm text-ink">{{ stats.layers }}</dd>
          </div>
          <div>
            <dt class="text-[11px] text-faint">{{ t("stats.elements") }}</dt>
            <dd class="font-mono text-sm text-ink">{{ stats.elements }}</dd>
          </div>
        </dl>
      </section>

      <!-- 图层开关。对应 ASR 里的 GroundMap_<id>，LOD 挡住的那些照样列出来。 -->
      <section v-if="layers.length" class="card p-4">
        <h2 class="text-sm font-semibold text-ink">{{ t("layers.title") }}</h2>
        <p class="mt-1 text-[11px] leading-relaxed text-faint">
          {{ t("layers.hint") }}
        </p>
        <ul class="mt-3 space-y-1">
          <li v-for="l in layers" :key="l.id">
            <label
              class="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-xs hover:bg-surface-sunken"
              :class="l.lit ? '' : 'opacity-50'"
            >
              <input
                type="checkbox"
                class="size-3.5"
                :checked="!hidden.has(l.id)"
                @change="toggle(l.id)"
              />
              <span class="min-w-0 flex-1 truncate text-ink">
                {{ t(`layers.names.${l.id}`) }}
                <code class="ml-1 text-faint">{{ l.id }}</code>
              </span>
              <span class="shrink-0 font-mono text-[10px] text-faint">
                {{ l.lod[0] }}–{{ l.lod[1] }}
              </span>
            </label>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
