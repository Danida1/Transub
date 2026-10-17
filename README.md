# Paradero

App Android para buscar la ruta más rápida en TransMilenio y SITP en Bogotá, sin anuncios.

- Origen y destino por dirección (Calle 72 # 10-34), estación, paradero o lugar.
- Usa el GPS del teléfono como punto de partida si das el permiso.
- Rutas con todas las troncales, alimentadores y rutas SITP del GTFS oficial de Bogotá (SIMUR).
- Muestra tiempo total, hora de llegada, transbordos, frecuencia de cada ruta y el recorrido en el mapa.
- Pestaña Novedades con los canales oficiales de TransMilenio (WhatsApp, X y Facebook).

## Cómo obtener la APK (sin instalar nada)

1. Crea una cuenta gratis en https://github.com y luego un repositorio nuevo (puede ser privado).
2. En el repositorio toca **Add file > Upload files** y arrastra el contenido de esta carpeta.
   La carpeta `.github` está oculta en algunos computadores. Si no se sube, créala a mano con
   **Add file > Create new file**, escribe `.github/workflows/build.yml` como nombre y pega el contenido del archivo.
3. Entra a la pestaña **Actions**. La compilación empieza sola y tarda entre 5 y 10 minutos.
4. Cuando termine, ve a **Releases** (columna derecha de la página del repositorio) y descarga `Paradero.apk` desde el teléfono.
5. Ábrela. Android pedirá permitir la instalación de apps de origen desconocido para el navegador; acéptalo solo para esto.

Cada mes la APK se vuelve a compilar con el GTFS más reciente. También puedes forzarlo en **Actions > Construir APK > Run workflow**.
Las versiones nuevas se instalan encima de la anterior sin borrar nada.

## Compilar en tu computador (opcional)

Necesitas Python 3 y Android Studio.

```
python tools/build_data.py        # descarga el GTFS y genera app/src/main/assets/www/data/network.json
./gradlew assembleRelease         # la APK queda en app/build/outputs/apk/release/
```

## Estructura

- `tools/build_data.py`: descarga el GTFS oficial y lo convierte en un archivo compacto (paradas, rutas, frecuencias).
- `app/src/main/assets/www/`: la app (HTML y JavaScript).
  - `router.js`: buscador de rutas (algoritmo RAPTOR con frecuencias).
  - `geo.js`: lectura de direcciones de Bogotá y búsqueda de lugares.
  - `app.js`: pantalla, GPS, mapa y resultados.
- `app/src/main/java/.../MainActivity.java`: contenedor Android con permiso de ubicación.

## Límites actuales

- Los tiempos se calculan con las frecuencias programadas. No hay posición de buses en vivo porque TransMilenio no la publica en un servicio abierto.
- Las direcciones se ubican con la cuadrícula de calles y carreras; el margen es de unos cientos de metros.
- Las alertas de la vía se consultan en los canales oficiales; la app todavía no las lee sola.
- La llave de firma (`app/paradero.keystore`) está en el proyecto para que las actualizaciones se instalen sin problema. Si publicas la app en Play Store, crea una llave nueva y privada.
