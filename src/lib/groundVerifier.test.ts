import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));

function fixture(run: (ground: string, sector: string) => void) {
  const scratch = join(repo, ".temp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "ground-verifier-"));
  const ground = join(root, "Ground");
  const sector = join(root, "Sector");
  mkdirSync(join(ground, "ZBPE/airports"), { recursive: true });
  // Synthetic geometry, not navigation data. An absent output airport must fail.
  writeFileSync(
    join(ground, "ZBPE/airports/ZAAA.json"),
    JSON.stringify([{ a: "stand_label", r: "A1", g: [[0, 0]] }]),
  );
  try {
    run(ground, sector);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function artifact(sector: string, plugin: string, content = '{"airports":{}}') {
  const directory = join(sector, "ZBPE/Plugins", plugin);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "ground.json"), content);
}

function verify(ground: string, sector: string) {
  const result = spawnSync("bun", ["run", "scripts/verify-ground-port.ts"], {
    cwd: repo,
    env: { ...process.env, GROUND_REPO: ground, SECTOR_REPO: sector },
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

for (const plugin of ["GroundMap", "CANGroundRender"]) {
  test(`reports mismatched airport geometry in ${plugin}`, () => {
    fixture((ground, sector) => {
      artifact(sector, plugin);
      const result = verify(ground, sector);
      expect(result.status).toBe(1);
      expect(result.output).toContain("ZBPE/ZAAA 对不上");
    });
  });
}

test("reads the live renderer instead of a stale legacy artifact", () => {
  fixture((ground, sector) => {
    artifact(sector, "CANGroundRender");
    artifact(sector, "GroundMap", "invalid stale artifact");
    const result = verify(ground, sector);
    expect(result.status).toBe(1);
    expect(result.output).toContain("ZBPE/ZAAA 对不上");
    expect(result.output).not.toContain("SyntaxError");
  });
});

test("does not fall back when the selected renderer has no artifact", () => {
  fixture((ground, sector) => {
    mkdirSync(join(sector, "ZBPE/Plugins/CANGroundRender"), {
      recursive: true,
    });
    artifact(sector, "GroundMap");
    const result = verify(ground, sector);
    expect(result.status).toBe(1);
    expect(result.output).toContain("ZBPE/Plugins/CANGroundRender/ground.json");
    expect(result.output).not.toContain("ZBPE/ZAAA 对不上");
  });
});
