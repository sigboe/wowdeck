import { STEAM } from "../steamTheme";
import { moneyParts } from "../text";

/**
 * WoW's coin colours as TradeSkillMaster writes money (owner, PR #318
 * review): gold, silver and copper each in its own colour, so an amount
 * reads at a glance the way it does in game. WoW's colours, not Steam's.
 */
export const COIN_COLOURS = { g: "#ffd70a", s: "#c7c7cf", c: "#eda55f" } as const;

/**
 * Money as WoW writes it, "1,234g 56s 78c", each coin in its colour. A loss
 * keeps the coin colours behind a minus in Steam's danger red, so the sign
 * carries the meaning and not the colour alone (S13).
 */
export function Money({ copper }: { copper: number }) {
  const { negative, parts } = moneyParts(copper);
  return (
    <span className="wowdeck-money">
      {negative && <span style={{ color: STEAM.danger }}>-</span>}
      {parts.map(({ amount, unit }, index) => (
        <span key={unit} style={{ color: COIN_COLOURS[unit] }}>
          {index > 0 ? " " : ""}
          {amount}
          {unit}
        </span>
      ))}
    </span>
  );
}
