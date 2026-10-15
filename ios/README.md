# DenaviLab Grabadora (beta 0.1, alcance «verde»)

App nativa iOS (SwiftUI + AVAudioEngine) para grabar samples y exportarlos al EP-133 K.O. II.
Diseño: Canva DAHX-TlarCw. Estilo oscuro y ámbar (ver `Grabadora/App/Theme.swift`).

## Qué incluye (verde)
- Grabación con medidor de nivel y aviso de clip; monitorización opcional.
- Captura retroactiva con búfer circular en memoria (la app debe estar abierta y escuchando).
- Editor: zoom, recorte con ajuste a cruce por cero, fundidos, normalizado.
- Efectos no destructivos (EQ, filtro, reverb, tono, compresor): se guarda el original y los parámetros; se renderiza al exportar.
- Metrónomo sobre el reloj de audio y tap tempo.
- Biblioteca con carpetas, etiquetas y búsqueda.
- Exportación WAV mono 16-bit por slot (`007_nombre.wav`) y kit, vía hoja de compartir (AirDrop / Archivos).

## Fuera de la beta
BPM automático, clasificación automática, separación de stems, captura del audio de otras apps y transferencia USB directa al K.O. II.

## Por confirmar con el dispositivo
Frecuencia de muestreo objetivo (46 875 Hz), formatos aceptados, rango de slots y convención de nombres.

## Compilar
Requiere macOS con Xcode 15+ y [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
cd ios
xcodegen generate
open DenaviGrabadora.xcodeproj
```
Tests de lógica: `Cmd+U` (o `xcodebuild test -scheme DenaviGrabadora -destination 'platform=iOS Simulator,name=iPhone 15'`).

## Estado
Escrito en un entorno Linux sin Swift: **no se ha compilado ni probado todavía**. Espera pequeños errores de compilación en el primer build. Para la fuente Ubuntu, añade los `.ttf` al proyecto y declara `UIAppFonts` en `project.yml`.
