import { useState, type CSSProperties } from "react";

/**
 * An icon in a square slot of `size`, beside a name in a list or menu.
 * Decorative: hidden from screen readers, and blank when there is no icon
 * or it fails to load, so names beside it line up either way.
 */
export function IconSlot({
  icon,
  size,
  style,
}: {
  icon?: string;
  size: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      data-icon-slot
      aria-hidden="true"
      style={{ ...style, width: size, height: size, flex: "none" }}
    >
      {icon && icon !== failed && (
        <img
          src={icon}
          alt=""
          decoding="async"
          style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
          onError={() => setFailed(icon)}
        />
      )}
    </span>
  );
}
