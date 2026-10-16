// Carpetas y subcarpetas de la biblioteca (las mismas que en la app de iPhone).
export const UNSORTED = 'Sin clasificar';
export const FOLDERS = [
  { name: 'Música', subs: ['Ambient', 'Soul', 'Hip hop', 'Electrónica'] },
  { name: 'Naturaleza', subs: ['Viento', 'Mar y agua', 'Lluvia', 'Animales', 'Bosque', 'Otro'] },
  { name: 'Cine y TV', subs: ['Diálogos', 'Banda sonora', 'Efectos'] },
  { name: 'Voz', subs: ['Habla', 'Canto', 'Tarareo'] },
  { name: 'Ciudad y objetos', subs: ['Calle', 'Máquinas', 'Hogar'] },
  { name: UNSORTED, subs: [] },
];
export const folderDetail = f => f.subs.length ? f.subs.join(' · ') : 'Por revisar';
/** Las carpetas que no están en la lista caen en «Sin clasificar». */
export const folderOf = s => FOLDERS.some(f => f.name === s.folder) ? s.folder : UNSORTED;
