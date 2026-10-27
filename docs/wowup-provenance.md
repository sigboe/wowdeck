# WowUp extraction provenance audit

Every module derived from WowUp carries a provenance header. This file is
the authoritative register. Upstream reference: the `wowup/` checkout pinned
at `4fdae600d94ad7dd187a6bc93b517e657100b01a` (`make wowup`; WowUp 2.23.1,
GPL-3.0; the `wowup-lib` package declares ISC in its package.json — we treat
all extracted code as GPL-3.0 and license the project GPL-3.0 accordingly).

| Project module | Upstream path | Upstream commit | Modified | Reason |
| --- | --- | --- | --- | --- |
| `backend/src/wow/types.ts` | `wowup-lib/src/types.ts` | 4fdae600 | yes | Trimmed provider set; moved helpers out |
| `backend/src/wow/toc/toc.ts` | `wowup-lib/src/toc.ts`; `wowup-electron/src/common/constants.ts`; `wowup-electron/app/services/warcraft/warcraft-platform.service.ts` (`getClientTypeForFolderName`) | 4fdae600 | yes | Merged TOC tags + flavor folder mapping into one module |
| `backend/src/wow/models.ts` | `wowup-lib/src/addons.ts`; `wowup-lib/src/models/warcraft.ts`; `wowup-lib/src/ipc.ts` | 4fdae600 | yes | Trimmed unused fields; renamed Addon→WowAddon; leaner FsStats |
| `backend/src/wow/utils/toc.ts` | `wowup-lib/src/utils/toc.utils.ts` | 4fdae600 | no | Verbatim extraction (minor import changes) |
| `backend/src/wow/providers/curseforge/CurseForgeProvider.ts` | `wowup-electron/src/app/addon-providers/curse-addon-provider.ts` + curseforge-v2 wire shapes | 4fdae600 | yes | User-supplied API key (upstream embeds at build); TOC-id scan instead of murmur2 fingerprints; files ordered stable-first for engine files[0]; GAME_TYPE_LISTS + file compatibility verbatim |
| `backend/src/wow/utils/gametype.ts` | `wowup-lib/src/utils/wow-client.utils.ts` | 4fdae600 | yes | Dropped client groups; added display labels |
| `backend/src/wow/providers/addon-provider.ts` | `wowup-lib/src/addon-provider.ts` | 4fdae600 | yes | Trimmed capability surface (no batch/protocol/ads); changelog and categories kept as optional overrides; capabilities are optional methods with their flags derived from them, URL import its own `resolveUrl`; scan() returns matches (ScanMatch) instead of setting `folder.matchingAddon`, records are built by AddonService (`scannedAddonRecord`), scan order is AddonService's SCAN_ORDER |
| `backend/src/wow/toc/TocParser.ts` | `wowup-electron/src/app/services/toc/toc.service.ts` | 4fdae600 | yes | Pure functions on Bun.file; empty values normalized to undefined; dependency list trimmed |
| `backend/src/wow/addons/AddonScanner.ts` | `wowup-electron/src/app/services/warcraft/warcraft.service.ts` (`listAddons`/`getAddonFolder`) | 4fdae600 | yes | safe-fs paths; read-only; git marking inlined; location semantics = flavor dir |
| `backend/src/wow/installation/InstallationDetector.ts` | informed by `wowup-electron/app/services/warcraft/warcraft-platform.linux.ts`; `WOW_EXECUTABLE_NAMES` from `warcraft-platform.win.ts:15-45` | 4fdae600 | yes | Directory probing instead of product.db decode; Steam/SD-card/Deck layouts added; tiered validity (docs/installation-detection.md) |
| `backend/src/wow/net/network.ts` | replaces `wowup-lib/src/utils/network-interface.ts` + electron `net.request` download path | 4fdae600 | reimplemented | Fetch-based client with timeout, JSON POST, streaming download, URL redaction |
| `backend/src/wow/utils/string.ts` | replaces `string-similarity` dep used by `tukui-addon-provider.ts` | 4fdae600 | reimplemented | Dice bigram coefficient (same semantics) |
| `backend/src/wow/providers/tukui/tukui-model.ts` | `wowup-lib/src/models/tukui.ts` | 4fdae600 | no | Wire model only |
| `backend/src/wow/providers/tukui/TukUiAddonProvider.ts` | `wowup-lib/src/addon-providers/tukui-addon-provider.ts` | 4fdae600 | yes | Native replacements; TTL catalog cache; flavor-aware search; scan returns matches, sub-folder claims tracked locally |
| `backend/src/wow/providers/wowup-hub/wowup-hub-models.ts` | `wowup-lib/src/models/wowup.ts` | 4fdae600 | yes | Trimmed surfaces; string dates |
| `backend/src/wow/providers/wowup-hub/WowUpHubProvider.ts` | `wowup-lib/src/addon-providers/wowup-addon-provider.ts` | 4fdae600 | yes | Batch/protocol/category dropped; featured split into Get Addons Popular (its popular list) and Latest (its recent list); scan consumes scanResults.wowup and returns matches |
| `backend/src/wow/addons/FingerprintScanner.ts` | `wowup-electron/app/wowup-folder-scanner.ts` + `file.utils.ts` (md5) | 4fdae600 | yes | lodash/rxjs/log removed; Bun.CryptoHasher; same file-selection algorithm |
| `backend/src/wow/utils/gameversion.ts` | `wowup-lib/src/utils/addon.utils.ts` | 4fdae600 | no | getGameVerdsion/getGameVersionList verbatim |
| `backend/src/wow/addons/addonStatus.ts` (`needsUpdate`) | `wowup-electron/app/controllers/addon.controller.ts` L102-112 | 4fdae600 | no | Update-detection predicate extracted verbatim; service orchestration is project-owned |
| `backend/src/wow/utils/gameversion.ts` (`toInterfaceVersion`) | `wowup-electron/src/app/utils/addon.utils.ts` (`toInterfaceVersion`/`padInterfacePart`) | 4fdae600 | yes | Only the first 3 dot-separated parts are used (handles 4-part Battle.net build strings); returns `undefined` instead of throwing |
| `backend/src/wow/catalogue/Catalogue.ts` (`search`, `discover`) | `wowup-electron/src/app/services/addons/addon.service.ts` (`search`, `getFeaturedAddons`) | 4fdae600 | yes | No rxjs; a failed provider is reported beside the others' results (`providerErrors`) instead of dropped; Latest/Popular is one source per page instead of every source joined |
| `backend/src/wow/addons/addonStatus.ts` (`updateStatus`) | `wowup-electron/src/app/services/wowup/wowup-addon.service.ts` (`canUpdateAddon`) | 4fdae600 | yes | Reuses this project's own `needsUpdate` instead of upstream's own version-string check; adds a source-off check and the auto-update pause, and says why an addon can't update; `AddonService.eligibleUpdatesFor` filters on it |
| `backend/src/wow/notifications/companion-data.ts` | `wowup-electron/assets/WowUpAddon/data.lua.hbs`, `wowup_data_addon.toc.hbs` (schema only, not the Handlebars source) | 4fdae600 | yes | Built with plain template literals + a Lua string escaper instead of adding a Handlebars dependency for two files; omits the minimap icon field (companion's own icon toggle is hidden in its UI) and the slash-command field (no in-game command to open) |

| `backend/src/wow/providers/zip/ZipProvider.ts` | `wowup-electron/src/app/addon-providers/zip-provider.ts` | 4fdae600 | yes | https only; .rar/.7z links too, the format checked on the downloaded bytes (ArchiveExtractor) instead of a HEAD content-type request; no website (upstream: the link's origin); installed addons stay visible and are skipped by update checks (no `getAll`) instead of forced to ignored |
| `backend/src/wow/addons/AddonPortability.ts` | `wowup-electron/src/app/services/addons/addon-broker.service.ts` | 4fdae600 | yes | Wire JSON schema + base64 encoding kept byte-compatible for interop; unsupported export entries reported instead of dropped; a per-entry unavailable provider is "unresolved" instead of failing the whole import; an optional per-entry `dependency: true` marks libraries, which WowUp ignores (docs/addon-list-format.md) |
| `backend/src/wow/wtf/*` (WtfBackupService, WtfPaths, BackupMeta, ZipWriter, ZipReader, WtfWalker) | `wowup-electron/src/app/services/wtf/wtf.service.ts`; `wowup-electron/app/file.utils.ts` (`zipFile`, `getDirTree`); `app/ipc-events.ts` (`handleZipFile`) | 4fdae600 | reimplemented | `wtf_<epochMs>.zip` naming and the `wowup-meta.json` schema are kept compatible (verified against adm-zip 0.5.12 / yauzl 3.4.0); streaming fflate writer/reader instead of in-memory AdmZip; metadata is built in memory instead of being written into the live WTF folder; `.lua.bak` excluded; backups keyed by game flavor instead of installation id |

WowUp.Addon (the companion addon consumed by the row above) is a
**separate** GPL-3.0 repository (`WowUp/WowUp.Addon`), not vendored in the
reference checkout — read live at commit `6c9304b` for contract verification
only (`AddonManagers.md`, `main.lua`, `config.lua`, `util.lua`,
`WowUp.toc`); no code or assets from it are reused.

## Update procedure

When the `wowup/` reference checkout is moved to a new commit (change
`WOWUP_COMMIT` in `Makefile` and re-run `make wowup`): re-run `bun test` in
`backend/`, diff the upstream paths above against the extracted modules,
refresh this table (new rows for new extractions), and re-verify provenance
headers.
