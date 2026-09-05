# Archivo compartido

Aquí van los `.mid` y `.pdf` que queramos tener a mano los dos.
Neocities no tiene almacenamiento: lo único que se comparte de verdad es lo que está
en el repositorio, así que un archivo llega aquí por commit, no desde la app.

Para subir uno:

1. Copia el `.mid` o el `.pdf` a esta carpeta (`site/archivo/`).
2. Añade su entrada en `manifest.json`, dentro de `"archivos"`:

   { "nombre": "Cerro Caracol · base", "archivo": "cerro-caracol-base.mid",
     "tipo": "midi", "fecha": "2026-09-05", "de": "Rolando",
     "notas": "batería, bajo y acordes; 96 bpm, Am" }

3. Commit y push a `main`. La acción lo publica y aparece solo en la página.

Ojo: el workflow usa `cleanup: false`. Si borras un archivo de aquí, seguirá vivo en
Neocities hasta que lo quites a mano allá.
