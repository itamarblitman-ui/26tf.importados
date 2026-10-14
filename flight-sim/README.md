# Cielo Abierto — simulador de vuelo para navegador

Simulador de vuelo con terreno real del planeta (CesiumJS), física de vuelo de 6 grados de libertad
propia y aeronaves de diseño original. Escrito en TypeScript + Vite.

> Proyecto 100 % original: no usa nombres, logos, modelos ni assets de otros simuladores ni de
> fabricantes reales. La avioneta **Hornero H-160** es un diseño genérico propio cuyo modelo 3D se
> genera por código (`scripts/build-models.ts`).

## Inicio rápido

```bash
cd flight-sim
npm install
cp .env.example .env      # y completá las claves (ver abajo)
npm run dev               # http://localhost:5173
```

Sin claves el simulador igual arranca en **modo sin conexión**: globo con imagen satelital de baja
resolución incluida en Cesium, sin relieve ni edificios. Sirve para probar la física.

### Parámetros por URL (hasta que llegue el menú de la fase 4)

| Parámetro  | Ejemplo                       | Descripción                                          |
|------------|-------------------------------|------------------------------------------------------|
| `airport`  | `SABE`, `SAEZ`, `AEP`         | Código OACI o IATA (base OurAirports)                |
| `runway`   | `13`                          | Cabecera de inicio                                   |
| `aircraft` | `hornero-h160`                | Archivo en `public/aircraft/`                        |
| `scenery`  | `standard` · `photoreal` · `offline` | Terreno + satélite + edificios OSM · Google 3D Tiles · sin red |
| `camera`   | `orbit` · `cockpit` · `tower` | Cámara inicial                                       |
| `hora`     | `17:30`                       | Hora solar local (por defecto, la hora real)         |
| `clima`    | `Despejado`, `Buen tiempo`, `Ventoso con ráfagas`, `Nublado`, `Niebla`, `Tormenta` | Ajuste rápido de clima |

Ejemplo: `http://localhost:5173/?airport=SABE&runway=31&scenery=photoreal&hora=18:45`

## Cómo conseguir las claves gratis

Las claves se leen de `flight-sim/.env` (no se sube al repo). Vite expone `CESIUM_ION_TOKEN` y
`GOOGLE_MAPS_KEY` al navegador gracias a `envPrefix` en `vite.config.ts`.

### `CESIUM_ION_TOKEN` (necesaria para terreno y edificios)

1. Creá una cuenta gratuita en <https://ion.cesium.com/signup> (plan Community, sin tarjeta).
2. Entrá a **Access Tokens** → copiá el *Default Token* o creá uno nuevo con los permisos
   `assets:read` y `geocode`.
3. Pegalo en `.env`: `CESIUM_ION_TOKEN=eyJhbGciOi...`

Con esto tenés **Cesium World Terrain** (relieve), imagen satelital **Bing Maps** y **Cesium OSM
Buildings** (edificios). El plan gratuito alcanza de sobra para uso personal.

### `GOOGLE_MAPS_KEY` (opcional, para `scenery=photoreal`)

Las *Photorealistic 3D Tiles* de Google se pueden usar de dos formas:

- **Sólo con Cesium ion**: si no definís `GOOGLE_MAPS_KEY`, se cargan a través de ion (asset
  "Google Photorealistic 3D Tiles"; puede que tengas que agregarlo a tu cuenta desde *Asset Depot*).
- **Con tu propia clave de Google**:
  1. Entrá a <https://console.cloud.google.com/>, creá un proyecto y activá la facturación
     (Google Maps Platform incluye un cupo mensual gratuito; las teselas 3D para uso personal
     normalmente entran en él).
  2. En **APIs y servicios → Biblioteca**, habilitá **Map Tiles API**.
  3. En **Credenciales → Crear credenciales → Clave de API**.
  4. Pegala en `.env`: `GOOGLE_MAPS_KEY=AIza...`

> ⚠️ Toda clave usada desde el navegador queda visible en el código que se descarga. Restringila
> por **referente HTTP** (por ejemplo `http://localhost:5173/*` y tu dominio) tanto en Cesium ion
> como en Google Cloud.

## Controles

| Tecla | Acción |
|---|---|
| ↑ / ↓ | Picar / encabritar |
| ← / → | Alabeo |
| Q / E | Timón (dirige la rueda de nariz en tierra) |
| F1 · F2 · F3 · F4 | Corte · reducir · aumentar · pleno acelerador (también RePág/AvPág y +/−) |
| Inicio / Fin | Compensador picar / encabritar |
| Z / X | Subir / bajar flaps |
| B o Espacio | Frenos · `,` / `.` freno izquierdo / derecho · Shift+B freno de estacionamiento |
| G | Tren (aviones retráctiles) |
| M | Arrancar / detener el motor |
| C · 1 · 2 · 3 | Cambiar cámara · cabina · externa · torre |
| Mouse | Arrastrar: mirar/orbitar · rueda: zoom · doble clic: centrar |
| Shift + flechas | Mirar alrededor |
| I | Tablero de instrumentos on/off (en cabina se ve por defecto) |
| H · Shift+H | HUD · barra de datos superior |
| [ / ] | Ajuste del altímetro (ventanilla de Kollsman, hPa) |
| O | Sonido on/off (se activa con la primera tecla o clic) |
| T | Panel de hora y clima |
| A | Elegir aeropuerto y cabecera en el mapa |
| P · R · F10/? | Pausa · reiniciar · ayuda |

**Joystick / gamepad** (Gamepad API, se detecta solo al tocar un botón): stick izquierdo =
alabeo/cabeceo, gatillos = timón, stick derecho vertical = acelerador, A = frenos, B/X = flaps,
Y = tren, LB/RB = compensador. En joysticks de vuelo (mapping no estándar): ejes 0/1 = palanca,
eje 2 = acelerador, eje 3 o 5 = timón (twist).

### Primer despegue

1. Arrancás alineado en la cabecera 13 de Aeroparque con el compensador en posición de despegue.
2. **F4** (pleno). Mantené el eje con **Q/E**: la hélice tiende a llevarte a la izquierda.
3. A ~55 kt tirá suave (**↓**) hasta ver ~8° de nariz arriba y mantené: trepa a ~75 kt.
4. Arriba, reducí a ~2300 RPM (F2) y compensá (Inicio/Fin) para volar sin presión en la palanca.

## Arquitectura

```
flight-sim/
├─ src/
│  ├─ physics/        TypeScript puro (sin DOM ni Cesium): corre en un Web Worker y en los tests
│  │  ├─ Simulation.ts      integrador 6DOF a 120 Hz, trimado, choques, re-anclado del marco local
│  │  ├─ Aerodynamics.ts    CL/CD(α) con pérdida, derivadas de estabilidad, efecto suelo, soplado de hélice
│  │  ├─ Propulsion.ts      motor a pistón (Gagg-Ferrar) + hélice de paso fijo (Ct/Cp vs J) con dinámica de RPM
│  │  ├─ LandingGear.ts     resorte-amortiguador por pata, fricción, frenos diferenciales, rueda de nariz
│  │  ├─ Atmosphere.ts      ISA hasta 20 km, ISA+ΔT
│  │  ├─ Wind.ts            viento medio + ráfagas + turbulencia tipo Dryden (determinista)
│  │  ├─ geodesy.ts         WGS84, ECEF, marcos NED
│  │  ├─ snapshot.ts        layout binario del estado (Float64Array transferible)
│  │  └─ worker.ts          bucle de paso fijo con acumulador
│  ├─ app/            FlightSession (orquestador), PhysicsClient (interpolación), protocolo de mensajes
│  ├─ world/          Cesium: globo/LOD, aeropuertos, sonda de suelo, modelo del avión, cámaras
│  ├─ input/          teclado, Gamepad API, fusión de entradas
│  ├─ instruments/    modelo de instrumentos (retardos, altímetro barométrico, giróscopos) y dibujo en Canvas
│  ├─ audio/          motor, hélice, viento, rodadura y bocina de pérdida sintetizados con Web Audio
│  └─ ui/             interfaz superpuesta y HUD
├─ public/aircraft/   una aeronave = un JSON (masa, inercias, curvas, motor, tren…)
├─ public/models/     glTF generados por scripts/build-models.ts
├─ public/data/       aeropuertos (OurAirports) compactados por scripts/build-airports.ts
└─ tests/physics/     tests unitarios del modelo de vuelo (Vitest)
```

**Flujo por frame**: el hilo principal lee teclado/joystick → envía `ControlInputs` al worker →
el worker integra a 120 Hz fijos independientemente del framerate y publica el estado
(`Float64Array` transferible, sin copias) → el hilo principal interpola entre los dos últimos
estados para el instante de render y actualiza modelo, cámaras e interfaz. A ~15 Hz el hilo
principal mide el suelo bajo el avión (terreno de Cesium o el plano exacto de la pista) y se lo
pasa a la física.

**Rendimiento**: física fuera del hilo de render, LOD de terreno y 3D Tiles con
`maximumScreenSpaceError` ajustado, *foveated* y *dynamic SSE* (menos detalle en la periferia),
caché de teselas acotada, FXAA en lugar de MSAA, interfaz actualizada a ~12 Hz.

## Mundo vivo (hora y clima)

- **Hora**: por defecto la real; con **T** se fija la hora solar local del lugar. Sol, iluminación del
  terreno y del avión, sombras (cascada cercana, 1,5 km), luces de ciudades de noche (modo
  estándar) y luces de navegación/estrobos del avión.
- **Viento** (físico, no sólo visual): dirección, velocidad, ráfagas y turbulencia tipo Dryden, con
  perfil de capa límite (menos viento junto al suelo). Desvía la trayectoria, afecta el carreteo y
  los aterrizajes con viento cruzado.
- **Nubes**: capas por cobertura (pocas → cubierto) y altura de base, generadas de forma
  determinista alrededor del avión. Dentro de una capa fragmentada o cubierta la visibilidad cae a
  ~100 m.
- **Visibilidad/niebla**: post-proceso propio sobre el buffer de profundidad (ley de Koschmieder),
  con el color de la niebla según la altura del sol.
- **Atmósfera**: desvío de temperatura ISA (los días calurosos alargan el despegue) y QNH (si no
  ajustás el altímetro con `[`/`]`, marca mal).
- **Aeropuertos** (**A**): mapa de OpenStreetMap con los ~11 000 aeropuertos con pistas de
  OurAirports; buscar por OACI, IATA, nombre o ciudad, y elegir cabecera. El traslado es instantáneo
  (sin recargar).
- **Accidentes**: impacto contra el terreno o edificios de la estructura, aterrizaje duro (> 3,5 m/s),
  exceso de velocidad o de G, y **amerizaje** (detectado con la máscara de agua de Cesium World
  Terrain). La pantalla muestra causa, velocidad, régimen vertical y G, con opciones de reiniciar o
  elegir otro aeropuerto.

> El mapa usa teselas de `tile.openstreetmap.org`, pensadas para uso liviano; para un despliegue
> público conviene un proveedor propio de teselas.

## Tests

```bash
npm test
```

Incluye: atmósfera ISA, geodesia, motor y hélice, vuelo nivelado compensado (la altitud se mantiene
estable 60 s), amortiguamiento de la dinámica longitudinal, pérdida (CL cae superado el ángulo
crítico; en vuelo, con palanca atrás y motor reducido, entra en pérdida y baja la nariz) y
recuperación, tren de aterrizaje (reposo estable, carrera de despegue, frenado, dirección de rueda de
nariz, roce de cola, aterrizaje duro) e instrumentos (altímetro y ventanilla de Kollsman, retardo del
variómetro, bola del coordinador, giróscopos sin vacío), clima (dirección del viento, capa límite,
ráfagas, deriva con viento cruzado, efecto de la temperatura en el despegue, amerizaje), posición del
sol y campo de nubes determinista.

## Instrumentos y sonido

- **Tablero** (Canvas 2D, redibujado a 30 Hz con esferas pre-renderizadas): anemómetro con arcos
  blanco/verde/amarillo y línea roja tomados del JSON del avión, horizonte artificial, altímetro de
  tres agujas con ventanilla de Kollsman, coordinador de virajes con bola, indicador de rumbo y
  variómetro; más tacómetro y un recuadro de acelerador/flaps/compensador/frenos.
- Los instrumentos no muestran la física "cruda": el variómetro tiene retardo, el altímetro es
  barométrico (si cambia el QNH y no lo ajustás, marca mal) y los giróscopos dependen de la bomba de
  vacío del motor: con el motor detenido se van degradando.
- **HUD** (H): cintas de velocidad y altitud, rumbo, V/S y G; en cabina, horizonte, escalera de
  cabeceo y vector de trayectoria conformes al campo visual.
- **Sonido**: todo sintetizado (sin grabaciones). Explosiones del motor de 4 cilindros según RPM,
  paso de pala de la hélice, viento según la velocidad, rodadura en pista y bocina de pérdida
  (suena ~3° antes del ángulo crítico). En cabina el sonido llega filtrado; afuera se atenúa con la
  distancia.

## Regenerar datos y modelos

```bash
npm run build:models     # public/models/*.glb
npm run build:airports   # descarga OurAirports y genera public/data/airports.json
```

## Créditos y licencias de datos

- Aeropuertos y pistas: [OurAirports](https://ourairports.com/data/) — dominio público.
- Globo y terreno: [CesiumJS](https://cesium.com/) (Apache 2.0), Cesium World Terrain, imagen Bing
  Maps y Cesium OSM Buildings (© OpenStreetMap contributors) vía Cesium ion; Google Photorealistic
  3D Tiles (© Google). Los créditos se muestran en pantalla como exigen sus términos.

## Estado

- [x] **Fase 1** — núcleo jugable: globo, pista real, avioneta propia, física 6DOF, controles, cámaras.
- [x] **Fase 2** — seis instrumentos básicos + tacómetro en Canvas, HUD conforme, sonido sintetizado.
- [x] **Fase 3** — hora del día con sol y sombras, clima (viento, ráfagas, turbulencia, nubes, niebla), selector de aeropuertos en mapa, agua y pantalla de accidente.
- [ ] Fase 4 — piloto automático, menú, bimotor.
