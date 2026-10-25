import { toaster } from "@decky/api";
import { FaBoxOpen } from "react-icons/fa";
import { errorText } from "./errors";

/**
 * Every plugin toast goes through here so it carries the plugin's icon, as
 * Steam's own toasts carry the app or game art (guide S17). Body text is
 * trimmed; never pass raw ids or stack traces.
 */
export function pluginToast(title: string, body = ""): void {
  toaster.toast({ title, body: body.slice(0, 180), icon: <FaBoxOpen /> });
}

/** A failure toast: the title says what failed, the body the error in plain words. */
export function toastError(title: string, e: unknown): void {
  pluginToast(title, errorText(e));
}
