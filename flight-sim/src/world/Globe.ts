import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export type SceneryMode = 'standard' | 'photoreal' | 'offline';

export interface GlobeOptions {
  mode: SceneryMode;
  ionToken?: string;
  googleKey?: string;
}

export interface World {
  viewer: Cesium.Viewer;
  scene: Cesium.Scene;
  mode: SceneryMode;
  /** Tileset fotorrealista o de edificios (puede no existir). */
  tileset: Cesium.Cesium3DTileset | null;
  /** true si hay un modelo de terreno real (no el elipsoide). */
  hasTerrain: boolean;
}

/** Lee las claves desde .env (Vite expone CESIUM_* y GOOGLE_* gracias a envPrefix). */
export function readKeys() {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    ionToken: env.CESIUM_ION_TOKEN?.trim() || undefined,
    googleKey: env.GOOGLE_MAPS_KEY?.trim() || undefined,
  };
}

/**
 * Crea el visor de Cesium ajustado para simulación: sin widgets, sin controles de cámara por defecto,
 * con LOD y caché pensados para una laptop común.
 */
export async function createWorld(container: HTMLElement, opts: GlobeOptions): Promise<World> {
  let mode = opts.mode;
  if (!opts.ionToken && mode !== 'offline') {
    console.warn('Falta CESIUM_ION_TOKEN: se usa el modo sin conexión (sin terreno real). Ver README.');
    mode = 'offline';
  }
  if (opts.ionToken) Cesium.Ion.defaultAccessToken = opts.ionToken;

  const offlineImagery = () =>
    Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
    );

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    creditContainer: undefined,
    scene3DOnly: true,
    shouldAnimate: true,
    msaaSamples: 1,
    useBrowserRecommendedResolution: true,
    baseLayer: mode === 'offline' ? offlineImagery() : mode === 'photoreal' ? false : Cesium.ImageryLayer.fromWorldImagery({}),
    terrain: mode === 'offline' ? undefined : Cesium.Terrain.fromWorldTerrain({ requestWaterMask: true, requestVertexNormals: true }),
  });

  const scene = viewer.scene;
  // Nuestra app maneja la cámara: desactivamos las interacciones por defecto de Cesium.
  const ctrl = scene.screenSpaceCameraController;
  ctrl.enableInputs = false;
  viewer.trackedEntity = undefined;

  // Rendimiento
  scene.postProcessStages.fxaa.enabled = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.maximumScreenSpaceError = 2.5;
  scene.globe.tileCacheSize = 250;
  scene.globe.preloadAncestors = true;
  scene.globe.preloadSiblings = false;
  scene.fog.enabled = true;
  scene.fog.density = 1.6e-4;
  scene.fog.screenSpaceErrorFactor = 4;
  scene.highDynamicRange = false;
  scene.globe.enableLighting = true;
  scene.camera.frustum instanceof Cesium.PerspectiveFrustum && (scene.camera.frustum.fov = Cesium.Math.toRadians(70));
  // El ciclo de render corre continuo: el avión se mueve siempre.
  scene.requestRenderMode = false;

  // Luces de las ciudades de noche (NASA Black Marble vía Cesium ion): sólo se ven en el lado nocturno.
  if (mode === 'standard') {
    Cesium.IonImageryProvider.fromAssetId(3812)
      .then((p) => {
        const night = viewer.imageryLayers.addImageryProvider(p);
        night.dayAlpha = 0;
        night.nightAlpha = 0.9;
        night.brightness = 2.2;
      })
      .catch((e) => console.warn('Sin capa de luces nocturnas:', e));
  }

  let tileset: Cesium.Cesium3DTileset | null = null;
  const tilesetOptions = {
    maximumScreenSpaceError: 16,
    // Prioriza los tiles cercanos al centro de la pantalla y difiere los secundarios
    foveatedScreenSpaceError: true,
    dynamicScreenSpaceError: true,
    skipLevelOfDetail: true,
    cacheBytes: 384 * 1024 * 1024,
  };
  try {
    if (mode === 'photoreal') {
      tileset = await Cesium.createGooglePhotorealistic3DTileset(opts.googleKey ? { key: opts.googleKey } : undefined, tilesetOptions);
      scene.primitives.add(tileset);
      // El globo queda debajo como respaldo (océanos/zonas sin cobertura) pero no se dibuja encima.
      scene.globe.show = false;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    } else if (mode === 'standard') {
      tileset = await Cesium.createOsmBuildingsAsync();
      Object.assign(tileset, { maximumScreenSpaceError: 16, foveatedScreenSpaceError: true, dynamicScreenSpaceError: true });
      scene.primitives.add(tileset);
    }
  } catch (e) {
    console.warn('No se pudo cargar el tileset 3D:', e);
  }
  if (tileset) tileset.shadows = Cesium.ShadowMode.DISABLED;

  return { viewer, scene, mode, tileset, hasTerrain: mode !== 'offline' };
}
