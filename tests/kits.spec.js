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

test('los samples 254–257 (de fábrica, antes sin inventariar) están en la base con sus medidas, como acordes Bm7, y marcados como estimados', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const base = await page.evaluate(() => JSON.parse(document.getElementById('ksDatos').textContent));
  const nuevos = base.sonidos.filter(s => s.slot >= 254 && s.slot <= 257).sort((a, b) => a.slot - b.slot);
  expect(nuevos.map(s => s.slot)).toEqual([254, 255, 256, 257]);
  for (const s of nuevos) { expect(s.rol).toBe('Acorde / stab'); expect(s.origen).toBe('fabrica'); expect(s.pack).toBe('EP-133 Factory Sounds'); expect(s.cargado).toBe(true); expect(s.estimado).toBe(true); expect(s.aviso).toContain('Nivel bajo'); }
  expect(nuevos.map(s => s.dur_s)).toEqual([0.26, 0.26, 0.39, 0.14]);        // medidas con el método de la base
  expect(nuevos.slice(0, 3).map(s => s.acorde)).toEqual(['≈ B m7', '≈ B m7', '≈ B m7']);
  expect(nuevos[3].acorde).toBe('');                                          // el 257 no se pudo clasificar con seguridad
  expect(base.sonidos).toHaveLength(501);
});

test('los samples 254–257 se pueden elegir desde las mejores opciones de un pad y avisan su nivel y su encaje estimado', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  await page.click('#tabC'); await pad(page, 'C:7').click();
  await page.locator('.ks-ops summary').click();
  const opcion = page.locator('.ks-op', { hasText: 'synth keys bm7 254' });
  await expect(opcion).toHaveCount(1);                                         // entra entre las mejores opciones del pad
  await expect(opcion).toContainText('encaje ~');                              // «~» = estimado
  await opcion.click();
  expect(await slotDe(page, 'C:7')).toBe(254);
  await expect(pad(page, 'C:7').locator('.enc')).toContainText('~');
  await expect(page.locator('#ksDetalle')).toContainText('encaje estimado');
  await expect(page.locator('#ksDetalle')).toContainText('Nivel bajo');
  await expect(page.locator('#ksDetalle')).toContainText('≈ B m7');
  await expect(page.locator('.ks-op[aria-current=true]')).toContainText('synth keys bm7 254');   // la opción elegida queda marcada
});

test('el buscador encuentra sonidos por nombre, rol, slot o acorde', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  await expect(page.locator('#ksResultados')).toContainText('Escribe parte del nombre');
  await page.fill('#ksBuscar', 'synth keys');
  await expect(page.locator('#ksResultados .ks-rs')).toHaveCount(4);                       // por nombre
  await expect(page.locator('#ksResultados')).toContainText('4 resultados para Synth pop');
  await page.fill('#ksBuscar', 'bm7');                                                      // por acorde: sólo los tres que se detectaron
  await expect(page.locator('#ksResultados .ks-rs')).toHaveCount(3);
  await page.fill('#ksBuscar', '254');                                                      // por slot
  await expect(page.locator('[data-fijar="synth keys bm7 254"]')).toHaveCount(1);
  await page.fill('#ksBuscar', 'acorde stab');                                              // por rol, varias palabras a la vez
  expect(await page.locator('#ksResultados .ks-rs').count()).toBeGreaterThan(10);
  await page.fill('#ksBuscar', 'ÓRGANO');                                                   // sin distinguir mayúsculas ni tildes
  expect(await page.locator('#ksResultados .ks-rs').count()).toBeGreaterThan(0);
  await page.fill('#ksBuscar', 'zzzzqx');
  await expect(page.locator('#ksResultados')).toContainText('Ningún sonido coincide');
});

test('sin un pad abierto no se puede fijar nada, y con uno abierto el botón dice dónde', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop'); await page.fill('#ksBuscar', 'synth keys');
  const boton = page.locator('[data-fijar="synth keys bm7 254"]');
  await expect(boton).toBeDisabled(); await expect(boton).toHaveText('Abre un pad para fijarlo');
  await page.click('#tabC'); await pad(page, 'C:7').click();
  await expect(boton).toBeEnabled(); await expect(boton).toHaveText('Fijar en C · pad 7');
});

test('un sonido fijado se queda en su pad aunque cambien alternativas, interruptor y recarga; se puede quitar', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop'); await page.click('#tabC'); await pad(page, 'C:7').click();
  const automatico = await slotDe(page, 'C:7');
  expect(automatico).not.toBe(254);
  await page.fill('#ksBuscar', 'synth keys bm7 254'); await page.locator('[data-fijar="synth keys bm7 254"]').click();
  expect(await slotDe(page, 'C:7')).toBe(254);
  await expect(pad(page, 'C:7').locator('.tecla')).toContainText('📌');
  await expect(page.locator('#ksDetalle')).toContainText('Fijado por ti');
  await expect(page.locator('[data-fijar="synth keys bm7 254"]')).toHaveText('Fijado aquí');            // el buscador lo muestra como ya puesto
  await expect(page.locator('[data-fijar="synth keys bm7 254"]')).toBeDisabled();
  await expect(page.locator('#ksSig')).toBeDisabled();                                       // fijado: no hay «siguiente alternativa»
  await page.uncheck('#ksSolo'); await page.check('#ksSolo');                                // cambiar el interruptor no lo suelta
  expect(await slotDe(page, 'C:7')).toBe(254);
  await page.reload(); await page.click('#tabC');
  expect(await slotDe(page, 'C:7')).toBe(254);                                               // y sobrevive a recargar
  await pad(page, 'C:7').click(); await page.click('#ksQuitarFijo');
  expect(await slotDe(page, 'C:7')).toBe(automatico);                                        // vuelve a lo que sugería el ranking
  await expect(pad(page, 'C:7').locator('.tecla')).not.toContainText('📌');
});

test('un sonido va en un solo pad: fijarlo en otro lo saca del anterior, y los demás pads no se lo llevan', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop'); await page.click('#tabC');
  const nombres = async () => page.locator('button.ks-pad .nom').allTextContents();
  await pad(page, 'C:7').click(); await page.fill('#ksBuscar', 'synth keys bm7 254'); await page.locator('[data-fijar="synth keys bm7 254"]').click();
  await pad(page, 'C:8').click(); await page.locator('[data-fijar="synth keys bm7 254"]').click();
  expect(await slotDe(page, 'C:8')).toBe(254);
  expect(await slotDe(page, 'C:7')).not.toBe(254);
  expect((await nombres()).filter(n => n === 'synth keys bm7 254')).toHaveLength(1);        // aparece una sola vez en todo el grupo
  const vistos = [];
  for (const g of ['A', 'B', 'C', 'D']) { await page.click('#tab' + g); vistos.push(...(await nombres())); }
  expect(new Set(vistos).size).toBe(vistos.length);                                          // y en ningún otro grupo
});

test('los fijos son de cada género', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop'); await page.click('#tabC'); await pad(page, 'C:7').click();
  await page.fill('#ksBuscar', 'synth keys bm7 254'); await page.locator('[data-fijar="synth keys bm7 254"]').click();
  expect(await slotDe(page, 'C:7')).toBe(254);
  await page.selectOption('#ksGenero', 'Techno / tech house'); await page.click('#tabC');
  await expect(pad(page, 'C:7').locator('.tecla')).not.toContainText('📌');
  await page.selectOption('#ksGenero', 'Synth pop'); await page.click('#tabC');
  expect(await slotDe(page, 'C:7')).toBe(254);                                               // al volver, sigue ahí
});
