// Asistente de patrones del EP-133: página sólo para Rolando que guía la construcción de un beat. Corre con `npm test`.
const { test, expect } = require('@playwright/test');

const como = quien => page => page.addInitScript(q => { try { localStorage.setItem('denavilab.sesion', q); } catch (e) {} }, quien);
const rolando = como('rolando');
const abrirTodo = page => page.evaluate(() => document.querySelectorAll('.pa-paso').forEach(p => { p.open = true; }));
const cas = (page, pad, n) => page.locator(`button.pa-cas[data-pad="${pad}"][data-cas="${n}"]`);

test('sólo entra Rolando y no hay errores de JS', async ({ page }) => {
  await page.goto('/patrones.html');
  await expect(page).toHaveURL(/index\.html$|\/$/);
  const errores = [];
  const p = await page.context().newPage(); await rolando(p);
  p.on('pageerror', e => errores.push(e.message));
  await p.goto('/patrones.html');
  await expect(p.locator('h1')).toHaveText('Asistente de patrones');
  await abrirTodo(p);
  await expect(p.locator('#paSecuencia li').first()).toBeVisible();
  expect(errores).toEqual([]);
});

test('el trip hop a 77 BPM trae la base «26 ag impro» y la secuencia dice dónde escribir cada golpe', async ({ page }) => {
  await rolando(page); await page.goto('/patrones.html'); await abrirTodo(page);
  await expect(page.locator('#paBpm')).toHaveValue('77');
  for (const n of [1, 2, 4]) await expect(cas(page, 'k', n)).toHaveAttribute('aria-pressed', 'true');
  await expect(cas(page, 'k', 3)).toHaveAttribute('aria-pressed', 'false');
  for (const n of [5, 13]) await expect(cas(page, 's', n)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button.pa-cas[data-pad="h"][aria-pressed="true"]')).toHaveCount(16);
  const sec = await page.locator('#paSecuencia').innerText();
  expect(sec).toContain('1.1.1, 1.1.2, 1.1.4');       // bombo
  expect(sec).toContain('1.2.1, 1.4.1');              // caja
  expect(sec).toContain('repetición de nota');        // hat de 16: no se escribe casilla a casilla
  expect(sec).toContain('54 %');
});

test('cambiar de casilla, de género y de largo recalcula la secuencia', async ({ page }) => {
  await rolando(page); await page.goto('/patrones.html'); await abrirTodo(page);
  await cas(page, 'k', 3).click();
  expect(await page.locator('#paSecuencia').innerText()).toContain('1.1.1, 1.1.2, 1.1.3, 1.1.4');
  await page.selectOption('#paGenero', 'House (deep / clásico)');
  await expect(page.locator('#paBpm')).toHaveValue('122');
  for (const n of [1, 5, 9, 13]) await expect(cas(page, 'k', n)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#paSecuencia').innerText()).toContain('1.1.1, 1.2.1, 1.3.1, 1.4.1');
  await page.locator('input[name=compases][value="2"]').check({ force: true });
  expect(await page.locator('#paLargo').innerText()).toContain('2.4.3 y 2.4.4');
  await page.reload();                                  // lo elegido se recuerda
  await expect(page.locator('#paGenero')).toHaveValue('House (deep / clásico)');
});

test('el manual K.O. II importado carga y las lecciones de beats alimentan la hoja', async ({ page }) => {
  const r = await page.request.get('/ko2-manual.json');
  const m = await r.json();
  expect(m.lecciones.length).toBe(16);
  expect(m.lecciones.filter(l => l.para_beats).length).toBeGreaterThan(8);
  await rolando(page); await page.goto('/patrones.html');
  await page.locator('#pasoChequeo > summary').click();
  await expect(page.locator('#paErrores .pa-error').first()).toContainText('Lección');
});
