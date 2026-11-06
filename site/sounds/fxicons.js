// Un icono de línea por efecto (24×24, trazo con el color del texto): ilustra qué hace cada uno de un vistazo.
const P = {
  cassette: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8.5" cy="11.5" r="2"/><circle cx="15.5" cy="11.5" r="2"/><path d="M8 16h8"/>',
  vinyl303: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 12h.01"/>',
  vinyl404: '<circle cx="12" cy="12" r="9"/><path d="M12 7a5 5 0 0 1 5 5M12 17a5 5 0 0 1-5-5"/><circle cx="12" cy="12" r="1"/>',
  chorus: '<path d="M3 7c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>',
  autopitch: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  granular: '<g fill="currentColor" stroke="none"><circle cx="5" cy="8" r="1.4"/><circle cx="10" cy="5" r="1.2"/><circle cx="15" cy="9" r="1.6"/><circle cx="19" cy="6" r="1.1"/><circle cx="7" cy="14" r="1.2"/><circle cx="12" cy="13" r="1.5"/><circle cx="18" cy="14" r="1.2"/><circle cx="5" cy="19" r="1.1"/><circle cx="10" cy="19" r="1.4"/><circle cx="16" cy="19" r="1.2"/></g>',
  tapeecho: '<path d="M4 7v10M9 5v14M14 8v8M19 10v4"/>',
  flanger: '<path d="M3 12l4-6 3 12 3-12 3 12 3-6h2"/>',
  phaser: '<path d="M12 12a1.5 1.5 0 0 1 3 0 4.5 4.5 0 0 1-9 0 7.5 7.5 0 0 1 15 0"/>',
  reverb: '<path d="M4 12h2M10 8a6 6 0 0 1 0 8M14 5a10 10 0 0 1 0 14M18 3a14 14 0 0 1 0 18"/>',
  filterdrive: '<path d="M3 9h7c1.5-3 3-3 4 0l2 6c.5 1.5 2 2 5 2"/>',
  overdrive: '<path d="M3 12c2 0 3-6 6-6h2c3 0 4 12 7 12h3"/>',
  distortion: '<path d="M3 17l4-11h3v11h4V6h3l4 11"/>',
  crusher: '<path d="M3 18h4v-4h4v-4h4V6h6"/>',
  ringmod: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
  slicer: '<rect x="3" y="7" width="3" height="10" rx="1"/><rect x="9" y="7" width="3" height="10" rx="1"/><rect x="15" y="7" width="3" height="10" rx="1"/>',
  stutter: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  tremolo: '<path d="M3 12l2-7 2 14 2-10 2 6 2-2 2 3 2-9 2 12 2-7"/>',
  tapestop: '<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  layer: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
};
/** Elemento <span> con el icono del efecto (decorativo: el nombre ya va en el texto). */
export function fxIcon(id) {
  const s = document.createElement('span');
  s.className = 'fxi'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[id] || P.chorus}</svg>`;
  return s;
}
export const FX_ICON_IDS = Object.keys(P);
