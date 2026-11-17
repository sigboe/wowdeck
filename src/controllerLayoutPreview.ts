import type { ControllerLayoutPreview } from "../backend/src/api/contracts";

export interface LayoutContext {
  target: number;
  accountId: number;
  controllerIndex: number;
  controllerType: number;
  /** Full native selection semantics, including enabled/inherited scope. */
  selection: string;
}
export interface NativeLayoutAdapter {
  context(target: number): Promise<LayoutContext>;
  preview(
    context: LayoutContext,
    url: string,
  ): Promise<{ model: NativeLayoutModel; release(): void }>;
}
export interface NativeLayoutModel {
  controller_type: number;
  sets: unknown[];
  modes: unknown[];
}
export type LayoutPreviewOutcome =
  { state: "ready"; model: NativeLayoutModel } | { state: "error"; message: string };

/** Canonical native mapping content, excluding handles, URLs and mutable metadata. */
export function mappingContent(model: NativeLayoutModel): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sort(v)]),
      );
    return value;
  };
  return JSON.stringify(
    sort({ type: model.controller_type, sets: model.sets, modes: model.modes }),
  );
}

/** One preview lifetime. No selection, editing-store or native navigation mutation. */
export async function previewLayout(
  adapter: NativeLayoutAdapter,
  approved: ControllerLayoutPreview,
  target: number,
): Promise<LayoutPreviewOutcome> {
  let release: (() => void) | undefined;
  let outcome: LayoutPreviewOutcome;
  try {
    const before = await adapter.context(target);
    if (
      before.accountId !== approved.accountId ||
      !approved.mappings[String(before.controllerType)]
    )
      throw Error();
    const preview = await adapter.preview(before, approved.url);
    release = preview.release;
    if (!Array.isArray(preview.model.sets) || !Array.isArray(preview.model.modes)) throw Error();
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(mappingContent(preview.model)),
    );
    const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    if (
      hash !== approved.mappings[String(before.controllerType)] ||
      preview.model.controller_type !== before.controllerType
    )
      throw Error();
    const after = await adapter.context(target);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error();
    outcome = { state: "ready", model: preview.model };
  } catch {
    outcome = {
      state: "error",
      message:
        "Couldn't verify the layout preview. Steam support, the controller or current controls may have changed. Your controls weren't replaced by WoWDeck.",
    };
  }
  try {
    release?.();
  } catch {
    outcome = {
      state: "error",
      message: "Couldn't release the native preview. Close and reopen WoWDeck before trying again.",
    };
  }
  return outcome;
}
