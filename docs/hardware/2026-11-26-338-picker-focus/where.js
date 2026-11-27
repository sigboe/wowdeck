(() => {
  const e = doc.querySelector('.gpfocus');
  const zone = doc.querySelector('.wowdeck-list-zone');
  const view = zone ? (getComputedStyle(zone).display === 'flex' ? 'widened' : 'collapsed') : 'no-get-addons-zone';
  if (!e) return 'WHERE focus=NONE view=' + view;
  let picker = false, f = e[Object.keys(e).find(k => k.startsWith('__reactFiber$'))];
  for (let i = 0; f && i < 40; i++, f = f.return) { const n = f.type && (f.type.displayName || f.type.name); if (n === 'InstallationSelect') { picker = true; break; } }
  const label = (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const cls = [...e.classList].filter(c => /^[A-Za-z]/.test(c) && !/^[A-Za-z0-9_-]{8,}$/.test(c) || c.startsWith('wowdeck') || c.startsWith('Dialog')).join('.');
  const what = picker ? 'PICKER' : e.classList.contains('wowdeck-tab') ? 'TAB' : 'OTHER';
  return `WHERE ${what} label="${label}" role=${e.getAttribute('role') || '-'} class=${cls} view=${view}`;
})()
