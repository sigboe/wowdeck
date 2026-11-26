// Swap the player's avatar in Steam's top bar for Steam's default avatar and
// hide the equipped avatar frame, for screenshots that go into the README.
// Only the open Big Picture window changes, until Steam draws the bar again;
// nothing is saved. The clock and the other icons keep their places. Run it
// a second time to put the player's avatar and frame back.
//
//   tools/deck-ui/deck run 'target Big Picture; eval --file=tools/deck-ui/readme-avatar.js; shot docs/screenshot.png --max=1280'
//
// Steam's own classes, read on the Deck (DEVICE 2026-11-26): `img.avatar`
// inside `.avatarHolder`, and `.avatarFrame` for the frame. The default
// avatar is Steam's "?" avatar, from Steam's avatar cache, else its CDN.
(async () => {
  const DEFAULT = "fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";
  const sources = [
    `https://steamloopback.host/clientassets/avatars/${DEFAULT}`,
    `https://avatars.fastly.steamstatic.com/${DEFAULT}`,
  ];
  const avatars = [...document.querySelectorAll(".avatarHolder img.avatar")];
  if (!avatars.length) return "no avatar found: is this the Big Picture window?";
  const frames = [...document.querySelectorAll(".avatarHolder .avatarFrame")];
  if (avatars.some((img) => img.dataset.readmeSrc !== undefined)) {
    for (const img of avatars) {
      if (img.dataset.readmeSrc === undefined) continue;
      img.src = img.dataset.readmeSrc;
      img.srcset = img.dataset.readmeSrcset;
      delete img.dataset.readmeSrc;
      delete img.dataset.readmeSrcset;
    }
    for (const frame of frames) frame.style.visibility = "";
    return "avatar and frame restored";
  }
  const load = (src) =>
    new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(probe.naturalWidth > 0);
      probe.onerror = () => resolve(false);
      probe.src = src;
    });
  let used = null;
  for (const src of sources) {
    if (await load(src)) {
      used = src;
      break;
    }
  }
  if (!used) return "default avatar did not load; nothing changed";
  for (const img of avatars) {
    img.dataset.readmeSrc = img.src;
    img.dataset.readmeSrcset = img.srcset;
    img.srcset = "";
    img.src = used;
  }
  for (const frame of frames) frame.style.visibility = "hidden";
  return `avatar replaced (${avatars.length}) from ${new URL(used).host}, frames hidden (${frames.length})`;
})()
