import { useState } from "react";

/**
 * An icon in a square slot of `size`, beside a name in a list or menu.
 * Decorative: hidden from screen readers, and blank when there is no icon
 * or it fails to load, so names beside it line up either way.
 */
export function IconSlot({ icon, size }: { icon?: string; size: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      data-icon-slot
      aria-hidden="true"
      style={{ display: "block", width: size, height: size, flex: "none" }}
    >
      {icon && icon !== failed && (
        <img
          src={icon}
          alt=""
          decoding="async"
          // Steam's header download portrait uses a fixed box and Chromium's
          // default scaling (DEVICE 2026-11-18, sp.css HeaderAppPortrait).
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            imageRendering: "auto",
          }}
          onError={() => setFailed(icon)}
        />
      )}
    </span>
  );
}
