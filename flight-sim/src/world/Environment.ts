import * as Cesium from 'cesium';
import type { WeatherSettings } from '../app/weather';
import { cellOf, cloudsAround, layerThickness, type CloudCover } from './cloudField';
import type { World } from './Globe';
import { dateForLocalSolarHour, solarElevation } from './sun';

const FT = 0.3048;

/** Niebla por distancia real (buffer de profundidad): la de Cesium sólo afecta al terreno lejano. */
const FOG_SHADER = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float visibility;
uniform vec4 fogColor;
uniform float skyAmount;
in vec2 v_textureCoordinates;
void main(void) {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float rawDepth = texture(depthTexture, v_textureCoordinates).r;
  float f;
  if (rawDepth >= 1.0) {
    f = skyAmount;
  } else {
    // Profundidad cruda (logarítmica): czm_windowToEyeCoordinates la reconstruye con precisión.
    vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, rawDepth);
    float dist = length(eye.xyz / eye.w);
    // Ley de Koschmieder: contraste 2 % a la distancia de visibilidad (3.912 = -ln 0.02)
    f = 1.0 - exp(-3.912 * dist / visibility);
  }
  out_FragColor = vec4(mix(color.rgb, fogColor.rgb, clamp(f, 0.0, 1.0)), color.a);
}`;

/**
 * Ambiente visual: hora del día (sol, sombras, iluminación), niebla/visibilidad y nubes.
 * El viento y la temperatura los aplica la física (ver weather.ts).
 */
export class Environment {
  private clouds: Cesium.CloudCollection;
  private fog: Cesium.PostProcessStage;
  private weather: WeatherSettings;
  private cloudCell: string = '';
  private sunElevation = 45;
  private cloudLight = 1;
  /** true si el avión está dentro de la capa de nubes */
  inCloud = false;

  constructor(private world: World, weather: WeatherSettings) {
    const { scene, viewer } = world;
    this.weather = weather;
    this.clouds = scene.primitives.add(new Cesium.CloudCollection({ noiseDetail: 16 }));
    this.fog = new Cesium.PostProcessStage({
      name: 'niebla',
      fragmentShader: FOG_SHADER,
      uniforms: {
        visibility: () => this.effectiveVisibility(),
        fogColor: () => this.fogColor(),
        skyAmount: () => this.skyFog(),
      },
    });
    scene.postProcessStages.add(this.fog);

    // Sombras del sol (sólo cerca de la cámara: es lo que se nota y es barato)
    viewer.shadows = true;
    const sm = viewer.shadowMap;
    sm.size = 2048;
    sm.maximumDistance = 1500;
    sm.softShadows = false;
    sm.darkness = 0.35;
    scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
    // Por defecto Cesium apaga la iluminación solar del globo cuando la cámara está cerca del suelo;
    // para un simulador queremos día y noche también a baja altura.
    scene.globe.lightingFadeOutDistance = 1;
    scene.globe.lightingFadeInDistance = 2;
    scene.globe.nightFadeOutDistance = 1;
    scene.globe.nightFadeInDistance = 2;
    if (scene.atmosphere) scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT;
    this.apply(weather);
  }

  apply(w: WeatherSettings) {
    const coverChanged = w.cover !== this.weather.cover || w.cloudBaseFt !== this.weather.cloudBaseFt;
    this.weather = { ...w };
    this.world.viewer.shadows = w.shadows;
    if (coverChanged) this.cloudCell = '';
  }

  /** Fija la hora (solar local) o vuelve a la real. */
  setTime(w: WeatherSettings, lonDeg: number) {
    const clock = this.world.viewer.clock;
    clock.currentTime = Cesium.JulianDate.fromDate(w.timeMode === 'real' ? new Date() : dateForLocalSolarHour(w.localHour, lonDeg));
    clock.multiplier = 1;
    clock.shouldAnimate = true;
  }

  currentDate(): Date {
    return Cesium.JulianDate.toDate(this.world.viewer.clock.currentTime);
  }

  private effectiveVisibility(): number {
    if (this.inCloud) return 120;
    return Math.max(this.weather.visibilityKm * 1000, 200);
  }

  private skyFog(): number {
    const v = this.inCloud ? 0.1 : this.weather.visibilityKm;
    if (v >= 30) return 0;
    // Con poca visibilidad el cielo se vuelve gris
    return Math.min(0.92, 1.4 / Math.max(v, 0.3));
  }

  private fogColor(): Cesium.Color {
    // Del gris claro de día al casi negro de noche, con un dejo cálido en el crepúsculo
    const e = this.sunElevation;
    const day = Math.max(0, Math.min(1, (e + 4) / 14));
    const dusk = Math.max(0, 1 - Math.abs(e - 2) / 8) * 0.12;
    const base = this.inCloud ? 0.86 : 0.74;
    const r = 0.04 + (base - 0.04) * day + dusk;
    const g = 0.05 + (base + 0.02 - 0.05) * day + dusk * 0.6;
    const b = 0.07 + (base + 0.06 - 0.07) * day + dusk * 0.3;
    return new Cesium.Color(r, g, b, 1);
  }

  /** Llamar en cada frame con la posición del avión (grados, m de altura MSL). */
  update(lat: number, lon: number, altMsl: number) {
    this.sunElevation = solarElevation(this.currentDate(), lat, lon);
    const w = this.weather;
    this.fog.enabled = w.visibilityKm < 50 || this.inCloud;

    const base = w.cloudBaseFt * FT;
    const thick = layerThickness(w.cover);
    this.inCloud = (w.cover === 'broken' || w.cover === 'overcast') && altMsl > base && altMsl < base + thick;

    // Regenera el campo de nubes al cambiar de celda (cada ~2 km)
    const [ci, cj] = cellOf(lat, lon);
    const key = `${ci}:${cj}:${w.cover}:${w.cloudBaseFt}`;
    if (key !== this.cloudCell) {
      this.cloudCell = key;
      this.rebuildClouds(lat, lon, w.cover, base, thick);
    }
    // Las nubes se oscurecen de noche
    const light = Math.max(0.08, Math.min(1, (this.sunElevation + 6) / 16));
    if (Math.abs(light - this.cloudLight) > 0.02) {
      this.cloudLight = light;
      for (let i = 0; i < this.clouds.length; i++) this.clouds.get(i).brightness = light;
    }
  }

  private rebuildClouds(lat: number, lon: number, cover: CloudCover, base: number, thick: number) {
    this.clouds.removeAll();
    const specs = cloudsAround(lat, lon, cover, 7);
    for (const c of specs) {
      const layers = cover === 'overcast' || cover === 'broken' ? 2 : 1;
      for (let k = 0; k < layers; k++) {
        const h = base + c.heightOffset * (thick / 250) * 0.6 + k * thick * 0.45;
        this.clouds.add({
          position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, h + c.height * 0.3),
          scale: new Cesium.Cartesian2(c.width, c.height),
          maximumSize: new Cesium.Cartesian3(50, 15, 13),
          slice: 0.3 + c.seed * 0.3,
          brightness: this.cloudLight,
        });
      }
    }
  }

  get sunElevationDeg() { return this.sunElevation; }

  /** Intensidad de luz ambiente 0..1 (para oscurecer modelos de noche). */
  get daylight(): number {
    return Math.max(0.06, Math.min(1, (this.sunElevation + 5) / 13));
  }
}
