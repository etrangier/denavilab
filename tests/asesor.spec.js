// El asesor de jam session: página de acceso libre (sin sesión) que recomienda sonido, ritmo y acordes
// para tocar con hardware (D1, B1, Akai) y Logic Pro, antes de conectar nada. Corre con `npm test`.
const { test, expect } = require('@playwright/test');

test('acceso libre: sin sesión, sin redirigir', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('/asesor.html');   // sin localStorage.sesion puesto
  await expect(page).toHaveURL(/asesor\.html/);
  await expect(page.locator('h1')).toHaveText('Asesor de jam session');
  expect(errs, errs.join('\n')).toEqual([]);
});

test('recalcula al cambiar cualquier respuesta', async ({ page }) => {
  await page.goto('/asesor.html');
  const out = page.locator('#asResultado');
  await expect(out).toContainText('Lofi house');
  await expect(out).toContainText('92');   // bpm por defecto de lofi house

  await page.selectOption('#asGenero', 'acid-house');
  await expect(out).toContainText('Acid house');
  await expect(page.locator('#asBpm')).toHaveValue('123');
  await expect(out).toContainText('El acid es minimalista');

  // desmarcar todo instrumento
  for (const v of ['d1', 'ak37', 'logic']) await page.locator(`#asInstrumentos input[value=${v}]`).uncheck();
  await expect(out).toContainText('Marca al menos un instrumento');

  await page.locator('#asInstrumentos input[value=ak37]').check();   // Akai sin Logic: sólo controlador
  await page.locator('#asInstrumentos input[value=logic]').uncheck();
  await expect(out).toContainText('no genera sonido por sí mismo');
});

test('reparto de roles aparece con dos o más personas', async ({ page }) => {
  await page.goto('/asesor.html');
  await page.locator('#asInstrumentos input[value=b1]').check();
  await page.locator('input[name=personas][value="2"]').check();
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

test('sin errores de JS al tocar todos los controles', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('/asesor.html');
  for (const g of ['trip-hop', 'lofi-house', 'house', 'acid-house', 'synth-pop', 'lofi-hiphop']) {
    await page.selectOption('#asGenero', g);
    for (const v of ['d1', 'b1', 'ak25', 'ak37', 'logic', 'bajoelec']) await page.locator(`#asInstrumentos input[value=${v}]`).check();
    for (const p of ['1', '2', '3']) await page.locator(`input[name=personas][value="${p}"]`).check();
    await page.locator('input[name=cable][value=no]').check();
  }
  await page.fill('#asOtro', 'kalimba');
  await page.fill('#asBpm', '999');
  expect(errs, errs.join('\n')).toEqual([]);
});
