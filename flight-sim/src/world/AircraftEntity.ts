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
  private propAngle = 0;
  private nodes: Record<string, Cesium.ModelNode | undefined> = {};
  private originals: Record<string, Cesium.Matrix4> = {};
  readonly position = new Cesium.Cartesian3();
  /** Matriz cuerpo (x adelante, y derecha, z abajo) → ECEF, útil para cámaras. */
  readonly bodyToFixed = new Cesium.Matrix4();
  private modelMatrix = new Cesium.Matrix4();
  private enu = new Cesium.Matrix4();

  constructor(private scene: Cesium.Scene) {}

  async load(url: string): Promise<void> {
    this.model = await Cesium.Model.fromGltfAsync({
      url,
      // Nuestros glTF siguen la convención estándar: +Y arriba, +Z adelante.
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.Z,
      shadows: Cesium.ShadowMode.ENABLED,
      minimumPixelSize: 0,
      allowPicking: false,
    });
    this.scene.primitives.add(this.model);
    await new Promise<void>((resolve) => {
      if (this.model.ready) return resolve();
      const remove = this.model.readyEvent.addEventListener(() => { remove(); resolve(); });
    });
    for (const n of ['propeller', 'propdisc', 'aileron_l', 'aileron_r', 'flap_l', 'flap_r', 'elevator', 'rudder']) {
      try {
        const node = this.model.getNode(n);
        this.nodes[n] = node;
        if (node) this.originals[n] = Cesium.Matrix4.clone(node.originalMatrix);
      } catch { /* nodo opcional */ }
    }
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

    // Hélice: a RPM altas se ve el disco y las palas giran "estroboscópicamente" lento.
    const rps = s.rpm0 / 60;
    const fast = s.rpm0 > 450;
    this.propAngle = (this.propAngle + (fast ? 0.7 + rps * 0.004 : rps) * 2 * Math.PI * dt) % (2 * Math.PI);
    this.setNode('propeller', rotZ(this.propAngle));
    const disc = this.nodes.propdisc;
    if (disc) disc.show = fast;
  }
}
