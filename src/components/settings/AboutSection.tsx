import { useEffect, useRef, useState } from "react";
import { Field, PanelSection } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import type { AboutInfo } from "../../types";
import * as api from "../../services/backend";
import {
  aboutRows,
  lastAboutInfo,
  noticesText,
  rememberAboutInfo,
  type AboutRow,
  type AboutRowId,
} from "../../about";
import { descriptionStyle } from "../../steamTheme";
import { AboutFunding, AboutMarkdown, AboutNames, openAboutModal } from "../AboutModal";
import { rememberedFocus, revealRemembered } from "../../focusMemory";
import { SettingsRow, VIEW } from "./common";

/**
 * Options › About, the last section: the rows src/about.ts picks from
 * about.get (local only, so the answer is there at once), each opening its
 * own modal. Every row is a SettingsRow, so focus memory brings it back;
 * the section starts from the last answer (lastAboutInfo), so after a modal
 * closes and the panel remounts (G4) the row that opened it is already there.
 */
export function AboutSection() {
  const [info, setInfo] = useState<AboutInfo | null>(lastAboutInfo);

  useEffect(() => {
    api
      .rpc("about.get")
      .then((answer) => {
        rememberAboutInfo(answer);
        setInfo(answer);
      })
      .catch(() => {
        // engine not ready: the last answer, or the always-shown rows, stay
      });
  }, []);

  // Rows that arrive with about.get land above the row focus memory brought
  // back, which pushes it down out of sight while Steam, seeing no focus
  // change, doesn't scroll (DEVICE 2026-10-30). Bring it back into view.
  const rows = aboutRows(info);
  const rowIds = rows.map((row) => row.id).join();
  const shownIds = useRef(rowIds);
  useEffect(() => {
    if (shownIds.current === rowIds) {
      return;
    }
    shownIds.current = rowIds;
    if (rows.some((row) => row.id === rememberedFocus(VIEW))) {
      revealRemembered(VIEW);
    }
  }, [rowIds]);

  const open: Record<AboutRowId, (row: AboutRow) => void> = {
    supportWoWDeck: (row) =>
      openAboutModal(
        row.label,
        (close) => <AboutFunding links={info?.funding ?? []} closeModal={close} />,
        "focus",
      ),
    showSupporters: (row) =>
      openAboutModal(row.label, () => <AboutNames names={info?.supporters ?? []} />),
    thirdPartyNotices: (row) =>
      openAboutModal(row.label, (close) => (
        <AboutMarkdown markdown={noticesText(info)} closeModal={close} />
      )),
  };

  return (
    <PanelSection title="About">
      {rows.map((row) => (
        <SettingsRow key={row.id} id={row.id}>
          <Field
            focusable
            label={row.label}
            description={<span style={descriptionStyle}>{row.description}</span>}
            onClick={() => open[row.id](row)}
          >
            <FaChevronRight />
          </Field>
        </SettingsRow>
      ))}
    </PanelSection>
  );
}
