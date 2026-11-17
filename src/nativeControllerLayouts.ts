import type {
  ControllerLayoutContext,
  ControllerLayoutOperation,
  ControllerLayoutRecoverySnapshot,
} from "../backend/src/api/contracts";
import type { LayoutRecoveryAdapter } from "./controllerLayoutPreservation";
import * as DeckyUi from "@decky/ui";
import { listSteamShortcuts } from "./steamLibrary";
import type { LayoutContext, NativeLayoutModel } from "./controllerLayoutPreview";

interface Selection {
  accountID: number;
  nControllerType: number;
  unControllerIndex: number;
}
interface NativeInput {
  RegisterForConfigSelectionChanges?(callback: (...args: unknown[]) => void): {
    unregister(): void;
  };
  GetConfigForAppAndController(target: number, controller: number): Promise<Selection>;
  PreviewConfigForAppAndController(
    target: number,
    controller: number,
    url: string,
  ): Promise<Uint8Array>;
  FreeControllerConfig(handle: number): void;
  StartEditingControllerConfigurationForAppIDAndControllerIndex?(
    target: number,
    controller: number,
  ): Promise<Uint8Array>;
  ExportCurrentControllerConfiguration?(
    controller: number,
    target: number,
    type: number,
    title: string,
    description: string,
    extra: string,
  ): Promise<{ result: number }>;
  SetSelectedConfigForApp?(
    target: number,
    controller: number,
    url: string,
    forced: boolean,
    selectionType: number,
  ): Promise<void>;
  ClearSelectedConfigForApp?(
    target: number,
    controller: number,
    selectionType: number,
  ): Promise<void>;
}
interface Decoder {
  deserializeBinary(bytes: Uint8Array): {
    toObject(): NativeLayoutModel & { binding_handle: number; error_msg?: string };
  };
}

/**
 * Undocumented native interfaces: LIVE prior experiment, integration a08a38f,
 * docs/hardware/2026-11-17-controller-layouts and the installed-source snapshot
 * cited there. Raw preview avoids Steam's F3 Apply screen and shared editor.
 * Logged-in account discovery via User.GetSteamID is INFERRED and guarded;
 * selection.accountID may identify a source author, so it never chooses the folder.
 * Protobuf discovery is INFERRED from that snapshot; missing/changed shapes
 * refuse the action. Every operation probes again; browsing needs none of it.
 */
export function nativeControllerLayouts(): LayoutRecoveryAdapter {
  let occupied = false;
  let mutationPending = false;
  const mutate = async <T>(start: () => Promise<T>): Promise<T> => {
    if (mutationPending || occupied) throw Error("Native work is still pending");
    mutationPending = true;
    const pending = Promise.resolve()
      .then(start)
      .finally(() => {
        mutationPending = false;
      });
    // Keep the slot after a timeout until native work really settles.
    return bounded(pending);
  };
  const capabilities = () => {
    const globals = globalThis as unknown as {
      SteamClient?: { Input?: NativeInput; User?: { GetSteamID?: () => string | Promise<string> } };
      controllerConfiguratorStore?: { EditingConfigurationControllerIndex?: number };
    };
    const input = globals.SteamClient?.Input;
    const user = globals.SteamClient?.User;
    const controller = globals.controllerConfiguratorStore?.EditingConfigurationControllerIndex;
    if (
      !input ||
      typeof user?.GetSteamID !== "function" ||
      ![
        input.GetConfigForAppAndController,
        input.PreviewConfigForAppAndController,
        input.FreeControllerConfig,
      ].every((f) => typeof f === "function") ||
      !Number.isSafeInteger(controller) ||
      controller! < 0
    )
      throw Error("Native preview unavailable");
    return { input, user: user!, controller: controller! };
  };
  const assertContext = async (expected: ControllerLayoutContext) => {
    if (mutationPending || occupied) throw Error("Native work is still pending");
    const actual = await adapter.operationContext(expected.target, expected.installationId);
    if (
      actual.scope.state !== "established" ||
      JSON.stringify({ ...actual, selection: "" }) !==
        JSON.stringify({ ...expected, selection: "" })
    )
      throw Error("Couldn't establish the full affected controls.");
  };
  const adapter: LayoutRecoveryAdapter = {
    async preservationState(
      _operation: ControllerLayoutOperation,
    ): Promise<ControllerLayoutRecoverySnapshot> {
      // Recorded GetConfig returns the winning selection, not absence of both
      // override layers or all equivalent controllers. Do not invent that proof.
      throw Error("Couldn't establish controller identity, shared scope and override absence.");
    },
    async exportLocal(operation) {
      await assertContext(operation.context);
      const { input } = capabilities();
      if (typeof input.ExportCurrentControllerConfiguration !== "function")
        throw Error("Native export unavailable");
      const result = await mutate(() =>
        input.ExportCurrentControllerConfiguration!(
          operation.context.controllerIndex,
          operation.context.target,
          1,
          `WoWDeck recovery ${operation.id}`,
          "Previous controls",
          "",
        ),
      );
      if (result.result !== 1) throw Error("Native export failed");
      const selection = (await bounded(
        input.GetConfigForAppAndController(
          operation.context.target,
          operation.context.controllerIndex,
        ),
      )) as Selection & { URL?: string };
      if (!selection.URL?.startsWith("usercloud://")) throw Error("Native export result unknown");
      return selection.URL;
    },
    async restoreSelections(operation, snapshot) {
      await assertContext(operation.context);
      const { input } = capabilities();
      if (
        typeof input.SetSelectedConfigForApp !== "function" ||
        typeof input.ClearSelectedConfigForApp !== "function"
      )
        throw Error("Native restore unavailable");
      for (const entry of snapshot.selections) {
        await assertContext(operation.context);
        if (entry.present)
          await mutate(() =>
            input.SetSelectedConfigForApp!(
              entry.target,
              operation.context.controllerIndex,
              entry.url!,
              false,
              entry.selectionType,
            ),
          );
        else
          await mutate(() =>
            input.ClearSelectedConfigForApp!(
              entry.target,
              operation.context.controllerIndex,
              entry.selectionType,
            ),
          );
      }
    },
    async apply(context, url) {
      await assertContext(context);
      const { input } = capabilities();
      const selectionType = context.scope.selectionType;
      if (
        typeof input.SetSelectedConfigForApp !== "function" ||
        (selectionType !== 0 && selectionType !== 1)
      )
        throw Error("Couldn't establish the native application scope.");
      // Installed SetActiveConfigForApp resolves this layer from its controller
      // list, then reloads the shared editor's current target. Use the proven
      // layer directly and read the intended target through our owned handle.
      await mutate(() =>
        input.SetSelectedConfigForApp!(
          context.target,
          context.controllerIndex,
          url,
          false,
          selectionType,
        ),
      );
    },
    async readback(context) {
      const loaded = await load(context, "", true);
      try {
        return loaded.model;
      } finally {
        loaded.release();
      }
    },
    subscribe(invalidate) {
      const { input } = capabilities();
      if (typeof input.RegisterForConfigSelectionChanges !== "function")
        throw Error("Native notifications unavailable");
      // All notifications, including appID 0, invalidate captured state only.
      let active = true;
      const handle = input.RegisterForConfigSelectionChanges(() => {
        if (active) invalidate();
      });
      if (typeof handle?.unregister !== "function") {
        active = false;
        throw Error("Native notification lifetime unavailable");
      }
      return () => {
        if (active) {
          active = false;
          handle.unregister();
        }
      };
    },
    async operationContext(target, installationId) {
      const context = await adapter.context(target);
      const targets = listSteamShortcuts();
      const selected = targets.find((t) => t.appId === target);
      return {
        ...context,
        installationId,
        controllerIdentity: "",
        scope: {
          state: "unknown",
          identity: "",
          targets: targets.filter((t) => t.name === selected?.name),
        },
      };
    },
    async context(target) {
      const { input, user, controller } = capabilities();
      const steamId = await bounded(Promise.resolve(user.GetSteamID!()));
      if (!/^[0-9]{17}$/.test(steamId)) throw Error("Steam account unavailable");
      const accountId = Number(BigInt(steamId) - 76561197960265728n);
      if (!Number.isSafeInteger(accountId) || accountId < 1 || accountId > 0xffffffff)
        throw Error("Steam account unavailable");
      const targets = listSteamShortcuts();
      if (!targets.some((game) => game.appId === target)) throw Error("Native target unavailable");
      const value = await bounded(input.GetConfigForAppAndController(target, controller));
      if (
        !Number.isSafeInteger(target) ||
        target <= 0 ||
        !Number.isSafeInteger(value.accountID) ||
        value.accountID < 0 ||
        value.unControllerIndex !== controller ||
        !Number.isSafeInteger(value.nControllerType)
      )
        throw Error("Native target unavailable");
      return {
        target,
        accountId,
        controllerIndex: controller,
        controllerType: value.nControllerType,
        selection: JSON.stringify({ value, targets: targets.sort((a, b) => a.appId - b.appId) }),
      };
    },
    preview(context, url) {
      return load(context, url);
    },
  };
  async function load(context: LayoutContext, url: string, active = false) {
    if (occupied || mutationPending) throw Error("Native work is already running");
    const { input, controller } = capabilities();
    if (
      controller !== context.controllerIndex ||
      !/^usercloud:\/\/wowdeck-approved\/[a-f0-9]{64}$/.test(url)
    )
      throw Error("Native context changed");
    if (typeof DeckyUi.findModuleExport !== "function") throw Error("Native decoder unavailable");
    const decoder = DeckyUi.findModuleExport((value: unknown) => {
      try {
        const candidate = value as {
          prototype?: { getClassName?: () => string };
          deserializeBinary?: unknown;
        };
        return (
          typeof candidate?.deserializeBinary === "function" &&
          candidate.prototype?.getClassName?.() === "CMsgControllerConfiguration"
        );
      } catch {
        return false;
      }
    }) as Decoder | undefined;
    if (!decoder) throw Error("Native decoder unavailable");
    if (
      active &&
      typeof input.StartEditingControllerConfigurationForAppIDAndControllerIndex !== "function"
    )
      throw Error("Native readback unavailable");
    const free = input.FreeControllerConfig.bind(input);
    occupied = true;
    const pending = Promise.resolve()
      .then(() =>
        active
          ? input.StartEditingControllerConfigurationForAppIDAndControllerIndex!(
              context.target,
              controller,
            )
          : input.PreviewConfigForAppAndController(context.target, controller, url),
      )
      .then((bytes) => decoder.deserializeBinary(bytes).toObject());
    let model: NativeLayoutModel & { binding_handle: number; error_msg?: string };
    try {
      model = await bounded(pending);
    } catch (error) {
      // Native work cannot be cancelled. Keep ownership until it settles and
      // free a late result rather than leaking it after a UI timeout.
      void pending
        .then((late) => {
          if (late.binding_handle > 0) free(late.binding_handle);
        })
        .catch(() => {})
        .finally(() => {
          occupied = false;
        });
      throw error;
    }
    if (!model || !Number.isSafeInteger(model.binding_handle) || model.binding_handle <= 0) {
      occupied = false;
      throw Error("Native preview unavailable");
    }
    let freed = false;
    const release = () => {
      if (!freed) {
        freed = true;
        try {
          free(model.binding_handle);
        } finally {
          occupied = false;
        }
      }
    };
    if (model.error_msg) {
      release();
      throw Error("Native preview failed");
    }
    try {
      return {
        model: JSON.parse(
          JSON.stringify({
            controller_type: model.controller_type,
            sets: model.sets,
            modes: model.modes,
          }),
        ) as NativeLayoutModel,
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }
  return adapter;
}

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Native preview timed out")), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
