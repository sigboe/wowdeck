import type { CSSProperties } from "react";

/**
 * Facts separated by "·" that wrap only between facts, never inside one,
 * and never leave a "·" at the start or end of a line (owner, 2026-10-16:
 * the Details status line broke in the middle of a fact). Each fact is
 * unbreakable and carries its separator in front; the list is shifted left
 * by one separator inside a clipping box, so every line's leading separator
 * falls outside and is cut off. A single fact wider than the line ends in
 * an ellipsis instead of overflowing. CSS: `.wowdeck-facts` in sharedStyles.
 */
export function FactLine({ facts, style }: { facts: string[]; style?: CSSProperties }) {
  if (facts.length === 0) {
    return null;
  }
  return (
    <span className="wowdeck-facts" style={style}>
      <span>
        {facts.map((fact, i) => (
          <span key={`${i}:${fact}`}>{fact}</span>
        ))}
      </span>
    </span>
  );
}
