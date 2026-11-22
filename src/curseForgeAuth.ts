import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import type { CurseForgeAuthStatus } from "./types";
import { useResource } from "./useResource";

const KEY = "status";

/** CurseForge's access status as the key modal shows it. */
const status = createKeyedResource<CurseForgeAuthStatus>({
  read: () => engine.rpc("curseforge.authStatus"),
  errorText: () => "Couldn't check CurseForge access",
  clock: systemClock,
});

/** Forget the status (the modal closed): the next one opens with what its row knew. */
export const forgetCurseForgeAuth = () => status.forget(KEY);

/** The status while the modal is open; a failed read keeps the last one. */
export const useCurseForgeAuth = () => useResource(status, KEY);

/** An action's answer for the status. */
export const putCurseForgeAuth = (auth: CurseForgeAuthStatus) => status.put(KEY, auth);
