import type {
  ControllerLayoutContext,
  ControllerLayoutOperation,
  ControllerLayoutRecoverySnapshot,
} from "../backend/src/api/contracts";
import type { LayoutRecoveryAdapter } from "./controllerLayoutPreservation";
import * as DeckyUi from "@decky/ui";
import { listSteamShortcuts } from "./steamLibrary";
import {
  mappingContent,
  type LayoutContext,
  type NativeLayoutModel,
} from "./controllerLayoutPreview";

interface Selection {
  URL?: string;
  eSelectionType?: number;
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
  StopEditingControllerConfiguration?(controller: number): void;
  DeletePersonalControllerConfiguration?(url: string): unknown;
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
 * LIVE 2026-11-17: friendStore.currentUserSteamID and connected inventory work
 * without an open configurator. User.GetSteamID is absent on this client;
 * selection.accountID may identify a source author, so it never chooses the folder.
 * Protobuf discovery is INFERRED from that snapshot; missing/changed shapes
 * refuse the action. Every operation probes again; browsing needs none of it.
 */
export function nativeControllerLayouts(): LayoutRecoveryAdapter {
  let occupied = false;
  let mutationPending = false;
  let pendingNative: Promise<unknown> = Promise.resolve();
  const mutate = async <T>(start: () => Promise<T>): Promise<T> => {
    if (mutationPending || occupied) throw Error("Native work is still pending");
    mutationPending = true;
    const pending = Promise.resolve()
      .then(start)
      .finally(() => {
        mutationPending = false;
      });
    pendingNative = pending.catch(() => {});
    // Keep the slot after a timeout until native work really settles.
    return bounded(pending);
  };
  const capabilities = () => {
    const globals = globalThis as unknown as {
      SteamClient?: { Input?: NativeInput; User?: { GetSteamID?: () => string | Promise<string> } };
      friendStore?: { currentUserSteamID?: { ConvertTo64BitString?: () => string } };
      controllerConfiguratorStore?: {
        m_controllerList?: {
          nControllerIndex: number;
          eControllerType: number;
          bRemoteDevice?: boolean;
          strSerialNumber?: string;
          strChipID?: string;
        }[];
      };
    };
    const input = globals.SteamClient?.Input;
    const steamID = globals.friendStore?.currentUserSteamID;
    const user =
      typeof steamID?.ConvertTo64BitString === "function"
        ? { GetSteamID: () => steamID.ConvertTo64BitString!() }
        : globals.SteamClient?.User;
    const inventory = globals.controllerConfiguratorStore?.m_controllerList;
    if (Array.isArray(inventory) && inventory.length > 1)
      throw Error(
        "Couldn't preview with more than one controller connected. Disconnect the others, then try again.",
      );
    // Bounded to the one built-in Deck controller evidenced on the device.
    // An editor index may be stale or absent; it never establishes connectivity.
    const connected = Array.isArray(inventory) && inventory.length === 1 ? inventory[0] : undefined;
    const controller =
      connected?.eControllerType === 4 && !connected.bRemoteDevice
        ? connected.nControllerIndex
        : undefined;
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
    const physical = `${connected!.strSerialNumber ?? ""}|${connected!.strChipID ?? ""}`;
    return { input, user: user!, controller: controller!, physical };
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
    async settled() {
      await pendingNative;
    },
    async preservationState(
      operation: ControllerLayoutOperation,
    ): Promise<ControllerLayoutRecoverySnapshot> {
      const { context } = operation;
      const { input } = capabilities();
      const value = await bounded(
        input.GetConfigForAppAndController(context.target, context.controllerIndex),
      );
      // LIVE 2026-11-17: a present layer-1 override always wins, so a layer-0
      // winner proves layer 1 absent. Only personal sources have archivable bytes.
      if (value.eSelectionType !== 0 || !archivableSource(value.URL))
        throw Error("Couldn't preserve your previous controls. This source isn't supported.");
      const loaded = await load(context, "", true);
      let mapping: string;
      try {
        mapping = mappingContent(loaded.model);
      } finally {
        loaded.release();
      }
      return {
        mapping,
        sourceURL: value.URL!,
        selections: [
          { target: context.target, selectionType: 0, present: true, url: value.URL! },
          { target: context.target, selectionType: 1, present: false },
        ],
      };
    },
    async exportLocal(operation) {
      await assertContext(operation.context);
      const { input } = capabilities();
      if (
        typeof input.ExportCurrentControllerConfiguration !== "function" ||
        typeof input.StartEditingControllerConfigurationForAppIDAndControllerIndex !== "function"
      )
        throw Error("Native export unavailable");
      const decoder = findDecoder();
      if (typeof input.StopEditingControllerConfiguration !== "function")
        throw Error("Native export unavailable");
      // LIVE 2026-11-17: export never settles without an editing session. It
      // exports the edited configuration and selects the export on layer 0.
      const result = await mutate(async () => {
        const bytes = await input.StartEditingControllerConfigurationForAppIDAndControllerIndex!(
          operation.context.target,
          operation.context.controllerIndex,
        );
        try {
          return await input.ExportCurrentControllerConfiguration!(
            operation.context.controllerIndex,
            operation.context.target,
            1,
            `WoWDeck recovery ${operation.id}`,
            "Previous controls",
            "",
          );
        } finally {
          const handle = decoder.deserializeBinary(bytes).toObject().binding_handle;
          if (Number.isSafeInteger(handle) && handle > 0) input.FreeControllerConfig(handle);
          input.StopEditingControllerConfiguration!(operation.context.controllerIndex);
        }
      });
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
    async discardExport(operation, url) {
      const { input } = capabilities();
      // Only the export this operation made: "<entry>/wowdeck recovery <id>_<n>".
      const name = `wowdeck recovery ${operation.id}`.toLowerCase();
      const match = /^usercloud:\/\/[^/]+\/(.+)_[0-9]+$/.exec(url);
      if (!match || match[1]!.toLowerCase() !== name) throw Error("Not WoWDeck's export");
      if (typeof input.DeletePersonalControllerConfiguration !== "function")
        throw Error("Native delete unavailable");
      await mutate(() => Promise.resolve(input.DeletePersonalControllerConfiguration!(url)));
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
      const { input, physical } = capabilities();
      const selected = listSteamShortcuts().find((t) => t.appId === target);
      // LIVE 2026-11-17: Steam keys shortcut controls by the lowercased name, so
      // case variants share them and other names don't. Non-ASCII names stay
      // unsupported: their normalization is unproven.
      const key =
        selected && /^[\x20-\x7e]+$/.test(selected.name) ? selected.name.toLowerCase() : "";
      const targets = listSteamShortcuts().filter(
        (t) => t.name.toLowerCase() === selected?.name.toLowerCase(),
      );
      const controllerIdentity = await sha256(physical);
      const value = JSON.parse(context.selection).value as Selection;
      let established =
        !!key &&
        physical !== "|" &&
        context.controllerType === 4 &&
        value.eSelectionType === 0 &&
        archivableSource(value.URL);
      for (const other of targets) {
        if (!established) break;
        const shared = await bounded(
          input.GetConfigForAppAndController(other.appId, context.controllerIndex),
        );
        established = shared.URL === value.URL && shared.eSelectionType === value.eSelectionType;
      }
      return {
        ...context,
        installationId,
        controllerIdentity,
        scope: established
          ? {
              state: "established",
              selectionType: 0,
              identity: await sha256(JSON.stringify({ key, controllerIdentity, selectionType: 0 })),
              targets,
            }
          : { state: "unknown", identity: "", targets },
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
    previewDefault(context) {
      // LIVE 2026-11-17: Steam names a shortcut's default selection
      // default://<lowercased name>; preview decodes it without selecting it.
      const name = listSteamShortcuts().find((t) => t.appId === context.target)?.name;
      if (!name || !/^[\x20-\x7e]+$/.test(name)) throw Error("Native target unavailable");
      return load(context, `default://${name.toLowerCase()}`);
    },
  };
  async function load(context: LayoutContext, url: string, active = false) {
    if (occupied || mutationPending) throw Error("Native work is already running");
    const { input, controller } = capabilities();
    if (
      controller !== context.controllerIndex ||
      (!active && !safePreviewURL(url) && !/^default:\/\/[\x20-\x7e]+$/.test(url))
    )
      throw Error("Native context changed");
    const decoder = findDecoder();
    if (
      active &&
      typeof input.StartEditingControllerConfigurationForAppIDAndControllerIndex !== "function"
    )
      throw Error("Native readback unavailable");
    const freeHandle = input.FreeControllerConfig.bind(input);
    // An active readback opens Steam's editing session; close it with the handle.
    const free = (handle: number) => {
      try {
        freeHandle(handle);
      } finally {
        if (active) input.StopEditingControllerConfiguration?.(controller);
      }
    };
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
    pendingNative = pending.catch(() => {});
    let model: NativeLayoutModel & { binding_handle: number; error_msg?: string };
    try {
      model = await bounded(pending);
    } catch (error) {
      // Native work cannot be cancelled. Keep ownership until it settles and
      // free a late result rather than leaking it after a UI timeout.
      pendingNative = pending
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

function findDecoder(): Decoder {
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
  return decoder;
}

/** Sources whose bytes the engine can archive: personal exports and autosaves. */
function archivableSource(url: string | undefined) {
  return !!url && (url.startsWith("usercloud://") || url.startsWith("autosave:///"));
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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

/** Preview accepts engine-delivered snapshots and native personal exports only.
 * Active readback has no URL; it uses a separate native entry point. */
function safePreviewURL(url: string) {
  const match = /^usercloud:\/\/([a-zA-Z0-9 _/-]+)$/.exec(url);
  return !!match && match[1]!.split("/").every((part) => part && part !== "." && part !== "..");
}
