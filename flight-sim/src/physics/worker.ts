/// <reference lib="webworker" />
/**
 * Web Worker de física. Corre la simulación a paso fijo (120 Hz) con un acumulador de tiempo real,
 * totalmente desacoplada del framerate de render. Publica el estado como Float64Array transferible.
 */
import type { FromPhysics, ToPhysics } from '../app/protocol';
import { validateAircraftConfig } from './AircraftConfig';
import { PHYSICS_DT, Simulation } from './Simulation';
import { emptySnapshot, packSnapshot, SNAPSHOT_SIZE } from './snapshot';

declare const self: DedicatedWorkerGlobalScope;

let sim: Simulation | null = null;
let paused = false;
let accumulator = 0;
let lastTime = 0;
const MAX_STEPS_PER_TICK = 8; // evita la "espiral de la muerte" si el worker se atrasa
const pool: Float64Array<ArrayBuffer>[] = [];
const snap = emptySnapshot();

const post = (msg: FromPhysics, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function publish(steps: number) {
  if (!sim) return;
  const buf = pool.pop() ?? new Float64Array(SNAPSHOT_SIZE);
  packSnapshot(sim.snapshot(snap), buf);
  post({ type: 'state', buffer: buf, steps }, [buf.buffer]);
}

function tick() {
  const now = performance.now();
  const elapsed = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (sim && !paused) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_TICK) {
      sim.step(PHYSICS_DT);
      accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_TICK) accumulator = 0;
    if (steps > 0) publish(steps);
  }
  // setTimeout(…, 4) da ~250 Hz de muestreo; el acumulador garantiza el paso fijo exacto.
  setTimeout(tick, 4);
}

self.onmessage = (ev: MessageEvent<ToPhysics>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
        sim = new Simulation(validateAircraftConfig(msg.aircraft));
        sim.setEnvironment(msg.env);
        sim.reset(msg.initial);
        accumulator = 0;
        publish(0);
        post({ type: 'ready' });
        break;
      case 'reset':
        sim?.reset(msg.initial);
        accumulator = 0;
        publish(0);
        break;
      case 'controls':
        sim?.setControls(msg.controls);
        break;
      case 'ground':
        sim?.setGround(msg.ground);
        break;
      case 'environment':
        sim?.setEnvironment(msg.env);
        break;
      case 'pause':
        paused = msg.paused;
        lastTime = performance.now();
        break;
      case 'recycle':
        if (pool.length < 8 && msg.buffer.length === SNAPSHOT_SIZE) pool.push(msg.buffer);
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

lastTime = performance.now();
tick();
