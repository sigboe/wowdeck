.PHONY: setup wowup build build-frontend build-backend test typecheck lint format clean package version-set version-check release-tag record-provider-fixtures

# GNU Make uses this shell for recipes. This is independent of the interactive shell.
SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

# USE_NIX=auto: use the flake's dev shell when nix is available and we are
# not already inside it; otherwise use tools from PATH (see flake.nix for the
# list). Override with `make USE_NIX=0 ...` or `make USE_NIX=1 ...`.
USE_NIX ?= auto
ifeq ($(USE_NIX),auto)
  ifneq ($(IN_NIX_SHELL),)
    USE_NIX := 0
  else ifneq ($(shell command -v nix 2>/dev/null),)
    USE_NIX := 1
  else
    USE_NIX := 0
  endif
endif

ifeq ($(USE_NIX),1)
  ifeq ($(shell command -v nix 2>/dev/null),)
    $(error USE_NIX=1 but nix was not found in PATH)
  endif
  TOOL_RUN := nix develop -c bash -c
else ifeq ($(USE_NIX),0)
  TOOL_RUN := bash -c
else
  $(error USE_NIX must be auto, 0, or 1)
endif

setup: wowup
	$(TOOL_RUN) 'set -euo pipefail; pnpm install && (cd backend && bun install)'

# WowUp is a read-only reference only: not tracked, never imported by the
# plugin. The import-compat test needs it (and skips without it), so fetch the
# pinned commit on demand. Keep WOWUP_COMMIT in step with
# docs/development.md's pinned-references table.
WOWUP_REPO   ?= https://github.com/WowUp/WowUp.git
WOWUP_COMMIT ?= 4fdae600d94ad7dd187a6bc93b517e657100b01a

wowup:
	@if [ -f wowup/wowup-lib/src/types.ts ]; then \
	  echo "wowup/ is present at the pinned reference checkout"; \
	  exit 0; \
	fi; \
	echo "fetching WowUp $(WOWUP_COMMIT) into wowup/ (read-only reference)"; \
	mkdir -p wowup; \
	cd wowup; \
	git init -q; \
	git remote add origin $(WOWUP_REPO) 2>/dev/null || git remote set-url origin $(WOWUP_REPO); \
	git fetch -q --depth 1 origin $(WOWUP_COMMIT); \
	git checkout -q FETCH_HEAD

build: build-frontend build-backend

build-frontend:
	$(TOOL_RUN) 'set -euo pipefail; pnpm run build'

build-backend:
	$(TOOL_RUN) 'set -euo pipefail; cd backend && bun run build'

# Frontend (G-2) and beta-release script, engine (G-4) and packaging (G-5) suites.
# The engine's integration tests run the compiled engine, so it is built first:
# a binary left from another branch would test that branch instead.
test: build-backend
	$(TOOL_RUN) 'set -euo pipefail; pnpm test && (cd backend && bun test) && python3 tools/test_package.py && python3 tools/test_version.py && python3 tools/test_main_bridge.py'

typecheck:
	$(TOOL_RUN) 'set -euo pipefail; pnpm run typecheck && (cd backend && bun run typecheck)'

# Re-record the provider cassettes the contract suite replays. Needs the
# network and, for CurseForge, CURSEFORGE_API_KEY or CURSEFORGE_API_KEY_FILE
# (see backend/tests/providers/record.ts). PROVIDERS limits it, e.g. "github".
PROVIDERS ?=
record-provider-fixtures:
	$(TOOL_RUN) 'set -euo pipefail; cd backend && bun tests/providers/record.ts $(PROVIDERS)'

lint:
	$(TOOL_RUN) 'set -euo pipefail; pnpm run lint && pnpm run format:check'

format:
	$(TOOL_RUN) 'set -euo pipefail; pnpm run format'

# Build a distributable plugin zip into build/.
package: build
	$(TOOL_RUN) 'set -euo pipefail; python3 tools/package.py'

# One version in package.json, plugin.json and backend/package.json; the
# release tag is built from it. See tools/version.py.
version-set:
	$(TOOL_RUN) 'set -euo pipefail; python3 tools/version.py set "$(VERSION)"'

version-check:
	$(TOOL_RUN) 'set -euo pipefail; python3 tools/version.py check'

# Creates the annotated v<version> tag (dirty tree and version mismatch
# refused) and prints the push command; it never pushes for you.
release-tag:
	$(TOOL_RUN) 'set -euo pipefail; python3 tools/version.py tag'

clean:
	rm -rf dist build backend/out
