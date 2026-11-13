# Third-party notices

WoWDeck Addon Manager is free software under the GPL-3.0. It is built on
other people's open-source work. This page lists that work, its license and
what WoWDeck uses it for. The license texts named here come with WoWDeck in
its LICENSE file, or are linked below.

## WowUp

[WowUp](https://github.com/WowUp/WowUp) is a desktop addon manager for
World of Warcraft, licensed under the GPL-3.0. WoWDeck's addon engine is
adapted from WowUp's code: finding WoW installations, reading addon files,
and talking to CurseForge, WowUp Hub, TukUI, GitHub and WoWInterface.
WowUp's `wowup-lib` package says ISC in its package file, but WoWDeck treats
every part it took from WowUp as GPL-3.0.

## Decky Loader and its plugin template

[Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) runs
WoWDeck inside Steam's Game Mode. WoWDeck started from Decky's
[plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template),
which is licensed under BSD-3-Clause; its license text is at the end of
WoWDeck's LICENSE file. WoWDeck's screens use Decky's `@decky/ui` and
`@decky/api` libraries, published by SteamDeckHomebrew under BSD-3-Clause
and GPL-3.0.

## Bun

[Bun](https://bun.sh) is a JavaScript runtime, licensed under the MIT
license. WoWDeck's engine, the program that installs and updates your
addons, is a single file that has Bun built in.

## fflate

[fflate](https://github.com/101arrowz/fflate), licensed under the MIT
license, unpacks the zip files that addons come in. WoWDeck checks every
file in a zip before unpacking it, so an addon can't write outside its own
folder.

## uqr

[uqr](https://github.com/unjs/uqr) by Anthony Fu, licensed under the MIT
license, draws the QR codes under Options › About › Support WoWDeck. The
license text is in
[uqr's repository](https://github.com/unjs/uqr/blob/main/LICENSE).

## In the source code only

These are part of WoWDeck's source code on GitHub, but not of the plugin
you install.

- The button and icon pictures in the README. Steam's button glyphs are
  © Valve Corporation. The gear is from
  [Bootstrap Icons](https://github.com/twbs/icons) (MIT). The other icons
  are Font Awesome Free 5 by Fonticons, Inc., under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), the same icons
  WoWDeck shows on screen.
- A writing guide for the project's coding agents, the `unslop` skill from
  [pstack](https://github.com/cursor/plugins/tree/main/pstack), MIT,
  © 2026 Lauren Tan.

## tsm-app-linux

The TradeSkillMaster sign-in, auction-data protocol and AppData writer follow
[tsm-app-linux](https://github.com/exceptionptr/tsm-app-linux), commit
`1908e34930f742a3a9ce754faf4e1839431fff3a`, under the MIT license.

Copyright © 2026 exceptionptr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
