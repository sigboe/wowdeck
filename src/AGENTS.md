# Frontend UI (`src/`)

A UI change starts in the **task router** of `docs/ui/README.md`: find the
row for what you are changing, read the files it names, and apply every
rule it lists. The rule index there has each rule in one line; this file
repeats only the rules that cost rework most often.

## Rules that cost rework

- **S3, S20**: use Steam's components as they are, with colours and sizes
  from `src/steamTheme.ts`; style our own classes only.
- **S8, S12**: build modals from `ModalRoot`, `DialogHeader`, `DialogBody`
  and `DialogControlsSection`, following Steam's dialog template.
- **S9, S14**: each list item and each modal action is one whole-row
  focus stop (`Field` with `onClick`), its actions on A, X and Menu, named
  in the footer. Focusable `DialogButton`s live only in a modal's footer.
- **S36**: closing a modal, menu or picker returns focus to the row that
  opened it.
- **S21**: QAM rows keep their place (`FocusRow`, recipe R1); scrolling
  views use Valve's scroll buffer (recipe R2).
- **G4, P6, P7**: `showModal` unmounts the QAM panel. State that must
  survive a modal round-trip or a QAM close lives in module scope (with a
  `reset`), and a modal finishes its own work instead of handing data back.
- **S22**: help text sits where it is needed (a row's `description`, a line
  above the controls it explains, or the page bar), or goes when a row
  already shows the information.
- **A2, A9**: render loading, error, empty and success as four states; a
  failed load reads as an error.
- **A5b, C01, C06**: run caught errors through `backendErrorMessage` and
  word them "Couldn't <verb> <thing>".
- **C02–C12**: player text uses sentence case, real plurals, contractions
  and the project's date format.

## Done

A UI change is done when every rule its router row names is applied, and
the verification report (`docs/ui/verification.md`, §8.5) says which tiers
you reached. Hardware claims come only from a device run (`deck-test`).
