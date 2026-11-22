import { expect, test } from "bun:test";
import { hookObserverRender } from "./observerRender";

/**
 * A class shaped like a mobx-react v9 observer on the Deck (Steam's
 * libraries bundle, 2026-11-18): the prototype `render` defines the
 * instance's own reactive `render` on first call, non-writable and
 * non-configurable, then calls it.
 */
function observerClass() {
  let renders = 0;
  class Observed {
    label = "Play";
    render(): unknown {
      const original = function (this: Observed) {
        renders += 1;
        return { tree: this.label };
      };
      Object.defineProperty(this, "render", {
        configurable: false,
        writable: false,
        value: function reactive(this: Observed) {
          return original.call(this);
        },
      });
      return this.render();
    }
  }
  return { Observed, renders: () => renders };
}

const wrapTree = (_instance: unknown, tree: unknown) => ({ wrapped: tree });

test("an instance rendered after the hook is wrapped on every render", () => {
  const { Observed, renders } = observerClass();
  hookObserverRender(Observed, wrapTree);
  const instance = new Observed();
  expect(instance.render()).toEqual({ wrapped: { tree: "Play" } });
  instance.label = "Resume";
  expect(instance.render()).toEqual({ wrapped: { tree: "Resume" } });
  expect(renders()).toBe(2);
});

test("the instance's own render stays locked the way mobx made it", () => {
  const { Observed } = observerClass();
  hookObserverRender(Observed, wrapTree);
  const instance = new Observed();
  instance.render();
  const own = Object.getOwnPropertyDescriptor(instance, "render");
  expect(own?.writable).toBe(false);
  expect(own?.configurable).toBe(false);
});

test("an instance that rendered before the hook can't be wrapped and reports it", () => {
  const { Observed } = observerClass();
  const early = new Observed();
  early.render();
  const hook = hookObserverRender(Observed, wrapTree);
  expect(hook.isHooked(early)).toBe(false);
  expect(early.render()).toEqual({ tree: "Play" });
  const late = new Observed();
  late.render();
  expect(hook.isHooked(late)).toBe(true);
});

test("Object.defineProperty is restored, also when the render throws", () => {
  const define = Object.defineProperty;
  class Throws {
    render(): unknown {
      throw new Error("boom");
    }
  }
  hookObserverRender(Throws, wrapTree);
  expect(() => new Throws().render()).toThrow("boom");
  expect(Object.defineProperty).toBe(define);
});

test("a class without the observer's own render is wrapped through the prototype", () => {
  class Plain {
    render(): unknown {
      return "plain";
    }
  }
  const hook = hookObserverRender(Plain, wrapTree);
  const instance = new Plain();
  expect(instance.render()).toEqual({ wrapped: "plain" });
  expect(instance.render()).toEqual({ wrapped: "plain" });
  expect(hook.isHooked(instance)).toBe(true);
});

test("an own render the hook didn't catch leaves that instance Steam's", () => {
  class Assigns {
    render(): unknown {
      const own = () => "steam";
      Reflect.defineProperty(this, "render", { value: own, writable: false, configurable: false });
      return own();
    }
  }
  const hook = hookObserverRender(Assigns, wrapTree);
  const instance = new Assigns();
  expect(instance.render()).toBe("steam");
  expect(instance.render()).toBe("steam");
  expect(hook.isHooked(instance)).toBe(false);
});

test("unhook restores the prototype; instances made afterwards stay Steam's", () => {
  const { Observed } = observerClass();
  const hook = hookObserverRender(Observed, wrapTree);
  hook.unhook();
  expect(new Observed().render()).toEqual({ tree: "Play" });
});
