// EP-133 Beatmaking Assistant: página sólo para Rolando que sugiere qué sonido cargar en cada pad del EP-133. Corre con `npm test`.
// Los casos de aceptación usan la base real incrustada en la página; las reglas finas, una base sintética inventada aquí.
const { test, expect } = require('@playwright/test');

const como = quien => page => page.addInitScript(q => { try { localStorage.setItem('denavilab.sesion', q); } catch (e) {} }, quien);
const rolando = como('rolando');

const snd = (nombre, rol, enc, extra = {}) => ({ slot: null, nombre, origen: 'fabrica', cargado: true, pack: 'Prueba', rol, dur_s: 0.3, cola20_s: 0.1, cola40_s: 0.15,
  ataque_ms: 1, centroide_hz: 100, pct_grave: 90, pico_grave_hz: 60, nota: '', acorde: '', perfil: 'corto', parlante: '', maquina_inferida: '', encaje: { Prueba: enc }, top3: ['Prueba'], ...extra });
const SINTETICA = {
  version: 1, generado: '2026-01-01', roles: [],
  generos: [{ id: 'Prueba', bpm_min: 100, bpm_max: 130, bpm_default: 120, rasgos: '', fuente: '' }],
  sonidos: [
    snd('boom dry', 'Bombo', 90, { slot: 1, cola20_s: 0.7 }),      // cola de 0.7 s: pasa de 1 tiempo (0.5 s) a 120 BPM
    snd('boom wet', 'Bombo', 89, { slot: 2 }),                     // variante casi idéntica de «boom dry»: no debe repetirse en el grupo A
    snd('sub kick', 'Bombo', 95, { slot: 3, pico_grave_hz: 40 }),  // 95 − 8 = 87: pierde contra «boom dry» y avisa
    snd('thud', 'Bombo', 80, { slot: 4 }),
    snd('ghost kick', 'Bombo', 99, { cargado: false }),            // mejor de todos, pero todavía no está en el aparato
    snd('ghost two', 'Bombo', 98, { cargado: false }),
    snd('tick', 'Hat cerrado', 70, { slot: 5, cola20_s: 0.3 }),    // 0.3 s pasa de medio tiempo (0.25 s)
    snd('long chord', 'Acorde / stab', 70, { slot: 10, dur_s: 8 }),
    snd('low bass', 'Bajo', 90, { slot: 20, pico_grave_hz: 35 }),
  ],
};
const subirBase = (page, json) => page.setInputFiles('#ksArchivo', { name: 'ep133_sonidos.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
const pad = (page, k) => page.locator(`button.ks-pad[data-pad="${k}"]`);
const slotDe = async (page, k) => Number(await pad(page, k).getAttribute('data-slot'));

test('sólo entra Rolando: los demás vuelven a la portada', async ({ page }) => {
  await page.goto('/kits.html');                                   // sin sesión
  await expect(page).toHaveURL(/index\.html$|\/$/);
  for (const q of ['schair', 'invitado']) {
    const p = await page.context().newPage(); await como(q)(p);
    await p.goto('/kits.html'); await expect(p).toHaveURL(/index\.html$|\/$/); await p.close();
  }
  await rolando(page); await page.goto('/kits.html');
  await expect(page).toHaveURL(/kits\.html/);
  await expect(page.locator('h1')).toHaveText('EP-133 Beatmaking Assistant');
});

test('la puerta de la portada aparece sólo con la sesión de Rolando', async ({ page }) => {
  for (const q of [null, 'schair', 'invitado']) {
    const p = await page.context().newPage(); if (q) await como(q)(p);
    await p.goto('/index.html'); await expect(p.locator('#doorKits')).toBeHidden(); await p.close();
  }
  await rolando(page); await page.goto('/index.html');
  await expect(page.locator('#doorKits')).toBeVisible();
  await page.click('#doorKits');
  await expect(page).toHaveURL(/kits\.html/);
});

test('aceptación: Lofi house, 120 BPM, sólo cargados', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  await page.fill('#ksBpm', '120');
  await expect(page.locator('#ksSolo')).toBeChecked();
  expect([2, 1, 35]).toContain(await slotDe(page, 'A:7'));          // bombo
  expect(await slotDe(page, 'A:9')).toBe(307);                       // clap
  expect([216, 202]).toContain(await slotDe(page, 'A:4'));           // hat cerrado
  await page.click('#tabB');
  expect(await slotDe(page, 'B:7')).toBe(403);                       // bajo
  await page.click('#tabC');
  expect([537, 514, 543]).toContain(await slotDe(page, 'C:7'));      // acordes
});

test('ningún sonido se repite entre pads ni entre grupos', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const vistos = [];
  for (const g of ['A', 'B', 'C', 'D']) {
    await page.click('#tab' + g);
    vistos.push(...(await page.locator('button.ks-pad').evaluateAll(bs => bs.map(b => b.dataset.pad + '|' + b.querySelector('.nom').textContent))));
  }
  const nombres = vistos.map(v => v.split('|')[1]);
  expect(nombres.length).toBeGreaterThan(20);
  expect(new Set(nombres).size).toBe(nombres.length);
});

test('reglas: variantes, grave, «por cargar», avisos de cola y compases', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirBase(page, SINTETICA);
  await expect(page.locator('#ksBase')).toContainText('cargada por ti');
  await page.fill('#ksBpm', '120');

  // bombo: «boom dry» gana (90); «sub kick» (95 − 8 = 87) queda detrás; «boom wet» es variante de «boom dry» y no entra
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('boom dry');
  await expect(pad(page, 'A:0').locator('.nom')).toHaveText('sub kick');
  await expect(pad(page, 'A:ENTER')).toHaveCount(0);               // no es caja: sin sonido, no hay botón
  const nombresA = await page.locator('button.ks-pad .nom').allTextContents();
  expect(nombresA).not.toContain('boom wet');

  await pad(page, 'A:7').click();
  await expect(page.locator('#ksDetalle')).toContainText('supera 1 tiempo');   // cola 0.7 s > 0.5 s
  await pad(page, 'A:0').click();
  await expect(page.locator('#ksDetalle')).toContainText('casi inaudible');
  await expect(page.locator('#ksDetalle')).toContainText('menos 8 puntos');
  await pad(page, 'A:4').click();
  await expect(page.locator('#ksDetalle')).toContainText('supera medio tiempo');   // cola 0.3 s > 0.25 s

  await page.fill('#ksBpm', '60');                                  // a 60 BPM un tiempo dura 1 s: ya no hay aviso para el bombo
  await pad(page, 'A:7').click();
  await expect(page.locator('#ksDetalle')).not.toContainText('supera 1 tiempo');

  await page.fill('#ksBpm', '120');
  await page.click('#tabC'); await pad(page, 'C:7').click();
  await expect(page.locator('#ksDetalle')).toContainText('≈ 4 compases');       // 8 s / (4 × 0.5 s)

  // con el interruptor apagado entran los «por cargar», marcados con ★
  await page.click('#tabA'); await page.uncheck('#ksSolo');
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('ghost kick');
  await expect(pad(page, 'A:7').locator('.slot')).toHaveText('★ por cargar');
  await page.check('#ksSolo');
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('boom dry');
});

test('siguiente alternativa cambia el sonido sin repetir los de otros pads', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  const antes = await slotDe(page, 'A:7');
  await pad(page, 'A:7').click();
  await page.click('#ksSig');
  const despues = await slotDe(page, 'A:7');
  expect(despues).not.toBe(antes);
  const slots = await page.locator('button.ks-pad').evaluateAll(bs => bs.map(b => b.dataset.slot));
  expect(new Set(slots).size).toBe(slots.length);
});

test('marcar un sonido propio como cargado le da slot y se queda tras recargar', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirBase(page, SINTETICA);
  await page.uncheck('#ksSolo');
  await pad(page, 'A:7').click();                                   // ghost kick, por cargar
  await page.fill('#ksSlotNuevo', '99'); await page.click('#ksMarcar');
  await expect(pad(page, 'A:7').locator('.slot')).toHaveText('99');
  await pad(page, 'A:0').click();                                   // ghost two, también por cargar
  await page.fill('#ksSlotNuevo', '99'); await page.click('#ksMarcar');
  await expect(page.locator('#ksSlotError')).toContainText('ya lo usa');   // el slot 99 es de ghost kick
  await page.fill('#ksSlotNuevo', '1'); await page.click('#ksMarcar');
  await expect(page.locator('#ksSlotError')).toContainText('ya lo usa');   // el slot 1 es de boom dry
  await page.reload();
  await expect(pad(page, 'A:7').locator('.slot')).toHaveText('99');        // sobrevive: base y marcas viven en este navegador
  await pad(page, 'A:7').click(); await page.click('#ksQuitar');
  await expect(pad(page, 'A:7').locator('.slot')).toHaveText('★ por cargar');
});

test('copiar plan sale en texto plano, un pad por línea', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  await page.click('#ksCopiar');
  await expect(page.locator('#ksEstado')).toContainText('copiado');
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  expect(txt).toMatch(/^EP-133 Beatmaking Assistant · Lofi house · 120 BPM/);
  expect(txt).toMatch(/^Grupo A · pad 7 → sonido \d+ · .+$/m);
  expect(txt).toMatch(/^Grupo B · pad 7 → sonido 403 · .+$/m);
  expect(txt).toContain('mantén SOUND, escribe el número, pulsa ENTER');
});

test('cada género y cada grupo se pintan sin errores de JS, también en celular', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewportSize({ width: 375, height: 812 });
  await rolando(page); await page.goto('/kits.html');
  const generos = await page.locator('#ksGenero option').evaluateAll(os => os.map(o => o.value));
  expect(generos).toHaveLength(9);
  for (const g of generos) {
    await page.selectOption('#ksGenero', g);
    for (const gr of ['A', 'B', 'C', 'D']) { await page.click('#tab' + gr); }
    await page.uncheck('#ksSolo'); await page.check('#ksSolo');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);   // sin scroll horizontal
  expect(errs, errs.join('\n')).toEqual([]);
});

test('indica género y BPM a la vista y los sigue al cambiarlos', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  await expect(page.locator('#ksBanda')).toContainText('Lofi house');
  await expect(page.locator('#ksBanda')).toContainText('120 BPM');
  await expect(page.locator('#ksBanda')).toContainText('1 tiempo = 0,5 s');
  await page.fill('#ksBpm', '90');
  await expect(page.locator('#ksBanda')).toContainText('90 BPM');
  await expect(page.locator('#ksIluSvg')).toContainText('90');          // la pantalla del esquema también
  await expect(page.locator('#ksIluSvg')).toContainText('Lofi house');
});

test('el esquema del aparato muestra los grupos y el slot de cada tecla, y se puede tocar', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house'); await page.fill('#ksBpm', '120');
  await expect(page.locator('#ksIluSvg [data-ilu=grupo]')).toHaveCount(4);
  await expect(page.locator('#ksIluSvg [data-ilu=pad]')).toHaveCount(12);
  const delEsquema = await page.locator('#ksIluSvg [data-pad="A:7"] text').nth(1).textContent();
  expect(Number(delEsquema)).toBe(await slotDe(page, 'A:7'));            // el número del esquema es el de la cuadrícula
  await page.locator('#ksIluSvg [data-grupo="B"]').click();              // tocar el grupo B en el esquema cambia de grupo
  await expect(page.locator('#tabB')).toHaveAttribute('aria-selected', 'true');
  await expect(pad(page, 'B:7')).toBeVisible();
  await page.locator('#ksIluSvg [data-pad="B:7"]').click();              // y tocar una tecla abre su detalle
  await expect(page.locator('#ksDetalle')).toBeVisible();
  await expect(page.locator('#ksDetalle h2')).toContainText('403');
});

test('la lista por grupo reúne todos los sonidos del plan y lleva a cada pad', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  await expect(page.locator('#ksListaTit')).toHaveText('Lista de sonidos por grupo');
  await expect(page.locator('#ksLista details.ks-gl')).toHaveCount(4);
  for (const g of ['A', 'B', 'C', 'D']) {                                // la lista de cada grupo coincide con sus pads
    await page.click('#tab' + g);
    const enPads = await page.locator('button.ks-pad').count();
    await expect(page.locator(`#ksLista details[data-grupo="${g}"] button.ks-li`)).toHaveCount(enPads);
  }
  const fila = page.locator('#ksLista details[data-grupo="B"] button.ks-li').first();
  const nombre = await fila.locator('.n').evaluate(n => n.firstChild.textContent);
  await fila.click();                                                    // tocar una fila abre ese pad en su grupo
  await expect(page.locator('#tabB')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ksDetalle h2')).toContainText(nombre);
});
