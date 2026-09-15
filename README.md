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
