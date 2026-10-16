// DenaviLab: Sounds (la PWA de site/sounds). Se prueba con el micrófono falso de Chromium:
// puerta de acceso, grabar → guardar → biblioteca → editar → exportar, el perfil sin K.O. II, la selección múltiple y el móvil.
const fs = require('fs');
const { test, expect } = require('@playwright/test');

const URL = '/sounds/';
const abrir = async (page, quien = 'rolando', extra = {}) => {
  await page.addInitScript(([q, ex]) => {
    try {
      localStorage.setItem('denavilab.sesion', q);
      localStorage.setItem('denavilab.sounds.onboarded', '1');
      for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
    } catch (e) {}
  }, [quien, extra]);
  await page.goto(URL);
};
const vigilar = page => {
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  return errores;
};
const tab = (page, id) => page.locator(`.tab[data-tab="${id}"]`).click();
async function sembrar(page, nombres) {
  await page.evaluate(async names => {
    const st = await import('/sounds/store.js');
    for (let i = 0; i < names.length; i++) {
      const audio = new Float32Array(48000).map((_, k) => 0.5 * Math.sin(k * 0.05));
      await st.putSample(st.newSample(names[i], audio, 48000, { created: Date.now() + i * 1000 }), audio);
    }
  }, nombres);
  await page.reload();
}
const wavInfo = buf => ({ riff: buf.toString('ascii', 0, 4), canales: buf.readUInt16LE(22), rate: buf.readUInt32LE(24), bits: buf.readUInt16LE(34), datos: buf.readUInt32LE(40) });
async function descargar(page, accion) { const [d] = await Promise.all([page.waitForEvent('download'), accion()]); return { buf: fs.readFileSync(await d.path()), nombre: d.suggestedFilename() }; }

test.describe('núcleo de audio (dsp.js)', () => {
  test('lo esencial funciona en el navegador', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async () => {
      const d = await import('/sounds/dsp.js'), z = await import('/sounds/zip.js');
      const w = d.encodeWav(Float32Array.of(0, .5, -.5, 1, -1), 46875), back = d.decodeWav(w);
      const quiet = new Float32Array(144000).map((_, i) => 0.002 * Math.sin(i * 0.37)); quiet[70000] = 0.01;
      const click = new Float32Array(48000); click[24000] = .5;
      const track = (bpm, seg, rate = 44100) => { const x = new Float32Array(seg * rate); for (let t = .1; t < seg - .1; t += 60 / bpm) { const s = Math.floor(t * rate); for (let j = 0; j < 2000 && s + j < x.length; j++) x[s + j] = .8 * Math.sin(2 * Math.PI * 220 * j / rate) * (1 - j / 2000); } return x; };
      const s = { ...d.QUICK_DEFAULTS, fades: false, normalize: false };
      const zip = z.readZip(z.makeZip([{ name: 'a/ñ.wav', data: Uint8Array.of(1, 2, 3) }]));
      return {
        wav: [w.length, back.rate, Math.abs(back.samples[1] - .5) < 1e-3], res: d.resample(new Float32Array(48000), 48000, 46875).length,
        baja: d.quickProcess(quiet, 48000, s).length / quiet.length, clic: d.quickProcess(click, 48000, s).length,
        norm: Math.max(...d.quickProcess(new Float32Array(48000).fill(.004), 48000, d.QUICK_DEFAULTS)),
        bpm100: d.estimateBPM(track(100, 10), 44100).bpm, bpm120: d.estimateBPM(track(120, 10), 44100).bpm, silencio: d.estimateBPM(new Float32Array(100000), 44100),
        nombres: d.names('Kick', 3), ventana: [d.windowRange(1000, 250, 10), d.windowRange(1000, 250, 990)],
        compases: [d.takeSamples(2, 4, 120, 48000), d.takeSamples(0, 4, 120, 48000)], zip: [zip.length, zip[0].name, zip[0].data.length],
        crc: z.crc32(new TextEncoder().encode('123456789')),
      };
    });
    expect(r.wav).toEqual([54, 46875, true]);
    expect(r.res).toBe(46875);
    expect(r.baja).toBeGreaterThan(0.9);          // una toma baja no queda vacía
    expect(r.clic).toBe(48000);                    // nunca menos de 0,1 s
    expect(r.norm).toBeGreaterThan(0.5);           // normaliza por defecto
    expect(Math.abs(r.bpm100 - 100)).toBeLessThan(3); expect(Math.abs(r.bpm120 - 120)).toBeLessThan(3); expect(r.silencio).toBeNull();
    expect(r.nombres).toEqual(['Kick 01', 'Kick 02', 'Kick 03']);
    expect(r.ventana).toEqual([[0, 250], [750, 1000]]);
    expect(r.compases).toEqual([192000, null]);
    expect(r.zip).toEqual([1, 'a/ñ.wav', 3]); expect(r.crc).toBe(0xCBF43926);
  });
});

test.describe('chop con selección múltiple', () => {
  // Cuatro golpes separados por silencio: con 4 cortes iguales, cada golpe cae en su corte.
  const sembrarGolpes = (page, nombre = 'Percusión') => page.evaluate(async n => {
    const st = await import('/sounds/store.js'), rate = 48000, a = new Float32Array(rate * 4);
    for (let g = 0; g < 4; g++) for (let j = 0; j < 6000; j++) a[g * rate + 2000 + j] = 0.8 * Math.sin(2 * Math.PI * 200 * j / rate) * (1 - j / 6000);
    await st.putSample(st.newSample(n, a, rate), a);
  }, nombre);
  const abrirChop = async (page, nombreBoton) => {
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Percusión' }).click();
    await page.getByRole('button', { name: nombreBoton, exact: true }).click();
    return page.locator('dialog.sheet');
  };

  test('cálculo de cortes en el navegador', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async () => {
      const d = await import('/sounds/dsp.js'), rate = 44100, x = new Float32Array(rate), s = [4410, 17640, 30870];
      for (const i of s) for (let j = 0; j < 2000; j++) x[i + j] = .8 * Math.sin(2 * Math.PI * 220 * j / rate) * (1 - j / 2000);
      const f = d.transients(x, .5, rate / 10), y = new Float32Array(8000).fill(.1), sl = d.slices(d.evenSlices(y, 8), y.length);
      return { golpes: f.map((v, i) => Math.abs(v - s[i]) < 1500), n: f.length, cortes: sl.length, fin: sl[7][1],
        rejilla: d.snapToGrid([0, 1020, 2450, 2500], 1000), nombres: [d.pieceName(0, 'toma'), d.pieceName(2, 'toma')],
        resalte: d.highlightRanges([[0, 100], [100, 250], [250, 400], [400, 1000]], 1000, new Set([3, 0])),
        seg: d.previewSegments([[0, 100], [100, 250], [250, 400]], new Set([2, 0]), 1000, 0.1),
        pre: (() => { const a = d.previewAudio(new Float32Array(400).fill(0.5), [[0, 100], [100, 250], [250, 400]], new Set([2, 0]), 1000, 0.1); return [a.length, a[150], a[50], a[275], a[0], a[349]]; })(),
        vacio: [d.previewAudio(new Float32Array(400), [[0, 100]], new Set(), 1000).length, d.previewSegments([[0, 100]], new Set([9]), 1000).length] };
    });
    expect(r.n).toBe(3); expect(r.golpes).toEqual([true, true, true]);
    expect(r.cortes).toBe(8); expect(r.fin).toBe(8000);
    expect(r.rejilla).toEqual([0, 1000, 2000, 3000]);
    expect(r.nombres).toEqual(['corte01_toma', 'corte03_toma']);
    expect(r.resalte).toEqual([[0, 0.1], [0.4, 1]]);
    expect(r.seg).toEqual([{ i: 0, start: 0, end: 100 }, { i: 2, start: 200, end: 350 }]);   // en su orden original, con un hueco entre ellos
    expect(r.pre).toEqual([350, 0, 0.5, 0.5, 0, 0]);                                         // sin hueco al final; el hueco es silencio; fundido en los extremos
    expect(r.vacio).toEqual([0, 0]);
  });

  test('se pueden elegir el 1 y el 3: se guardan y exportan sólo ésos, con su número original', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'rolando'); await sembrarGolpes(page); await page.reload();
    const hoja = await abrirChop(page, 'Chop en pads');
    await hoja.getByRole('button', { name: '4', exact: true }).click();
    await expect(hoja).toContainText('4 cortes · 0 seleccionados');
    await expect(hoja.getByRole('button', { name: 'Elige al menos un corte' })).toBeDisabled();
    await hoja.getByRole('button', { name: 'Pad 1', exact: true }).click();
    await hoja.getByRole('button', { name: 'Pad 3', exact: true }).click();
    await expect(hoja).toContainText('4 cortes · 2 seleccionados');
    await expect(hoja.getByRole('button', { name: 'Pad 2', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(hoja.getByRole('button', { name: 'Pad 1, seleccionado', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await hoja.getByRole('button', { name: 'Pad 3, seleccionado' }).click();                       // otra vez: se desmarca
    await expect(hoja).toContainText('1 seleccionado');
    await hoja.getByRole('button', { name: 'Pad 3', exact: true }).click();                        // y se vuelve a marcar

    // Escuchar la selección: uno tras otro, en orden; el pad que suena se ilumina
    const escuchar = hoja.getByRole('button', { name: /^Escuchar selección · \d,\d s$/ });
    await expect(escuchar).toBeEnabled();
    await escuchar.click();
    await expect(hoja.getByRole('button', { name: 'Parar la escucha de la selección', exact: true })).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Pad 1, seleccionado' })).toHaveClass(/playing/, { timeout: 3000 });
    await expect(hoja.getByRole('button', { name: 'Pad 3, seleccionado' })).toHaveClass(/playing/, { timeout: 4000 });   // después, el 3 (se salta el 2)
    await expect(hoja.locator('.pad.playing')).toHaveCount(1);
    await expect(hoja.getByRole('button', { name: /^Escuchar selección/ })).toBeVisible({ timeout: 6000 });             // termina solo y vuelve el botón
    await expect(hoja.locator('.pad.playing')).toHaveCount(0);
    await escuchar.click(); await hoja.getByRole('button', { name: 'Parar la escucha de la selección', exact: true }).click();                    // se puede parar a mitad
    await expect(escuchar).toBeVisible(); await expect(hoja.locator('.pad.playing')).toHaveCount(0);

    const { buf, nombre } = await descargar(page, () => hoja.getByRole('button', { name: 'Exportar 2 para el K.O. II' }).click());
    expect(nombre).toBe('denavilab-cortes.zip');
    const texto = buf.toString('latin1');
    expect(texto).toContain('corte01_Percusion.wav'); expect(texto).toContain('corte03_Percusion.wav'); expect(texto).not.toContain('corte02_'); expect(texto).not.toContain('corte04_');

    await hoja.getByRole('button', { name: 'Guardar 2 en la Biblioteca' }).click();
    await expect(page.locator('#toast')).toContainText('2 cortes guardados en la Biblioteca');
    // Guardar unidos: el 1 y el 3 en un solo sonido, en su orden original
    await hoja.getByRole('button', { name: 'Guardar unidos en un solo sonido' }).click();
    await expect(page.locator('#toast')).toContainText('2 cortes unidos en un sonido nuevo');
    const unido = await page.evaluate(async () => {
      const st = await import('/sounds/store.js'), m = (await st.listSamples()).find(x => x.name === 'Percusión · 1+3'), a = m && await st.getAudio(m.id);
      return m ? { dur: a.length / m.rate, ini: Math.abs(a[0]), fin: Math.abs(a[a.length - 1]) } : null;
    });
    expect(unido).not.toBeNull(); expect(unido.dur).toBeGreaterThan(1.9); expect(unido.dur).toBeLessThanOrEqual(2.001);
    expect(unido.ini).toBeLessThan(1e-3); expect(unido.fin).toBeLessThan(1e-3);
    await hoja.getByRole('button', { name: 'Pad 3, seleccionado' }).click();                       // con un solo corte no hay nada que unir
    await expect(hoja.getByRole('button', { name: 'Guardar unidos en un solo sonido' })).toBeDisabled();
    await hoja.getByRole('button', { name: 'Cerrar' }).click();
    await tab(page, 'biblioteca');                                   // la Biblioteca recuerda que seguías dentro de la carpeta
    const carpeta = page.locator('.folder', { hasText: 'Sin clasificar' }); if (await carpeta.count()) await carpeta.click();
    await expect(page.locator('.row-btn', { hasText: 'Percusión · corte 1' })).toBeVisible();
    await expect(page.locator('.row-btn', { hasText: 'Percusión · corte 3' })).toBeVisible();
    await expect(page.locator('.row-btn', { hasText: 'Percusión · corte 2' })).toHaveCount(0);
    expect(errores).toEqual([]);
  });

  test('Todos y Ninguno; cambiar el número de cortes borra la selección', async ({ page }) => {
    await abrir(page, 'rolando'); await sembrarGolpes(page); await page.reload();
    const hoja = await abrirChop(page, 'Chop en pads');
    await hoja.getByRole('button', { name: 'Todos', exact: true }).click();
    await expect(hoja).toContainText('8 cortes · 8 seleccionados');
    await expect(hoja.getByRole('button', { name: 'Todos', exact: true })).toBeDisabled();
    await hoja.getByRole('button', { name: 'Ninguno', exact: true }).click();
    await expect(hoja).toContainText('8 cortes · 0 seleccionados');
    await expect(hoja.getByRole('button', { name: 'Escuchar selección', exact: true })).toBeDisabled();   // sin selección no hay nada que escuchar
    await hoja.getByRole('button', { name: 'Pad 5', exact: true }).click();
    await hoja.getByRole('button', { name: '12', exact: true }).click();
    await expect(hoja).toContainText('12 cortes · 0 seleccionados');
  });

  test('sin K.O. II (Schair): se llama «cortes» y no menciona pads ni el aparato', async ({ page }) => {
    await abrir(page, 'schair'); await sembrarGolpes(page); await page.reload();
    const hoja = await abrirChop(page, 'Chop');
    await expect(hoja.getByRole('heading', { name: 'Chop', exact: true })).toBeVisible();
    await hoja.getByRole('button', { name: 'Corte 1', exact: true }).click(); await hoja.getByRole('button', { name: 'Corte 3', exact: true }).click();
    await expect(hoja.getByRole('button', { name: 'Exportar 2', exact: true })).toBeVisible();
    await expect(hoja).not.toContainText(/K\.O\.|pads?\b|libres/i);
  });
});

test.describe('puerta de acceso', () => {
  test('sin sesión pide entrar; como invitado se entra a Inicio', async ({ page }) => {
    const errores = vigilar(page);
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'DenaviLab: Sounds' })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
    await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    await expect(page.locator('#puerta')).toBeVisible();
    await page.locator('#entrarInvitado').click();
    await expect(page.locator('#tabs')).toBeVisible();
    expect(errores).toEqual([]);
  });
  test('con la clave equivocada no entra', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    await page.locator('#usuario').fill('schair'); await page.locator('#clave').fill('mal');
    await page.locator('#formPuerta button[type=submit]').click();
    await expect(page.locator('#errorPuerta')).toContainText('no calzan');
  });
});

test.describe('de la grabación a la exportación (Rolando)', () => {
  test('graba, guarda, edita y exporta a 46 875 Hz', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'rolando');
    await expect(page.getByRole('heading', { name: 'DenaviLab: Sounds' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Rolando Chaparro Gehren');

    await tab(page, 'grabar');
    await expect(page.locator('#screen')).toContainText('Búfer: últimos', { timeout: 10000 });
    const rec = page.getByRole('button', { name: 'Grabar', exact: true });
    await rec.click();
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: 'Parar grabación' }).click();

    const hoja = page.locator('dialog.sheet');
    await expect(hoja.getByRole('heading', { name: 'Guardar grabación' })).toBeVisible();
    await hoja.getByLabel('Nombre', { exact: true }).fill('Exterior');
    await hoja.getByRole('button', { name: 'Voz', exact: true }).click();
    await hoja.getByRole('button', { name: 'Habla', exact: true }).click();
    await hoja.getByRole('button', { name: /Guardar en Voz › Habla/ }).click();
    await expect(page.locator('#toast')).toContainText('Guardada en Voz › Habla');

    await tab(page, 'biblioteca');
    await expect(page.locator('.folder', { hasText: 'Voz' })).toContainText('1');
    await page.locator('.folder', { hasText: 'Voz' }).click();
    await page.locator('.row-btn', { hasText: 'Exterior' }).click();
    await expect(page.getByRole('heading', { name: 'Escuchar y editar' })).toBeVisible();
    await expect(page.locator('#screen')).toContainText(/pico -?\d+ dB/);
    await expect(page.locator('#screen')).not.toContainText('Nivel muy bajo');     // se normaliza al guardar
    await page.getByRole('button', { name: 'Normalizar' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');

    await tab(page, 'exportar');
    await expect(page.getByRole('heading', { name: 'Formato K.O. II' })).toBeVisible();
    await page.getByLabel('Slot de destino').fill('612'); await page.getByLabel('Slot de destino').press('Tab');
    await expect(page.getByLabel('Slot de destino')).toHaveValue('612');
    const { buf, nombre } = await descargar(page, () => page.getByRole('button', { name: 'Guardar con este formato' }).click());
    const w = wavInfo(buf);
    expect(nombre).toBe('612_Exterior.wav');
    expect(w).toMatchObject({ riff: 'RIFF', canales: 1, rate: 46875, bits: 16 });
    expect(w.datos).toBeGreaterThan(46875 * 2);                                        // más de 1 s de audio
    let max = 0; for (let i = 44; i + 1 < buf.length; i += 2) max = Math.max(max, Math.abs(buf.readInt16LE(i)));
    expect(max).toBeGreaterThan(20000);                                                // suena: no está vacío
    expect(errores).toEqual([]);
  });

  test('con compás: cuenta de entrada y la toma se corta sola en el compás exacto', async ({ page }) => {
    await abrir(page, 'rolando', { 'denavilab.sounds.metro': JSON.stringify({ mode: 'bar', bpm: 240, beats: 2, bars: 1, countIn: true, flash: false }) });
    await tab(page, 'grabar');
    await expect(page.locator('#screen')).toContainText('Búfer: últimos', { timeout: 10000 });
    await expect(page.locator('#screen')).toContainText('Con compás · 240 BPM');
    await page.getByRole('button', { name: 'Grabar', exact: true }).click();
    const hoja = page.locator('dialog.sheet');
    await expect(hoja.getByRole('heading', { name: 'Guardar grabación' })).toBeVisible({ timeout: 8000 });
    await expect(hoja).toContainText('00:00.50');       // 1 compás de 2 tiempos a 240 BPM = 0,5 s exactos
  });
});

test.describe('perfil sin K.O. II (Schair)', () => {
  test('no aparece nada del K.O. II ni de slots', async ({ page }) => {
    await abrir(page, 'schair');
    await sembrar(page, ['Pájaros del río']);
    for (const t of ['inicio', 'grabar', 'biblioteca']) { await tab(page, t); await expect(page.locator('#screen')).not.toContainText(/K\.O\.|slot|46 875/i); }
    await tab(page, 'exportar');
    await expect(page.getByRole('heading', { name: 'Exportar', exact: true })).toBeVisible();
    await expect(page.locator('#screen')).not.toContainText(/K\.O\.|slot|46 875|Memoria|128 MB/i);
    const { buf, nombre } = await descargar(page, () => page.getByRole('button', { name: 'Guardar WAV' }).click());
    expect(nombre).toBe('Pajaros_del_rio.wav');                                       // sin tildes ni prefijo de slot
    expect(wavInfo(buf)).toMatchObject({ canales: 1, rate: 48000, bits: 16 });        // frecuencia habitual
    await tab(page, 'inicio'); await page.getByRole('button', { name: 'Manual' }).click();
    await expect(page.locator('dialog.sheet')).toBeVisible();
    await expect(page.locator('dialog.sheet')).not.toContainText(/K\.O\./);
    await page.locator('dialog.sheet').getByRole('button', { name: '1', exact: true }).click();
    await expect(page.locator('dialog.sheet')).not.toContainText('Slot');
  });
  test('Rolando sí ve el K.O. II', async ({ page }) => {
    await abrir(page, 'rolando'); await tab(page, 'grabar');
    await expect(page.locator('#screen')).toContainText('→ K.O. II');
    await expect(page.locator('#screen')).toContainText('46 875 Hz');
  });
});

test.describe('biblioteca', () => {
  test('selección múltiple: cambiar nombre, mover y borrar', async ({ page }) => {
    await abrir(page, 'rolando');
    await sembrar(page, ['uno', 'dos', 'tres']);
    await tab(page, 'biblioteca');
    await page.getByRole('button', { name: 'Seleccionar' }).first().click();
    await expect(page.locator('.sel-row')).toHaveCount(3);
    await page.locator('.row-btn', { hasText: 'uno' }).click(); await page.locator('.row-btn', { hasText: 'dos' }).click();
    await expect(page.locator('.selbar')).toContainText('2 seleccionadas');
    await page.locator('.selbar').getByRole('button', { name: 'Cambiar nombre' }).click();
    await page.locator('dialog.sheet input').fill('Kick'); await page.locator('dialog.sheet').getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.row-btn', { hasText: 'Kick 01' })).toBeVisible(); await expect(page.locator('.row-btn', { hasText: 'Kick 02' })).toBeVisible();
    await expect(page.locator('.row-btn', { hasText: 'tres' })).toBeVisible();

    await page.getByRole('button', { name: 'Seleccionar' }).first().click();
    await page.locator('.row-btn', { hasText: 'Kick 01' }).click();
    await page.locator('.selbar').getByRole('button', { name: 'Mover' }).click();
    await page.locator('dialog.sheet').getByRole('button', { name: 'Voz', exact: true }).click();
    await page.locator('dialog.sheet').getByRole('button', { name: 'Mover aquí' }).click();
    await expect(page.locator('.row-btn', { hasText: 'Kick 01' })).toContainText('Voz');

    await page.getByRole('button', { name: 'Seleccionar' }).first().click();
    await page.getByRole('button', { name: 'Todas', exact: true }).click();
    await page.locator('.selbar').getByRole('button', { name: 'Borrar' }).click();
    await page.locator('dialog.sheet').getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(page.locator('#screen')).toContainText('Esta carpeta está vacía');
    await page.getByRole('button', { name: '‹ Biblioteca' }).click();
    await expect(page.locator('#screen')).toContainText('Aún no hay samples');
  });

  test('copia de seguridad y restauración', async ({ page }) => {
    await abrir(page, 'rolando'); await sembrar(page, ['uno', 'dos']);
    await tab(page, 'biblioteca');
    const { buf, nombre } = await descargar(page, () => page.getByRole('button', { name: 'Copia de seguridad' }).click());
    expect(nombre).toMatch(/^denavilab-sounds-copia-\d{4}-\d{2}-\d{2}\.zip$/);
    await page.evaluate(async () => { const st = await import('/sounds/store.js'); await st.deleteSamples((await st.listSamples()).map(s => s.id)); });
    await page.reload(); await tab(page, 'biblioteca');
    await expect(page.locator('#screen')).toContainText('Aún no hay samples');
    await page.setInputFiles('input[type=file]', { name: 'copia.zip', mimeType: 'application/zip', buffer: buf });
    await expect(page.locator('#toast')).toContainText('Restauradas 2 grabaciones');
  });
});

test.describe('aspecto', () => {
  test.use({ deviceScaleFactor: 2 });                        // como un iPhone: con densidad doble el lienzo roto se realimentaba
  test('el lienzo de la onda del editor mantiene su tamaño (no se agranda solo)', async ({ page }) => {
    await abrir(page, 'rolando'); await sembrar(page, ['uno']);
    await tab(page, 'editar'); await page.locator('.tab[data-tab="biblioteca"]').click();
    await page.locator('.row-btn').first().click();
    await expect(page.getByRole('heading', { name: 'Escuchar y editar' })).toBeVisible();
    await page.waitForTimeout(700);                                   // varios fotogramas
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.wave-edit'), c = wrap.querySelector('canvas'), rc = c.getBoundingClientRect(), rw = wrap.getBoundingClientRect();
      return { w: c.width, cw: rc.width, ch: rc.height, wrapW: rw.width, wrapH: rw.height, dpr: devicePixelRatio };
    });
    expect(m.cw, 'el lienzo debe caber dentro de su tarjeta').toBeLessThanOrEqual(m.wrapW);
    expect(m.ch).toBeLessThanOrEqual(m.wrapH);
    expect(m.w).toBeLessThanOrEqual(Math.ceil(m.wrapW * m.dpr) + 2);   // y su resolución no puede crecer más que la tarjeta
    expect(m.cw).toBeGreaterThan(200);
  });

  test('en las hojas, los interruptores y deslizadores no heredan el estilo del cuadro de login', async ({ page }) => {
    await abrir(page, 'rolando'); await tab(page, 'grabar');
    await page.locator('.icon-btn[aria-label="Guardado rápido"]').click();
    const e = await page.evaluate(() => { const l = document.querySelector('dialog.sheet .toggle-row'), r = document.querySelector('dialog.sheet input[type=range]'); return { transform: getComputedStyle(l).textTransform, tam: getComputedStyle(l.querySelector('b')).fontSize, bg: getComputedStyle(r).backgroundColor, borde: getComputedStyle(r).borderTopWidth }; });
    expect(e.transform).toBe('none'); expect(parseFloat(e.tam)).toBeGreaterThanOrEqual(15);
    expect(e.borde).toBe('0px');                                       // el deslizador no lleva el borde de los campos de texto
  });
});

test.describe('móvil y PWA', () => {
  for (const [nombre, w, h] of [['iPhone SE', 320, 568], ['iPhone 14', 390, 844], ['Android grande', 412, 915], ['tableta', 820, 1180]]) {
    test(`sin desbordes ni objetivos pequeños en ${nombre}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 700, permissions: ['microphone'] });
      const page = await ctx.newPage(); await abrir(page, 'rolando'); await sembrar(page, ['uno']);
      for (const t of ['inicio', 'grabar', 'biblioteca', 'editar', 'exportar']) {
        await tab(page, t); await page.waitForTimeout(150);
        const o = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vp: innerWidth, screen: document.getElementById('screen').scrollWidth, cliente: document.getElementById('screen').clientWidth }));
        expect(o.ancho, `desborde horizontal en ${t}`).toBeLessThanOrEqual(o.vp); expect(o.screen, `desborde interno en ${t}`).toBeLessThanOrEqual(o.cliente);
      }
      for (const b of await page.locator('.tab').all()) { const bb = await b.boundingBox(); expect(bb.height).toBeGreaterThanOrEqual(44); expect(bb.width).toBeGreaterThanOrEqual(44); }
      await ctx.close();
    });
  }

  test('manifiesto, iconos y service worker', async ({ page, request }) => {
    await abrir(page);
    const m = await (await request.get('/sounds/manifest.json')).json();
    expect(m).toMatchObject({ name: 'DenaviLab: Sounds', display: 'standalone', start_url: './', scope: './' });
    for (const i of m.icons) expect((await request.get('/sounds/' + i.src)).status(), i.src).toBe(200);
    expect(m.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active && r.scope.endsWith('/sounds/'); });
    expect(sw).toBe(true);
    const caches = await page.evaluate(async () => (await caches.keys()));
    expect(caches.some(k => k.startsWith('sounds-'))).toBe(true);
  });
});

test.describe('armonizar y unir cortes', () => {
  test('armonizar quita el desvío y suaviza bordes; unir iguala el volumen y no deja saltos', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async () => {
      const d = await import('/sounds/dsp.js'), rate = 48000;
      const tono = (f, sec, amp, dc = 0) => new Float32Array(Math.round(sec * rate)).map((_, i) => amp * Math.sin(2 * Math.PI * f * i / rate) + dc);
      const golpe = amp => new Float32Array(rate / 4).map((_, i) => amp * Math.sin(i * 0.2) * Math.exp(-i / 4000));
      const suave = new Float32Array(rate / 4).map((_, i) => 0.3 * Math.sin(i * 0.05) * Math.min(1, i / 3000));
      const a = tono(300, 0.5, 0.5, 0.1), h = d.harmonize(a, rate), cola = new Float32Array(rate / 2).map((_, i) => 0.5 * Math.sin(i * 0.04) * Math.exp(-i / 3000));
      const j = d.joinPieces([golpe(0.8), golpe(0.2), suave], rate);
      let salto = 0, pico = 0; for (let i = 1; i < j.length; i++) { salto = Math.max(salto, Math.abs(j[i] - j[i - 1])); pico = Math.max(pico, Math.abs(j[i])); }
      const crudo = d.joinPieces([golpe(0.8), golpe(0.2)], rate, { match: false });
      const rmsAct = x => 20 * Math.log10(d.activeRMS(x, rate));
      const mitad = j.subarray(0, 12000), seg = j.subarray(12000 - 100, 24000);
      return { ini: Math.abs(h[0]), fin: Math.abs(h[h.length - 1]), dc: Math.abs(h.reduce((s, v) => s + v, 0) / h.length), fadeLargo: d.endFadeSamples(d.removeDC(a), rate) / rate * 1000,
        fadeCorto: d.endFadeSamples(cola, rate) / rate * 1000, largo: j.length, suma: 36000, pico, salto, igual: crudo.length === 24000,
        nivel: [rmsAct(golpe(0.8)), rmsAct(golpe(0.2))], vacio: d.joinPieces([], rate).length, una: d.joinPieces([golpe(0.5)], rate).length,
        ataque: Math.max(...j.subarray(12000, 12400).map(Math.abs)) };
    });
    expect(r.ini).toBeLessThan(1e-3); expect(r.fin).toBeLessThan(1e-3);
    expect(r.dc).toBeLessThan(1e-3);
    expect(r.fadeLargo).toBeGreaterThan(20);        // cortada en pleno sonido: salida larga
    expect(r.fadeCorto).toBeLessThan(5);            // ya acaba suave: casi no se toca
    expect(r.largo).toBeGreaterThan(r.suma - 1500); expect(r.largo).toBeLessThanOrEqual(r.suma);
    expect(r.pico).toBeLessThan(0.99);
    expect(r.salto).toBeLessThan(0.2);              // sin escalones entre muestras vecinas
    expect(r.igual).toBe(true);
    expect(r.nivel[0] - r.nivel[1]).toBeGreaterThan(10);   // las entradas difieren ~12 dB
    expect(r.vacio).toBe(0); expect(r.una).toBe(12000);
    expect(r.ataque).toBeGreaterThan(0.1);          // el golpe que entra conserva su ataque
  });

  test('Editar: «Armonizar bordes» deja el inicio y el final en cero y se puede deshacer', async ({ page }) => {
    await abrir(page, 'schair');
    await page.evaluate(async () => {
      const st = await import('/sounds/store.js'), rate = 48000, a = new Float32Array(rate).map((_, i) => 0.5 * Math.sin(i * 0.05) + 0.1);
      await st.putSample(st.newSample('Cortada', a, rate), a);
    });
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Cortada' }).click();
    await page.getByRole('button', { name: 'Armonizar bordes (sin clics)' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    const ext = () => page.evaluate(async () => {
      const st = await import('/sounds/store.js'), s = (await st.listSamples()).find(m => m.name === 'Cortada'), a = await st.getAudio(s.id);
      return [Math.abs(a[0]), Math.abs(a[a.length - 1])];
    });
    const [i, f] = await ext(); expect(i).toBeLessThan(1e-3); expect(f).toBeLessThan(1e-3);
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    const [i2] = await ext(); expect(i2).toBeGreaterThan(0.05);
  });
});

test.describe('limpieza de ruido', () => {
  // Un golpe de tono de 1 s a 2 s entre ruido bajo y constante.
  const rate0 = 48000;
  const sembrarRuidoso = page => page.evaluate(async () => {
    const st = await import('/sounds/store.js'), rate = 48000, a = new Float32Array(rate * 5);
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
    for (let i = 0; i < a.length; i++) { const t = i / rate; a[i] = 0.05 * rnd() + (t > 2 && t < 3 ? 0.4 * Math.sin(2 * Math.PI * 880 * t) : 0); }
    await st.putSample(st.newSample('Radio', a, rate), a);
  });
  const niveles = page => page.evaluate(async () => {
    const st = await import('/sounds/store.js'), s = (await st.listSamples()).find(m => m.name === 'Radio'), a = await st.getAudio(s.id), rate = s.rate;
    const rms = (x, y) => { let e = 0; for (let i = Math.round(x * rate); i < Math.round(y * rate); i++) e += a[i] ** 2; return 20 * Math.log10(Math.sqrt(e / Math.round((y - x) * rate))); };
    return { ruido: rms(3.5, 4.5), tono: rms(2.2, 2.8) };
  });
  const abrirRadio = async page => {
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Radio' }).click();
  };

  test('filtros y resta espectral: bajan el ruido y respetan el sonido', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async () => {
      const d = await import('/sounds/dsp.js'), rate = 48000, n = rate * 5;
      let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / rate; x[i] = 0.04 * rnd() + 0.03 * Math.sin(2 * Math.PI * 60 * t) + (t > 2 && t < 3 ? 0.4 * Math.sin(2 * Math.PI * 880 * t) : 0); }
      const rms = (a, p, q) => { let e = 0; const A = Math.round(p * rate), B = Math.round(q * rate); for (let i = A; i < B; i++) e += a[i] ** 2; return 20 * Math.log10(Math.sqrt(e / (B - A))); };
      const w = d.quietestWindow(x, rate), plano = new Float32Array(rate * 3).map((_, i) => 0.3 * Math.sin(i * 0.1));
      const sinRuido = d.denoise(plano, new Float32Array(rate)), base = { ...d.QUICK_DEFAULTS, normalize: false, fades: false };
      return { antes: rms(x, 3.5, 4.5), suave: rms(d.cleanNoise(x, rate, 'soft'), 3.5, 4.5), fuerte: rms(d.cleanNoise(x, rate, 'strong'), 3.5, 4.5),
        tonoFuerte: rms(d.cleanNoise(x, rate, 'strong'), 2.2, 2.8), tono: rms(x, 2.2, 2.8),
        espectral: rms(d.denoise(x, x.subarray(w[0], w[1])), 3.5, 4.5), ventana: w[0] / rate, sinVentana: d.quietestWindow(plano, rate),
        identidad: sinRuido.reduce((m, v, i) => Math.max(m, Math.abs(v - plano[i])), 0), largo: d.denoise(x, x.subarray(w[0], w[1])).length === n,
        apagado: d.cleanNoise(x, rate, 'off') === x, rapido: [d.quickProcess(x, rate, base).length, d.quickProcess(x, rate, { ...base, denoise: 'strong' }).length] };
    });
    expect(r.suave).toBeLessThan(r.antes - 6);                 // el filtro y la compuerta bajan el fondo
    expect(r.fuerte).toBeLessThan(r.suave);                    // Fuerte baja más que Suave
    expect(Math.abs(r.tonoFuerte - r.tono)).toBeLessThan(1);   // el sonido de verdad queda igual
    expect(r.espectral).toBeLessThan(r.antes - 8);
    expect(r.ventana).not.toBeNull(); expect(r.sinVentana).toBeNull();   // una señal pareja no tiene parte tranquila
    expect(r.identidad).toBeLessThan(1e-6); expect(r.largo).toBe(true);
    expect(r.apagado).toBe(true);
    expect(r.rapido[1]).toBeLessThan(r.rapido[0] * 0.5);        // con ruido fuera, el recorte de silencios sí encuentra silencio
    expect(r.rapido[1]).toBeGreaterThan(rate0 * 0.9);   // y no se come el sonido
  });

  test('en Editar: «Quitar ruido de fondo» baja el fondo y se puede deshacer', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair'); await sembrarRuidoso(page); await page.reload();
    await abrirRadio(page);
    await expect(page.getByText('Limpiar ruido', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quitar ruido de fondo' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    const n = await niveles(page);
    expect(n.ruido).toBeLessThan(-45); expect(n.tono).toBeGreaterThan(-12);
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await niveles(page)).ruido).toBeGreaterThan(-40);
    expect(errores).toEqual([]);
  });

  test('«Con la selección» pide una parte de ruido y «Suave/Fuerte» limpian la toma', async ({ page }) => {
    await abrir(page, 'schair'); await sembrarRuidoso(page); await page.reload();
    await abrirRadio(page);
    await page.getByRole('button', { name: 'Fuerte', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    expect((await niveles(page)).ruido).toBeLessThan(-55);
    // sin marcar nada, la selección es toda la toma y no es «sólo ruido», pero sí dura más de 0,1 s: se aplica sin romper
    await page.getByRole('button', { name: 'Con la selección' }).click();
    await expect(page.getByRole('heading', { name: 'Escuchar y editar' })).toBeVisible();
  });

  test('Reducir ruido al guardar: se elige en el guardado rápido y se recuerda', async ({ page }) => {
    await abrir(page, 'schair'); await tab(page, 'grabar');
    await page.getByRole('button', { name: 'Guardado rápido' }).click();
    const hoja = page.locator('dialog.sheet');
    await expect(hoja).toContainText('Reducir ruido al guardar');
    await hoja.getByRole('button', { name: 'Fuerte', exact: true }).click();
    await expect(hoja).toContainText('Fuerte');
    await hoja.getByRole('button', { name: 'Listo', exact: true }).last().click();
    await page.getByRole('button', { name: 'Guardado rápido' }).click();
    await expect(page.locator('dialog.sheet').getByRole('button', { name: 'Fuerte', exact: true })).toHaveClass(/\bsel\b/);
  });
});
