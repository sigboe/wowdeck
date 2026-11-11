// node tree.mjs <target> [--roles=button,tab] [--max=60]  - compact accessibility tree (roles and names)
import { connect } from "./cdp.mjs";

const [want, ...flags] = process.argv.slice(2);
const arg = (name, dflt) => {
  const f = flags.find((x) => x.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : dflt;
};

const { send, close } = await connect(want || "QuickAccess_uid");
await send("Accessibility.enable");
const tree = await send("Accessibility.getFullAXTree");
close();

const roles = (arg("roles", "") || "").split(",").filter(Boolean);
const max = Number(arg("max", "60"));
const nodes = tree.result?.nodes ?? [];
const shown = nodes
  .filter((n) => !n.ignored && n.role?.value && n.role.value !== "none" && n.role.value !== "generic")
  .filter((n) => !roles.length || roles.includes(n.role.value))
  .slice(0, max)
  .map((n) => `${n.role.value}:${(n.name?.value ?? "").replace(/\s+/g, " ").slice(0, 60)}`);

console.log(shown.join("\n"));
console.log(`-- ${shown.length}/${nodes.length} nodes${roles.length ? `, roles=${roles.join(",")}` : ""}`);
