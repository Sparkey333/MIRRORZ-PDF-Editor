// Minimal inline SVG icon set (24x24 stroke icons), injected into buttons.
const I = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const icons = {
  open: I('<path d="M3 7v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9L9 5H4a1 1 0 0 0-1 1z"/>'),
  save: I('<path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3"/><rect x="7" y="13" width="10" height="7"/>'),
  caret: I('<path d="M7 10l5 5 5-5"/>'),
  print: I('<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="1"/><path d="M7 14h10v7H7z"/>'),
  undo: I('<path d="M4 10h11a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
  redo: I('<path d="M20 10H9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
  select: I('<path d="M5 3l14 8-6 1.5L16 19l-3 1.5-3-6.5L5 17V3z"/>'),
  hand: I('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5v-1a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V13m-9-1v6l-2.5-2.5a1.7 1.7 0 0 0-2.4 2.4L8 22h7.5a3.5 3.5 0 0 0 3.5-3.5V7"/>'),
  highlight: I('<path d="M9 15l-4 4H2l4-4"/><path d="M14 3l7 7-9 9-7-7z" fill="currentColor" fill-opacity="0.25"/>'),
  underline: I('<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'),
  strikeout: I('<path d="M17 5H9a3.5 3.5 0 0 0 0 7h6a3.5 3.5 0 0 1 0 7H6"/><path d="M4 12h16"/>'),
  note: I('<path d="M21 4H3v12h5l4 5 4-5h5V4z"/><path d="M7 9h10M7 12h6"/>'),
  text: I('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  ink: I('<path d="M3 17c3-6 5-8 7-6s-2 6 1 6 4-8 7-8 3 8 3 8" /><path d="M3 21h18"/>'),
  rect: I('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: I('<ellipse cx="12" cy="12" rx="8.5" ry="6"/>'),
  line: I('<path d="M5 19L19 5"/>'),
  arrow: I('<path d="M5 19L19 5"/><path d="M11 5h8v8"/>'),
  whiteout: I('<rect x="4" y="8" width="16" height="8" fill="currentColor" fill-opacity="0.25"/><path d="M2 20h20"/>'),
  signature: I('<path d="M3 17c2-4 4-8 6-8s0 8 2 8 3-10 5-10 1 10 3 10h2"/><path d="M3 21h18"/>'),
  stamp: I('<path d="M9 11c-1-4-1-8 3-8s4 4 3 8"/><path d="M5 15a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3H5v-3z"/><path d="M4 21h16"/>'),
  image: I('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.7" cy="10" r="1.6"/><path d="M21 16l-5-5-6 6-2.5-2.5L3 19"/>'),
  zoomIn: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.8-5.8"/><path d="M7.5 10.5h6M10.5 7.5v6"/>'),
  zoomOut: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.8-5.8"/><path d="M7.5 10.5h6"/>'),
  search: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.8-5.8"/>'),
  organize: I('<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><path d="M17.2 13.5v7.5M13.5 17.2h7.5"/>'),
  theme: I('<path d="M12 3a9 9 0 1 0 9 9c-5 2-11-4-9-9z"/>'),
  more: I('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>'),
  thumbs: I('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
  outline: I('<path d="M4 6h4M4 12h4M4 18h4"/><path d="M11 6h9M11 12h9M11 18h9"/>'),
  comments: I('<path d="M21 4H3v12h5l4 5 4-5h5V4z"/>'),
  forms: I('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 9h4M7 14h4"/><rect x="13" y="8" width="5" height="2.5"/><rect x="13" y="13" width="5" height="2.5"/>'),
};

export function applyIcon(btn, name) {
  if (icons[name]) btn.innerHTML = icons[name];
}
