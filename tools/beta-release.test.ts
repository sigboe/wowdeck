import { describe, expect, test } from "bun:test";
import { betasToPrune, nextBetaVersion, previousBeta } from "./beta-release";

describe("nextBetaVersion", () => {
  test("bumps the newest stable tag's patch and appends the run number", () => {
    expect(nextBetaVersion(["v0.2.0", "v0.3.0", "v0.1.4"], 57)).toBe("0.3.1-beta.57");
  });

  test("orders stable tags numerically, not as text", () => {
    expect(nextBetaVersion(["v0.9.0", "v0.10.0"], 3)).toBe("0.10.1-beta.3");
  });

  test("starts from 0.0.0 when no stable tag exists yet", () => {
    expect(nextBetaVersion([], 1)).toBe("0.0.1-beta.1");
    expect(nextBetaVersion(["v0.0.1-beta.1"], 2)).toBe("0.0.1-beta.2");
  });

  test("ignores existing betas and other pre-releases when choosing the base", () => {
    const tags = ["v0.3.0", "v0.3.1-beta.55", "v0.3.1-beta.56", "v0.4.0-rc1", "v9.9.9-beta.1"];
    expect(nextBetaVersion(tags, 57)).toBe("0.3.1-beta.57");
  });
});

describe("betasToPrune", () => {
  test("keeps the newest three betas and selects the older ones, newest first", () => {
    const tags = [
      "v0.3.1-beta.54",
      "v0.3.1-beta.57",
      "v0.3.1-beta.55",
      "v0.3.1-beta.58",
      "v0.3.1-beta.56",
    ];
    expect(betasToPrune(tags)).toEqual(["v0.3.1-beta.55", "v0.3.1-beta.54"]);
  });

  test("selects nothing while three or fewer betas exist", () => {
    expect(betasToPrune(["v0.3.1-beta.1", "v0.3.1-beta.2", "v0.3.1-beta.3"])).toEqual([]);
    expect(betasToPrune([])).toEqual([]);
  });

  test("orders betas by version, so a beta after a new stable outranks a higher run on the old base", () => {
    const tags = ["v0.3.1-beta.9", "v0.3.1-beta.10", "v0.4.1-beta.2", "v0.4.1-beta.3"];
    expect(betasToPrune(tags)).toEqual(["v0.3.1-beta.9"]);
  });

  test("never selects a stable tag or any other non-beta tag, even when given one", () => {
    const tags = [
      "v0.1.0",
      "v0.2.0",
      "v1.0.0-rc1",
      "v0.3.1-beta.1",
      "v0.3.1-beta.2",
      "v0.3.1-beta.3",
      "v0.3.1-beta.4",
      "v0.3.0",
    ];
    expect(betasToPrune(tags)).toEqual(["v0.3.1-beta.1"]);
    expect(betasToPrune(["v0.1.0", "v0.2.0", "v0.3.0", "v0.4.0", "v0.5.0"])).toEqual([]);
  });

  test("ignores tags with leading zeros, as tools/version.py would reject them", () => {
    const tags = ["v0.3.1-beta.01", "v0.3.1-beta.1", "v0.3.1-beta.2", "v0.3.1-beta.3"];
    expect(betasToPrune(tags)).toEqual([]);
    expect(nextBetaVersion(["v0.3.0", "v0.03.0"], 1)).toBe("0.3.1-beta.1");
  });
});

describe("previousBeta", () => {
  test("is the newest beta tag, ignoring stable tags", () => {
    expect(previousBeta(["v0.3.1-beta.56", "v0.4.0", "v0.3.1-beta.57", "v0.3.0"])).toBe(
      "v0.3.1-beta.57",
    );
  });

  test("is null before the first beta", () => {
    expect(previousBeta(["v0.3.0"])).toBeNull();
  });
});

describe("command line", () => {
  async function run(args: string[], stdin: string): Promise<{ out: string; code: number }> {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/beta-release.ts`, ...args], {
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    return { out, code: await proc.exited };
  }

  test("next-version reads tags from stdin", async () => {
    expect(await run(["next-version", "57"], "v0.2.0\nv0.3.0\n")).toEqual({
      out: "0.3.1-beta.57\n",
      code: 0,
    });
  });

  test("prune prints one tag per line", async () => {
    const tags =
      "v0.3.0\nv0.3.1-beta.1\nv0.3.1-beta.2\nv0.3.1-beta.3\nv0.3.1-beta.4\nv0.3.1-beta.5\n";
    expect(await run(["prune"], tags)).toEqual({ out: "v0.3.1-beta.2\nv0.3.1-beta.1\n", code: 0 });
  });

  test("previous-beta prints nothing before the first beta", async () => {
    expect(await run(["previous-beta"], "v0.3.0\n")).toEqual({ out: "", code: 0 });
  });

  test("rejects a run number that is not a positive integer", async () => {
    expect((await run(["next-version", "abc"], "")).code).toBe(1);
  });
});
