/**
 * Addon-list import/export (project-owned), WowUp-compatible wire format.
 *
 * Adapted from WowUp (GPL-3.0).
 * Upstream: wowup-electron/src/app/services/addons/addon-broker.service.ts
 * Commit: 4fdae600d94ad7dd187a6bc93b517e657100b01a
 * Modified: yes — the exported/imported JSON schema (collection_name,
 *   client_type, addons[].{name,provider_name,id,version_id}) and the
 *   base64-of-UTF8-JSON encoding are kept byte-compatible with upstream
 *   so a list exported by WowUp imports here and vice versa. Departs
 *   from upstream in two deliberate ways: unsupported export entries are
 *   reported instead of silently dropped, and an import entry whose
 *   provider is unavailable is marked "unresolved" (its own row) instead
 *   of failing the entire import the way upstream's MISSING_ADDON_PROVIDERS
 *   does — a per-entry provider gap shouldn't block every other entry
 *   that doesn't need that provider. One additive key: an entry may carry
 *   `dependency: true` (a library); WowUp ignores it, see
 *   docs/addon-list-format.md.
 * See docs/wowup-provenance.md.
 */

import type { ImportComparison, ImportSummary } from "../../api/contracts";
import type { WowInstallation } from "../models";
import type { AddonRecord } from "./AddonRecords";
import { WowClientType } from "../types";
import { getWowGameType } from "../utils/gametype";
import { ValidationError, providerDisplayName } from "../errors";
import type { ProviderRegistry } from "../providers/provider-registry";

/** Raw wire shape — field names match WowUp's own JSON exactly (interop, not this project's camelCase convention). */
export interface ExportPayloadJson {
  collection_name?: string;
  client_type: string;
  addons: ExportAddonJson[];
}

export interface ExportAddonJson {
  name: string;
  provider_name: string;
  id: string;
  version_id?: string;
  /**
   * Installed only as another addon's required dependency (isDependency).
   * Our own addition, written only when true: WowUp ignores unknown keys
   * (docs/addon-list-format.md), and its own exports never have it.
   */
  dependency?: boolean;
}

export interface ImportSummaryError {
  code: "empty_import" | "incompatible_client" | "malformed_import" | "too_large";
  message: string;
}

const MAX_IMPORT_STRING_LENGTH = 2_000_000;
const MAX_ADDON_COUNT = 1000;

/** TS numeric enums carry a name->number AND number->name mapping on the same object; only accept a genuine member name. */
function clientTypeFromExportName(name: string): WowClientType | undefined {
  const value = (WowClientType as unknown as Record<string, number>)[name];
  return typeof value === "number" && WowClientType[value] === name ? value : undefined;
}

function isAddonExportable(addon: AddonRecord): addon is AddonRecord & { providerName: string; externalId: string } {
  return !!addon.providerName && !!addon.externalId;
}

/**
 * Builds the WowUp-compatible export payload for one installation's
 * non-ignored, resolvable addons. Addons without a provider/external id
 * (nothing should produce one in this plugin, but defensively handled
 * the same as a scan-matched-nothing case) are reported in `unsupported`
 * rather than silently dropped the way upstream's own try/catch-and-log
 * does — a truthful export report beats a silent gap.
 */
export function buildExportPayload(
  addons: readonly AddonRecord[],
  installation: WowInstallation,
): { payload: ExportPayloadJson; unsupported: { name: string; reason: string }[] } {
  const unsupported: { name: string; reason: string }[] = [];
  const exportable: ExportAddonJson[] = [];

  for (const addon of addons) {
    if (!isAddonExportable(addon)) {
      unsupported.push({ name: addon.name, reason: "Not from a known addon source" });
      continue;
    }
    exportable.push({
      name: addon.name,
      provider_name: addon.providerName,
      id: addon.externalId,
      version_id: addon.installedExternalReleaseId ?? undefined,
      ...(addon.isDependency ? { dependency: true } : {}),
    });
  }

  const payload: ExportPayloadJson = {
    collection_name: `wowdeck_export_${Date.now()}`,
    client_type: WowClientType[installation.clientType] ?? "Retail",
    addons: exportable,
  };
  return { payload, unsupported };
}

/** Exactly WowUp's own encoding: base64 of the UTF-8 JSON string. */
export function encodeExportString(payload: ExportPayloadJson): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

/**
 * Exactly WowUp's own detection: a string starting with `{` is treated as
 * raw JSON, anything else is base64-decoded first. Any malformed input
 * (bad base64, invalid JSON, non-object payload) throws ValidationError —
 * never installs anything, never leaves the caller guessing.
 */
export function decodeImportString(input: string): ExportPayloadJson {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ValidationError("Paste an export code first");
  }
  if (trimmed.length > MAX_IMPORT_STRING_LENGTH) {
    throw new ValidationError("That export code is too long");
  }

  let jsonStr = trimmed;
  if (trimmed.charAt(0) !== "{") {
    try {
      jsonStr = Buffer.from(trimmed, "base64").toString("utf-8");
    } catch {
      throw new ValidationError("That isn't an addon list export code");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ValidationError("That isn't an addon list export code");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("That isn't an addon list export code");
  }
  return parsed as ExportPayloadJson;
}

/**
 * Whole-import compatibility rules (empty list / unknown or incompatible
 * client) mirror upstream's own all-or-nothing checks — these aren't
 * per-entry problems, so there's nothing to partially salvage. Per-entry
 * provider availability, below in computeImportSummary, is where this
 * project deliberately diverges from upstream's all-or-nothing behavior.
 */
export function computeImportSummary(
  payload: ExportPayloadJson,
  currentAddons: readonly AddonRecord[],
  installation: WowInstallation,
  registry: ProviderRegistry,
): ImportSummary | ImportSummaryError {
  if (!Array.isArray(payload.addons) || payload.addons.length === 0) {
    return { code: "empty_import", message: "This list has no addons in it" };
  }
  if (payload.addons.length > MAX_ADDON_COUNT) {
    return { code: "too_large", message: `Too many addons in one list (at most ${MAX_ADDON_COUNT})` };
  }

  const importedClientType = clientTypeFromExportName(payload.client_type);
  if (importedClientType === undefined) {
    return {
      code: "incompatible_client",
      message: "This list is for a WoW version WoWDeck Addon Manager doesn't know",
    };
  }
  if (getWowGameType(importedClientType) !== getWowGameType(installation.clientType)) {
    return {
      code: "incompatible_client",
      message: "This list is for a different WoW version than the selected installation",
    };
  }

  const comparisons: ImportComparison[] = [];
  const seen = new Set<string>();

  for (const entry of payload.addons) {
    if (!entry || typeof entry.provider_name !== "string" || typeof entry.id !== "string") {
      // Reported, not silently dropped — a truthful summary accounts for
      // every entry in the import, even a malformed one.
      comparisons.push({
        name: (entry && typeof entry.name === "string" && entry.name) || "(unknown)",
        providerId: (entry && typeof entry.provider_name === "string" && entry.provider_name) || "",
        externalId: (entry && typeof entry.id === "string" && entry.id) || "",
        versionId: null,
        state: "unresolved",
        reason: "This entry is damaged",
        dependency: false,
      });
      continue;
    }
    const key = `${entry.provider_name}:${entry.id}`;
    const versionId = entry.version_id ?? null;
    const name = entry.name || entry.id;
    const dependency = entry.dependency === true;

    if (seen.has(key)) {
      comparisons.push({
        name,
        providerId: entry.provider_name,
        externalId: entry.id,
        versionId,
        dependency,
        state: "conflict",
        reason: "Listed twice. The first one is used.",
      });
      continue;
    }
    seen.add(key);

    const provider = registry.get(entry.provider_name);
    if (!provider) {
      comparisons.push({
        name,
        providerId: entry.provider_name,
        externalId: entry.id,
        versionId,
        dependency,
        state: "unresolved",
        reason: `${providerDisplayName(entry.provider_name)} isn't supported`,
      });
      continue;
    }
    if (!registry.usable(entry.provider_name)) {
      comparisons.push({
        name,
        providerId: entry.provider_name,
        externalId: entry.id,
        versionId,
        dependency,
        state: "unresolved",
        reason: `${providerDisplayName(entry.provider_name)} is turned off or not set up in Options`,
      });
      continue;
    }

    const existing = currentAddons.find(
      (a) => a.installationId === installation.id && a.providerName === entry.provider_name && a.externalId === entry.id,
    );
    if (existing) {
      comparisons.push({
        name,
        providerId: entry.provider_name,
        externalId: entry.id,
        versionId,
        dependency,
        state: versionId === (existing.installedExternalReleaseId ?? null) ? "no_change" : "conflict",
        reason:
          versionId === (existing.installedExternalReleaseId ?? null)
            ? null
            : "You have a different version. Update it from My Addons.",
      });
      continue;
    }

    const nameMatch = currentAddons.find(
      (a) => a.installationId === installation.id && name.length > 0 && a.name.toLowerCase() === name.toLowerCase(),
    );
    if (nameMatch) {
      comparisons.push({
        name,
        providerId: entry.provider_name,
        externalId: entry.id,
        versionId,
        dependency,
        state: nameMatch.providerName === entry.provider_name ? "no_change" : "conflict",
        reason:
          nameMatch.providerName === entry.provider_name
            ? null
            : nameMatch.providerName
              ? `You have it from ${providerDisplayName(nameMatch.providerName)}`
              : "You installed it manually",
      });
      continue;
    }

    comparisons.push({ name, providerId: entry.provider_name, externalId: entry.id, versionId, dependency, state: "new", reason: null });
  }

  return {
    addedCt: comparisons.filter((c) => c.state === "new").length,
    noChangeCt: comparisons.filter((c) => c.state === "no_change").length,
    conflictCt: comparisons.filter((c) => c.state === "conflict").length,
    unresolvedCt: comparisons.filter((c) => c.state === "unresolved").length,
    comparisons,
  };
}

export function isImportSummaryError(value: ImportSummary | ImportSummaryError): value is ImportSummaryError {
  return "code" in value;
}

/**
 * Export and preview of an installation's addon list (WowUp-compatible). Every
 * import error code comes from this file. Installing an import is
 * AddonService.importAddonList's: it owns installs and library flags.
 */
export class AddonListPortability {
  constructor(
    private addonsFor: (installationId: string) => readonly AddonRecord[],
    private registry: ProviderRegistry,
  ) {}

  async export(installation: WowInstallation): Promise<{
    payload: string;
    collectionName: string;
    exportedCount: number;
    ignoredCount: number;
    unsupported: { name: string; reason: string }[];
  }> {
    const addons = this.addonsFor(installation.id);
    const ignoredCount = addons.filter((a) => a.isIgnored).length;
    const { payload, unsupported } = buildExportPayload(addons.filter((a) => !a.isIgnored), installation);
    return {
      payload: encodeExportString(payload),
      collectionName: payload.collection_name ?? "",
      exportedCount: payload.addons.length,
      ignoredCount,
      unsupported,
    };
  }

  /**
   * Parsing/preview never mutates installed state — decode and compare
   * only. An import re-derives this same summary itself rather than
   * trusting a client-held copy of it, so a preview can never go stale
   * between the two calls.
   */
  preview(
    importString: string,
    installation: WowInstallation,
  ): { summary: ImportSummary | null; error: { code: string; message: string } | null } {
    let payload;
    try {
      payload = decodeImportString(importString);
    } catch (err) {
      return { summary: null, error: { code: "malformed_import", message: err instanceof Error ? err.message : String(err) } };
    }
    const result = computeImportSummary(payload, this.addonsFor(installation.id), installation, this.registry);
    if (isImportSummaryError(result)) {
      return { summary: null, error: result };
    }
    return { summary: result, error: null };
  }
}
