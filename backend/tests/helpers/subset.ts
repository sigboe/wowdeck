/**
 * The typed subset of a handler module's deps a test hands it. Handler
 * modules type what they use (AddonsDeps, SystemDeps, ...); a test passes
 * real or stub values for what its methods read, each checked against that
 * type. A left-out dependency fails on first use, naming itself, instead of
 * reading undefined.
 */
export function subset<T extends object>(given: NoInfer<Partial<T>>): T {
  return new Proxy(given, {
    get: (target, key) => (key in target ? Reflect.get(target, key) : absent(String(key))),
  }) as T;
}

function absent(name: string): object {
  const refuse = (): never => {
    throw new Error(`${name} is not part of this test`);
  };
  return new Proxy(() => {}, { get: refuse, set: refuse, has: refuse, apply: refuse });
}
