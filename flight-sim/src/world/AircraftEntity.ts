import * as Cesium from 'cesium';
import type { Snapshot } from '../physics/snapshot';
import { qRotate, type Quat } from '../physics/math/quat';

const DEG = Math.PI / 180;

/** Ángulos máximos visuales de las superficies (grados). */
const DEFLECTION = { elevator: 25, aileron: 18, rudder: 22 };

/**
 * Modelo 3D del avión en la escena. Ubica el modelo según el estado interpolado de la física
 * y anima las superficies de control y la hélice.
 */
export class AircraftEntity {
  model!: Cesium.Model;
  private propAngles = [0, 0];
  /** Sentido de giro de cada hélice (+1 horario visto desde la cabina). */
  rotations: number[] = [1, -1];
  private nodes: Record<string, Cesium.ModelNode | undefined> = {};
  private originals: Record<string, Cesium.Matrix4> = {};
  readonly position = new Cesium.Cartesian3();
  /** Matriz cuerpo (x adelante, y derecha, z abajo) → ECEF, útil para cámaras. */
  readonly bodyToFixed = new Cesium.Matrix4();
  private modelMatrix = new Cesium.Matrix4();
  private enu = new Cesium.Matrix4();

  private lights: Cesium.PointPrimitiveCollection | null = null;
  private lightDefs: { p: Cesium.PointPrimitive; body: Cesium.Cartesian3; kind: 'nav' | 'strobe' | 'beacon' }[] = [];
  private lightTime = 0;
  /** Luces de navegación encendidas (de noche). Los estrobos y el faro anticolisión van siempre. */
  navLightsOn = false;

  constructor(private scene: Cesium.Scene) {}

  /** Crea las luces exteriores a partir de la configuración del avión. */
  setupLights(cfg?: { navLeft: number[]; navRight: number[]; tail: number[]; beacon: number[] }) {
    if (!cfg) return;
    this.lights = this.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const add = (pos: number[], color: Cesium.Color, kind: 'nav' | 'strobe' | 'beacon', size = 7) => {
      const p = this.lights!.add({ color, pixelSize: size, outlineWidth: 0, scaleByDistance: new Cesium.NearFarScalar(30, 1.6, 4000, 0.5) });
      this.lightDefs.push({ p, body: new Cesium.Cartesian3(pos[0], pos[1], pos[2]), kind });
    };
    add(cfg.navLeft, Cesium.Color.fromCssColorString('#ff2a1a'), 'nav');
    add(cfg.navRight, Cesium.Color.fromCssColorString('#1aff5a'), 'nav');
    add(cfg.tail, Cesium.Color.WHITE, 'nav', 6);
    add(cfg.navLeft, Cesium.Color.WHITE, 'strobe', 10);
    add(cfg.navRight, Cesium.Color.WHITE, 'strobe', 10);
    add(cfg.beacon, Cesium.Color.fromCssColorString('#ff3020'), 'beacon', 8);
  }

  private updateLights(dt: number) {
    if (!this.lights) return;
    this.lightTime += dt;
    const strobe = (this.lightTime % 1.2) < 0.06 || ((this.lightTime % 1.2) > 0.14 && (this.lightTime % 1.2) < 0.2);
    const beacon = (this.lightTime % 1.0) < 0.12;
    const visibleModel = this.model?.show ?? true;
    for (const l of this.lightDefs) {
      l.p.position = Cesium.Matrix4.multiplyByPoint(this.bodyToFixed, l.body, new Cesium.Cartesian3());
      l.p.show = visibleModel && (l.kind === 'nav' ? this.navLightsOn : l.kind === 'strobe' ? strobe : beacon);
    }
  }

  async load(url: string): Promise<void> {
    this.model = await Cesium.Model.fromGltfAsync({
      url,
      // Nuestros glTF siguen la convención estándar: +Y arriba, +Z adelante.
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.Z,
      // Sólo proyecta sombra: recibirla sobre geometría low-poly de doble cara produce "acné" de sombra.
      shadows: Cesium.ShadowMode.CAST_ONLY,
      minimumPixelSize: 0,
      allowPicking: false,
    });
    this.scene.primitives.add(this.model);
    await new Promise<void>((resolve) => {
      if (this.model.ready) return resolve();
      const remove = this.model.readyEvent.addEventListener(() => { remove(); resolve(); });
    });
    for (const n of ['propeller', 'propdisc', 'propeller2', 'propdisc2', 'aileron_l', 'aileron_r', 'flap_l', 'flap_r', 'flap_l2', 'flap_r2',
      'elevator', 'rudder', 'gear_nose', 'gear_l', 'gear_r']) {
      try {
        const node = this.model.getNode(n);
        this.nodes[n] = node;
        if (node) this.originals[n] = Cesium.Matrix4.clone(node.originalMatrix);
      } catch { /* nodo opcional */ }
    }
  }

  /** Ajusta la luz que recibe el modelo según la hora (0 = noche cerrada, 1 = día). */
  setDaylight(k: number) {
    if (!this.model) return;
    this.model.lightColor = new Cesium.Cartesian3(k * 1.1, k * 1.08, k * 1.0);
    this.model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(k, k);
  }

  private spinProp(node: string, discNode: string, rpm: number, i: number, dt: number, dir: number) {
    if (!this.nodes[node]) return;
    const fast = rpm > 450;
    const rps = rpm / 60;
    this.propAngles[i] = (this.propAngles[i] + dir * (fast ? 0.7 + rps * 0.004 : rps) * 2 * Math.PI * dt) % (2 * Math.PI);
    this.setNode(node, Cesium.Matrix3.fromRotationZ(this.propAngles[i]));
    const disc = this.nodes[discNode];
    if (disc) disc.show = fast;
  }

  set visible(v: boolean) { if (this.model) this.model.show = v; }
  get visible() { return this.model?.show ?? false; }

  private setNode(name: string, rot: Cesium.Matrix3) {
    const node = this.nodes[name], orig = this.originals[name];
    if (!node || !orig) return;
    const r = Cesium.Matrix4.fromRotationTranslation(rot);
    node.matrix = Cesium.Matrix4.multiply(orig, r, new Cesium.Matrix4());
  }

  /**
   * Actualiza pose y animaciones.
   * Ejes glTF del modelo: X izquierda, Y arriba, Z adelante.
   */
  update(s: Snapshot, dt: number): void {
    if (!this.model) return;
    Cesium.Cartesian3.fromRadians(s.lon * DEG, s.lat * DEG, s.height, Cesium.Ellipsoid.WGS84, this.position);
    Cesium.Transforms.eastNorthUpToFixedFrame(this.position, Cesium.Ellipsoid.WGS84, this.enu);

    // Ejes del cuerpo expresados en NED local → ENU
    const q: Quat = [s.qw, s.qx, s.qy, s.qz];
    const nedToEnu = (v: [number, number, number]) => [v[1], v[0], -v[2]];
    const fwd = nedToEnu(qRotate(q, [1, 0, 0]));
    const right = nedToEnu(qRotate(q, [0, 1, 0]));
    const down = nedToEnu(qRotate(q, [0, 0, 1]));

    // Cuerpo → ENU (columnas = ejes del cuerpo)
    const bodyRot = new Cesium.Matrix3(
      fwd[0], right[0], down[0],
      fwd[1], right[1], down[1],
      fwd[2], right[2], down[2],
    );
    Cesium.Matrix4.multiply(this.enu, Cesium.Matrix4.fromRotationTranslation(bodyRot), this.bodyToFixed);

    // Marco del modelo de Cesium (tras la corrección de ejes del glTF): x adelante, y izquierda, z arriba.
    const modelRot = new Cesium.Matrix3(
      fwd[0], -right[0], -down[0],
      fwd[1], -right[1], -down[1],
      fwd[2], -right[2], -down[2],
    );
    Cesium.Matrix4.multiply(this.enu, Cesium.Matrix4.fromRotationTranslation(modelRot), this.modelMatrix);
    this.model.modelMatrix = this.modelMatrix;
    this.updateLights(dt);

    // Superficies (rotaciones en ejes glTF; ver build-models.ts)
    const rotX = Cesium.Matrix3.fromRotationX, rotY = Cesium.Matrix3.fromRotationY, rotZ = Cesium.Matrix3.fromRotationZ;
    const ail = s.aileron * DEFLECTION.aileron * DEG;
    // Alabeo a la derecha: alerón derecho arriba (borde de fuga arriba), izquierdo abajo.
    this.setNode('aileron_r', rotX(ail));
    this.setNode('aileron_l', rotX(-ail));
    const flap = s.flapDeg * DEG;
    this.setNode('flap_l', rotX(-flap));
    this.setNode('flap_r', rotX(-flap));
    this.setNode('elevator', rotX(s.elevator * DEFLECTION.elevator * DEG));
    this.setNode('rudder', rotY(s.rudder * DEFLECTION.rudder * DEG));

    this.setNode('flap_l2', rotX(-flap));
    this.setNode('flap_r2', rotX(-flap));

    // Tren retráctil: la rueda de nariz se pliega hacia atrás y las principales hacia adentro.
    const up = (1 - s.gearExtension) * DEG;
    this.setNode('gear_nose', rotX(up * 90));
    this.setNode('gear_l', rotZ(-up * 85));
    this.setNode('gear_r', rotZ(up * 85));

    // Hélices: a RPM altas se ve el disco y las palas giran "estroboscópicamente" lento.
    this.spinProp('propeller', 'propdisc', s.rpm0, 0, dt, this.rotations[0] ?? 1);
    this.spinProp('propeller2', 'propdisc2', s.rpm1, 1, dt, this.rotations[1] ?? -1);
  }
}
