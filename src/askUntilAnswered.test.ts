/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { askUntilAnswered } from "./askUntilAnswered";

const never = () => new Promise<string>(() => {});
const opts = { timeoutMs: 10, attempts: 3 };

describe("askUntilAnswered", () => {
  test("a prompt answer is returned at once", async () => {
    let calls = 0;
    expect(await askUntilAnswered(async () => (calls++, "ok"), opts)).toBe("ok");
    expect(calls).toBe(1);
  });

  test("an unanswered call is asked again", async () => {
    let calls = 0;
    const answer = await askUntilAnswered(
      () => (calls++ === 0 ? never() : Promise.resolve("ok")),
      opts,
    );
    expect(answer).toBe("ok");
    expect(calls).toBe(2);
  });

  test("gives up after the last unanswered try", async () => {
    let calls = 0;
    await expect(askUntilAnswered(() => (calls++, never()), opts)).rejects.toThrow(
      "no answer after 3 tries",
    );
    expect(calls).toBe(3);
  });

  test("a failure is not retried", async () => {
    let calls = 0;
    const failing = () => (calls++, Promise.reject(new Error("engine down")));
    await expect(askUntilAnswered(failing, opts)).rejects.toThrow("engine down");
    expect(calls).toBe(1);
  });
});
