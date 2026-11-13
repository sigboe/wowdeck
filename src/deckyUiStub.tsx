import type { ReactNode } from "react";

/**
 * Stand-ins for the Steam controls @decky/ui finds at runtime, for the
 * static-render tests (`mock.module("@decky/ui", () => deckyUiStub)`). They
 * keep visible labels and disabled state. One stub for every such test:
 * bun keeps the first mock of a module for the whole run, so each test
 * must get the same names.
 */
type Kids = { children?: ReactNode };
const box = ({ children }: Kids) => <div>{children}</div>;

export const deckyUiStub = {
  PanelSection: ({ title, children }: Kids & { title?: string }) => (
    <section>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  PanelSectionRow: box,
  Focusable: box,
  DialogBody: box,
  ModalRoot: box,
  DialogControlsSection: ({ children }: Kids) => <section>{children}</section>,
  DialogControlsSectionHeader: ({ children }: Kids) => <h3>{children}</h3>,
  DialogHeader: ({ children }: Kids) => <h2>{children}</h2>,
  DialogFooter: ({ children }: Kids) => <footer>{children}</footer>,
  DialogButton: ({
    children,
    disabled,
    "aria-label": ariaLabel,
    onClick,
  }: Kids & { disabled?: boolean; "aria-label"?: string; onClick?: () => void }) => (
    <button disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  ),
  ButtonItem: ({
    children,
    label,
    description,
    disabled,
    onClick,
  }: Kids & {
    label?: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {label && <span>{label}: </span>}
      {children}
      {description && <small>{description}</small>}
    </button>
  ),
  DialogButtonPrimary: ({ children, disabled }: Kids & { disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
  Field: ({
    label,
    description,
    disabled,
    children,
    onSecondaryActionDescription,
    onMenuActionDescription,
    onCancelButton,
    onCancelActionDescription,
    onClick,
  }: Kids & {
    label?: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
    onSecondaryActionDescription?: string;
    onMenuActionDescription?: string;
    /** B's action: a button labeled "B: <its description>". */
    onCancelButton?: () => void;
    onCancelActionDescription?: string;
    onClick?: () => void;
  }) => (
    <div data-disabled={disabled ? "true" : undefined} onClick={onClick}>
      <b>{label}</b>
      <i>{description}</i>
      {children}
      <footer>
        {onSecondaryActionDescription && <span>X: {onSecondaryActionDescription}</span>}
        {onMenuActionDescription && <span>Menu: {onMenuActionDescription}</span>}
        {onCancelButton && <button onClick={onCancelButton}>B: {onCancelActionDescription}</button>}
      </footer>
    </div>
  ),
  Navigation: {},
  GamepadButton: {},
  ConfirmModal: () => null,
  Menu: () => null,
  MenuItem: () => null,
  showContextMenu: () => {},
  TextField: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) =>
    ariaLabel ? <input aria-label={ariaLabel} /> : null,
  Spinner: () => <span role="progressbar" />,
  // Steam's ProgressBarWithInfo is itself a Field row: its label and B action.
  ProgressBarWithInfo: ({
    label,
    sOperationText,
    onCancelButton,
    onCancelActionDescription,
  }: {
    label?: ReactNode;
    sOperationText?: ReactNode;
    onCancelButton?: () => void;
    onCancelActionDescription?: string;
  }) => (
    <div>
      <b>{label}</b>
      <div role="progressbar">{sOperationText}</div>
      {onCancelButton && (
        <footer>
          <button onClick={onCancelButton}>B: {onCancelActionDescription}</button>
        </footer>
      )}
    </div>
  ),
  DropdownItem: (p: {
    label?: string;
    menuLabel?: string;
    disabled?: boolean;
    description?: ReactNode;
    rgOptions: { data: string; label: string }[];
    selectedOption: string | null;
  }) => (
    <div>
      <select
        aria-label={p.label ?? p.menuLabel}
        disabled={p.disabled}
        defaultValue={p.selectedOption ?? undefined}
      >
        {p.rgOptions.map((o) => (
          <option key={o.data} value={o.data}>
            {o.label}
          </option>
        ))}
      </select>
      {p.description}
    </div>
  ),
  DialogBodyText: box,
  MenuSeparator: box,
  ToggleField: ({
    label,
    checked,
    onChange,
  }: {
    label?: string;
    checked?: boolean;
    onChange?: (on: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked ?? false}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.checked)}
    />
  ),
  showModal: () => ({ Close: () => {} }),
};
