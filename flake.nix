{
  description = "WoWDeck Addon Manager for Decky (wowdeck): development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # `nix develop` (or `make`, which uses it when nix is on PATH).
      # Not using Nix? Install these from your distro instead.

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bash # Makefile recipe shell
            gnumake # `make setup build test lint package`
            nodejs_22 # frontend build (rollup, tsc, eslint, prettier); runs tools/deck-ui scripts
            pnpm # frontend package manager (pnpm-lock.yaml)
            bun # engine: `bun build --compile` binary, engine and frontend tests
            python3 # tools/package.py, packaging and main.py bridge tests
            patchelf # package.py sets the engine's ELF loader to SteamOS's /lib64 path
            _7zz # engine 7z extraction tests (RAR tests skip without unfree unrar)
            wakeonlan # deck-test skill: wakes the sleeping Steam Deck over its USB Ethernet adapter
          ];
        };
      });
    };
}
