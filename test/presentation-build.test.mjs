import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "../server.mjs";

test("isolated public build fails closed on unreviewed financial bytes and malformed agent data", async () => {
  const root = await mkdtemp(join(tmpdir(), "portfolio-public-build-"));
  try {
    for (const name of [
      "build.mjs",
      "package.json",
      "index.html",
      "styles.css",
      "app.js",
      "chart.js",
      "favicon.svg",
      "admin",
      "portfolio",
    ]) {
      await cp(new URL("../" + name, import.meta.url), join(root, name), {
        recursive: true,
      });
    }
    const build = () =>
      spawnSync(process.execPath, ["build.mjs"], {
        cwd: root,
        encoding: "utf8",
      });
    assert.equal(build().status, 0);
    const dataPath = join(root, "portfolio/cash-map.json"),
      reviewPath = join(root, "portfolio/cash-map-review.json");
    const original = await readFile(dataPath, "utf8");
    await writeFile(dataPath, original + " ");
    assert.notEqual(
      build().status,
      0,
      "Even arithmetic-valid bytes need a matching review",
    );
    const bad = JSON.parse(original);
    bad.companies[0].cash_remaining = "100";
    const raw = JSON.stringify(bad),
      review = JSON.parse(await readFile(reviewPath, "utf8"));
    review.dataset_sha256 = createHash("sha256").update(raw).digest("hex");
    await writeFile(dataPath, raw);
    await writeFile(reviewPath, JSON.stringify(review));
    assert.notEqual(
      build().status,
      0,
      "A matching review hash cannot bypass arithmetic",
    );
    await writeFile(dataPath, original);
    review.dataset_sha256 = createHash("sha256").update(original).digest("hex");
    await writeFile(reviewPath, JSON.stringify(review));
    const statePath = join(root, "portfolio/agent-state.json"),
      state = JSON.parse(await readFile(statePath, "utf8"));
    state.private_draft = "DO_NOT_PUBLISH";
    await writeFile(statePath, JSON.stringify(state));
    assert.notEqual(
      build().status,
      0,
      "Extra private fields cannot enter a checkpoint",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static server serves public explorer inputs and denies private or review files", async () => {
  let origin;
  const server = createServer(
    () => {
      throw new Error("No API calls expected");
    },
    { origin: "http://localhost" },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  try {
    for (const path of [
      "/portfolio/explorer.js",
      "/portfolio/agent.js",
      "/portfolio/project.css",
      "/portfolio/cash-map.json",
      "/portfolio/agent-state.json",
    ]) {
      // createServer requires its configured origin; Host does not change URL origin validation.
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
    }
    for (const path of [
      "/portfolio/cash-map-review.json",
      "/.env",
      "/.data/credentials.json",
      "/portfolio/private.json",
    ])
      assert.equal((await fetch(origin + path)).status, 404, path);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
