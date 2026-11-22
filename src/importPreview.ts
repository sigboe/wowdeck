import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import { errorText } from "./errors";
import { useResource } from "./useResource";

/** One resource key per installation and import text: another text never shows this one's preview. */
export function importPreviewKey(installationId: string, importText: string): string {
  return JSON.stringify([installationId, importText.trim()]);
}

const previews = createKeyedResource<
  Awaited<ReturnType<typeof engine.rpc<"addons.previewImport">>>
>({
  read: (key) => {
    const [installationId, importString] = JSON.parse(key) as [string, string];
    return engine.rpc("addons.previewImport", { importString, installationId });
  },
  errorText,
  clock: systemClock,
});

/** The preview of one import text (null shows nothing). */
export const useImportPreview = (key: string | null) => useResource(previews, key);

export const forgetImportPreview = (key: string) => previews.forget(key);

/** Read a preview again (after an install changed what is installed). */
export const refreshImportPreview = (key: string) => previews.refresh(key);
