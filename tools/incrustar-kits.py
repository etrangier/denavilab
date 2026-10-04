#!/usr/bin/env python3
"""Incrusta ep133_sonidos.json dentro de site/kits.html, para que la página funcione sin red.

Uso:  python3 tools/incrustar-kits.py ruta/a/ep133_sonidos.json

Reemplaza el contenido de <script type="application/json" id="ksDatos">…</script>.
Nota: el repositorio es público, así que lo que se incrusta queda visible para cualquiera.
"""
import json, re, sys, pathlib

if len(sys.argv) != 2:
    sys.exit(__doc__)
datos = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
for clave in ("generos", "sonidos"):
    if not isinstance(datos.get(clave), list) or not datos[clave]:
        sys.exit(f"Al JSON le falta «{clave}».")
# Compacto, sin escapar acentos, y sin que un «</» cierre el <script> antes de tiempo.
cuerpo = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
destino = pathlib.Path(__file__).resolve().parent.parent / "site" / "kits.html"
html = destino.read_text(encoding="utf-8")
patron = re.compile(r'(<script type="application/json" id="ksDatos">)(.*?)(</script>)', re.S)
if not patron.search(html):
    sys.exit("No encontré <script id=\"ksDatos\"> en site/kits.html.")
destino.write_text(patron.sub(lambda m: m.group(1) + cuerpo + m.group(3), html, count=1), encoding="utf-8")
print(f"Incrustados {len(datos['sonidos'])} sonidos ({len(cuerpo) // 1024} KB) en {destino}")
