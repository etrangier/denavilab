// Memoria de Pistorius: aprende en el propio dispositivo (sin enviar nada) qué sueles grabar, qué quieres hacer con cada tipo de sonido
// y qué camino prefieres (la sugerencia, cortar un fragmento o chopear). Con 2 o más ejemplos empieza a reordenar y a ofrecer lo habitual.
const KEY = 'denavilab.sounds.pistoriusMem';
export const MIN_USES = 2;
const fresh = () => ({ v: 1, n: 0, last: null, src: {}, goal: {}, act: {} });
export function load() { try { const m = JSON.parse(localStorage.getItem(KEY)); return m && m.v === 1 ? m : fresh(); } catch (e) { return fresh(); } }
const save = m => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} return m; };
export function forget() { try { localStorage.removeItem(KEY); } catch (e) {} return fresh(); }
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

/** Anota un resultado que el usuario aceptó: qué era el sonido, qué quiso hacer y con qué acción lo hizo. */
export function record({ source, goal, action }, m = load()) {
  m.n++; m.last = source; bump(m.src, source);
  m.goal[source] = m.goal[source] || {}; bump(m.goal[source], goal);
  m.act[goal] = m.act[goal] || {}; bump(m.act[goal], action);
  return save(m);
}
/** Ordena los orígenes: el último usado primero (solo si ya hay ejemplos). */
export function rankSources(sources, m = load()) {
  if (m.n < MIN_USES) return { list: sources, top: null };
  const ord = [...sources].sort((a, b) => (m.src[b.id] || 0) - (m.src[a.id] || 0) || (a.id === m.last ? -1 : b.id === m.last ? 1 : 0));
  return { list: ord, top: (m.src[ord[0].id] || 0) >= MIN_USES ? ord[0].id : null };
}
/** Pasa al frente la meta que más has elegido para ese tipo de sonido (si la has elegido al menos MIN_USES veces). Devuelve {list, top}. */
export function rankGoals(source, goals, m = load()) {
  const c = m.goal[source] || {}, best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < MIN_USES) return { list: goals, top: null };
  const top = goals.find(g => g.id === best[0]);
  return top ? { list: [top, ...goals.filter(g => g !== top)], top: top.id } : { list: goals, top: null };
}
/** La acción que sueles elegir para esa meta ('cortar', 'chop'…), si es clara. */
export function usualAction(goal, m = load()) {
  const c = m.act[goal] || {}, tot = Object.values(c).reduce((a, b) => a + b, 0), best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= MIN_USES && best[1] / tot >= 0.6 ? best[0] : null;
}
export const summary = (m = load()) => m.n ? `Pistorius ha aprendido de ${m.n} ${m.n === 1 ? 'sonido' : 'sonidos'} tuyos` : 'Pistorius aún no te conoce: aprende con lo que elijas';
