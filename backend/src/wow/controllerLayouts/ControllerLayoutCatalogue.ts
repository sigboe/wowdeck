/**
 * The Controller layouts catalogue (GLOSSARY: Controller layout, Layout
 * revision, Withdrawn revision): the reviewed manifest the maintainers
 * publish from a public catalogue repository, independently of WoWDeck
 * releases (ADR-0015). Read when the destination asks: one bounded request
 * per call (size and time capped), no cache, no polling.
 *
 * The manifest is untrusted data: only parsed and validated, never
 * executed. It applies nothing; native application is #261's.
 *
 * Whether the request runs at all is the caller's to decide: a source
 * toggle gates the destination before it asks (#265).
 */

import type {
  ControllerLayout,
  ControllerLayoutCatalogue,
  ControllerLayoutOffer,
  ControllerLayoutRevision,
} from "../../api/contracts";
import type { NetworkClient } from "../net/network";
import { SingleFlight } from "../utils/SingleFlight";

/**
 * Where the published catalogue is served from: the WoW catalogue in the
 * public sigboe/steam-input-layouts repository (ADR-0015), which validates
 * every change with parseCatalogue. Released clients keep this address, so
 * it never moves. WOWDECK_CONTROLLER_LAYOUTS_URL overrides it (EngineUrls).
 */
export const CONTROLLER_LAYOUT_CATALOGUE_URL =
  "https://raw.githubusercontent.com/sigboe/steam-input-layouts/main/wow/catalogue.json";

/** The newest manifest schema this client reads; a newer one is "unsupported". */
export const CONTROLLER_LAYOUT_SCHEMA_VERSION = 1;

/** The newest layout content format this client can safely apply. */
export const CONTROLLER_LAYOUT_CONTENT_FORMAT = 1;

/** Anything bigger is not a catalogue the maintainers wrote; the request stops downloading past it. */
export const MAX_CATALOGUE_BYTES = 256 * 1024;

/** The whole request, body included. */
export const CATALOGUE_TIMEOUT_MS = 15_000;

/** The most layouts read; the rest are left out. */
export const MAX_LAYOUTS = 200;
/** The most revisions read per layout. */
export const MAX_REVISIONS = 500;
/** The longest title or author, and description, in characters; longer ones end in "…". */
export const MAX_SHORT_TEXT = 120;
export const MAX_DESCRIPTION = 2000;
/** The most metric or provenance fields kept per layout. */
export const MAX_EXTRA_FIELDS = 20;

const LAYOUT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PUBLISHED_FILE_ID = /^[1-9]\d{0,19}$/;
const CONTROLLER_TYPE = /^[a-z0-9_]{1,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** Control characters and the invisible ones that reorder or hide text. */
const UNSHOWN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const MAX_UINT64 = 18446744073709551615n;

export class ControllerLayoutCatalogueSource {
  readonly #reading = new SingleFlight<ControllerLayoutCatalogue>();

  constructor(
    private readonly net: Pick<NetworkClient, "getText">,
    private readonly url: string = CONTROLLER_LAYOUT_CATALOGUE_URL,
  ) {}

  /** The catalogue as published right now; concurrent callers share one request. Never throws. */
  read(): Promise<ControllerLayoutCatalogue> {
    return this.#reading.run(() => this.#read());
  }

  async #read(): Promise<ControllerLayoutCatalogue> {
    let text: string;
    try {
      text = await this.net.getText(this.url, {
        maxBytes: MAX_CATALOGUE_BYTES,
        timeoutMs: CATALOGUE_TIMEOUT_MS,
        redirect: "follow",
      });
    } catch (err) {
      // The network layer's message is already redacted; the URL carries no key.
      console.error(
        JSON.stringify({
          component: "controller-layouts",
          event: "catalogue-unavailable",
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return { state: "unavailable" };
    }
    return parseCatalogue(text);
  }
}

/** A manifest's text → what the destination shows. */
export function parseCatalogue(text: string): ControllerLayoutCatalogue {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return malformed("not JSON");
  }
  if (!isRecord(manifest)) return malformed("not an object");
  const { schemaVersion, layouts } = manifest;
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return malformed("no schemaVersion");
  }
  if (schemaVersion > CONTROLLER_LAYOUT_SCHEMA_VERSION) {
    console.error(
      JSON.stringify({ component: "controller-layouts", event: "catalogue-unsupported", schemaVersion }),
    );
    return { state: "unsupported", schemaVersion };
  }
  if (!Array.isArray(layouts)) return malformed("no layouts list");

  const seen = new Set<string>();
  const read: ControllerLayout[] = [];
  let dropped = 0;
  for (const raw of layouts.slice(0, MAX_LAYOUTS)) {
    const layout = layoutOf(raw);
    if (layout === null || seen.has(layout.id)) {
      dropped++;
      continue;
    }
    seen.add(layout.id);
    read.push(layout);
  }
  if (dropped > 0) {
    console.error(JSON.stringify({ component: "controller-layouts", event: "entries-dropped", dropped }));
  }
  // Entries that all failed are a broken publication, never an empty catalogue.
  if (read.length === 0 && layouts.length > 0) return malformed("no valid entry");
  return { state: "ready", layouts: read };
}

function malformed(reason: string): ControllerLayoutCatalogue {
  console.error(JSON.stringify({ component: "controller-layouts", event: "catalogue-malformed", reason }));
  return { state: "malformed" };
}

function layoutOf(raw: unknown): ControllerLayout | null {
  if (!isRecord(raw)) return null;
  const { id, title, author, description, controllerType, publishedFileId, revisions, metrics, provenance } = raw;
  if (typeof id !== "string" || !LAYOUT_ID.test(id)) return null;
  const shownTitle = text(title, MAX_SHORT_TEXT);
  const shownAuthor = text(author, MAX_SHORT_TEXT);
  if (!shownTitle || !shownAuthor) return null;
  if (description !== undefined && typeof description !== "string") return null;
  if (typeof controllerType !== "string" || !CONTROLLER_TYPE.test(controllerType)) return null;
  if (typeof publishedFileId !== "string" || !PUBLISHED_FILE_ID.test(publishedFileId)) return null;
  if (BigInt(publishedFileId) > MAX_UINT64) return null;
  const history = revisionsOf(revisions);
  if (history === null) return null;

  const { offer, revision } = offerOf(history);
  const shownDescription = text(description, MAX_DESCRIPTION);
  const shownMetrics = metricsOf(metrics);
  const shownProvenance = provenanceOf(provenance);
  return {
    id,
    title: shownTitle,
    author: shownAuthor,
    ...(shownDescription && { description: shownDescription }),
    controllerType,
    publishedFileId,
    offer,
    revision,
    revisions: history,
    ...(shownMetrics && { metrics: shownMetrics }),
    ...(shownProvenance && { provenance: shownProvenance }),
  };
}

/** The revisions oldest first with increasing numbers, or null when the history is unusable. */
function revisionsOf(raw: unknown): ControllerLayoutRevision[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REVISIONS) return null;
  const history: ControllerLayoutRevision[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { number, sha256, contentFormat, withdrawn, previewMappings } = entry;
    if (previewMappings !== undefined && (
      !isRecord(previewMappings) || Object.keys(previewMappings).length > 64 ||
      Object.entries(previewMappings).some(([key, value]) =>
        !/^\d{1,3}$/.test(key) || typeof value !== "string" || !SHA256_HEX.test(value))
    )) return null;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
    if (history.length > 0 && number <= history[history.length - 1]!.number) return null;
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return null;
    if (typeof contentFormat !== "number" || !Number.isSafeInteger(contentFormat) || contentFormat < 1) return null;
    if (withdrawn !== undefined && typeof withdrawn !== "boolean") return null;
    history.push({ number, sha256, contentFormat, withdrawn: withdrawn === true,
      ...(previewMappings !== undefined && { previewMappings: previewMappings as Record<string, string> }),
    });
  }
  return history;
}

/**
 * The newest revision this client may offer for new application: not
 * withdrawn, in a content format it reads. An older approved revision
 * serves an older client when a newer one uses a newer format.
 */
function offerOf(history: ControllerLayoutRevision[]): {
  offer: ControllerLayoutOffer;
  revision: ControllerLayoutRevision | null;
} {
  const live = history.filter((r) => !r.withdrawn);
  const readable = live.filter((r) => r.contentFormat <= CONTROLLER_LAYOUT_CONTENT_FORMAT);
  const newest = readable[readable.length - 1];
  if (newest) return { offer: "available", revision: newest };
  return { offer: live.length > 0 ? "unsupported" : "withdrawn", revision: null };
}

/** Finite, non-negative numbers only; nothing given is absent, never 0. */
function metricsOf(raw: unknown): Record<string, number> | undefined {
  if (!isRecord(raw)) return undefined;
  const kept: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw).slice(0, MAX_EXTRA_FIELDS)) {
    if (FIELD_NAME.test(name) && typeof value === "number" && Number.isFinite(value) && value >= 0) {
      kept[name] = value;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Plain-text notes only. */
function provenanceOf(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw).slice(0, MAX_EXTRA_FIELDS)) {
    const shown = text(value, MAX_SHORT_TEXT);
    if (FIELD_NAME.test(name) && shown) kept[name] = shown;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Shown text: unshown characters removed, whitespace collapsed, capped; "" when not a string. */
function text(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const plain = raw.replace(UNSHOWN, "").replace(/\s+/g, " ").trim();
  const chars = [...plain];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : plain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
