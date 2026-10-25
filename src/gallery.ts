/**
 * Pure gallery-viewer index logic, pulled out of AddonDetailsModal.tsx
 * so it's unit-testable without @decky/ui. Wraps around (unlike
 * shoulderNav's nextSectionIndex, which clamps) — Next on the last
 * image goes to the first, matching a normal slideshow.
 */
export function nextGalleryIndex(current: number, delta: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (current + delta + count) % count;
}
