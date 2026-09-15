// Lo crítico del sitio: que las páginas carguen limpias, que el MIDI salga con las pistas correctas,
// que una maqueta se guarde y se vuelva a abrir, que el Secuenciador suene junto con la batería,
// la ruta de la guía y el taller en celular. Corre con `npm test` y antes de cada publicación.
const fs = require('fs');
const { test, expect } = require('@playwright/test');

// Cada prueba parte con el navegador vacío; la sesión de la puerta vive en localStorage.
const comoBanda = (page, quien = 'rolando') =>
  page.addInitScript(q => { try { localStorage.setItem('denavilab.sesion', q); } catch (e) {} }, quien);

function vigilarErrores(page) {
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  return errores;
}

// El taller descarga con un <a download>: se atrapa la descarga y se leen sus bytes.
async function descargar(page, accion) {
  const [d] = await Promise.all([page.waitForEvent('download'), accion()]);
  return fs.readFileSync(await d.path());
}

// Nombre (FF 03) y cantidad de notas de cada pista de un .mid
function pistasMidi(buf) {
  const pistas = [];
  let p = 14;   // cabecera MThd
  while (p + 8 <= buf.length) {
    const largo = buf.readUInt32BE(p + 4), cuerpo = buf.subarray(p + 8, p + 8 + largo);
    let nombre = '', notas = 0;
    for (let i = 0; i < cuerpo.length - 3; i++) if (cuerpo[i] === 0xff && cuerpo[i + 1] === 0x03) { nombre = cuerpo.subarray(i + 3, i + 3 + cuerpo[i + 2]).toString('latin1'); break; }
    for (let i = 0; i < cuerpo.length - 2; i++) if ((cuerpo[i] & 0xf0) === 0x90 && cuerpo[i + 1] < 128 && cuerpo[i + 2] > 0 && cuerpo[i + 2] < 128) notas++;
    pistas.push({ nombre, notas });
    p += 8 + largo;
  }
  return pistas;
}

async function cargarPatronDeBateria(page) {
  const valor = await page.$eval('#drumPreset', s => [...s.options].map(o => o.value).find(v => v && v !== 'Vacío'));
  await page.selectOption('#drumPreset', valor);
}

test('las páginas cargan sin errores', async ({ page }) => {
  await comoBanda(page);
  const errores = vigilarErrores(page);
  for (const ruta of ['index.html', 'guia.html', 'app.html', 'archivo.html']) {
    await page.goto(ruta);
    await page.waitForLoadState('load');
  }
  expect(errores.filter(e => !/fonts\.(googleapis|gstatic)/.test(e))).toEqual([]);
});

test('MIDI: el Piano lead sólo sale cuando tiene contenido', async ({ page }) => {
  await comoBanda(page);
  await page.goto('app.html?modo=pad');
  await page.click('#generar');

  let pistas = pistasMidi(await descargar(page, () => page.click('#expMidiAll')));
  expect(pistas.map(p => p.nombre)).toContain('Pad · acordes');
  expect(pistas.filter(p => p.nombre.startsWith('Piano lead'))).toEqual([]);

  await page.click('#modosTabs [data-m=lead]');
  await page.locator('#leadGenChips button').first().click();
  pistas = pistasMidi(await descargar(page, () => page.click('#expMidiAll')));
  const lead = pistas.filter(p => p.nombre.startsWith('Piano lead'));
  expect(lead.length).toBeGreaterThan(0);
  for (const p of lead) expect(p.notas, p.nombre).toBeGreaterThan(0);
});

test('maqueta: se guarda, se descarga como .denavi y se vuelve a abrir', async ({ page }) => {
  await comoBanda(page);
  await page.goto('app.html?modo=beat');
  await cargarPatronDeBateria(page);

  await page.fill('#maquetaName', 'prueba automática');
  await page.click('#saveMaqueta');
  await expect(page.locator('#guardarInfo')).toContainText('prueba automática');

  const denavi = JSON.parse((await descargar(page, () => page.click('#expProyecto'))).toString('utf8'));
  expect(denavi.app).toBe('DenaviLAB');
  expect(Object.values(denavi.drums.pat).some(v => v.some(Boolean))).toBe(true);

  denavi.musica.bpm = 97;
  await page.setInputFiles('#impProyecto', { name: 'recibida.denavi', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(denavi)) });
  await expect(page.locator('#guardarInfo')).toContainText('Abierta «recibida»');
  await expect(page.locator('#bpm')).toHaveValue('97');
  expect(await page.locator('#seq .st.on').count()).toBeGreaterThan(0);
});

test('Secuenciador: la batería suena junto con el bajo, sin notas atrasadas', async ({ page }) => {
  await comoBanda(page);
  // anota cada nota que se programa: cuándo debía sonar y qué hora marcaba el reloj de audio
  await page.addInitScript(() => {
    window.__inicios = [];
    const P = AudioScheduledSourceNode.prototype, original = P.start;
    P.start = function (cuando = 0, ...resto) { window.__inicios.push({ cuando, ahora: this.context.currentTime }); return original.call(this, cuando, ...resto); };
  });
  await page.goto('app.html?modo=beat');
  await cargarPatronDeBateria(page);
  await page.click('#modosTabs [data-m=pad]');
  await page.click('#generar');   // «=» escribe la raíz de cada acorde: necesita una vuelta
  await page.click('#modosTabs [data-m=bajod]');
  await page.click('#bpTeclado [data-id="igual"]');
  await expect(page.locator('#bpTira')).not.toHaveText(/^[\s·]*$/);

  async function medir(acompanamiento) {
    await page.locator('#bassAcomp button', { hasText: acompanamiento }).click();
    await page.evaluate(() => { window.__inicios = []; });
    await page.click('#playBass');
    await page.waitForTimeout(1600);
    const inicios = await page.evaluate(() => window.__inicios);
    await page.click('#playBass');   // detener
    await page.waitForTimeout(300);
    return inicios;
  }
  const solo = await medir('Solo bajo');
  const conBateria = await medir('Con batería');
  expect(solo.length).toBeGreaterThan(0);
  expect(conBateria.length).toBeGreaterThan(solo.length);
  expect(conBateria.filter(x => x.cuando > 0 && x.cuando < x.ahora - 0.005)).toEqual([]);
});

test('guía: la ruta muestra el siguiente paso y avanza al marcarlo', async ({ page }) => {
  await comoBanda(page);
  await page.goto('guia.html?vista=ruta');
  const ruta = page.locator('section[data-para~="rolando"][data-vista="ruta"]').first();
  await expect(ruta.locator('.ruta-sigue .rs-eyebrow')).toHaveText(/1 de 7/);
  await ruta.locator('.steps > .step').first().locator('.paso-hecho input').check();
  await expect(ruta.locator('.ruta-sigue .rs-eyebrow')).toHaveText(/2 de 7/);
  await page.locator('.guia-tab', { hasText: 'Lecciones' }).click();
  await expect(page.locator('section[data-para~="rolando"] .leccion').first()).toBeVisible();
});

test('guía: al entrar se elige entre trabajo guiado y el tutor', async ({ page }) => {
  await comoBanda(page);
  await page.goto('guia.html');
  const elige = page.locator('#formaElige');
  await expect(elige).toBeVisible();
  await expect(page.locator('.guia-cab')).toBeHidden();

  await elige.locator('[data-forma="tutor"]').click();
  await expect(page.locator('section.tutor-intro')).toBeVisible();
  await expect(page.locator('a', { hasText: 'Empezar con el tutor' })).toHaveAttribute('href', /tutor=1/);
  await expect(page.locator('#guiaElige')).toBeHidden();

  await page.click('#guiaCambiar');
  await expect(elige).toBeVisible();
  await elige.locator('[data-forma="guiado"]').click();
  await expect(page.locator('#guiaElige')).toBeVisible();
  await expect(page.locator('section.tutor-intro')).toBeHidden();

  await page.reload();   // se vuelve a preguntar cada vez que entras
  await expect(elige).toBeVisible();
});

test('tutor: esconde los moldes, escucha lo que marcas y responde sin decir dónde', async ({ page }) => {
  await comoBanda(page);
  const errores = vigilarErrores(page);
  await page.goto('app.html?tutor=1&modo=beat');
  const tutor = page.locator('#tutor');
  await expect(tutor).toBeVisible();
  await expect(page.locator('#drumPreset')).toBeHidden();
  await expect(page.locator('#genBeat')).toBeHidden();
  await expect(tutor.locator('.tu-etapa')).toContainText('El pulso');
  const primero = await tutor.locator('.tu-msg').innerText();
  expect(primero.length).toBeGreaterThan(20);

  // marca un bombo: el tutor lo oye y, al quedarse quieto, contesta con otra cosa y la etapa queda lista
  await page.click('#seq .st[data-r="kick"][data-s="0"]');
  await expect(tutor.locator('.tu-etapa')).toContainText('✓', { timeout: 5000 });
  await expect(tutor.locator('.tu-msg')).not.toHaveText(primero, { timeout: 8000 });
  const mensajes = await page.evaluate(() => JSON.parse(localStorage.getItem('denavilab.tutor.rolando')).bitacora.map(m => m.t));
  expect(mensajes.length).toBeGreaterThan(1);
  for (const t of mensajes) expect(t, t).not.toMatch(/\d/);   // nunca posiciones ni números de paso

  await tutor.locator('button', { hasText: 'Sigo' }).click();
  await expect(tutor.locator('.tu-etapa')).toContainText('El contraste');
  expect(errores).toEqual([]);
});

test('tutor sin moldes: fuera presets y bandas, se quedan tempo, compases y cuantización', async ({ page }) => {
  await comoBanda(page);
  await page.goto('app.html?tutor=1&modo=beat');
  for (const id of ['#genre', '#band', '#bpmRange', '#drumPreset', '#genBeat', '.saved']) await expect(page.locator(id).first()).toBeHidden();
  for (const id of ['#animo', '#bpm', '#barChips', '#drumLenChips', '#drumQuantChips', '#drumKit']) await expect(page.locator(id)).toBeVisible();
  const pestanas = await page.locator('#modosTabs .mtab:visible').evaluateAll(ts => ts.map(t => t.dataset.m));
  expect(pestanas).toEqual(['beat', 'bajod', 'pad', 'piano']);

  // la rueda sin porcentajes ni flechas de sugerencia
  await page.click('#modosTabs [data-m=pad]');
  await expect(page.locator('#generar')).toBeHidden();   // nada de «Generar vuelta»
  await page.locator('#wheel g.inkey').first().click();   // un clic en la rueda agrega el acorde
  await expect(page.locator('#bars')).toContainText(/\S/);
  await expect(page.locator('.heat-legend')).toBeHidden();
  expect(await page.locator('#wheel g.sug').count()).toBe(0);
  expect(await page.locator('#wheelArrows path').count()).toBe(0);

  // el secuenciador: el «=» no escribe por ti
  await page.click('#modosTabs [data-m=bajod]');
  await page.keyboard.press('=');
  await expect(page.locator('#bpTira')).toHaveText(/^[\s·]*$/);
  await expect(page.locator('.bp-avanzado')).toBeHidden();
});

test('la rueda del tutor: relaciones de teoría, ánimo y tu camino, sin probabilidades de banda', async ({ page }) => {
  await comoBanda(page);
  const errores = vigilarErrores(page);
  await page.goto('app.html?tutor=1&modo=pad');
  await page.selectOption('#animo', 'Melancólico');
  // clic por evento: el panel del tutor puede tapar parte de la rueda en una ventana chica
  const agregar = async nombre => { await page.locator(`#wheel g.slot:has(text:text-is("${nombre}"))`).dispatchEvent('click'); const b = page.locator('#candSave'); if (await b.isVisible()) await b.dispatchEvent('click'); await page.waitForTimeout(300); };
  for (const n of ['Lam', 'Rem', 'Fa', 'Mim']) await agregar(n);
  const rueda = page.locator('#tuRueda');
  await expect(rueda).toBeVisible();
  await expect(rueda).toContainText('La rueda del tutor');
  await expect(rueda.locator('.tr-animo')).toContainText('Melancólico');
  await expect(rueda.locator('.tr-lectura')).toContainText('Tu camino');
  expect(await page.locator('#wheel g.tu-casa, #wheel g.tu-luz, #wheel g.tu-calma, #wheel g.tu-tension').count()).toBeGreaterThan(0);
  expect(await page.locator('#wheel g.sug').count()).toBe(0);
  expect(await page.locator('#wheelCamino .camino-linea').count()).toBeGreaterThan(0);
  await expect(page.locator('#cSub')).toContainText('Melancólico');
  // el tutor comenta el paso que diste, sin cifras
  await expect.poll(async () => page.evaluate(() => (JSON.parse(localStorage.getItem('denavilab.tutor.rolando') || '{"bitacora":[]}').bitacora || []).some(m => m.sit.startsWith('m_paso_'))), { timeout: 8000 }).toBe(true);
  expect(errores).toEqual([]);
});

test('el oído aprende: crece por persona y se retroalimenta con lo que haces', async ({ page }) => {
  await comoBanda(page);
  const errores = vigilarErrores(page);
  await page.goto('app.html?tutor=1&modo=beat');
  const tutor = page.locator('#tutor');
  const modelo = quien => page.evaluate(q => JSON.parse(localStorage.getItem('denavilab.oido.' + q) || 'null'), quien);

  // un bombo: el oído lo percibe, nace la primera neurona y el tutor habla
  await page.click('#seq .st[data-r="kick"][data-s="0"]');
  await expect(tutor.locator('.tu-fb')).toBeVisible({ timeout: 8000 });
  let m = await modelo('rolando');
  expect(m.redes.bateria.neuronas.length).toBeGreaterThan(0);

  // 👍: el consejo dicho gana peso en esa neurona
  await tutor.locator('.tu-fb button', { hasText: 'me sirvió' }).click();
  m = await modelo('rolando');
  const pesos = m.redes.bateria.neuronas.flatMap(nu => Object.values(nu.w));
  expect(Math.max(...pesos)).toBeGreaterThan(0);

  // algo muy distinto (lleno): la red crece con otra neurona
  for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) await page.click(`#seq .st[data-r="hh"][data-s="${s}"]`);
  for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) await page.click(`#seq .st[data-r="hh"][data-s="${s}"]`);
  for (const s of [4, 12, 6, 14]) await page.click(`#seq .st[data-r="snare"][data-s="${s}"]`);
  await expect.poll(async () => (await modelo('rolando')).redes.bateria.neuronas.length, { timeout: 8000 }).toBeGreaterThan(1);

  await tutor.locator('.tu-aprendido summary').click();
  await expect(tutor.locator('.ta-cuerpo')).toContainText('Batería');
  expect(await modelo('schair')).toBeNull();   // cada uno tiene su propia red
  expect(errores).toEqual([]);
});

test('tutor al mínimo para Schair: batería y guitarra', async ({ page }) => {
  await comoBanda(page, 'schair');
  await page.goto('app.html?tutor=1&modo=letra');
  const pestanas = await page.locator('#modosTabs .mtab:visible').evaluateAll(ts => ts.map(t => t.dataset.m));
  expect(pestanas).toEqual(['beat', 'guitarra']);
  await expect(page.locator('#modosTabs [data-m=beat]')).toHaveAttribute('aria-current', 'true');
  await page.click('#modosTabs [data-m=guitarra]');
  for (const id of ['#guitGenre', '#guitBand', '#guitSugs', '#guitRasgueoPresets']) await expect(page.locator(id)).toBeHidden();
  for (const id of ['#guitAnimo', '#guitBpm', '#guitCapo']) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#guitRasgueo')).toBeVisible();
});

test('taller en celular: el instrumento queda arriba y se ven todas las pestañas', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await contexto.newPage();
  await comoBanda(page);
  await page.goto('app.html?modo=beat');
  const m = await page.evaluate(() => {
    const centro = document.querySelector('.grid > .center');
    const arriba = n => n.getBoundingClientRect().top + scrollY;
    return {
      instrumento: arriba(centro),
      // todo lo demás de la grilla (ajustes, registro…) debe quedar debajo del instrumento
      antesDelInstrumento: [...document.querySelectorAll('.grid > *')].filter(n => n !== centro && n.offsetParent && arriba(n) < arriba(centro)).map(n => n.id || n.className),
      ancho: document.documentElement.scrollWidth,
      pestanasFuera: [...document.querySelectorAll('#modosTabs .mtab')].filter(t => t.getBoundingClientRect().right > innerWidth + 1).length,
    };
  });
  expect(m.antesDelInstrumento).toEqual([]);
  expect(m.instrumento).toBeLessThan(900);
  expect(m.ancho).toBeLessThanOrEqual(375);
  expect(m.pestanasFuera).toBe(0);
  await contexto.close();
});
