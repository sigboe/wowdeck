import { toaster } from "@decky/api";
import type { ControllerLayout, ControllerLayoutPreviewJob } from "../backend/src/api/contracts";
import { engine } from "./engineLink";
import { backendErrorMessage } from "./errors";
import { layoutNative, layoutPreviewSession } from "./controllerLayoutPreviewSession";
import { PREVIEW_ONLY_REASON } from "./nativeControllerLayouts";
import { layoutApplyStatus, startLayoutApply } from "./controllerLayoutRecoverySession";
import { addonSession } from "./session";
import { browseFocusView, holdBrowseSessionForModal, onNextQamShown } from "./browseSessionState";
import { requestFocus } from "./focusMemory";
import { openPanel } from "./openPanel";

/**
 * Steam's own layout preview, opened the way its community list opens it
 * (DEVICE 2026-11-17, Steam UI module 62581): PreviewConfiguration on the
 * configurator store, then NavigateToLayoutPreview. X on that page calls the
 * store's SetActiveConfigForApp, which ends in SteamClient.Input.SetSelectedConfigForApp;
 * for a WoWDeck-approved URL we run WoWDeck's
 * Apply instead (previous controls saved, layer 0, readback checked).
 */

const APPROVED = "usercloud://wowdeck-approved/";

interface ConfiguratorStore {
  PreviewConfiguration(appid: number, controllerIndex: number, url: string): void;
  SetActiveConfigForApp(
    appid: number,
    controllerIndex: number,
    url: string,
    ...rest: unknown[]
  ): unknown;
}
interface MemoryHistory {
  location?: { pathname?: string };
  push(path: string): void;
  listen(listener: (location: { pathname?: string }) => void): () => void;
}
interface SteamUi {
  NavigateToLayoutPreview(appid: number, window: unknown): void;
  WindowStore?: { GamepadUIMainWindowInstance?: { m_history?: MemoryHistory } };
}
const globals = () =>
  globalThis as unknown as {
    controllerConfiguratorStore?: ConfiguratorStore;
    SteamUIStore?: SteamUi;
  };

/** The preview WoWDeck opened last; X applies only this one. */
let intent: {
  url: string;
  target: number;
  jobId: string;
  title: string;
  controllerIndex: number;
} | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verify the approved snapshot (published fingerprint, or a decode that isn't
 * Steam's defaults), then show it in Steam's preview. Returns an error to show,
 * or null once Steam's page is open.
 */
export async function openNativePreview(
  layout: ControllerLayout,
  target: number,
): Promise<string | null> {
  const { controllerConfiguratorStore: store, SteamUIStore: ui } = globals();
  if (
    typeof store?.PreviewConfiguration !== "function" ||
    typeof ui?.NavigateToLayoutPreview !== "function"
  )
    return "Couldn't open Steam's layout preview on this Steam version.";
  const key = layoutPreviewSession.key(layout, target);
  try {
    for (let i = 0; i < 240; i++) {
      await layoutPreviewSession.resource.refresh(key);
      const state = layoutPreviewSession.resource.get(key);
      if (state.error) return state.error;
      if (state.data?.state === "error") return state.data.message;
      if (state.data?.state === "ready") break;
      await wait(500);
    }
    const jobId = await layoutPreviewSession.job(key);
    if (!jobId) return "Couldn't prepare the layout preview.";
    const status: ControllerLayoutPreviewJob = await engine.rpc("controllerLayouts.previewStatus", {
      jobId,
    });
    if (status.state !== "ready" || !status.preview.url.startsWith(APPROVED))
      return "Couldn't prepare the layout preview.";
    const verified = layoutPreviewSession.resource.get(key).data;
    const context = await layoutNative.context(target);
    if (verified?.state !== "ready" || JSON.stringify(verified.context) !== JSON.stringify(context))
      return "Couldn't open the layout preview. The active controller or its controls changed.";
    intent = {
      url: status.preview.url,
      target,
      jobId,
      title: layout.title,
      controllerIndex: context.controllerIndex,
    };
    const main = ui.WindowStore?.GamepadUIMainWindowInstance;
    returnAfterPreview(main?.m_history, layout.id);
    store.PreviewConfiguration(target, context.controllerIndex, status.preview.url);
    ui.NavigateToLayoutPreview(target, main);
    return null;
  } catch (error) {
    return backendErrorMessage(error);
  } finally {
    layoutPreviewSession.resource.retainOnly([]);
  }
}

const PREVIEW_ROUTE = /\/controllerconfigurator\/sharedlayout$/;

/**
 * Leaving Steam's preview, by B or X, comes back to WoWDeck on this layout's
 * row. X runs Steam's NavigateHistory(-2), one page past where the player was
 * (DEVICE 2026-11-17), so that page is pushed back first. The browse session
 * is held while the preview hides the QAM, as for WoWDeck's own dialogs.
 */
function returnAfterPreview(history: MemoryHistory | undefined, layoutId: string) {
  const release = holdBrowseSessionForModal();
  const before = history?.location?.pathname;
  if (!history || typeof history.listen !== "function" || !before) {
    release();
    return;
  }
  let seen = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stop();
    clearTimeout(timer);
    setTimeout(() => {
      try {
        if (history.location?.pathname !== before) history.push(before);
      } catch {
        /* Steam stays where it navigated */
      }
      // Back on the list, where "Restore previous controls" sits above the rows.
      openPanel("browse");
      release();
      // DEVICE 2026-11-17: focus requested while the QAM was hidden, or on a
      // timer, lost to the tab header Steam focuses as the QAM shows (~1.1 s
      // after B). Ask once it has shown, then again after Steam's own focus.
      const focusRow = () => requestFocus(browseFocusView("controllerLayouts"), layoutId);
      const cancel = onNextQamShown(() => {
        for (const ms of [0, 250, 600]) setTimeout(focusRow, ms);
      });
      setTimeout(cancel, 5000);
    }, 300);
  };
  const stop = history.listen((location) => {
    if (PREVIEW_ROUTE.test(location.pathname ?? "")) seen = true;
    else if (seen) finish();
  });
  // A preview that never opened must not hold the session.
  const timer = setTimeout(() => {
    if (!seen && !done) {
      done = true;
      stop();
      release();
    }
  }, 5000);
}

const APPLY_TEXT: Record<string, string> = {
  succeeded: "Applied. Restore your previous controls in WoWDeck › Controller Layouts.",
  restored: "Couldn't apply the layout. Your previous controls are back.",
  failed: "Couldn't apply the layout. Your controls didn't change.",
  blocked: "Couldn't apply the layout. Steam's controls changed; preview it again.",
  "recovery-required":
    "Couldn't apply the layout. Restore your previous controls in WoWDeck › Controller Layouts.",
};

async function applyFromSteam(appid: number, url: string) {
  const current = intent;
  const notify = (body: string) =>
    toaster.toast({ title: current?.title ?? "Controller layout", body });
  if (!current || current.url !== url || current.target !== appid) {
    notify("Couldn't apply this layout. Preview it again from WoWDeck.");
    return;
  }
  // Steam clears its preview and navigates back after X; let that settle
  // before WoWDeck opens its own native sessions.
  await wait(500);
  try {
    const installationId = addonSession.get().selectedId ?? "";
    const context = await layoutNative.operationContext(appid, installationId);
    if (context.controllerIndex !== current.controllerIndex) {
      notify("Couldn't apply the layout. The preview used a different controller.");
      return;
    }
    if (context.scope.state !== "established") {
      notify(`Couldn't apply the layout. ${context.scope.reason ?? PREVIEW_ONLY_REASON}`);
      return;
    }
    await startLayoutApply(current.jobId, context, () => addonSession.get().selectedId ?? "");
    const state = layoutApplyStatus.get();
    notify(
      state === "succeeded"
        ? `Applied to ${context.scope.targets.map((t) => t.name).join(", ")}. Restore your previous controls in WoWDeck › Controller Layouts.`
        : (APPLY_TEXT[state] ?? APPLY_TEXT.failed!),
    );
  } catch (error) {
    notify(backendErrorMessage(error));
  }
}

/**
 * Route X on Steam's preview page through WoWDeck's Apply for WoWDeck-approved
 * URLs; every other call reaches Steam unchanged. Returns the uninstaller and
 * never throws: a Steam without this hook just keeps Steam's own Apply.
 *
 * DEVICE 2026-11-17: the store's SetActiveConfigForApp is a locked MobX
 * action (writable and configurable false). It ends in
 * SteamClient.Input.SetSelectedConfigForApp, which is writable, so the hook
 * sits there. WoWDeck's own Apply passes through while it runs.
 */
export function interceptNativeApply(): () => void {
  try {
    const input = (globalThis as unknown as { SteamClient?: { Input?: NativeInput } }).SteamClient
      ?.Input;
    const original = input?.SetSelectedConfigForApp;
    if (!input || typeof original !== "function") return () => {};
    const patched: NativeInput["SetSelectedConfigForApp"] = function (
      this: unknown,
      appid,
      index,
      url,
      ...rest
    ) {
      if (
        typeof url === "string" &&
        url.startsWith(APPROVED) &&
        layoutApplyStatus.get() !== "applying"
      ) {
        void applyFromSteam(appid, url);
        return Promise.resolve(undefined);
      }
      return original.call(this, appid, index, url, ...rest);
    };
    input.SetSelectedConfigForApp = patched;
    return () => {
      try {
        if (input.SetSelectedConfigForApp === patched) input.SetSelectedConfigForApp = original;
      } catch {
        /* Steam replaced the object; nothing of ours remains on it */
      }
    };
  } catch {
    return () => {};
  }
}

interface NativeInput {
  SetSelectedConfigForApp(
    appid: number,
    controllerIndex: number,
    url: string,
    ...rest: unknown[]
  ): Promise<unknown>;
}

/** Test seam for the return path; the preview itself needs Steam. */
export const returnAfterPreviewForTest = returnAfterPreview;
