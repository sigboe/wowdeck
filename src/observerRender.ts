/**
 * Wrap the render of a mobx-react observer class component, for instances
 * that haven't rendered yet.
 *
 * mobx-react v9 (Steam's bundle, LIVE on the Deck 2026-11-18) replaces the
 * class's prototype `render` with an installer: on an instance's first
 * render it defines that instance's own reactive `render` with
 * `writable: false, configurable: false`, then calls it. After that nothing
 * can replace an instance's render. So the hook replaces the installer and,
 * for the length of that one synchronous call, intercepts its
 * `Object.defineProperty(this, "render", …)` to wrap the reactive render as
 * it is defined. The reaction mobx tracks stays the one it made: its admin
 * state is keyed by the instance, not by the render function.
 *
 * An instance that rendered before the hook can't be wrapped (`isHooked`
 * says so); it has to remount. A class without the installer is wrapped
 * through its prototype on every render.
 */

type Render = (this: object) => unknown;

export interface ObserverRenderHook {
  /** Whether this instance's renders go through the wrapper. */
  isHooked(instance: object): boolean;
  /** Restore the class's own prototype render. Hooked instances keep their wrapper. */
  unhook(): void;
}

export function hookObserverRender(
  cls: { prototype: object },
  wrap: (instance: object, tree: unknown) => unknown,
): ObserverRenderHook {
  const proto = cls.prototype as { render: Render };
  const installer = proto.render;
  const hooked = new WeakSet<object>();

  function hookedRender(this: object) {
    return renderThrough(this);
  }

  function renderThrough(self: object): unknown {
    const define = Object.defineProperty;
    let caught = false;
    Object.defineProperty = function (target: object, key: PropertyKey, desc: PropertyDescriptor) {
      if (!caught && target === self && key === "render" && typeof desc?.value === "function") {
        caught = true;
        const reactive = desc.value as Render;
        desc = {
          ...desc,
          value: function (this: object) {
            return wrap(this, reactive.call(this));
          },
        };
      }
      return define(target, key, desc);
    } as typeof Object.defineProperty;
    let tree: unknown;
    try {
      tree = installer.call(self);
    } finally {
      Object.defineProperty = define;
    }
    // With the installer, its own call to `this.render()` already went through the wrapper.
    if (caught) {
      hooked.add(self);
      return tree;
    }
    // An own render defined some other way would skip the wrapper from now on: leave it all Steam's.
    if (Object.getOwnPropertyDescriptor(self, "render")) return tree;
    hooked.add(self);
    return wrap(self, tree);
  }

  proto.render = hookedRender;
  return {
    isHooked: (instance) => hooked.has(instance),
    unhook() {
      if (proto.render === hookedRender) proto.render = installer;
    },
  };
}
