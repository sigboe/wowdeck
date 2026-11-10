import { customIcon } from "./customIcon";
import { faTsmFull, faTsmSmall } from "./tsm";

// Prefer the full mark. Use the simplified version only in cramped placements.
export const TsmIcon = customIcon(faTsmFull);
export const TsmSmallIcon = customIcon(faTsmSmall);
