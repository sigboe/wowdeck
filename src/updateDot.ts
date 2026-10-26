import { DECKY } from "./steamTheme";

/**
 * The update dot's colour language: one semantic colour per kind of news,
 * so a surface says what it means and the look lives here. Only "update"
 * (WoWDeck itself) ships; green for addon updates and red for errors are
 * reserved for later rounds, blue is not used.
 */
export type DotColor = "update";

/**
 * Decky Loader's notification badge (frontend NotificationBadge, the orange
 * dot on a plugin with an update in Decky's plugin list): #ffa500, 10 x 10 px,
 * half-radius, pinned top-right. Decky insets it 8 px from the corner of its
 * large rows; on our 34 px tab pill that would land it wholly on the focused
 * (white) pill, so UpdateDot pins it to the corner itself.
 */
export const DOT_FILL: Record<DotColor, string> = {
  update: DECKY.notification,
};
export const DOT_SIZE_PX = 10;
