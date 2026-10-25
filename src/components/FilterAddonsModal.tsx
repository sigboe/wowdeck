import { useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogButtonPrimary,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Focusable,
  ModalRoot,
  TextField,
  showModal,
} from "@decky/ui";
import { TextRow } from "./TextRow";

/**
 * The My Addons text filter (WF-06), behind a glyph-only button so the list
 * gets no extra rows (owner, 2026-10-16). A Steam dialog with one text row
 * (S28): Filter applies (also Enter on the keyboard), Show all clears, B
 * leaves the filter as it was. The panel is unmounted while this is open
 * (G4), so the result goes to module state, never to the panel.
 */
function FilterAddonsModal({
  current,
  onApply,
  closeModal,
}: {
  current: string;
  onApply: (filter: string) => void;
  closeModal?: () => void;
}) {
  const [text, setText] = useState(current);
  const apply = (value: string) => {
    onApply(value);
    closeModal?.();
  };
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>Filter My Addons</DialogHeader>
      <DialogBody>
        <DialogControlsSection>
          <TextRow label="Name, folder, author or source" layout="inline">
            <TextField
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  apply(text);
                }
              }}
            />
          </TextRow>
        </DialogControlsSection>
      </DialogBody>
      <DialogFooter>
        <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
          <DialogButtonPrimary onClick={() => apply(text)}>Filter</DialogButtonPrimary>
          <DialogButton onClick={() => apply("")}>Show all</DialogButton>
        </Focusable>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openFilterAddonsModal(current: string, onApply: (filter: string) => void): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <FilterAddonsModal current={current} onApply={onApply} closeModal={close} />,
    window,
    { strTitle: "Filter My Addons", bHideMainWindowForPopouts: false },
  );
}
