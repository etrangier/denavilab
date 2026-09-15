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
