/** The engine's single-flight guard: concurrent callers collapse onto one run. */

import { describe, expect, test } from "bun:test";
import { SingleFlight } from "../src/wow/utils/SingleFlight";

describe("SingleFlight", () => {
  test("concurrent callers share one run", async () => {
    const flight = new SingleFlight<number>();
    let runs = 0;
    const start = async (): Promise<number> => {
      runs += 1;
      await Promise.resolve();
      return 42;
    };
    const [a, b, c] = await Promise.all([flight.run(start), flight.run(start), flight.run(start)]);
    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(runs).toBe(1);
  });

  test("after the run settles, the next caller starts a new one", async () => {
    const flight = new SingleFlight<number>();
    let runs = 0;
    const start = async (): Promise<number> => {
      runs += 1;
      return runs;
    };
    expect(await flight.run(start)).toBe(1);
    expect(await flight.run(start)).toBe(2);
  });

  test("a failed run is not cached: the next caller tries again", async () => {
    const flight = new SingleFlight<number>();
    let runs = 0;
    const failing = async (): Promise<number> => {
      runs += 1;
      if (runs === 1) throw new Error("boom");
      return runs;
    };
    await expect(flight.run(failing)).rejects.toThrow("boom");
    expect(await flight.run(failing)).toBe(2);
  });
});
