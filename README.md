# DenaviLAB

Maqueta beats, bajo digital y acordes (pad / piano / piano lead) con el Akai MPK mini de 25 o 37 teclas, desde el navegador, y expórtalo a MIDI para terminarlo en Logic.
Sitio: https://denavilab.neocities.org

## Qué hay en `site/`
- `index.html` — la portada: qué es el proyecto y las dos puertas de entrada (ruta guiada o directo al taller).
- `app.html` — la app entera, en un único archivo autónomo.

La portada enlaza a la app con `?modo=beat|bajod|pad|piano|lead` para entrar directo a un instrumento. Si el parámetro falta o no es válido, arranca en `beat`.

## Cómo se actualiza
1. Edita lo que toque en `site/`.
2. Commit y push a `main`.
3. La acción de GitHub (`.github/workflows/deploy.yml`) sube la carpeta `site/` a Neocities con la clave guardada en el secreto `NEOCITIES_API_TOKEN`.

Sólo los push a `main` publican: puedes trabajar en ramas sin tocar el sitio.
Ojo: el workflow usa `cleanup: false`, así que un archivo borrado de `site/` sigue vivo en Neocities y hay que quitarlo a mano allá.

## Abrir en local
Doble clic en `site/app.html` con Opera, Chrome o Edge (MIDI y descargas funcionan directo). Safari no soporta Web MIDI.
