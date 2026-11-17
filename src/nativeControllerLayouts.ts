import * as DeckyUi from "@decky/ui";
import { listSteamShortcuts } from "./steamLibrary";
import type {
  LayoutContext,
  NativeLayoutAdapter,
  NativeLayoutModel,
} from "./controllerLayoutPreview";

interface Selection {
  accountID: number;
  nControllerType: number;
  unControllerIndex: number;
}
interface NativeInput {
  GetConfigForAppAndController(target: number, controller: number): Promise<Selection>;
  PreviewConfigForAppAndController(
    target: number,
    controller: number,
    url: string,
  ): Promise<Uint8Array>;
  FreeControllerConfig(handle: number): void;
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
export function nativeControllerLayouts(): NativeLayoutAdapter {
  let occupied = false;
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
  return {
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
    async preview(context: LayoutContext, url: string) {
      if (occupied) throw Error("A native preview is already running");
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
      const free = input.FreeControllerConfig.bind(input);
      occupied = true;
      const pending = Promise.resolve()
        .then(() => input.PreviewConfigForAppAndController(context.target, controller, url))
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
    },
  };
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
