import type { HandlerTable } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";

export function launchHandlers({ launch, store }: Pick<HandlerDeps, "launch" | "store">) {
  return {
    // Only the shortcut's launch target: My Addons' installation stays as it is.
    "launch.select": async ({ appId, targetId }) => ({
      target: await launch.select(appId, targetId, (target) => {
        store.updateSettings({ steamLaunchTargets: { ...store.settings.steamLaunchTargets, [appId]: target.id } });
      }),
    }),
    "launch.state": async ({ appId }) => ({ state: await launch.state(appId) }),
    "launch.start": ({ appId, canStartSteam, steamEntryRunning }) =>
      launch.start(appId, canStartSteam, steamEntryRunning),
    "launch.steamRefused": async ({ attemptId }) => launch.steamRefused(attemptId),
    "launch.icon": async ({ appId, targetId }) => ({ icon: (await launch.icon(appId, targetId)) ?? null }),
  } satisfies Partial<HandlerTable>;
}
