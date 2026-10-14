import * as Cesium from 'cesium';
import type { Snapshot } from '../physics/snapshot';
import type { AircraftEntity } from './AircraftEntity';

export type CameraMode = 'cockpit' | 'orbit' | 'tower';
export const CAMERA_MODES: CameraMode[] = ['cockpit', 'orbit', 'tower'];
export const CAMERA_LABEL: Record<CameraMode, string> = { cockpit: 'Cabina', orbit: 'Externa', tower: 'Torre' };

const DEG = Math.PI / 180;

/**
 * Cámaras del simulador. Maneja el mouse (arrastrar = mirar/orbitar, rueda = zoom).
 * - Cabina: en el ojo del piloto, solidaria al avión; se puede mirar alrededor.
 * - Externa: orbita alrededor del avión manteniendo el horizonte.
 * - Torre: fija en el aeropuerto, siguiendo al avión (se reubica si el avión se aleja mucho).
 */
export class Cameras {
  mode: CameraMode = 'orbit';
  private orbit = { heading: 20 * DEG, pitch: -10 * DEG, range: 26 };
  private look = { yaw: 0, pitch: -6 * DEG };
  private towerPos: Cesium.Cartesian3 | null = null;
  private towerFov = 50 * DEG;
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };
  private scratch = new Cesium.Cartesian3();
  onModeChange: (m: CameraMode) => void = () => {};

  constructor(
    private scene: Cesium.Scene,
    private aircraft: AircraftEntity,
    private pilotEye: [number, number, number],
  ) {
    const canvas = scene.canvas;
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastMouse = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', (e) => { this.dragging = false; canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastMouse.x, dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.drag(dx, dy);
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY); }, { passive: false });
    canvas.addEventListener('dblclick', () => this.recenter());
  }

  setTowerLocation(lat: number, lon: number, height: number) {
    this.towerPos = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  }

  setMode(m: CameraMode) {
    this.mode = m;
    this.aircraft.visible = m !== 'cockpit';
    const frustum = this.scene.camera.frustum as Cesium.PerspectiveFrustum;
    frustum.near = m === 'cockpit' ? 0.05 : 0.5;
    frustum.fov = m === 'cockpit' ? 75 * DEG : m === 'tower' ? this.towerFov : 60 * DEG;
    this.onModeChange(m);
  }

  next() {
    this.setMode(this.nextMode());
  }

  private nextMode(): CameraMode {
    return CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
  }

  recenter() {
    this.look = { yaw: 0, pitch: -6 * DEG };
    this.orbit = { ...this.orbit, heading: 20 * DEG, pitch: -10 * DEG };
  }

  /** Mirar con teclado/hat del joystick (rad/s). */
  pan(dYaw: number, dPitch: number) {
    if (this.mode === 'cockpit') {
      this.look.yaw += dYaw;
      this.look.pitch = Math.max(-80 * DEG, Math.min(80 * DEG, this.look.pitch + dPitch));
    } else if (this.mode === 'orbit') {
      this.orbit.heading += dYaw;
      this.orbit.pitch = Math.max(-89 * DEG, Math.min(60 * DEG, this.orbit.pitch + dPitch));
    }
  }

  private drag(dx: number, dy: number) {
    const k = 0.005;
    if (this.mode === 'cockpit') this.pan(-dx * k, -dy * k);
    else if (this.mode === 'orbit') this.pan(dx * k, -dy * k);
  }

  private zoom(delta: number) {
    const f = Math.exp(delta * 0.001);
    const frustum = this.scene.camera.frustum as Cesium.PerspectiveFrustum;
    if (this.mode === 'orbit') this.orbit.range = Math.max(8, Math.min(3000, this.orbit.range * f));
    else if (this.mode === 'tower') {
      this.towerFov = Math.max(2 * DEG, Math.min(70 * DEG, this.towerFov * f));
      frustum.fov = this.towerFov;
    } else frustum.fov = Math.max(30 * DEG, Math.min(100 * DEG, (frustum.fov ?? 60 * DEG) * f));
  }

  update(s: Snapshot) {
    const cam = this.scene.camera;
    const target = this.aircraft.position;
    if (this.mode === 'orbit') {
      // Orbita en el marco ENU local: el horizonte queda nivelado aunque el avión alabee.
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(target);
      cam.lookAtTransform(enu, new Cesium.HeadingPitchRange(s.heading + this.orbit.heading, this.orbit.pitch, this.orbit.range));
      return;
    }
    cam.lookAtTransform(Cesium.Matrix4.IDENTITY);

    if (this.mode === 'cockpit') {
      const m = this.aircraft.bodyToFixed;
      const eye = Cesium.Matrix4.multiplyByPoint(m, new Cesium.Cartesian3(...this.pilotEye), this.scratch);
      // Dirección de la mirada en ejes cuerpo
      const cy = Math.cos(this.look.yaw), sy = Math.sin(this.look.yaw);
      const cp = Math.cos(this.look.pitch), sp = Math.sin(this.look.pitch);
      const dirBody = new Cesium.Cartesian3(cp * cy, cp * sy, -sp);
      // Vector "arriba" de la mirada (perpendicular a dirBody; el arriba del cuerpo es -z)
      const upBody = new Cesium.Cartesian3(-sp * cy, -sp * sy, -cp);
      const direction = Cesium.Matrix4.multiplyByPointAsVector(m, dirBody, new Cesium.Cartesian3());
      const up = Cesium.Matrix4.multiplyByPointAsVector(m, upBody, new Cesium.Cartesian3());
      cam.setView({
        destination: eye,
        orientation: { direction: Cesium.Cartesian3.normalize(direction, direction), up: Cesium.Cartesian3.normalize(up, up) },
      });
      return;
    }

    // Torre: si el avión está muy lejos, la "torre" se reubica adelante en su trayectoria (cámara de pasada).
    if (!this.towerPos || Cesium.Cartesian3.distance(this.towerPos, target) > 6000) {
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(target);
      const speed = Math.max(s.groundSpeed, 20);
      const ahead = new Cesium.Cartesian3(s.vE / speed * 600 + 60, s.vN / speed * 600 + 60, -Math.min(30, Math.max(-30, s.vD * 5)) + 15);
      this.towerPos = Cesium.Matrix4.multiplyByPoint(enu, ahead, new Cesium.Cartesian3());
      this.towerFov = 35 * DEG;
      (cam.frustum as Cesium.PerspectiveFrustum).fov = this.towerFov;
    }
    const dir = Cesium.Cartesian3.subtract(target, this.towerPos, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(dir, dir);
    const upGeo = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this.towerPos, new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.cross(dir, upGeo, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(right, right);
    const up = Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3());
    cam.setView({ destination: this.towerPos, orientation: { direction: dir, up } });
  }
}
