import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { deckyUiStub } from "./deckyUiStub";
import type {
  Installation,
  InstallationRecoveryDetails,
  RecoveryRetryResult,
  RecoveryVerifyResult,
} from "./types";

mock.module("@decky/api", () => ({ toaster: { toast: () => {} } }));

// Steam supplies these controls at runtime (the findWow.test.tsx pattern).
mock.module("@decky/ui", () => deckyUiStub);
// The engine bridge and module session are Decky's; these renders never call them.
mock.module("./services/backend", () => ({ rpc: async () => ({}) }));
mock.module("./session", () => ({
  addonSession: { subscribe: () => () => {}, get: () => ({}) },
}));

const { RecoveryNoticeRow } = await import("./components/RecoveryNotice");
const { RecoveryDetailsContent, RecoveryDetailsFooter } =
  await import("./components/RecoveryDetailsModal");
const { InstallationDetailsModal } = await import("./components/InstallationDetailsModal");

const retail = { id: "A", displayName: "Retail" } as Installation;

describe("recovery notice", () => {
  test("shows state repair instructions on every tab without installations", () => {
    for (const view of ["qam.installed", "qam.browse", "qam.options"]) {
      const html = renderToStaticMarkup(
        <RecoveryNoticeRow
          view={view}
          installation={null}
          stateFile={{
            reason: "Saved state is unreadable",
            nextStep: "Restore state.json and restart WoWDeck",
          }}
        />,
      );
      expect(html).toContain("Saved addon information can&#x27;t be read");
      expect(html).toContain("Settings changes aren&#x27;t saved");
      expect(html).toContain("Restore state.json and restart WoWDeck");
    }
  });
  test("names the affected installation", () => {
    const html = renderToStaticMarkup(
      <RecoveryNoticeRow view="qam.installed" installation={retail} />,
    );
    expect(html).toContain("Retail needs recovery");
    expect(html).toContain("unverified");
  });

  test("an unaffected installation shows nothing", () => {
    expect(renderToStaticMarkup(<RecoveryNoticeRow view="qam.browse" installation={null} />)).toBe(
      "",
    );
  });
});

describe("recovery details view", () => {
  const details: InstallationRecoveryDetails = {
    installationId: "A",
    installationName: "Retail",
    status: "recoveryRequired",
    operations: [
      {
        transactionId: "tx-1",
        addonName: "Suite",
        originalVersion: "1.0",
        operation: "update",
        startedAt: null,
        preserved: [{ location: "AddOns/.wowdeck/tx-1/backup/Suite", belongsAt: "AddOns/Suite" }],
        conflicts: [
          { location: "AddOns/Suite", reason: "Holds the files this addon change put here." },
        ],
      },
    ],
    retry: { available: true },
    verify: { available: true },
  };
  const render = (
    d: InstallationRecoveryDetails | null,
    error: string | null = null,
    outcome: RecoveryRetryResult | RecoveryVerifyResult | null = null,
  ) =>
    renderToStaticMarkup(
      <RecoveryDetailsContent
        installationName="Retail"
        details={d}
        error={error}
        now={0}
        outcome={outcome}
      />,
    );
  const footer = (
    d: InstallationRecoveryDetails | null,
    running: "retry" | "verify" | null = null,
  ) =>
    renderToStaticMarkup(
      <RecoveryDetailsFooter
        details={d}
        running={running}
        onRetry={() => {}}
        onVerify={() => {}}
        onClose={() => {}}
      />,
    );

  test("offers Retry recovery in its footer when the engine says it applies", () => {
    expect(footer(details)).toContain("Retry recovery");
    expect(footer(details)).not.toContain("disabled");
    expect(footer(details, "retry")).toContain('<button disabled="">Retrying recovery…</button>');
    expect(footer(details, "retry")).toContain('<button disabled="">Verify recovery</button>');
  });

  test("offers Verify recovery in its footer, off while either action runs", () => {
    expect(footer(details)).toContain("<button>Verify recovery</button>");
    expect(footer(details, "verify")).toContain('<button disabled="">Verifying recovery…</button>');
    expect(footer(details, "verify")).toContain('<button disabled="">Retry recovery</button>');
    expect(footer({ ...details, status: "ready", operations: [] })).not.toContain(
      "Verify recovery",
    );
  });

  test("offers no Retry recovery when it doesn't apply, and says what to do instead", () => {
    const unavailable: InstallationRecoveryDetails = {
      ...details,
      retry: {
        available: false,
        reason: "WoWDeck can't read it",
        nextStep: "Put the files back by hand",
      },
      verify: {
        available: false,
        reason: "WoWDeck can't read it",
        nextStep: "Put the files back by hand",
      },
    };
    expect(footer(unavailable)).not.toContain("Retry recovery");
    expect(footer(unavailable)).not.toContain("Verify recovery");
    expect(footer(null)).not.toContain("Retry recovery");
    expect(footer({ ...details, status: "ready", operations: [] })).not.toContain("Retry recovery");
    const html = render(unavailable);
    expect(html).toContain("Retry recovery and Verify recovery aren&#x27;t available");
    expect(html).toContain("WoWDeck can&#x27;t read it. Put the files back by hand");
  });

  test("shows a refused retry's reason, next step and conflicts", () => {
    const html = render(details, null, {
      installationId: "A",
      status: "refused",
      restored: [],
      reason: "Files changed since the addon change stopped",
      nextStep: "Put the files listed here back as they were, then try again",
      conflicts: [{ location: "AddOns/.wowdeck/rollback/a/Suite", reason: "Its files changed." }],
    });
    expect(html).toContain("Retry recovery stopped");
    expect(html).toContain(
      "Files changed since the addon change stopped. Put the files listed here back as they were, then try again. Nothing was overwritten or deleted",
    );
    expect(html).toContain("AddOns/.wowdeck/rollback/a/Suite");
    expect(html).toContain("Its files changed.");
  });

  test("shows a finished retry", () => {
    const html = render({ ...details, status: "ready", operations: [] }, null, {
      installationId: "A",
      status: "recovered",
      restored: ["Suite"],
    });
    expect(html).toContain("Recovery finished");
  });

  test("shows what still differs after a refused verification", () => {
    const html = render(details, null, {
      installationId: "A",
      status: "refused",
      verified: [],
      reason: "The original files aren't all back yet",
      nextStep: "Put the original files back where they belong, then verify again",
      conflicts: [{ location: "AddOns/Suite", reason: "Its files differ from the original." }],
    });
    expect(html).toContain("Verify recovery found differences");
    expect(html).toContain(
      "The original files aren&#x27;t all back yet. Put the original files back where they belong, then verify again. Nothing was changed",
    );
    expect(html).toContain("Its files differ from the original.");
  });

  test("shows a finished verification", () => {
    const html = render({ ...details, status: "ready", operations: [] }, null, {
      installationId: "A",
      status: "verified",
      verified: ["Suite"],
    });
    expect(html).toContain("Recovery verified");
    expect(html).toContain("The original files and addon information are back");
  });

  test("shows the engine's preserved locations and conflicts", () => {
    const html = render(details);
    expect(html).toContain("Suite");
    expect(html).toContain("Update stopped · was version 1.0");
    expect(html).toContain("AddOns/.wowdeck/tx-1/backup/Suite");
    expect(html).toContain("It belongs at AddOns/Suite");
    expect(html).toContain("Holds the files this addon change put here.");
  });

  test("says when it is loading, failed, or nothing needs recovery", () => {
    expect(render(null)).toContain("Reading the recovery details");
    expect(render(null, "engine busy")).toContain("engine busy");
    expect(render({ ...details, status: "ready", operations: [] })).toContain(
      "Retail doesn&#x27;t need recovery",
    );
  });
});

describe("Options installation details while recovery is required", () => {
  const render = (recoveryRequired: boolean) =>
    renderToStaticMarkup(
      <InstallationDetailsModal
        installation={{ ...retail, path: "/home/deck/wow/_retail_", version: null } as Installation}
        counts={{ installed: 2, managed: 1 }}
        actions={{
          onUpdate: async () => retail as Installation,
          onRescan: () => {},
          onRemove: () => {},
          recoveryRequired,
        }}
      />,
    );

  test("rescan and removal are off and say why", () => {
    const html = render(true);
    expect(html.match(/data-disabled="true"/g)).toHaveLength(2);
    expect(html).toContain("Not available until this installation&#x27;s recovery is done");
  });

  test("an unaffected installation keeps both", () => {
    const html = render(false);
    expect(html).not.toContain("data-disabled");
    expect(html).toContain("Finds addons added or changed outside");
  });
});
