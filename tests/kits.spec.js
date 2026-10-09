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
  expect([217, 202]).toContain(await slotDe(page, 'A:4'));           // hat cerrado: «crunch hat 2» está en el 217 del aparato real (el paquete de fábrica lo numeraba 216)
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

  // bombo a 120 BPM: la cola de «boom dry» (0.7 s) pasa de 1 tiempo (0.5 s) y pierde 4 puntos (86), así que gana su variante «boom wet» (89);
  // «sub kick» (95 − 8 = 87) queda detrás
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('boom wet');
  await expect(pad(page, 'A:0').locator('.nom')).toHaveText('sub kick');
  await expect(pad(page, 'A:ENTER')).toHaveCount(0);               // no es caja: sin sonido, no hay botón
  // «boom dry» es variante de «boom wet»: no entra en su pad, pero sí completa un pad que si no quedaría vacío (y el detalle lo dice)
  await expect(pad(page, 'A:8').locator('.nom')).toHaveText('boom dry');
  await pad(page, 'A:8').click(); await expect(page.locator('#ksDetalle')).toContainText('Pad completado');
  await expect(page.locator('#ksDetalle')).toContainText('sonido afín al grupo');

  await expect(page.locator('#ksDetalle')).toContainText('supera 1 tiempo');   // (el pad A:8 sigue abierto)   // cola 0.7 s > 0.5 s
  await pad(page, 'A:0').click();
  await expect(page.locator('#ksDetalle')).toContainText('casi inaudible');
  await expect(page.locator('#ksDetalle')).toContainText('menos 8 puntos');
  await pad(page, 'A:4').click();
  await expect(page.locator('#ksDetalle')).toContainText('supera medio tiempo');   // cola 0.3 s > 0.25 s

  await page.fill('#ksBpm', '60');                                  // a 60 BPM un tiempo dura 1 s: ya no hay aviso ni castigo, y «boom dry» (90) vuelve a ganar
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('boom dry');
  await pad(page, 'A:7').click();
  await expect(page.locator('#ksDetalle')).not.toContainText('supera 1 tiempo');
  await expect(page.locator('#ksDetalle')).not.toContainText('ajuste por BPM');

  await page.fill('#ksBpm', '120');
  await page.click('#tabC'); await pad(page, 'C:7').click();
  await expect(page.locator('#ksDetalle')).toContainText('≈ 4 compases');       // 8 s / (4 × 0.5 s)

  // con el interruptor apagado entran los «por cargar», marcados con ★
  await page.click('#tabA'); await page.uncheck('#ksSolo');
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('ghost kick');
  await expect(pad(page, 'A:7').locator('.slot')).toHaveText('★ por cargar');
  await page.check('#ksSolo');
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText('boom wet');           // a 120 BPM «boom dry» pierde por su cola
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
  expect(base.sonidos).toHaveLength(581);
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

// ── Audio local: la biblioteca se carga desde el computador de Rolando y se guarda en su navegador ──
const zlib = require('zlib');
const wav = (seg = 0.3, hz = 440, sr = 46875) => {
  const n = Math.round(sr * seg), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / sr) * 12000), 44 + i * 2);
  return b;
};
const crc32 = buf => { let crc = 0xFFFFFFFF; for (const byte of buf) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); } return (~crc) >>> 0; };
const zip = entradas => {                                                  // zip mínimo: método 8 (deflate) o 0 (sin comprimir)
  const locales = [], centrales = []; let pos = 0;
  for (const { nombre, datos, metodo = 8 } of entradas) {
    const comp = metodo === 8 ? zlib.deflateRawSync(datos) : datos, nom = Buffer.from(nombre), crc = crc32(datos);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(metodo, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(datos.length, 22); l.writeUInt16LE(nom.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(metodo, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(pos, 42);
    locales.push(l, nom, comp); centrales.push(c, nom); pos += 30 + nom.length + comp.length;
  }
  const cd = Buffer.concat(centrales), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...locales, cd, fin]);
};
const subirAudio = (page, archivos) => page.setInputFiles('#ksAudioInArchivos', archivos.map(([name, buffer]) => ({ name, mimeType: name.endsWith('.pak') ? 'application/zip' : 'audio/wav', buffer })));
const sonando = page => page.locator('body');

test('sin biblioteca de audio no hay botones de escuchar y el resumen invita a cargarla', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await expect(page.locator('#ksAudioResumen')).toContainText('Sin audio');
  await expect(page.locator('.ks-play')).toHaveCount(0);
  await pad(page, 'A:7').click();
  await expect(page.locator('#ksSinAudio')).toBeVisible(); await expect(page.locator('#ksPlay')).toHaveCount(0);
});

test('los archivos se asocian por nombre o, si no tienen nombre, por número a los sonidos estimados; el resto se informa', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirAudio(page, [['001 micro kick.wav', wav()], ['kick dirt.wav', wav()], ['254 sample.wav', wav()], ['023 sample.wav', wav()], ['cualquier cosa.wav', wav()], ['notas.txt', Buffer.from('x')]]);
  await expect(page.locator('#ksAudioInfo')).toContainText('3 con audio nuevo');
  await expect(page.locator('#ksAudioInfo')).toContainText('2 archivos sin coincidencia');      // «cualquier cosa» y «023 sample»; el .txt ni se mira
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 3 de 581');
  await page.fill('#ksBuscar', 'micro kick'); await expect(page.locator('.ks-play[data-nombre="micro kick"]')).toHaveCount(1);   // por nombre, con el número del paquete delante
  await page.fill('#ksBuscar', 'synth keys bm7 254'); await expect(page.locator('.ks-play[data-nombre="synth keys bm7 254"]')).toHaveCount(1);   // por número: estimado
  await page.fill('#ksBuscar', 'nt alt kick c'); await expect(page.locator('#ksResultados .ks-rs').filter({ hasText: 'nt alt kick c' }).first()).toBeVisible();
  await expect(page.locator('#ksResultados .ks-play')).toHaveCount(0);                          // el «023 sample» NO se pegó al slot 23: podría ser otro sonido
});

test('un sonido con audio se escucha desde la lista, el buscador y el detalle, y se puede parar', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  await pad(page, 'A:7').click(); const nombre = (await pad(page, 'A:7').locator('.nom').textContent()).trim();
  await subirAudio(page, [[`${nombre}.wav`, wav(2)]]);
  await expect(page.locator('#ksPlay')).toHaveText('▶ Escuchar');                                // el detalle abierto se repinta solo
  await expect(page.locator(`#ksLista .ks-play[data-nombre="${nombre}"]`)).toHaveCount(1);       // y la lista del plan
  await page.click('#ksPlay');
  await expect(sonando(page)).toHaveAttribute('data-sonando', nombre);
  await expect(page.locator('#ksPlay')).toHaveText('■ Parar');
  await page.click('#ksPlay');                                                                   // parar
  await expect(sonando(page)).not.toHaveAttribute('data-sonando', /./);
  await page.fill('#ksBuscar', nombre); await page.locator(`#ksResultados .ks-play[data-nombre="${nombre}"]`).click();   // desde el buscador
  await expect(sonando(page)).toHaveAttribute('data-sonando', nombre);
  await expect(page.locator(`#ksResultados .ks-play[data-nombre="${nombre}"]`)).toHaveText('■');
});

test('al terminar el sonido el botón vuelve a ▶ solo', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirAudio(page, [['micro kick.wav', wav(0.4)]]); await page.fill('#ksBuscar', 'micro kick');
  await page.locator('.ks-play[data-nombre="micro kick"]').click();
  await expect(sonando(page)).toHaveAttribute('data-sonando', 'micro kick');
  await expect(sonando(page)).not.toHaveAttribute('data-sonando', /./, { timeout: 5000 });
  await expect(page.locator('.ks-play[data-nombre="micro kick"]')).toHaveText('▶');
});

test('la biblioteca sobrevive a recargar, se puede ampliar sin perder lo anterior y se borra en dos pasos', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirAudio(page, [['micro kick.wav', wav(1)]]);
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 1 de 581');
  await page.reload();
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 1 de 581');            // sigue ahí
  await page.fill('#ksBuscar', 'micro kick'); await page.locator('.ks-play[data-nombre="micro kick"]').click();
  await expect(sonando(page)).toHaveAttribute('data-sonando', 'micro kick');                    // y suena tras recargar
  await subirAudio(page, [['micro kick.wav', wav(1, 880)], ['nt kick.wav', wav(1)]]);          // uno actualizado y uno nuevo
  await expect(page.locator('#ksAudioInfo')).toContainText('1 con audio nuevo, 1 actualizados');
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 2 de 581');
  await page.locator('#ksAudioCaja > summary').click();
  await page.click('#ksAudioBorrar'); await expect(page.locator('#ksAudioBorrar')).toHaveText('¿Seguro? Pulsa otra vez');
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 2');                    // con un solo clic no se borra
  await page.click('#ksAudioBorrar');
  await expect(page.locator('#ksAudioResumen')).toContainText('Sin audio');
  await expect(page.locator('.ks-play')).toHaveCount(0);
});

test('un .pak (zip) se lee por dentro: sólo entran los audios que coinciden con la base', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const pak = zip([{ nombre: '/sounds/002 nt kick.wav', datos: wav(0.2) }, { nombre: '/sounds/003 nt kick b.wav', datos: wav(0.2), metodo: 0 },
    { nombre: '/sounds/999 no existe.wav', datos: wav(0.2) }, { nombre: '/projects/P01.tar', datos: Buffer.from('basura') }]);
  await subirAudio(page, [['ep-133-factory.pak', pak]]);
  await expect(page.locator('#ksAudioInfo')).toContainText('2 con audio nuevo');                // deflate y sin comprimir
  await expect(page.locator('#ksAudioInfo')).toContainText('1 archivo sin coincidencia');       // «999 no existe»; el .tar ni se mira
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 2 de 581');
});

test('un audio dañado no rompe nada: avisa y sigue funcionando', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await rolando(page); await page.goto('/kits.html');
  await subirAudio(page, [['micro kick.wav', Buffer.from('esto no es un wav de verdad')]]);
  await page.fill('#ksBuscar', 'micro kick'); await page.locator('.ks-play[data-nombre="micro kick"]').click();
  await expect(page.locator('#ksEstado')).toContainText('No se pudo reproducir «micro kick»');
  await expect(sonando(page)).not.toHaveAttribute('data-sonando', /./);
  await page.fill('#ksBuscar', 'nt kick'); await expect(page.locator('#ksResultados .ks-rs').first()).toBeVisible();
  expect(errs, errs.join('\n')).toEqual([]);
});

const aiff = (seg = 1, hz = 440, sr = 44100) => {                           // AIFF sin comprimir, 16 bits, mono, con la frecuencia en 80 bits
  const n = Math.round(sr * seg), b = Buffer.alloc(54 + n * 2), e2 = Math.floor(Math.log2(sr));
  b.write('FORM', 0); b.writeUInt32BE(46 + n * 2, 4); b.write('AIFF', 8); b.write('COMM', 12); b.writeUInt32BE(18, 16); b.writeInt16BE(1, 20); b.writeUInt32BE(n, 22); b.writeInt16BE(16, 26);
  b.writeUInt16BE(e2 + 16383, 28); b.writeBigUInt64BE(BigInt(sr) << BigInt(63 - e2), 30); b.write('SSND', 38); b.writeUInt32BE(8 + n * 2, 42);
  for (let i = 0; i < n; i++) b.writeInt16BE(Math.round(Math.sin(2 * Math.PI * hz * i / sr) * 12000), 54 + i * 2);
  return b;
};
test('un .aiff también suena (Chrome no lo decodifica solo)', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.setInputFiles('#ksAudioInArchivos', [{ name: 'ht synth.aiff', mimeType: 'audio/aiff', buffer: aiff(1.5) }]);
  await expect(page.locator('#ksAudioInfo')).toContainText('1 con audio nuevo');
  await page.uncheck('#ksSolo');                                                               // «ht synth» es un sample por cargar: sólo aparece con el interruptor apagado
  await page.fill('#ksBuscar', 'ht synth'); await page.locator('.ks-play[data-nombre="ht synth"]').click();
  await expect(sonando(page)).toHaveAttribute('data-sonando', 'ht synth');
  await expect(page.locator('#ksEstado')).not.toContainText('No se pudo reproducir');
});

test('ningún pad queda vacío: 9 géneros × 4 grupos, con y sin el interruptor «sólo lo cargado»', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const generos = await page.locator('#ksGenero option').evaluateAll(os => os.map(o => o.value));
  for (const solo of [true, false]) {
    if (solo) await page.check('#ksSolo'); else await page.uncheck('#ksSolo');
    for (const g of generos) {
      await page.selectOption('#ksGenero', g);
      for (const gr of ['A', 'B', 'C', 'D']) {
        await page.click('#tab' + gr);
        expect(await page.locator('button.ks-pad').count(), `${g} · grupo ${gr} · sólo cargados=${solo}`).toBe(12);   // los 12 pads con sonido
      }
    }
  }
});

test('el grupo B trae 12 bajos distintos, uno por pad', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house'); await page.click('#tabB');
  const roles = await page.locator('button.ks-pad .rol').allTextContents(); const nombres = await page.locator('button.ks-pad .nom').allTextContents();
  expect(roles).toHaveLength(12); expect(new Set(roles)).toEqual(new Set(['Bajo']));
  expect(new Set(nombres).size).toBe(12);
  expect(await slotDe(page, 'B:7')).toBe(403);                                                       // el mejor sigue primero
});

test('sin sonidos para un rol, el pad se completa con uno afín y lo dice; sin nada afín queda vacío', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await subirBase(page, SINTETICA); await page.fill('#ksBpm', '120');
  await page.locator('#ksGrid button.ks-pad').first().click();                                    // abre un pad cualquiera para ver que el motor no se rompe
  await pad(page, 'A:9').click();                                                                  // «clap»: no hay ninguno en la base de prueba
  await expect(page.locator('#ksDetalle')).toContainText('Pad completado para que no quede vacío');
  await expect(page.locator('#ksDetalle')).toContainText('afín al grupo');
  await expect(page.locator('#ksGrid .ks-pad.libre').first()).toBeVisible();                       // con sólo 9 sonidos no alcanza para los 12 pads: «en lo posible»
});

test('el ajuste espectral prefiere el techo y la onda del género, está acotado y se explica', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const base = { ...SINTETICA, sonidos: [
    snd('hat oscuro', 'Hat cerrado', 60, { slot: 5, techo_khz: 11 }),          // techo ideal de Prueba: 12 kHz (ver BRILLO) → no aplica a un género inventado
    snd('bajo sierra', 'Bajo', 70, { slot: 20, onda: 'diente de sierra', pico_grave_hz: 60 }),
    snd('bajo seno', 'Bajo', 70, { slot: 21, onda: 'seno', pico_grave_hz: 60 }),
  ] };
  base.generos = [{ id: 'Lofi house', bpm_min: 100, bpm_max: 130, bpm_default: 120, rasgos: '', fuente: '' }];
  base.sonidos.forEach(s => { s.encaje = { 'Lofi house': s.encaje.Prueba }; });
  await subirBase(page, base); await page.fill('#ksBpm', '120');
  await page.click('#tabB');
  expect(await slotDe(page, 'B:7')).toBe(21);                                  // empatan en 70: el seno gana por +2 de onda
  await pad(page, 'B:7').click();
  await expect(page.locator('#ksDetalle')).toContainText('ajuste espectral +2');
  await expect(page.locator('#ksDetalle')).toContainText('onda seno');
});

test('Synth pop: baterías Behringer RD en el grupo A, bajos analógicos y pads suaves en C y D', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  const nombres = async t => { await page.click('#tab' + t); return page.locator('button.ks-pad .nom').allTextContents(); };
  // Con lo ya cargado: el bombo es un RD-8 (hay 3 RD en el aparato).
  expect((await nombres('A'))[0]).toMatch(/RD-?8/i);
  // Mirando también lo que falta cargar, el grupo A se llena de RD (606 y 808): al menos 6 de 12.
  await page.locator('#ksSolo').setChecked(false);
  const a = await nombres('A'); expect(a.filter(n => /\bRD-?[689]\b/i.test(n)).length).toBeGreaterThanOrEqual(6);
  await page.locator('#ksSolo').setChecked(true);
  expect(await nombres('B')).toContain('Bajo_Moog70s_Pluck_C2');                                    // bajo analógico (sierra, Moog)
  const d = await nombres('D'); expect(d).toContain('Classic Analog Pad');                          // el pad del slot 460 ya entra
  const c = await nombres('C'); expect(c).toEqual(expect.arrayContaining(['Pad_Suave_Cuerdas_Cm9', 'Celestial Voices']));
  await page.click('#tabD'); await page.locator('button.ks-pad', { hasText: 'Classic Analog Pad' }).click();
  await expect(page.locator('#ksDetalle')).toContainText('pad con ataque lento');
  // Los otros géneros no cambian: el bombo de Lofi house sigue sin forzar RD.
  await page.selectOption('#ksGenero', 'Lofi house'); await page.click('#tabA');
  expect([2, 1, 35]).toContain(await slotDe(page, 'A:7'));                                          // igual que la prueba de aceptación
  expect(await page.locator('button.ks-pad .nom').first().textContent()).not.toMatch(/RD/);
});

test('el BPM mueve el ranking: a más tempo, los hats abiertos de cola larga pierden y los cortos ganan', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const base = { ...SINTETICA, sonidos: [
    snd('open largo', 'Hat abierto', 80, { slot: 5, cola20_s: 0.9 }),
    snd('open medio', 'Hat abierto', 76, { slot: 6, cola20_s: 0.3 }),
    snd('open otro', 'Hat abierto', 60, { slot: 7, cola20_s: 0.3 }),
  ] };
  await subirBase(page, base);
  await page.fill('#ksBpm', '60');                                  // 1 tiempo = 1 s: «open largo» (0.9 s) cabe y respira (+2 = 82)
  await expect(pad(page, 'A:5').locator('.nom')).toHaveText('open largo');
  await page.fill('#ksBpm', '128');                                 // 1 tiempo = 0.47 s: 0.9 s lo pasa (−3 = 77) y «open medio» (76 + 2 = 78) gana
  await expect(pad(page, 'A:5').locator('.nom')).toHaveText('open medio');
  await pad(page, 'A:5').click(); await expect(page.locator('#ksDetalle')).toContainText('respira hasta el siguiente tiempo');
});

test('«me gusta» y «no me gusta» mueven el ranking de ese género, sobreviven a recargar y se olvidan', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house'); await page.click('#tabB');
  const primero = (await page.locator('button.ks-pad .nom').allTextContents())[0];
  await pad(page, 'B:7').click();
  await page.click('#ksNoGusta');                                   // −25: ya no es el primero
  const despues = (await page.locator('button.ks-pad .nom').allTextContents());
  expect(despues[0]).not.toBe(primero); expect(despues).not.toContain(primero);
  await page.reload(); await page.selectOption('#ksGenero', 'Lofi house'); await page.click('#tabB');
  expect(await page.locator('button.ks-pad .nom').allTextContents()).not.toContain(primero);   // se acuerda
  await page.selectOption('#ksGenero', 'Synth pop'); await page.click('#tabB');
  const sp = await page.locator('button.ks-pad .nom').allTextContents();                       // otro género: sin efecto
  await pad(page, 'B:7').click(); await page.click('#ksMeGusta');
  await expect(page.locator('#ksDetalle')).toContainText('te gustó en Synth pop');
  await page.selectOption('#ksGenero', 'Lofi house'); await page.click('#tabB'); await pad(page, 'B:7').click();
  await page.click('#ksOlvidarGustos');                              // olvida las marcas de Lofi house
  await expect(pad(page, 'B:7').locator('.nom')).toHaveText(primero);
  expect(sp.length).toBe(12);
});

test('comparar A/B: B por defecto es la siguiente opción, alterna, igualar volumen y «usar B»', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house'); await pad(page, 'A:7').click();
  await expect(page.locator('#ksAB')).toBeVisible();
  const a = await pad(page, 'A:7').locator('.nom').textContent();
  const b = await page.locator('#ksAbSel').inputValue(); expect(b).not.toBe(a);
  await expect(page.locator('#ksAbHint')).toContainText('necesitas el audio');          // sin biblioteca: botones apagados
  await expect(page.locator('#ksAbAlt')).toBeVisible(); await expect(page.locator('#ksAbA')).toBeDisabled();
  await page.click('#ksAbUsar');
  await expect(pad(page, 'A:7').locator('.nom')).toHaveText(b);
  await expect(page.locator('#ksIgualar')).toBeChecked();
  await page.uncheck('#ksIgualar'); await page.reload(); await page.selectOption('#ksGenero', 'Lofi house'); await pad(page, 'A:7').click();
  await expect(page.locator('#ksIgualar')).not.toBeChecked();                            // se acuerda
});

test('igualar volumen: un sonido fuerte y uno bajito suenan al mismo nivel; apagado, sin cambios', async ({ page }) => {
  const escalar = (b, k) => { const c = Buffer.from(b); for (let i = 44; i < c.length; i += 2) c.writeInt16LE(Math.round(c.readInt16LE(i) * k), i); return c; };
  await rolando(page); await page.goto('/kits.html');
  await subirAudio(page, [['micro kick.wav', wav(0.5)], ['nt kick.wav', escalar(wav(0.5), 0.2)]]);   // el segundo, 14 dB más bajo
  const ganancia = async nombre => {
    await page.fill('#ksBuscar', nombre); await page.locator(`#ksResultados .ks-play[data-nombre="${nombre}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-sonando', nombre);
    return Number(await page.locator('body').getAttribute('data-ganancia'));
  };
  const fuerte = await ganancia('micro kick'), bajo = await ganancia('nt kick');
  expect(bajo / fuerte).toBeGreaterThan(4.5); expect(bajo / fuerte).toBeLessThan(5.5);                 // 1 / 0.2 = 5: lo bajito sube 14 dB respecto al fuerte
});

test('hat típico: Lofi house lleva un cerrado seco y un abierto de cola típica, no el glitch/crunch ni el hat con reverb', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house'); await page.fill('#ksBpm', '120');
  await expect(pad(page, 'A:4').locator('.nom')).toHaveText('nt hh closed c');
  await expect(pad(page, 'A:5').locator('.nom')).toHaveText('open hat real');
  await pad(page, 'A:4').click(); await expect(page.locator('#ksDetalle')).toContainText('hat típico');
  await expect(page.locator('#ksDetalle')).toContainText('tick corto y seco');
  await page.selectOption('#ksGenero', 'Techno / tech house');
  const nombres = await page.locator('button.ks-pad .nom').allTextContents();
  expect(nombres.slice(3, 5).join(' ')).not.toMatch(/glitch|crunch|foot|pedal|wet/i);
});

test('el hat abierto hace pareja con el cerrado elegido (misma familia de máquina)', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  const hat = (n, rol, enc, extra) => snd(n, rol, enc, { cola20_s: 0.05, ...extra });
  await subirBase(page, { ...SINTETICA, sonidos: [
    hat('hat closed 9x9', 'Hat cerrado', 80, { slot: 1 }), hat('tick b', 'Hat cerrado', 78, { slot: 2 }),
    hat('open zz', 'Hat abierto', 84, { slot: 3, cola20_s: 0.2 }), hat('hat open 9x9', 'Hat abierto', 82, { slot: 4, cola20_s: 0.2 })] });
  await page.fill('#ksBpm', '120');
  await expect(pad(page, 'A:4').locator('.nom')).toHaveText('hat closed 9x9');
  await expect(pad(page, 'A:5').locator('.nom')).toHaveText('hat open 9x9');                   // 82 + pareja 3 > 84
  await pad(page, 'A:5').click(); await expect(page.locator('#ksDetalle')).toContainText('hace pareja con el hat cerrado');
});

test('Synth pop: grupo A de cajas de ritmos de la época y sintes (no loops ni instrumentos étnicos) en C y D', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  const a = await page.locator('button.ks-pad .nom').allTextContents();
  expect(a.filter(n => /RD-?[689]|DMX|lnndrum|linn|707|808|7x7|8x8|6x6/i.test(n)).length).toBeGreaterThanOrEqual(5);
  const cd = [];
  for (const t of ['C', 'D']) { await page.click('#tab' + t); cd.push(...await page.locator('button.ks-pad .nom').allTextContents()); }
  expect(cd.join(' | ')).not.toMatch(/loop|guzheng|sitar|exotic pluck|cello pluckz/i);
  expect(cd).toEqual(expect.arrayContaining(['Classic Analog Pad', 'synth keys bm7 254']));       // tu pad y tus sintes
  await page.locator('button.ks-pad', { hasText: 'Classic Analog Pad' }).first().click(); await expect(page.locator('#ksDetalle')).toContainText('carácter de sintetizador');
});

test('tocar un pad suena 1 s sin pulsar ▶, y se puede apagar', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Lofi house');
  const nombre = await pad(page, 'A:7').locator('.nom').textContent();
  await subirAudio(page, [[nombre + '.wav', wav(3)]]);                                   // 3 s de audio
  await pad(page, 'A:7').click();
  await expect(page.locator('body')).toHaveAttribute('data-sonando', nombre);              // suena al tocar
  await expect(page.locator('body')).not.toHaveAttribute('data-sonando', nombre, { timeout: 3000 });   // se corta solo al segundo
  await page.uncheck('#ksSonarPad');
  await pad(page, 'A:7').click(); await pad(page, 'A:7').click();
  await page.waitForTimeout(300);
  await expect(page.locator('body')).not.toHaveAttribute('data-sonando', /./);             // apagado: no suena
  await page.reload(); await expect(page.locator('#ksSonarPad')).not.toBeChecked();         // se acuerda
});

// Un K.O. II de mentira: contesta lo mismo que el real a identidad, INIT, LIST, METADATA_GET y GET, y anota cada orden que le llega.
const KO_FALSO = () => {
  const pack7 = s => { const n = s.length, out = new Uint8Array(n ? n + Math.ceil(n / 7) : 0); let o = 1, m = 0; for (let j = 0; j < n; j++) { const k = j % 7; out[m] |= (s[j] >> 7) << k; out[o++] = s[j] & 127; if (k === 6 && j < n - 1) { m += 8; o++; } } return out; };
  const unpack7 = s => { let a = 0, o = 0, k = 0, j = 1, hi = s[0]; while (j < s.length) { s[a] = ((hi & (1 << k)) ? 128 : 0) | (s[j] & 127); k++; j++; a++; if (k > 6) { j++; k = 0; o += 8; hi = s[o]; } } return s.subarray(0, a); };
  const enc = new TextEncoder(), u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const pcm = (n, ch, be) => { const b = new Uint8Array(n * ch * 2), dv = new DataView(b.buffer); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) dv.setInt16((i * ch + c) * 2, Math.round(Math.sin(i / 20) * 12000), !be); return b; };
  const sonidos = { 1: { meta: { channels: 1, samplerate: 46875, format: 's16', name: 'micro kick' }, pcm: pcm(23000, 1) }, 460: { meta: { channels: 2, samplerate: 48000, format: 's16', name: 'classic.alog pad' }, pcm: pcm(120000, 2) }, 999: { meta: { channels: 1, samplerate: 46875 }, pcm: pcm(500, 1) } };
  const entradas = (lista) => { const out = []; for (const [id, flags, size, nombre] of lista) out.push(id >> 8, id & 255, flags, ...u32(size), ...enc.encode(nombre), 0); return out; };
  window.__ko = { ordenes: [], conectado: false };
  const responder = (rid, datos, estado = 0) => { const p = pack7(Uint8Array.from(datos)), t = new Uint8Array(10 + p.length); t.set([0xF0, 0, 0x20, 0x76, 0x33, 0x40, (rid >> 7) & 31, rid & 127, 5, estado]); t.set(p, 10); t[t.length - 1] = 0xF7; return t; };
  let desde = 0;
  const entrada = { id: 'in', name: 'EP-133 K.O. II', manufacturer: 'teenage engineering', state: 'connected', onmidimessage: null };
  const salida = { id: 'out', name: 'EP-133 K.O. II', manufacturer: 'teenage engineering', state: 'connected', send(d) {
    d = Uint8Array.from(d); const resp = x => setTimeout(() => entrada.onmidimessage && entrada.onmidimessage({ data: x }), 0);
    if (d.length === 6 && d[1] === 0x7E) { resp(Uint8Array.from([0xf0, 0x7e, 0x33, 6, 2, 0, 0x20, 0x76, 0x20, 0, 2, 0, 0, 0, 0, 0, 0xf7])); return; }
    const rid = ((d[6] & 31) << 7) | (d[7] & 127), q = unpack7(d.slice(9, d.length - 1)); window.__ko.ordenes.push([q[0], q[1]]);
    if (q[0] === 1) return resp(responder(rid, [0x0c, 0, 0, 2, 0]));
    if (q[0] === 4) { const pag = (q[1] << 8) | q[2], carpeta = (q[3] << 8) | q[4];
      if (pag > 0) return resp(responder(rid, [0, pag]));
      const lista = carpeta === 0 ? [[1000, 14, 0, 'sounds'], [2000, 14, 0, 'projects']] : Object.keys(sonidos).map(id => [Number(id), 29, sonidos[id].pcm.length, String(id).padStart(3, '0') + '.pcm']);
      return resp(responder(rid, [0, 0, ...entradas(lista)])); }
    if (q[0] === 7 && q[1] === 2) { const id = (q[2] << 8) | q[3], pag = (q[4] << 8) | q[5]; return resp(responder(rid, pag === 0 ? [0, 0, ...enc.encode(JSON.stringify(sonidos[id].meta)), 0] : [0, pag])); }
    if (q[0] === 3 && q[1] === 0) { desde = (q[2] << 8) | q[3]; return resp(responder(rid, [0, 0, 0, ...u32(sonidos[desde].pcm.length), ...enc.encode(String(desde)), 0])); }
    if (q[0] === 3 && q[1] === 1) { const pag = (q[2] << 8) | q[3], tam = 400, trozo = sonidos[desde].pcm.slice(pag * tam, (pag + 1) * tam); return resp(responder(rid, [q[2], q[3], ...trozo])); }
    resp(responder(rid, [], 1));
  } };
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['in', entrada]]), outputs: new Map([['out', salida]]), onstatechange: null });
};

test('leer del aparato: lista los sonidos, suenan con ▶ sin cargar carpetas y sólo salen órdenes de lectura', async ({ page }) => {
  await page.addInitScript(KO_FALSO); await rolando(page); await page.goto('/kits.html');
  await expect(page.locator('#ksAudioResumen')).toContainText('Sin audio');
  await page.locator('#ksAudioCaja summary').click(); await page.click('#ksKoConectar');
  await expect(page.locator('#ksKoInfo')).toContainText('TE032AS002: 3 sonidos en el aparato, 2 con ▶');
  await expect(page.locator('#ksKoInfo')).toContainText('slots que la base no conoce: 999');
  await expect(page.locator('#ksAudioResumen')).toContainText('Audio de 2 de');
  await page.fill('#ksBuscar', 'micro kick');
  await page.locator('#ksResultados .ks-play[data-nombre="micro kick"]').click();               // lee del aparato y suena
  await expect(page.locator('body')).toHaveAttribute('data-sonando', 'micro kick');
  await page.fill('#ksBuscar', 'Classic Analog Pad');                                              // estéreo, 48 kHz
  await page.locator('#ksResultados .ks-play[data-nombre="Classic Analog Pad"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sonando', 'Classic Analog Pad', { timeout: 30000 });     // ▶ lee el archivo entero (1 200 páginas)
  const ordenes = await page.evaluate(() => window.__ko.ordenes);
  expect(ordenes.length).toBeGreaterThan(5);
  const permitidas = [[1], [3, 0], [3, 1], [4], [7, 2], [11]];
  for (const [a, b] of ordenes) expect(permitidas.some(([x, y]) => x === a && (y === undefined || y === b)), `orden no permitida ${a},${b}`).toBe(true);
  await page.click('#ksKoSoltar');                                                                 // dejar de leer: vuelven a no tener audio
  await expect(page.locator('#ksAudioResumen')).toContainText('Sin audio');
});

test('leer del aparato: sin Web MIDI o sin aparato avisa sin romper nada', async ({ page }) => {
  await rolando(page);
  await page.addInitScript(() => { navigator.requestMIDIAccess = async () => ({ inputs: new Map(), outputs: new Map() }); });
  await page.goto('/kits.html'); await page.locator('#ksAudioCaja summary').click(); await page.click('#ksKoConectar');
  await expect(page.locator('#ksKoInfo')).toContainText('no veo el aparato');
  await expect(page.locator('#ksKoConectar')).toBeEnabled();
});

test('leer del aparato: al tocar un pad sólo lee el primer segundo y pico del aparato, no el archivo entero', async ({ page }) => {
  await page.addInitScript(KO_FALSO); await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  await page.locator('#ksAudioCaja summary').click(); await page.click('#ksKoConectar');
  await expect(page.locator('#ksKoInfo')).toContainText('2 con ▶');
  await page.click('#tabD');
  await page.locator('button.ks-pad', { hasText: 'Classic Analog Pad' }).first().click();               // 480 000 bytes en el aparato (120 000 muestras estéreo)
  await expect(page.locator('body')).toHaveAttribute('data-sonando', 'Classic Analog Pad');
  const pags = await page.evaluate(() => window.__ko.ordenes.filter(o => o[0] === 3 && o[1] === 1).length);
  expect(pags).toBeGreaterThan(100); expect(pags).toBeLessThan(700);                                      // el archivo entero serían 1 200 páginas
}); 

test('Synth pop: los pads sintéticos nuevos (563–567) están en la base y los suaves entran en C y D', async ({ page }) => {
  await rolando(page); await page.goto('/kits.html');
  await page.selectOption('#ksGenero', 'Synth pop');
  const todos = [];
  for (const t of ['C', 'D']) { await page.click('#tab' + t); todos.push(...await page.locator('button.ks-pad .nom').allTextContents()); }
  expect(todos.filter(n => ['Cold Poly Em9', 'Machine Strings Dm', 'Dark Choir Cm', 'Glass Wave Fm9', 'Warm PWM Bbmaj9', 'Pad Gated Cm', 'Drone Oscuro Dm', 'Pad Lamento Blues Gm'].includes(n)).length).toBeGreaterThanOrEqual(2);
  await page.fill('#ksBuscar', 'Warm PWM'); await expect(page.locator('#ksResultados')).toContainText('Warm PWM Bbmaj9');
  await expect(page.locator('#ksResultados')).toContainText('567');
});
