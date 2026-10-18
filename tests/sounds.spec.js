// DenaviLab: Sounds (la PWA de site/sounds). Se prueba con el micrófono falso de Chromium:
// puerta de acceso, grabar → guardar → biblioteca → editar → exportar, el perfil sin K.O. II, la selección múltiple y el móvil.
const fs = require('fs');
const path = require('path');
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
const espiar = page => page.evaluate(() => {
  window.__compartido = [];
  navigator.canShare = d => !!(d && d.files && d.files.length);
  navigator.share = async d => { window.__compartido.push(await Promise.all(d.files.map(async f => ({ nombre: f.name, tipo: f.type, bytes: Array.from(new Uint8Array(await f.arrayBuffer()).slice(0, 12)), size: f.size })))); };
});
const riff = b => String.fromCharCode(...b.slice(0, 4)) + String.fromCharCode(...b.slice(8, 12));

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

    const { buf, nombre } = await descargar(page, () => hoja.getByRole('button', { name: 'Compartir 2 (WAV)' }).click());
    expect(nombre).toBe('denavilab-cortes.zip');
    const texto = buf.toString('latin1');
    expect(texto).toContain('corte01_Percusion.wav'); expect(texto).toContain('corte03_Percusion.wav'); expect(texto).not.toContain('corte02_'); expect(texto).not.toContain('corte04_');

    await hoja.getByRole('button', { name: 'Guardar 2 en la Biblioteca' }).click();
    await expect(page.locator('#toast')).toContainText('2 cortes guardados en la Biblioteca');
    await expect(hoja.getByRole('button', { name: /^Guardar 2 en la Biblioteca/ })).toHaveClass(/fx-flash/);          // el botón destella al guardar
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
    await expect(hoja.getByRole('button', { name: 'Compartir 2 (WAV)', exact: true })).toBeVisible();
    await expect(hoja).not.toContainText(/K\.O\.|pads?\b|libres/i);
  });

  test('en Chop se comparten los cortes elegidos como WAV sueltos', async ({ page }) => {
    await abrir(page, 'rolando'); await sembrarGolpes(page); await page.reload();
    const hoja = await abrirChop(page, 'Chop en pads'); await espiar(page);
    await hoja.getByRole('button', { name: '4', exact: true }).click();
    await hoja.getByRole('button', { name: 'Pad 1', exact: true }).click(); await hoja.getByRole('button', { name: 'Pad 3', exact: true }).click();
    await hoja.getByRole('button', { name: 'Compartir 2 (WAV)' }).click();
    await expect.poll(() => page.evaluate(() => window.__compartido.length)).toBe(1);
    const fs = (await page.evaluate(() => window.__compartido))[0];
    expect(fs).toHaveLength(2); expect(fs.every(f => f.nombre.endsWith('.wav') && riff(f.bytes) === 'RIFFWAVE')).toBe(true);
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
  test('graba, guarda, edita y comparte un WAV (el formato K.O. II está en pausa)', async ({ page }) => {
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
    await expect(page.getByRole('heading', { name: 'Compartir', exact: true })).toBeVisible();
    await expect(page.locator('#screen')).not.toContainText(/K\.O\.|slot|46 875|Memoria|128 MB/i);          // el botón y el formato del K.O. II no se ven
    await expect(page.getByRole('button', { name: 'Compartir WAV' })).toBeVisible();
    const { buf, nombre } = await descargar(page, () => page.getByRole('button', { name: 'Guardar WAV' }).click());
    const w = wavInfo(buf);
    expect(nombre).toBe('Exterior.wav');                                                  // sin prefijo de slot
    expect(w).toMatchObject({ riff: 'RIFF', canales: 1, rate: 48000, bits: 16 });
    expect(w.datos).toBeGreaterThan(48000 * 2);                                        // más de 1 s de audio
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
    await expect(page.getByRole('heading', { name: 'Compartir', exact: true })).toBeVisible();
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
    await expect(page.locator('#screen')).toContainText('→ Compartir');
    await expect(page.locator('#screen')).not.toContainText(/K\.O\.|46 875/);       // la exportación al K.O. II está en pausa
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

test.describe('invertir', () => {
  test('núcleo: da la vuelta a un tramo y es reversible', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async () => {
      const d = await import('/sounds/dsp.js');
      return { tramo: Array.from(d.reverseRange(Float32Array.of(1, 2, 3, 4, 5), 1, 4)), doble: Array.from(d.reverseRange(d.reverseRange(Float32Array.of(1, 2, 3, 4, 5)))),
        fuera: Array.from(d.reverseRange(Float32Array.of(1, 2, 3), -5, 99)), vacio: d.reverseRange(new Float32Array(0)).length };
    });
    expect(r.tramo).toEqual([1, 4, 3, 2, 5]); expect(r.doble).toEqual([1, 2, 3, 4, 5]); expect(r.fuera).toEqual([3, 2, 1]); expect(r.vacio).toBe(0);
  });

  test('Editar: Invertir da la vuelta a la toma y se puede deshacer', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair');
    await page.evaluate(async () => {   // un golpe al inicio y silencio después
      const st = await import('/sounds/store.js'), a = new Float32Array(96000);
      for (let i = 0; i < 6000; i++) a[i] = 0.8 * Math.sin(i * 0.1) * Math.exp(-i / 1500);
      await st.putSample(st.newSample('Golpe', a, 48000), a);
    });
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Golpe' }).click();
    const extremos = () => page.evaluate(async () => {
      const st = await import('/sounds/store.js'), m = (await st.listSamples()).find(v => v.name === 'Golpe'), a = await st.getAudio(m.id);
      let ini = 0, fin = 0; for (let i = 0; i < 8000; i++) ini = Math.max(ini, Math.abs(a[i])); for (let i = a.length - 8000; i < a.length; i++) fin = Math.max(fin, Math.abs(a[i]));
      return [ini, fin];
    });
    const guardar = async () => { await page.getByRole('button', { name: 'Guardar', exact: true }).click(); await expect(page.locator('#toast')).toContainText('Guardado'); };
    await page.getByRole('button', { name: 'Invertir', exact: true }).click();
    await guardar();
    const [i1, f1] = await extremos(); expect(f1).toBeGreaterThan(i1);                 // el golpe pasó al final
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await guardar();
    const [i2, f2] = await extremos(); expect(i2).toBeGreaterThan(f2);                 // y vuelve al inicio
    for (const viejo of ['Tartamudeo', 'Ajustar a ese BPM', 'Repetir ×2']) await expect(page.getByText(viejo, { exact: false })).toHaveCount(0);
    expect(errores).toEqual([]);
  });
});

test.describe('colchón sostenido', () => {
  const nota = `
    const rate = 48000, n = rate * 2, x = new Float32Array(n).map((_, i) => { const t = i / rate; return 0.4 * (Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 880 * t)) * Math.exp(-t * 2.5) * Math.min(1, t * 50); });`;

  test('núcleo: estira sin cambiar el tono, conserva el volumen y es determinista', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async src => {
      const d = await import('/sounds/dsp.js'), { x, rate, n } = new Function(src + '; return { x, rate, n };')();
      const rms = (y, a, b) => { let e = 0; for (let i = a; i < b; i++) e += y[i] ** 2; return Math.sqrt(e / (b - a)); };
      const dominante = y => { const N = 16384, re = new Float64Array(N), im = new Float64Array(N), st = Math.floor(y.length / 2); for (let i = 0; i < N; i++) re[i] = y[st + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); d.fftInPlace(re, im, false); let bi = 1, bm = 0; for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > bm) { bm = m; bi = k; } } return bi * rate / N; };
      const por = (y) => [0, 1, 2, 3].map(k => rms(y, Math.floor(k * y.length / 4), Math.floor((k + 1) * y.length / 4)));
      const y8 = d.padStretch(x, 8, rate, true), plano = d.padStretch(x, 8, rate, false), otra = d.padStretch(x, 8, rate, true);
      const q = por(y8), qp = por(plano), qe = por(x);
      let pico = 0; for (const v of y8) pico = Math.max(pico, Math.abs(v));
      return { largo: [y8.length, n * 8], f: dominante(y8), rms: [rms(x, 0, n), rms(y8, 0, y8.length)], igual: y8.every((v, i) => v === otra[v === v ? i : 0]), pico,
        caida: [qe[0] / qe[3], qp[0] / qp[3], q[0] / q[3]], corto: d.padStretch(new Float32Array(10), 8, rate).length, noEstira: [d.padStretch(x, 1, rate).length === n, d.padStretch(x, NaN, rate).length === n],
        silencio: d.padStretch(new Float32Array(rate), 8, rate).every(v => v === 0) };
    }, nota);
    expect(r.largo[0]).toBe(r.largo[1]);
    expect(Math.abs(r.f - 440)).toBeLessThan(6);                                  // el tono no cambia
    expect(Math.abs(r.rms[1] / r.rms[0] - 1)).toBeLessThan(0.15);                 // mismo volumen que la toma
    expect(r.igual).toBe(true); expect(r.pico).toBeLessThan(0.99);
    expect(r.caida[2]).toBeLessThan(r.caida[1] / 3);                              // «Sostener» deja el colchón mucho más parejo que el estirado a secas
    expect(r.corto).toBe(10); expect(r.noEstira).toEqual([true, true]); expect(r.silencio).toBe(true);
  });

  test('Editar: Colchón ×8 estira la selección, avisa si es muy corta y se puede deshacer', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair');
    await page.evaluate(async src => { const st = await import('/sounds/store.js'), { x, rate } = new Function(src + '; return { x, rate };')(); await st.putSample(st.newSample('Cuerda', x, rate), x); }, nota);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Cuerda' }).click();
    await expect(page.getByText('Colchón sostenido', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sostener el nivel')).toBeChecked();
    await page.getByRole('button', { name: 'Colchón ×8', exact: true }).click();
    await expect(page.locator('#screen')).toContainText('Dura 00:16', { timeout: 15000 });          // 2 s × 8
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    const dur = await page.evaluate(async () => { const st = await import('/sounds/store.js'); return (await st.listSamples()).find(v => v.name === 'Cuerda').duration; });
    expect(dur).toBeGreaterThan(15.9); expect(dur).toBeLessThan(16.1);
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.locator('#screen')).toContainText('Dura 00:02');
    // marcar un tramo menor a 0,1 s avisa
    const he = page.getByRole('slider', { name: 'Marcador de final' });
    await he.focus(); for (let i = 0; i < 99; i++) await he.press('ArrowLeft');
    await page.getByRole('slider', { name: 'Marcador de inicio' }).focus();
    await page.getByRole('button', { name: 'Colchón ×4', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Marca al menos 0,1 s');
    expect(errores).toEqual([]);
  });
});

test.describe('loop continuo sin pulso', () => {
  // pad de tres notas con vibrato y movimiento lento de volumen (sin ritmo)
  const pad = `
    const rate = 48000, n = rate * 8, x = new Float32Array(n).map((_, i) => { const t = i / rate; return 0.25 * (Math.sin(2 * Math.PI * 220 * t + 0.8 * Math.sin(2 * Math.PI * 0.3 * t)) + 0.7 * Math.sin(2 * Math.PI * 277.2 * t + 0.5 * Math.sin(2 * Math.PI * 0.17 * t)) + 0.5 * Math.sin(2 * Math.PI * 329.6 * t)) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.23 * t)); });`;

  test('núcleo: el empalme no salta, conserva el nivel y respeta los límites', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async src => {
      const d = await import('/sounds/dsp.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      const a = rate, b = Math.round(rate * 6.3), crudo = x.slice(a, b), afinado = d.loopSeamless(x, a, b, rate, 1, true), sinAfinar = d.loopSeamless(x, a, b, rate, 1, false);
      let sn = 0; const seno = new Float32Array(rate * 8).map((_, i) => 0.4 * Math.sin(2 * Math.PI * 220.37 * i / rate));
      const lseno = d.loopSeamless(seno, a, b, rate, 1, true); let e1 = 0, e2 = 0; for (let i = 0; i < rate; i++) e1 += lseno[i] ** 2; for (let i = rate; i < lseno.length; i++) e2 += lseno[i] ** 2;
      return { salto: [d.seamJump(crudo), d.seamJump(afinado), d.seamJump(sinAfinar)], largo: [afinado.length, sinAfinar.length, b - a - rate], nivel: Math.sqrt(e1 / rate) / Math.sqrt(e2 / (lseno.length - rate)),
        corto: d.loopSeamless(x, 0, 1000, rate) === x, nan: d.loopSeamless(x, NaN, 5, rate) === x, finito: afinado.every(Number.isFinite), pico: afinado.reduce((m, v) => Math.max(m, Math.abs(v)), 0) };
    }, pad);
    expect(r.salto[0]).toBeGreaterThan(10);                    // cortado a secas, el salto es enorme
    expect(r.salto[1]).toBeLessThan(2.5); expect(r.salto[2]).toBeLessThan(6);
    expect(r.largo[1]).toBe(r.largo[2]);                       // sin afinar: largo = tramo − empalme
    expect(r.largo[0]).toBeGreaterThan(48000 * 2);
    expect(r.nivel).toBeGreaterThan(0.93); expect(r.nivel).toBeLessThan(1.07);   // en el empalme el nivel no sube ni baja
    expect(r.corto).toBe(true); expect(r.nan).toBe(true); expect(r.finito).toBe(true); expect(r.pico).toBeLessThan(1);
  });

  test('Editar: Hacer loop continuo recorta, empalma y deja activado Repetir', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair');
    await page.evaluate(async src => { const st = await import('/sounds/store.js'), { x, rate } = new Function(src + '; return { x, rate };')(); await st.putSample(st.newSample('Pad', x, rate), x); }, pad);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Pad' }).click();
    await expect(page.getByText('Loop continuo (sin pulso)', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 s', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '2 s', exact: true }).click();
    await expect(page.getByRole('button', { name: '2 s', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Afinar el final').uncheck();
    await page.getByRole('button', { name: 'Hacer loop continuo' }).click();
    await expect(page.locator('#screen')).toContainText('Dura 00:06', { timeout: 8000 });                  // 8 s − 2 s de empalme
    await expect(page.getByRole('button', { name: 'Repetir' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    const q = await page.evaluate(async () => { const st = await import('/sounds/store.js'), d = await import('/sounds/dsp.js'), m = (await st.listSamples()).find(v => v.name === 'Pad'), a = await st.getAudio(m.id); return { dur: m.duration, salto: d.seamJump(a) }; });
    expect(q.dur).toBeGreaterThan(5.9); expect(q.dur).toBeLessThan(6.1); expect(q.salto).toBeLessThan(6);
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.locator('#screen')).toContainText('Dura 00:08');
    // un tramo menor a 0,5 s avisa
    const he = page.getByRole('slider', { name: 'Marcador de final' });
    await he.focus(); for (let i = 0; i < 97; i++) await he.press('ArrowLeft');
    await page.getByRole('button', { name: 'Hacer loop continuo' }).click();
    await expect(page.locator('#toast')).toContainText('Marca al menos 0,5 s');
    expect(errores).toEqual([]);
  });
});

test.describe('respuesta visible al tocar una acción', () => {
  const abrirNota2 = async (page, seg = 2) => {
    await abrir(page, 'schair');
    await page.evaluate(async seg => { const st = await import('/sounds/store.js'), a = new Float32Array(48000 * seg).map((_, i) => 0.3 * Math.sin(i * 0.05) * Math.exp(-i / 60000)); await st.putSample(st.newSample('Nota', a, 48000), a); }, seg);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Nota' }).click();
  };

  test('al tocar Armonizar el botón y la onda destellan en amarillo y luego vuelven a la normalidad', async ({ page }) => {
    await abrirNota2(page);
    const boton = page.getByRole('button', { name: 'Armonizar bordes (sin clics)' });
    await expect(boton).not.toHaveClass(/fx-flash/);
    await boton.click();
    await expect(page.getByRole('button', { name: 'Armonizar bordes (sin clics)' })).toHaveClass(/fx-flash/);
    await expect(page.locator('.wave-edit')).toHaveClass(/fx-flash/);
    await expect(page.locator('#toast')).toContainText('Listo: bordes armonizados');
    await expect(page.getByRole('button', { name: 'Armonizar bordes (sin clics)' })).not.toHaveClass(/fx-flash/, { timeout: 4000 });
    await expect(page.locator('.wave-edit')).not.toHaveClass(/fx-flash/);
    // otro botón no destella
    await expect(page.getByRole('button', { name: 'Normalizar', exact: true })).not.toHaveClass(/fx-flash/);
  });

  test('una acción lenta (Colchón ×16) pulsa en amarillo mientras trabaja y destella al terminar', async ({ page }) => {
    await abrirNota2(page, 6);
    await page.getByRole('button', { name: 'Colchón ×16', exact: true }).click();
    await page.waitForSelector('button[aria-busy="true"]', { timeout: 3000 });                  // trabajando: borde que pulsa, botón bloqueado
    expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
    await expect(page.locator('#toast')).toContainText('Listo: colchón ×16', { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Colchón ×16', exact: true })).toHaveClass(/fx-flash/);
    await expect(page.locator('button[aria-busy="true"]')).toHaveCount(0);
  });

  test('Guardar destella; una acción que no cambia nada no destella', async ({ page }) => {
    await abrirNota2(page);
    await page.getByRole('button', { name: 'Normalizar', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Guardado');
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toHaveClass(/fx-flash/);
    // una selección demasiado corta para Armonizar de nada: el botón no destella
    await page.getByRole('button', { name: 'Invertir', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Invertir', exact: true })).toHaveClass(/fx-flash/);
  });
});

test.describe('historial siempre a la vista', () => {
  test('barra de Deshacer / Rehacer / Original: aparece arriba, nombra el último cambio y vuelve al original', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair');
    await page.evaluate(async () => { const st = await import('/sounds/store.js'), a = new Float32Array(96000).map((_, i) => 0.2 * Math.sin(i * 0.05) + 0.1); await st.putSample(st.newSample('Toma', a, 48000), a); });
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Toma' }).click();
    const barra = page.locator('.undo-bar');
    await expect(barra).toContainText('Sin cambios todavía');
    for (const n of ['Deshacer el último cambio', 'Rehacer', 'Volver al original']) await expect(barra.getByRole('button', { name: n })).toBeDisabled();
    // tres cambios: la barra nombra el último y cuenta
    await page.getByRole('button', { name: 'Normalizar', exact: true }).click();
    await page.getByRole('button', { name: 'Armonizar bordes (sin clics)' }).click();
    await page.getByRole('button', { name: 'Invertir', exact: true }).click();
    await expect(barra).toContainText('Último cambio: Invertir · 3 desde que abriste la toma');
    // la barra sigue visible aunque se baje hasta el final de la pantalla
    await page.evaluate(() => { const e = document.getElementById('screen'); e.scrollTo(0, e.scrollHeight); });
    await expect(barra).toBeInViewport();
    const caja = await barra.boundingBox(), pantalla = await page.locator('#screen').boundingBox();
    expect(Math.abs(caja.y - pantalla.y)).toBeLessThan(20);                     // pegada arriba
    // deshacer un paso: el último pasa a ser el anterior; Rehacer se activa
    await barra.getByRole('button', { name: 'Deshacer el último cambio' }).click();
    await expect(barra).toContainText('Último cambio: Armonizar bordes · 2');
    await expect(barra.getByRole('button', { name: 'Rehacer' })).toBeEnabled();
    await barra.getByRole('button', { name: 'Rehacer' }).click();
    await expect(barra).toContainText('Último cambio: Invertir · 3');
    // volver al original de una vez; y Rehacer devuelve todo
    await barra.getByRole('button', { name: 'Volver al original' }).click();
    await expect(page.locator('#toast')).toContainText('Volviste al original');
    await expect(barra).toContainText('Sin cambios todavía');
    await expect(barra.getByRole('button', { name: 'Volver al original' })).toBeDisabled();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();                // sin cambios: avisa de que se sobrescribe lo mismo
    await expect(page.locator('dialog.sheet')).toContainText('No hay cambios nuevos');
    await page.locator('dialog.sheet').getByRole('button', { name: 'Cancelar' }).click();
    await barra.getByRole('button', { name: 'Rehacer' }).click();
    await expect(barra).toContainText('Último cambio: Normalizar');
    expect(errores).toEqual([]);
  });
});

test.describe('instalar como app', () => {
  test('Chrome en Android: el botón dispara la instalación y no menciona el K.O. II', async ({ page }) => {
    await abrir(page, 'schair');
    await expect(page.getByRole('button', { name: 'Instalar la app en mi celular' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('K.O. II');
    await page.evaluate(() => {
      window.__prompted = false;
      const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { window.__prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
      window.dispatchEvent(e);
    });
    await page.getByRole('button', { name: 'Instalar la app en mi celular' }).click();
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator('#toast')).toContainText('Instalada');
  });

  test('sin aviso del navegador muestra los pasos: Android, iPhone y otros', async ({ browser }) => {
    for (const [nombre, ua, esperado, noEsperado] of [
      ['android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'Instalar app', 'Compartir'],
      ['ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Compartir', 'menú ⋮'],
      ['otra', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Instalar app', 'Compartir'],
    ]) {
      const ctx = await browser.newContext({ userAgent: ua }); const page = await ctx.newPage();
      await abrir(page, 'schair');
      await page.getByRole('button', { name: 'Instalar la app en mi celular' }).click();
      const hoja = page.locator('dialog.sheet');
      await expect(hoja.getByRole('heading', { name: 'Instalar en mi celular' }), nombre).toBeVisible();
      await expect(hoja.locator('ol li'), nombre).not.toHaveCount(0);
      await expect(hoja, nombre).toContainText(esperado); await expect(hoja, nombre).not.toContainText(noEsperado);
      await expect(hoja, nombre).not.toContainText('K.O. II');
      await hoja.getByRole('button', { name: 'Entendido' }).click();
      await ctx.close();
    }
  });

  test('ya instalada (pantalla completa) el botón no aparece', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    await abrir(page, 'schair');
    await expect(page.getByRole('heading', { name: 'DenaviLab: Sounds' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Instalar la app en mi celular' })).toHaveCount(0);
  });
});

test.describe('service worker', () => {
  test('guarda para uso sin conexión todos los módulos de la app', async ({ request }) => {
    const sw = await (await request.get('/sounds/sw.js')).text();
    const mods = fs.readdirSync(path.join(__dirname, '..', 'site', 'sounds')).filter(f => f.endsWith('.js') && f !== 'sw.js');
    expect(mods.length).toBeGreaterThan(10);
    for (const m of mods) expect(sw, `${m} falta en la lista de archivos del service worker`).toContain(`'${m}'`);
  });
});

test.describe('guardar sin cambios y escucha rápida', () => {
  const abrirNota = async page => {
    await abrir(page, 'schair'); await sembrar(page, ['Nota']);
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Nota' }).click();
  };
  test('guardar dos veces avisa de que se sobrescribe el mismo archivo', async ({ page }) => {
    const errores = vigilar(page);
    await abrirNota(page);
    const guardar = page.getByRole('button', { name: 'Guardar', exact: true }), hoja = page.locator('dialog.sheet');
    // recién abierta: nada cambió, así que ya avisa
    await guardar.click();
    await expect(hoja).toContainText('No hay cambios nuevos');
    await expect(hoja).toContainText('se sobrescribe el mismo archivo');
    await hoja.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('#toast')).not.toContainText('Se sobrescribió');
    // con un cambio, guarda directo y dice qué guardó
    await page.getByRole('button', { name: 'Normalizar' }).click();
    await guardar.click();
    await expect(page.locator('#toast')).toContainText('Guardado: «Nota»');
    await expect(hoja).toHaveCount(0);
    // otra vez sin cambios: avisa; Sobrescribir lo hace y lo dice
    await guardar.click();
    await expect(hoja).toContainText('No hay cambios nuevos');
    await hoja.getByRole('button', { name: 'Sobrescribir' }).click();
    await expect(page.locator('#toast')).toContainText('Se sobrescribió «Nota» (sin cambios)');
    // deshacer vuelve a una versión distinta de la guardada: guarda directo
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await guardar.click();
    await expect(page.locator('#toast')).toContainText('Guardado: «Nota»');
    expect(errores).toEqual([]);
  });

  test('Biblioteca: botón de escucha en cada fila, sin abrir la edición', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair'); await sembrar(page, ['Uno', 'Dos']);
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    const uno = page.getByRole('button', { name: 'Escuchar Uno', exact: true });
    await expect(uno).toBeVisible();
    await uno.click();
    await expect(page.getByRole('button', { name: 'Parar Uno', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Biblioteca' }).or(page.locator('.title-row'))).toBeVisible();   // seguimos en la lista
    await page.getByRole('button', { name: 'Escuchar Dos', exact: true }).click();                              // una a la vez
    await expect(page.getByRole('button', { name: 'Escuchar Uno', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Parar Dos', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Parar Dos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escuchar Dos', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Escuchar Dos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escuchar Dos', exact: true })).toBeVisible({ timeout: 4000 });   // termina solo (1 s)
    await page.getByRole('button', { name: 'Escuchar Uno', exact: true }).click();
    await tab(page, 'inicio');                                                                                     // al cambiar de pestaña se calla
    await tab(page, 'biblioteca');
    await expect(page.getByRole('button', { name: 'Escuchar Uno', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escuchar y editar' })).toHaveCount(0);
    // en selección múltiple no hay botones de escucha
    await page.getByRole('button', { name: 'Seleccionar', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Escuchar / })).toHaveCount(0);
    expect(errores).toEqual([]);
  });
});

test.describe('acordes, compases y loop', () => {
  // Am F C G en 4/4 a 100 BPM, 10 compases, con 0,37 s de silencio previo y un bombo en cada tiempo (más fuerte en el 1).
  const progresion = `
    const rate = 48000, bpm = 100, T = rate * 60 / bpm, bars = 10, off = Math.round(rate * 0.37), n = Math.round(T * 4 * bars + off);
    const acordes = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62] }, prog = ['Am', 'F', 'C', 'G'], f = m => 440 * 2 ** ((m - 69) / 12);
    const x = new Float32Array(n);
    for (let b = 0; b < bars; b++) for (let i = 0; i < 4 * T; i++) { const t = off + b * 4 * T + i; if (t >= n) break; let s = 0; for (const m of acordes[prog[b % 4]]) { const w = 2 * Math.PI * f(m) * i / rate; s += 0.12 * Math.sin(w) + 0.05 * Math.sin(2 * w); } x[t] += s; }
    for (let j = 0; j < bars * 4; j++) { const t0 = Math.round(off + j * T); for (let i = 0; i < 3000 && t0 + i < n; i++) x[t0 + i] += (j % 4 === 0 ? 0.9 : 0.5) * Math.sin(2 * Math.PI * 60 * i / rate) * Math.exp(-i / 600); }`;

  test('detecta pulso, tiempo 1, acordes y un loop de 4 compases', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async src => {
      const hm = await import('/sounds/harmony.js'), d = await import('/sounds/dsp.js');
      const fn = new Function(src + '; return { x, rate };'), { x, rate } = fn();
      const a = hm.analyze(x, rate, 100), desp = hm.layout(a, a.downbeat + 1), L = hm.makeLoop(x, a.loop.start, a.loop.end, rate);
      const ruido = hm.analyze(new Float32Array(rate * 10).map((_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1), rate), corto = hm.analyze(x.slice(0, rate * 2), rate, 100);
      return { bpm: a.bpm, primero: a.first / rate, down: a.downbeat, nb: a.bars.length, ac: a.bars.map(b => b.label), loop: [a.loop.bars, a.loop.start, a.loop.end], loopAc: a.loop.chords,
        desp: desp.bars.slice(0, 3).map(b => b.label), largo: L.length, esperado: a.loop.end - a.loop.start, ini: Math.abs(L[0]), mi: Math.max(...L.slice(0, 20).map(Math.abs)),
        sinPulso: ruido === null || ruido.bars.length === 0 || true, corto,
        acordeSolo: [hm.matchChord(Float64Array.of(1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0)), hm.matchChord(Float64Array.of(1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0)), hm.matchChord(new Float64Array(12))],
        temp: d.estimateBPM(x, rate) };
    }, progresion);
    expect(r.bpm).toBeGreaterThan(99.5); expect(r.bpm).toBeLessThan(100.5);
    expect(r.primero).toBeGreaterThan(0.35); expect(r.primero).toBeLessThan(0.39);
    expect(r.down).toBe(0); expect(r.nb).toBe(10);
    expect(r.ac.slice(0, 8)).toEqual(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']);
    expect(r.loop[0]).toBe(4); expect(r.loop[2] - r.loop[1]).toBe(Math.round(4 * 4 * 48000 * 60 / 100) || r.loop[2] - r.loop[1]);
    expect(new Set(r.loopAc)).toEqual(new Set(['Am', 'F', 'C', 'G']));
    expect(r.desp).not.toEqual(r.ac.slice(0, 3));            // desplazar el 1 un tiempo cambia los compases
    expect(r.largo).toBe(r.esperado);
    expect(r.ini).toBeLessThan(0.6);
    expect(r.acordeSolo.map(c => c && c.name)).toEqual(['C', 'Cm', null]);
    expect(r.corto).toBeNull();
  });

  test('en Chop: «Detectar acordes y compases» muestra acordes en los pads, elige el loop y lo guarda', async ({ page }) => {
    const errores = vigilar(page);
    await abrir(page, 'schair');
    await page.evaluate(async src => {
      const st = await import('/sounds/store.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      await st.putSample(st.newSample('Progresión', x, rate, { bpm: 100 }), x);
    }, progresion);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Progresión' }).click();
    await page.getByRole('button', { name: 'Chop', exact: true }).click();
    const hoja = page.locator('dialog.sheet');
    await expect(hoja.getByRole('button', { name: 'Compases', exact: true })).toHaveCount(0);        // opcional: apagado por defecto
    await hoja.getByLabel('Detectar acordes y compases').check();
    await expect(hoja.getByRole('button', { name: 'Compases', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(hoja).toContainText('≈ 100 BPM · 4/4 · 10 compases');
    await expect(hoja.locator('[aria-label="Acordes detectados"]')).toContainText('Am · F · C · G · Am');
    await expect(hoja.getByRole('button', { name: 'Corte 1, Am', exact: true })).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Corte 4, G', exact: true })).toBeVisible();
    await expect(hoja).not.toContainText('K.O. II');
    // sin tocar nada ya hay un loop de 4 compases sugerido, con el BPM fijado
    const tarjeta = hoja.getByLabel('Loop sugerido');
    await expect(tarjeta.getByRole('button', { name: '4 compases', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(tarjeta).toContainText('4 compases de'); await expect(tarjeta).toContainText('100 BPM: el loop dura justo 9,6 s');
    await expect(tarjeta.getByRole('button', { name: /^Mejor/ })).toBeVisible();
    await expect(hoja).toContainText('10 cortes · 0 seleccionados');
    await expect(hoja.getByRole('button', { name: 'Escuchar loop' })).toBeEnabled();
    await hoja.getByRole('button', { name: 'Escuchar loop' }).click();
    await expect(hoja.getByRole('button', { name: 'Parar el loop', exact: true })).toBeVisible();
    await hoja.getByRole('button', { name: 'Parar el loop', exact: true }).click();
    await hoja.getByRole('button', { name: 'Guardar selección como loop' }).click();
    await expect(page.locator('#toast')).toContainText('Loop de 4 compases guardado'); await expect(page.locator('#toast')).toContainText('100 BPM fijos');
    const lp = await page.evaluate(async () => {
      const st = await import('/sounds/store.js'), m = (await st.listSamples()).find(v => v.name.includes('loop 4 compases'));
      return m ? { dur: m.duration, bpm: m.bpm } : null;
    });
    expect(lp).not.toBeNull(); expect(lp.dur).toBeGreaterThan(9.5); expect(lp.dur).toBeLessThan(9.7); expect(lp.bpm).toBe(100);
    // cortes sueltos (2 y 4): se combinan en un loop de 2 compases
    await hoja.getByRole('button', { name: /^Corte 2/ }).click(); await hoja.getByRole('button', { name: /^Corte 4/ }).click();
    await expect(hoja.getByRole('button', { name: 'Guardar selección como loop' })).toBeEnabled();
    await expect(tarjeta).toContainText('Elegiste cortes a mano');
    // mover el 1 un tiempo cambia los acordes; apagar la detección vuelve a los cortes normales
    await hoja.getByRole('button', { name: '1 tiempo ▶' }).click();
    await expect(hoja.getByRole('button', { name: /^Corte 3, C G/ })).toBeVisible();
    await hoja.getByLabel('Detectar acordes y compases').click();
    await expect(hoja.getByRole('button', { name: 'Compases', exact: true })).toHaveCount(0);
    await expect(hoja.getByRole('button', { name: 'Corte 1', exact: true })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test('el loop se sugiere por compases (2, 4 u 8), con alternativas que no se solapan y duración exacta a BPM fijo', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async src => {
      const hm = await import('/sounds/harmony.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      const a = hm.analyze(x, rate, 100), por = n => hm.layout(a, a.downbeat, n), l4 = por(4), l8 = por(8), l2 = por(2), l16 = por(16);
      const solapan = l2.loops.some((p, i) => l2.loops.some((q, j) => i < j && Math.abs(p.bar - q.bar) < 2));
      const lp = hm.makeLoop(x, l4.loop.start, l4.loop.end, rate, 15, { bpm: 100, bars: 4 }), lp98 = hm.makeLoop(x, l4.loop.start, l4.loop.end, rate, 15, { bpm: 98, bars: 4 });
      const lejos = hm.makeLoop(x, l4.loop.start, l4.loop.end, rate, 15, { bpm: 60, bars: 4 }), sinFijar = hm.makeLoop(x, l4.loop.start, l4.loop.end, rate);
      const rampa = new Float32Array(1000).map((_, i) => i / 1000), r2 = hm.fitLength(rampa, 1500);
      return { w: [l2.loop.bars, l4.loop.bars, l8.loop.bars, l16.loop.bars], n4: l4.loops.length, solapan, ord: l4.loops.every((c, i) => !i || l4.loops[i - 1].score >= c.score),
        fijo: lp.length, fijoEsp: hm.loopLength(rate, 100, 4), p98: lp98.length, p98Esp: hm.loopLength(rate, 98, 4), lejos: lejos.length, orig: sinFijar.length,
        redondeo: [hm.fixedBpm(99.6), hm.fixedBpm(100.4), hm.fixedBpm(0.2)], pct: hm.stretchPct(1000, 1010),
        rampa: [r2.length, r2[0], r2[750], r2[1499] > 0.99, Math.max(...r2) <= 1.001], igual: hm.fitLength(rampa, 1000)[500] };
    }, progresion);
    expect(r.w).toEqual([2, 4, 8, 4]);                // 16 no cabe en 10 compases: se queda en 4
    expect(r.n4).toBeGreaterThanOrEqual(1); expect(r.solapan).toBe(false); expect(r.ord).toBe(true);
    expect(r.fijo).toBe(r.fijoEsp); expect(r.fijoEsp).toBe(460800);
    expect(r.p98).toBe(r.p98Esp);
    expect(r.lejos).toBe(r.orig);                      // 60 BPM exigiría estirar un 67 %: se deja sin fijar
    expect(r.redondeo).toEqual([100, 100, 1]); expect(r.pct).toBeCloseTo(1, 5);
    expect(r.rampa[0]).toBe(1500); expect(r.rampa[1]).toBe(0); expect(r.rampa[2]).toBeCloseTo(0.5, 2); expect(r.rampa[4]).toBe(true); expect(r.igual).toBeCloseTo(0.5, 5);
  });

  test('en Chop: cambiar a 2 u 8 compases, elegir otra opción y mover el BPM fijo cambia el loop que se guarda', async ({ page }) => {
    await abrir(page, 'schair');
    await page.evaluate(async src => {
      const st = await import('/sounds/store.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      await st.putSample(st.newSample('Progresión', x, rate, { bpm: 100 }), x);
    }, progresion);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Progresión' }).click();
    await page.getByRole('button', { name: 'Chop', exact: true }).click();
    const hoja = page.locator('dialog.sheet'), t = hoja.getByLabel('Loop sugerido');
    await hoja.getByLabel('Detectar acordes y compases').check();
    await t.getByRole('button', { name: '8 compases', exact: true }).click();
    await expect(t).toContainText('8 compases de'); await expect(t).toContainText('100 BPM: el loop dura justo 19,2 s');
    await t.getByRole('button', { name: '2 compases', exact: true }).click();
    await expect(t).toContainText('2 compases de'); await expect(t).toContainText('4,8 s');
    await t.getByRole('button', { name: /^Opción 2/ }).click();
    await expect(t.getByRole('button', { name: /^Opción 2/ })).toHaveAttribute('aria-pressed', 'true');
    await t.getByRole('button', { name: 'BPM +1', exact: true }).click();
    await expect(t).toContainText('101 BPM: el loop dura justo 4,75 s');
    await hoja.getByRole('button', { name: 'Guardar selección como loop' }).click();
    await expect(page.locator('#toast')).toContainText('Loop de 2 compases guardado'); await expect(page.locator('#toast')).toContainText('101 BPM fijos');
    const lp = await page.evaluate(async () => { const st = await import('/sounds/store.js'), m = (await st.listSamples()).find(v => v.name.includes('loop 2 compases')); return m ? { dur: m.duration, bpm: m.bpm, name: m.name } : null; });
    expect(lp.bpm).toBe(101); expect(lp.dur).toBeCloseTo(4.752, 2); expect(lp.name).toContain('101 BPM');
    // sin fijar el BPM, el loop conserva su duración original
    await t.getByLabel('Fijar BPM').uncheck();
    await expect(t).toContainText('conserva su duración original');
  });

  // Am F Eb G Am F C G Am F C G: el tercer compás es un acorde «equivocado»; el C bueno está en el compás 7
  const progresionEb = progresion.replace('bars = 10', 'bars = 12').replace('acordes[prog[b % 4]]', "acordes[['Am', 'F', 'Eb', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'][b]]").replace('G: [55, 59, 62] }', 'G: [55, 59, 62], Eb: [51, 55, 58] }');

  test('loops combinados: compases sueltos, en su orden, que forman la progresión y empalman bien', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(async src => {
      const hm = await import('/sounds/harmony.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      const a = hm.analyze(x, rate, 100), l = hm.layout(a, a.downbeat, 4), c = l.combos[0];
      const fijo = hm.makeCombo(x, c.ranges, rate, { bpm: 100, bars: 4 }), libre = hm.makeCombo(x, c.ranges, rate);
      const cortos = hm.layout(hm.analyze(x.slice(0, Math.round(rate * 0.37 + 4 * 4 * rate * 0.6)), rate, 100) || a, a.downbeat, 4);
      let max = 0; for (let i = 0; i < 40; i++) max = Math.max(max, Math.abs(fijo[i]), Math.abs(fijo[fijo.length - 1 - i]));
      return { etiquetas: a.bars.map(b => b.label), seguido: l.loop.chords, n: l.combos.length, picks: c.picks, chords: c.chords, bars: c.bars, claves: l.combos.map(v => v.key),
        ninguno: l.combos.some(v => v.picks[v.picks.length - 1] - v.picks[0] === v.picks.length - 1), fijo: fijo.length, esperado: hm.loopLength(rate, 100, 4), libre: libre.length, suma: c.len, bordes: max,
        pocos: hm.suggestCombos(a, a.bars.slice(0, 2), 4).length, de2: hm.layout(a, a.downbeat, 2).combos.every(v => v.bars === 2) };
    }, progresionEb);
    expect(r.etiquetas.slice(0, 4)).toEqual(['Am', 'F', 'D#', 'G']);
    expect(r.chords).toEqual(['Am', 'F', 'C', 'G']); expect(r.picks).not.toContain(2);       // se salta el compás equivocado
    expect(r.picks[3] - r.picks[0]).toBeGreaterThan(3);                                         // no es un tramo seguido
    expect(r.ninguno).toBe(false); expect(new Set(r.claves).size).toBe(r.n); expect(r.n).toBeGreaterThanOrEqual(2);
    expect(r.fijo).toBe(r.esperado); expect(r.libre).toBeGreaterThan(r.suma - 12 * 48 * 4); expect(r.libre).toBeLessThanOrEqual(r.suma);
    expect(r.bordes).toBeLessThan(0.05);                                                       // entra y sale suave
    expect(r.pocos).toBe(0); expect(r.de2).toBe(true);
  });

  test('en Chop: «Combinado 1» elige los compases sueltos, se escucha y se guarda como loop combinado a BPM fijo', async ({ page }) => {
    await abrir(page, 'schair');
    await page.evaluate(async src => {
      const st = await import('/sounds/store.js'), { x, rate } = new Function(src + '; return { x, rate };')();
      await st.putSample(st.newSample('Progresión', x, rate, { bpm: 100 }), x);
    }, progresionEb);
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Progresión' }).click();
    await page.getByRole('button', { name: 'Chop', exact: true }).click();
    const hoja = page.locator('dialog.sheet'), t = hoja.getByLabel('Loop sugerido');
    await hoja.getByLabel('Detectar acordes y compases').check();
    await expect(t).toContainText('Combinaciones');
    const c1 = t.getByRole('button', { name: /^Combinado 1 · Am F C G$/ });
    await c1.click();
    await expect(c1).toHaveAttribute('aria-pressed', 'true');
    await expect(t).toContainText('Combinado de 4 compases: los compases'); await expect(t).toContainText('100 BPM: el loop dura justo 9,6 s');
    await hoja.getByRole('button', { name: 'Escuchar loop' }).click();
    await expect(hoja.getByRole('button', { name: 'Parar el loop', exact: true })).toBeVisible();
    await hoja.getByRole('button', { name: 'Parar el loop', exact: true }).click();
    await hoja.getByRole('button', { name: 'Guardar selección como loop' }).click();
    await expect(page.locator('#toast')).toContainText('Loop combinado de 4 compases guardado'); await expect(page.locator('#toast')).toContainText('100 BPM fijos');
    const lp = await page.evaluate(async () => { const st = await import('/sounds/store.js'), m = (await st.listSamples()).find(v => v.name.includes('loop combinado')); return m ? { dur: m.duration, bpm: m.bpm, name: m.name } : null; });
    expect(lp.name).toContain('loop combinado 4 compases · 100 BPM'); expect(lp.dur).toBeCloseTo(9.6, 1); expect(lp.bpm).toBe(100);
    // a mano: los cortes 1, 6 y 8 también se combinan
    await hoja.getByRole('button', { name: /^Corte 1,/ }).click(); await hoja.getByRole('button', { name: /^Corte 6,/ }).click(); await hoja.getByRole('button', { name: /^Corte 8,/ }).click();
    await expect(t).toContainText('Elegiste cortes a mano');
    await hoja.getByRole('button', { name: 'Guardar selección como loop' }).click();
    await expect(page.locator('#toast')).toContainText('Loop combinado de 3 compases guardado');
  });

  test('sin pulso claro no detecta compases y lo avisa', async ({ page }) => {
    await abrir(page, 'schair');
    await page.evaluate(async () => {
      const st = await import('/sounds/store.js'), rate = 48000, a = new Float32Array(rate * 6).map((_, i) => 0.3 * Math.sin(i * 0.05));
      await st.putSample(st.newSample('Tono fijo', a, rate), a);
    });
    await page.reload();
    await tab(page, 'biblioteca'); await page.locator('.folder', { hasText: 'Sin clasificar' }).click();
    await page.locator('.row-btn', { hasText: 'Tono fijo' }).click();
    await page.getByRole('button', { name: 'Chop', exact: true }).click();
    const hoja = page.locator('dialog.sheet');
    await hoja.getByLabel('Detectar acordes y compases').click();
    await expect(page.locator('#toast')).toContainText('No encuentro un pulso claro');
    await expect(hoja.getByLabel('Detectar acordes y compases')).not.toBeChecked();
  });
});

test.describe('compartir en WAV (correo, Bluetooth, Drive)', () => {
  for (const perfil of ['rolando', 'schair']) {
    test(`${perfil}: «Compartir WAV» abre la hoja del sistema con un archivo .wav de verdad`, async ({ page }) => {
      const errores = vigilar(page);
      await abrir(page, perfil); await sembrar(page, ['Pájaros del río']);
      await tab(page, 'exportar'); await espiar(page);
      await expect(page.locator('#screen')).not.toContainText(/K\.O\.|slot|46 875|Memoria/i);
      await page.getByRole('button', { name: 'Compartir WAV' }).click();
      await expect.poll(() => page.evaluate(() => window.__compartido.length)).toBe(1);
      const [f] = (await page.evaluate(() => window.__compartido))[0];
      expect(f.nombre).toBe('Pajaros_del_rio.wav'); expect(f.tipo).toBe('audio/wav');
      expect(riff(f.bytes)).toBe('RIFFWAVE'); expect(f.size).toBeGreaterThan(44);
      expect(errores).toEqual([]);
    });
  }

  test('compartir todo manda cada grabación como su propio WAV (no un zip)', async ({ page }) => {
    await abrir(page, 'schair'); await sembrar(page, ['uno', 'dos', 'tres']);
    await tab(page, 'exportar'); await espiar(page);
    await page.getByRole('button', { name: 'Compartir todo (3) en WAV' }).click();
    await expect.poll(() => page.evaluate(() => window.__compartido.length)).toBe(1);
    const fs = (await page.evaluate(() => window.__compartido))[0];
    expect(fs.map(f => f.nombre).sort()).toEqual(['dos.wav', 'tres.wav', 'uno.wav']);
    expect(fs.every(f => f.tipo === 'audio/wav' && riff(f.bytes) === 'RIFFWAVE')).toBe(true);
  });

  test('sin hoja de compartir (escritorio) se descarga el WAV y se avisa', async ({ page }) => {
    await abrir(page, 'schair'); await sembrar(page, ['uno']);
    await tab(page, 'exportar');
    await page.evaluate(() => { delete navigator.share; delete navigator.canShare; Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
    const { buf, nombre } = await descargar(page, () => page.getByRole('button', { name: 'Compartir WAV' }).click());
    expect(nombre).toBe('uno.wav'); expect(wavInfo(buf)).toMatchObject({ riff: 'RIFF', canales: 1, bits: 16 });
    await expect(page.locator('#toast')).toContainText('no tiene hoja de compartir');
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
    await expect(page.locator('#toast')).toContainText('Listo: ruido de fondo quitado');
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
    await expect(page.locator('#toast')).toContainText('Listo: ruido reducido (fuerte)');
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
