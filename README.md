# DenaviLAB

Maqueta beats, bajo digital y acordes (pad / piano / piano lead) con el Akai MPK mini de 25 o 37 teclas, desde el navegador, y expórtalo a MIDI para terminarlo en Logic.
Sitio: https://denavilab.neocities.org

## Qué hay en `site/`
- `index.html` — la portada: DenaviLAB, quiénes son Denavi, y las dos puertas. Acceso libre.
- `guia.html` — el trabajo guiado. Pide sesión, y muestra una ruta distinta según quién
  entró: la de Schair (sin teclado, termina en guitarra y letra) o la de Rolando (con MPK).
  Se elige con `data-para` en el marcado y `data-quien` en `<html>`, que fija el guardián.
- `app.html` — el taller entero, en un único archivo autónomo. Pide sesión.
  Modos: `beat`, `bajod`, `pad`, `piano`, `lead` y `letra` (letra y acordes de guitarra,
  por secciones, con los compases que dura cada acorde; sale en PDF y en texto).
- `estilo.css`, `acceso.js` — compartidos por la portada y la guía. `app.html` no los usa:
  lleva todo dentro para que la función de descargar la página siga funcionando.

La guía enlaza a la app con `?modo=beat|bajod|pad|piano|lead` para entrar directo a un
instrumento. Si el parámetro falta o no es válido, arranca en `beat`.

## Cómo se actualiza
1. Edita lo que toque en `site/`.
2. Commit y push a `main`.
3. La acción de GitHub (`.github/workflows/deploy.yml`) sube la carpeta `site/` a Neocities con la clave guardada en el secreto `NEOCITIES_API_TOKEN`.

Sólo los push a `main` publican: puedes trabajar en ramas sin tocar el sitio.
Ojo: el workflow usa `cleanup: false`, así que un archivo borrado de `site/` sigue vivo en Neocities y hay que quitarlo a mano allá.

## Abrir en local
Doble clic en `site/app.html` con Opera, Chrome o Edge (MIDI y descargas funcionan directo). Safari no soporta Web MIDI.

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
