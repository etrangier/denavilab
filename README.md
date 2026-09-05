# DenaviLAB

Maqueta beats, bajo digital y acordes (pad / piano / piano lead) con el Akai MPK mini de 25 o 37 teclas, desde el navegador.
Sitio: https://denavilab.neocities.org

## Cómo se actualiza
1. Edita `site/index.html` (la app entera está en ese único archivo).
2. Haz commit y push a `main`.
3. La acción de GitHub (`.github/workflows/deploy.yml`) sube la carpeta `site/` a Neocities con la clave guardada en el secreto `NEOCITIES_API_TOKEN`.

## Abrir en local
Doble clic en `site/index.html` con Opera, Chrome o Edge (MIDI y descargas funcionan directo).
