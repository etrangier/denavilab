// El asesor de jam session: página de acceso libre (sin sesión) que recomienda sonido, ritmo y acordes
// para tocar con hardware (D1, B1, Akai) y Logic Pro, antes de conectar nada. Corre con `npm test`.
// Las preguntas están en un asistente paso a paso (<details> encadenados); el plan sólo se ve tras
// completar el último paso («Ver el plan»), y cada paso se puede reabrir después para editarlo.
const { test, expect } = require('@playwright/test');

async function abrirPaso(page, id) {
  const details = page.locator('#' + id);
  if (!(await details.evaluate(el => el.open))) await details.locator('summary').click();
}

async function abrirSeccion(page, texto) {
  const details = page.locator('#asResultado .as-seccion', { has: page.locator('summary .tit', { hasText: texto }) }).first();
  if (!(await details.evaluate(el => el.open))) await details.locator('summary').click();
  return details;
}

async function pasarWizard(page) {
  for (const id of ['pasoPersonas', 'pasoInstrumentos', 'pasoCable']) {
    await abrirPaso(page, id);
    await page.locator(`#${id} .as-siguiente`).click();
  }
  await abrirPaso(page, 'pasoGenero');
  await page.click('#btnVerPlan');
}

test('acceso libre: sin sesión, sin redirigir', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('/asesor.html');   // sin localStorage.sesion puesto
  await expect(page).toHaveURL(/asesor\.html/);
  await expect(page.locator('h1')).toHaveText('Asesor de jam session');
  expect(errs, errs.join('\n')).toEqual([]);
});

test('el asistente pasa de un paso al siguiente y arma el plan al final', async ({ page }) => {
  await page.goto('/asesor.html');
  const out = page.locator('#asResultado');
  await expect(out).toBeHidden();
  await expect(page.locator('#pasoPersonas')).toHaveJSProperty('open', true);
  await expect(page.locator('#pasoInstrumentos')).toHaveJSProperty('open', false);

  await pasarWizard(page);
  await expect(out).toBeVisible();
  await expect(page.locator('#pasoGenero')).toHaveClass(/hecho/);
  await expect(page.locator('#resGenero')).toContainText('Lofi house');
});

test('recalcula al cambiar cualquier respuesta, reabriendo el paso correspondiente', async ({ page }) => {
  await page.goto('/asesor.html');
  await pasarWizard(page);
  const out = page.locator('#asResultado');
  await expect(out).toContainText('Lofi house');
  await expect(out).toContainText('92');   // bpm por defecto de lofi house

  await abrirPaso(page, 'pasoGenero');
  await page.selectOption('#asGenero', 'acid-house');
  await expect(out).toContainText('Acid house');
  await expect(page.locator('#asBpm')).toHaveValue('123');
  await expect(out).toContainText('El acid es minimalista');

  await abrirPaso(page, 'pasoInstrumentos');
  for (const v of ['d1', 'ak37', 'logic']) await page.locator(`#asInstrumentos input[value=${v}]`).uncheck();
  await expect(out).toContainText('Marca al menos un instrumento');

  await page.locator('#asInstrumentos input[value=ak37]').check();   // Akai sin Logic: sólo controlador
  await page.locator('#asInstrumentos input[value=logic]').uncheck();
  await expect(out).toContainText('no genera sonido por sí mismo');
});

test('reparto de roles aparece con dos o más personas', async ({ page }) => {
  await page.goto('/asesor.html');
  await abrirPaso(page, 'pasoInstrumentos');
  await page.locator('#asInstrumentos input[value=b1]').check();
  await abrirPaso(page, 'pasoPersonas');
  await page.locator('input[name=personas][value="2"]').check();
  await pasarWizard(page);
  await expect(page.locator('#asResultado')).toContainText('Reparto de roles');
  await expect(page.locator('#asResultado')).toContainText('Persona 1');
  await expect(page.locator('#asResultado')).toContainText('Persona 2');
});

test('los tres puntos de entrada llevan al asesor', async ({ page }) => {
  await page.goto('/index.html');
  await page.click('a.door[href="asesor.html"]');
  await expect(page).toHaveURL(/asesor\.html/);

  await page.addInitScript(() => { try { localStorage.setItem('denavilab.sesion', 'rolando'); } catch (e) {} });
  await page.goto('/guia.html');
  await page.click('a.forma-opcion.asesor');
  await expect(page).toHaveURL(/asesor\.html/);
});

test('el sonido usa Retro Synth (confirmado en el propio Logic de Rolando), no nombres inventados', async ({ page }) => {
  await page.goto('/asesor.html');
  await pasarWizard(page);
  const out = page.locator('#asResultado');
  await expect(out).toContainText('Retro Synth');                // el instrumento confirmado, no «Juno Pad»
  await expect(out).toContainText('Classic Analog Pad');         // confirmado real: preset de partida para el Pad
  await expect(out).not.toContainText('Juno Pad');
  await expect(out).toContainText('Oscilador');                  // la receta paso a paso
  await expect(out).toContainText('Fader');
  await expect(out).toContainText('Channel EQ');
  await abrirSeccion(page, 'Sonido');   // el detalle está colapsado por defecto: la vista rápida va primero
  await expect(out.locator('.as-cadena').first()).toBeVisible(); // la cadena de plugins, en orden

  await abrirPaso(page, 'pasoGenero');
  await page.selectOption('#asGenero', 'acid-house');
  await abrirPaso(page, 'pasoInstrumentos');
  await page.locator('#asInstrumentos input[value=b1]').check();
  await expect(out).toContainText('squelch');                    // mecanismo explicado, no un patch prometido
  await expect(out).toContainText('Gate Length');                // control real de la B1 (ficha de Captain Pikant), no inventado
  await expect(out).toContainText('Tape Delay');                 // el delay corto del bajo, con su panel
});

test('el preset queda armable pista por pista, arriba de todo y sin abrir nada más', async ({ page }) => {
  await page.goto('/asesor.html');
  await pasarWizard(page);
  const out = page.locator('#asResultado');
  const rapido = out.locator('.as-seccion').first();
  await expect(rapido.locator('summary .tit')).toContainText('pista por pista');
  await expect(rapido).toHaveJSProperty('open', true);             // abierta por defecto: es lo primero que se hace
  const pistas = rapido.locator('.as-pista');
  await expect(pistas).toHaveCount(5);                             // Batería + Pad + Arpegio + Bajo + Textura, con lofi house por defecto
  await expect(pistas.first()).toContainText('Batería');

  // el detalle pedagógico (Ritmo, Sonido) no debe estorbar: colapsado por defecto
  const detalleSonido = out.locator('.as-seccion', { has: page.locator('summary .tit', { hasText: 'Sonido' }) });
  await expect(detalleSonido).toHaveJSProperty('open', false);

  // marcar una pista lista la tacha, para seguir el avance mientras se arma el preset en Logic
  const primeraPista = pistas.nth(1);
  await primeraPista.locator('input[type=checkbox]').check();
  await expect(primeraPista).toHaveClass(/hecha/);
});

test('el Channel EQ numera cada banda y explica qué hace cada una', async ({ page }) => {
  await page.goto('/asesor.html');
  await pasarWizard(page);
  await abrirSeccion(page, 'Sonido');
  const primerEq = page.locator('#asResultado .as-eq-curva').first();
  await expect(primerEq).toBeVisible();
  const nodos = await primerEq.locator('circle.nodo').count();
  const numeros = await primerEq.locator('text.num').allTextContents();
  expect(nodos).toBeGreaterThan(0);
  expect(numeros).toEqual(Array.from({ length: nodos }, (_, i) => String(i + 1)));   // 1, 2, 3... en orden

  const leyenda = page.locator('#asResultado .as-eq-bandas').first();
  await expect(leyenda.locator('li')).toHaveCount(nodos);          // una línea de texto por cada nodo de la curva
});

test('cada acorde se ilustra con un teclado, marcando sus notas', async ({ page }) => {
  await page.goto('/asesor.html');
  await abrirPaso(page, 'pasoGenero');
  await page.selectOption('#asGenero', 'acid-house');            // Dm: re·fa·la → 3 teclas
  await pasarWizard(page);
  const primerAcorde = page.locator('.as-ac').first();
  await expect(primerAcorde.locator('svg.as-mini')).toBeVisible();
  const marcadas = await primerAcorde.locator('svg .on').count();
  expect(marcadas).toBe(6);                                      // Dm: tres notas, marcadas en las dos octavas del teclado
});

test('las secuencias de la D1 y la B1 se ilustran en una grilla de 16 pasos', async ({ page }) => {
  await page.goto('/asesor.html');
  await abrirPaso(page, 'pasoGenero');
  await page.selectOption('#asGenero', 'acid-house');
  await abrirPaso(page, 'pasoInstrumentos');
  await page.locator('#asInstrumentos input[value=b1]').check();
  await pasarWizard(page);
  const cajas = page.locator('.as-grid-caja');
  await expect(cajas).toHaveCount(2);                            // una para la D1, otra para la B1
  await expect(cajas.nth(0)).toContainText('Donner D1');
  await expect(cajas.nth(0).locator('.ej-fila')).toHaveCount(3); // Bombo, Aplauso, Hi-hat cerrado
  await expect(cajas.nth(1)).toContainText('Donner B1');
  const acentos = await cajas.nth(1).locator('.ej-c.acento').count();
  expect(acentos).toBe(2);                                       // los dos acentos del ejemplo de acid

  await abrirPaso(page, 'pasoInstrumentos');
  await page.locator('#asInstrumentos input[value=d1]').uncheck();
  await expect(cajas).toHaveCount(1);                             // sin D1 marcada, sólo queda la B1
});

test('sin errores de JS al tocar todos los controles', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('/asesor.html');
  await abrirPaso(page, 'pasoGenero');
  await abrirPaso(page, 'pasoInstrumentos');
  await abrirPaso(page, 'pasoPersonas');
  await abrirPaso(page, 'pasoCable');
  for (const g of ['trip-hop', 'lofi-house', 'house', 'acid-house', 'synth-pop', 'lofi-hiphop']) {
    await page.selectOption('#asGenero', g);
    for (const v of ['d1', 'b1', 'ak25', 'ak37', 'logic', 'bajoelec']) await page.locator(`#asInstrumentos input[value=${v}]`).check();
    for (const p of ['1', '2', '3']) await page.locator(`input[name=personas][value="${p}"]`).check();
    await page.locator('input[name=cable][value=no]').check();
  }
  await page.fill('#asOtro', 'kalimba');
  await page.fill('#asBpm', '999');
  await page.click('#btnVerPlan');
  expect(errs, errs.join('\n')).toEqual([]);
});
