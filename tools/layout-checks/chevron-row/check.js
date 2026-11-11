// Return [{name, value, min, max}] — numbers only, no screenshots.
// Bounds come from docs/UI_DEVELOPMENT_BEST_PRACTICES.md §5.3.
window.__layoutCheck = () => {
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  const row = document.getElementById("row-1");
  const chev = document.getElementById("row-1-chevron");
  const row2 = document.getElementById("row-2");
  return [
    {
      name: "chevron off row vertical center (px)",
      value: Math.abs(center(row) - center(chev)),
      min: 0,
      max: 1,
    },
    {
      name: "gap between rows (px), Steam minimum 6",
      value:
        row2.getBoundingClientRect().top -
        (row.getBoundingClientRect().bottom),
      min: 6,
      max: 8,
    },
  ];
};
