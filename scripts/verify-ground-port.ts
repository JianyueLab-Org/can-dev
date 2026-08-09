/**
 * 证明 `/ground` 的合并和 `Ground/tools/merge.py` 是同一件事。
 *
 * `src/lib/groundMap.ts` 是 merge.py 的第二份实现，而两个源头都不在这个仓库
 * 里 —— Ground 在 Gitea，扇区包在 GitHub，这个站的 CI 一个都看不见。所以对不
 * 对得上不能靠自觉：这个脚本拿真实的每机场文件跑一遍 TS 版，和扇区包里已经合
 * 并好、正在管制员机器上跑的 `ground.json` 逐字节比。
 *
 * **不在 CI 里**（CI 的机器上没有那两个仓库），改过 `groundMap.ts` 或者改过
 * merge.py 之后手工跑一次：
 *
 *   GROUND_REPO=~/Documents/Dev/CeruleanAviationNetwork/Ground \
 *   SECTOR_REPO=~/Documents/Dev/CeruleanAviationNetwork/Sector \
 *   bun run scripts/verify-ground-port.ts
 *
 * 退出码非零就是漂了。差异会打印出第一处不同的位置 —— 通常是某个常量，或者
 * merge.py 那边加了一层而这边没跟。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAirportFromSource,
  buildWorldLayer,
  parseSct,
  parseStands,
  type SourceFeature,
} from "../src/lib/groundMap";

// 默认按开发单体仓库的布局找同级的两个仓库；单独克隆 can-dev 时用环境变量指
const here = fileURLToPath(new URL(".", import.meta.url));
const GROUND = process.env.GROUND_REPO ?? join(here, "../../Ground");
const SECTOR = process.env.SECTOR_REPO ?? join(here, "../../Sector");

/** FIR -> 扇区文件名。PRC_FSS 的扇区文件不叫它自己的名字。 */
const FIRS: Record<string, string> = {
  ZBPE: "ZBPE.sct",
  ZGZU: "ZGZU.sct",
  ZHWH: "ZHWH.sct",
  ZJSA: "ZJSA.sct",
  ZLHW: "ZLHW.sct",
  ZPKM: "ZPKM.sct",
  ZSHA: "ZSHA.sct",
  ZWUQ: "ZWUQ.sct",
  ZYSH: "ZYSH.sct",
  PRC_FSS: "FSS.sct",
};

const read = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p));

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const at = Math.max(i - 50, 0);
  return `第 ${i} 字节：\n    本地 …${a.slice(at, i + 90)}\n    产物 …${b.slice(at, i + 90)}`;
}

let checked = 0;
let failed = 0;

for (const [fir, sctName] of Object.entries(FIRS)) {
  const groundJson = join(SECTOR, fir, "Plugins/GroundMap/ground.json");
  const airportsDir = join(GROUND, fir, "airports");
  if (!existsSync(groundJson)) {
    console.log(`${fir}: 扇区包里没有 ground.json，跳过`);
    continue;
  }
  const truth = json(groundJson);
  const runways = existsSync(join(SECTOR, fir, sctName))
    ? parseSct(read(join(SECTOR, fir, sctName)))
    : {};
  const standsPath = join(SECTOR, fir, "Plugins/GRplugin/GRpluginStands.txt");
  const stands = existsSync(standsPath) ? parseStands(read(standsPath)) : {};

  const files = existsSync(airportsDir)
    ? readdirSync(airportsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

  let same = 0;
  for (const file of files) {
    const icao = file.slice(0, -5);
    const els = json(join(airportsDir, file)) as SourceFeature[];
    // `?? []` 而不是 `undefined`：扇区文件在，只是这个场没有跑道行
    const { airport } = buildAirportFromSource(
      icao,
      els,
      runways[icao] ?? [],
      stands[icao] ?? [],
    );
    const want = truth.airports?.[icao];
    checked++;
    const mine = JSON.stringify(airport);
    const theirs = JSON.stringify(want ?? null);
    if (mine === theirs) {
      same++;
      continue;
    }
    failed++;
    console.log(`\n[x] ${fir}/${icao} 对不上\n  ${firstDiff(mine, theirs)}`);
  }

  // world 图层：边界 geojson 在 Ground 里，产物在扇区包里
  const icaos = new Set(Object.keys(truth.airports ?? {}));
  for (const [which, srcFile] of [
    ["acc", "boundaries.geojson"],
    ["tracon", "tracon.geojson"],
  ] as const) {
    const src = join(GROUND, "NavData", srcFile);
    if (!existsSync(src)) continue;
    const mine = JSON.stringify(buildWorldLayer(json(src), which, icaos));
    const theirs = JSON.stringify(
      (truth.world ?? []).find((w: { id: string }) => w.id === which) ?? null,
    );
    checked++;
    if (mine === theirs) {
      same++;
      continue;
    }
    failed++;
    console.log(
      `\n[x] ${fir}/world:${which} 对不上\n  ${firstDiff(mine, theirs)}`,
    );
  }

  console.log(`${fir}: ${same} 处相同，${files.length + 2} 处检查`);
}

console.log(
  failed
    ? `\n[x] ${checked} 处检查，${failed} 处和 merge.py 的产物不同`
    : `\n[ok] ${checked} 处检查全部逐字节相同`,
);
process.exit(failed ? 1 : 0);
