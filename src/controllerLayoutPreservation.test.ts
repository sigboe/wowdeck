import { expect, test } from "bun:test";
import { layoutPreservation, type LayoutRecoveryAdapter } from "./controllerLayoutPreservation";
import { restoreLayout } from "./controllerLayoutRestore";
import { mappingContent } from "./controllerLayoutPreview";
import type {
  ControllerLayoutOperation,
  ControllerLayoutRecoverySnapshot,
} from "../backend/src/api/contracts";
import type { Rpc } from "./services/envelope";
import model from "../backend/tests/fixtures/controller-layouts/decoded-approved.json";

for (const inherited of [false, true]) {
  test(`${inherited ? "inherited defaults" : "personal edits"} survive export selection changes and explicit restoration`, async () => {
    const op: ControllerLayoutOperation = {
      id: "operation",
      phase: "preserving",
      approved: {} as never,
      context: {
        installationId: "retail",
        accountId: 123,
        target: 42,
        controllerIndex: 15,
        controllerType: 4,
        controllerIdentity: "physical",
        selection: "previous semantics",
        scope: { state: "established", identity: "all", targets: [{ appId: 42, name: "WoW" }] },
      },
    };
    let selection = op.context.selection;
    let saved: ControllerLayoutRecoverySnapshot | undefined;
    let exportSealed = false;
    const snapshot: ControllerLayoutRecoverySnapshot = {
      sourceURL: "usercloud://personal/previous",
      mapping: mappingContent(model),
      selections: [0, 1].map((selectionType) => ({
        target: 42,
        selectionType,
        present: !inherited,
        ...(!inherited ? { url: "usercloud://personal/previous" } : {}),
      })),
    };
    let actualSnapshot = structuredClone(snapshot);
    let deliverySnapshot: ControllerLayoutRecoverySnapshot | undefined;
    const native: LayoutRecoveryAdapter = {
      context: async () => ({ ...op.context, selection }),
      operationContext: async () => ({ ...op.context, selection }),
      preview: async () => ({ model, release() {} }),
      apply: async () => {},
      readback: async () => model,
      settled: async () => {},
      subscribe: () => () => {},
      preservationState: async () => structuredClone(actualSnapshot),
      exportLocal: async () => {
        expect(saved).toEqual(snapshot); // durable evidence exists before selection changes
        selection = "local export";
        return "usercloud://personal/export";
      },
      restoreSelections: async (_op, delivered) => {
        actualSnapshot = structuredClone(delivered);
        selection = deliverySnapshot ? "archived URL" : "previous semantics";
      },
    };
    const rpc = (async (
      method: string,
      params: {
        snapshot?: ControllerLayoutRecoverySnapshot;
        phase?: ControllerLayoutOperation["phase"];
      },
    ) => {
      if (method === "controllerLayouts.saveRecovery") {
        saved = structuredClone(params.snapshot!);
        return { recoveryId: op.id };
      }
      if (method === "controllerLayouts.sealRecovery") {
        exportSealed = true;
        return { recoveryId: op.id };
      }
      if (method === "controllerLayouts.prepareRecovery") return deliverySnapshot ?? saved;
      if (method === "controllerLayouts.resumeRestore") return { ...op, phase: "restoring" };
      if (method === "controllerLayouts.advanceOperation") op.phase = params.phase!;
      return op;
    }) as Rpc;
    const preservation = layoutPreservation(rpc, native);
    expect(await preservation.capture(op)).toEqual({ recoveryId: "operation" });
    expect(exportSealed).toBe(true);
    expect(selection).toBe("previous semantics");
    if (!inherited) {
      const sourceURL = "usercloud://wowdeck-recovery/retained/original";
      deliverySnapshot = {
        ...snapshot,
        sourceURL,
        selections: snapshot.selections.map((e) => (e.present ? { ...e, url: sourceURL } : e)),
      };
    }
    selection = "approved";
    op.phase = "succeeded";
    expect(
      await restoreLayout({ rpc, native, operation: op, currentInstallation: () => "retail" }),
    ).toBe("restored");
    expect(selection).toBe(inherited ? "previous semantics" : "archived URL");
    expect(actualSnapshot).toEqual(deliverySnapshot ?? snapshot);
    native.restoreSelections = async () => {
      throw Error("native disappeared");
    };
    op.phase = "recovery-required";
    expect(
      await restoreLayout({ rpc, native, operation: op, currentInstallation: () => "retail" }),
    ).toBe("recovery-required");
    expect(saved).toEqual(snapshot);
    op.phase = "preserving";
    actualSnapshot = structuredClone(snapshot);
    deliverySnapshot = undefined;
    selection = "previous semantics";
    native.exportLocal = async () => {
      selection = "unknown export outcome";
      throw Error("interrupted export");
    };
    await expect(preservation.capture(op)).rejects.toThrow("interrupted export");
    expect(saved).toEqual(snapshot);
    expect(selection).toBe("unknown export outcome");
  });
}
