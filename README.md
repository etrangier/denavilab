# DenaviLAB

Taller de maquetas de la banda Denavi, en el navegador: batería, secuenciador de bajo, acordes (pad / piano), piano lead, guitarra y letra, con un mapa de la canción por partes. Todo sale en MIDI para terminarlo en Logic.
Sitio: https://denavilab.neocities.org

## Qué hay en `site/`
- `index.html` — la portada: quiénes son Denavi, las dos puertas (trabajo guiado y directo) y la entrada como invitado. Acceso libre.
- `guia.html` — el trabajo guiado. Pide sesión. «Primera vez» (siete pasos, para cualquiera) o la ruta de cada uno —la de Schair, sin teclado; la de Rolando, con MPK—, con «Siguiente paso», pestañas Pasos · Lecciones y ejemplos que suenan ahí mismo. Se elige con `data-para` en el marcado y `data-quien` en `<html>`.
- `app.html` — el taller entero, en un único archivo autónomo. Pide sesión. Pestañas: Batería (`beat`), Secuenciador de bajo (`bajod`), Pad (`pad`), Piano (`piano`), Piano lead (`lead`), Guitarra (`guitarra`), Letra con el Mapa de la canción (`letra`) y Mezcla (`mezcla`).
- `archivo.html` — «Guardado»: lo guardado en ese navegador (maquetas, patrones, MIDI importados) y lo publicado en `site/archivo/`.
- `archivo/` — archivos publicados (`.mid`, `.pdf`) y su `manifest.json`; ver `site/archivo/LEEME.md`.
- `estadisticas.html` — sólo Rolando: uso del sitio.
- `changelog.json` — novedades y bugs; lo leen la portada y el panel de administración del taller.
- `sounds/` — **DenaviLab: Sounds**, la app de captura de sonidos para sampling como PWA (se instala desde el navegador, en Android, iPhone o computador). Ver la sección de abajo.
- `estilo.css`, `acceso.js` — compartidos por la portada, la guía, Guardado y estadísticas. `app.html` no los usa: lleva todo dentro.

La guía enlaza al taller con `?modo=…` (y `&guia=…&paso=N` para la barra de la guía). Sin parámetro válido, arranca en `beat`.

## Guardar
- **Autoguardado:** lo que está abierto se guarda solo en el navegador (`denavilab.autoguardado`) y se recupera al volver.
- **Guardar con nombre:** panel «Guardar» del taller; queda en `rueda.maquetas` y se ve en Guardado.
- **`.denavi`:** «⤓ Descargar la maqueta (.denavi)» y «Abrir un archivo .denavi». Es JSON con el proyecto entero (acordes de Pad y Piano, batería, bajo, melodía, guitarra, letra, mapa de la canción, tempo, tonalidad y banda). Lleva `formato` para versionarlo; uno más nuevo se rechaza. Al abrir, primero se aplican género y banda (`applyBand()` vacía la progresión y fija el tempo de la banda) y después lo guardado.

Lo del navegador no viaja solo a otro computador: para pasarse trabajo, se manda el `.denavi`.

## Pruebas
```
npm install
npx playwright install chromium
npm test
```
Sirven `site/` en el puerto 4173 y prueban en Chromium (`tests/taller.spec.js`): que las páginas carguen sin errores, las pistas del MIDI, guardar y abrir un `.denavi`, que el Secuenciador suene junto con la batería, la ruta de la guía y el taller en celular.

## Cómo se publica
1. Edita lo que toque en `site/`.
2. Commit y push a `main`.
3. `.github/workflows/publicar.yml` corre las pruebas. Si pasan, sube `site/` a Neocities (secreto `NEOCITIES_API_TOKEN`) y deja en GitHub Pages sólo una redirección a Neocities (`tools/pages-redirect/`), que antes ofrece descargar las maquetas guardadas en esa dirección.

En un pull request sólo corren las pruebas; publicar, sólo desde `main`.
- Neocities va con `cleanup: false`: un archivo borrado de `site/` sigue vivo allá y hay que quitarlo a mano.
- **Caché:** las páginas piden `estilo.css?v=…` y `acceso.js?v=…`. Si cambias alguno, sube la versión en `index.html`, `guia.html`, `archivo.html` y `estadisticas.html`.

## Abrir en local
Sirve la carpeta por http —`python3 -m http.server 8000 --directory site`— y abre `http://127.0.0.1:8000` en Chrome, Opera o Edge. También vale doble clic en `site/app.html` (por `file://` no pide sesión). Safari no tiene Web MIDI.

## La puerta del taller

La portada (`index.html`) es de acceso libre. Los enlaces al taller piden nombre y clave;
la sesión queda en `localStorage` bajo `denavilab.sesion` y `app.html` redirige a la portada
si no la encuentra. Entrar por `file://` (el archivo descargado) no pide nada, para que el
MIDI siga funcionando sin conexión.

**Esto es una cortina, no una cerradura.** Neocities sirve archivos estáticos: no hay
servidor que valide nada, así que la comprobación ocurre en el navegador del visitante.
Quien sepa mirar puede saltársela —desactivando JavaScript, escribiendo la marca en
`localStorage` a mano, o leyendo `app.html` directamente desde la URL—. Sirve para que el
sitio no se use por accidente; no para guardar nada que importe.

Las claves están como hash SHA-256 de `denavilab:<usuario>:<clave>`, así que no se leen
a simple vista en el código, pero un hash de una clave corta se rompe sin esfuerzo.
Por eso este repositorio **no debería ser público**.

Si en algún momento hace falta control de acceso de verdad, hay que mover el sitio a algo
con servidor delante (Cloudflare Access, Netlify con contraseña, un hosting con
autenticación básica). Neocities por sí solo no puede darlo.


## App iOS (beta)

En [`ios/`](ios/README.md): Grabadora, app nativa iOS para grabar samples y exportarlos al EP-133 K.O. II.

## DenaviLab: Sounds (PWA, `site/sounds/`)

Capturador de sonidos para sampling: graba con el micrófono, guarda por carpetas, recorta y exporta WAV. Es la versión web de la app de iPhone (`ios/`), para quien no tiene iPhone. URL: `https://denavilab.neocities.org/sounds/`.

- **Sin build ni dependencias**: módulos ES, HTML y CSS planos. `dsp.js` (audio puro, sin DOM), `audio.js` + `worklet.js` (micrófono y búfer de captura retroactiva), `metronome.js`, `store.js` (IndexedDB), `zip.js`, `screens.js`, `editor.js` y `chop.js` (pantallas), `main.js` (arranque).
- **Login**: es la misma puerta del resto del sitio (`acceso.js`, sesión en `denavilab.sesion`). Sin sesión, la app muestra una pantalla cerrada con el botón Entrar.
- **Perfiles**: `profile.js`. Rolando trabaja con el EP-133 K.O. II (slot, memoria de 128 MB, 46 875 Hz). **Schair y los invitados no ven nada del K.O. II**: exportan WAV mono de 16 bit a 48 o 44,1 kHz, con el nombre del archivo sin prefijo de slot, y el manual no menciona el aparato.
- **Datos**: todo queda en el navegador de cada dispositivo (IndexedDB); nada se sube. «Copia de seguridad» y «Restaurar» (en Biblioteca) guardan y recuperan toda la biblioteca en un `.zip`.
- **Instalar**: Android/Chrome, menú › «Instalar app»; iPhone/Safari, Compartir › «Añadir a pantalla de inicio». En iPhone la app instalada guarda su propia sesión y su propia biblioteca, separadas de Safari, y el navegador vuelve a pedir el micrófono al abrirla.
- **Actualizaciones**: al publicar en `main`, el service worker (`sw.js`, primero la red) trae los archivos nuevos y la app avisa «Hay una versión nueva · Actualizar». **Sube `VERSION` en `sw.js` en cada publicación**, y el `?v=` de `app.css` en `index.html` si cambias los estilos.
- **Neocities (plan gratuito)**: sólo se suben tipos de archivo permitidos (`html`, `css`, `js`, `json`, `png`, `ttf`…). No añadas `.wasm`, `.woff2` ni `.webmanifest` sin comprobar que los acepta.
- **Pruebas**: `tests/sounds.spec.js` usa el micrófono falso de Chromium: login, grabar → guardar → editar → exportar, la toma que se corta sola en el compás exacto, el perfil sin K.O. II, la selección múltiple, la copia de seguridad, pantallas de 320 a 820 px y el manifiesto con el service worker.
- **Chop**: desde Editar. Corta la toma en 4, 8, 12 o Auto (por golpes), con ajuste a la cuadrícula si hay BPM. Se pueden elegir los cortes que se quiera, juntos o no (el 1 y el 3), y guardar o exportar sólo ésos; conservan su número original. Sin K.O. II se llama «cortes» en vez de «pads».
- **Pendiente respecto a la app de iPhone**: edición precisa con zoom, efectos (EQ, reverb, compresor, carácter), cambio de tono y sugerencia automática de carpeta.
