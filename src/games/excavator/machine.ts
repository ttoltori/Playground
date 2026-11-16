import * as THREE from 'three';
import { box } from '../forklift/world';

/** Excavator geometry (meters) and joint limits. Planar arm in the cab's forward/up plane. */
export const DIM = { pivotR: 0.9, pivotY: 1.9, L1: 5.0, L2: 2.7, L3: 1.35 };
export const LIM = {
  boom: [-0.65, 1.15] as [number, number],
  phi: [0.35, 2.6] as [number, number],
  curl: [-0.5, 2.3] as [number, number],
};
/** boom angle up, stick fold (0 = straight), bucket curl (+ = curl in) */
export interface Joints { boom: number; phi: number; curl: number }
export const TRAVEL_POSE: Joints = { boom: 0.5, phi: 1.7, curl: 1.2 };

export interface Pose2 {
  boomEnd: [number, number]; // [r, y]
  stickEnd: [number, number];
  tip: [number, number];
  mouth: [number, number];
  a3: number;
  /** sin of bucket opening direction: >0.32 holds dirt, <0 dumps */
  open: number;
}

export function fk(j: Joints): Pose2 {
  const a1 = j.boom;
  const a2 = a1 - j.phi;
  const a3 = a2 - j.curl;
  const b: [number, number] = [DIM.pivotR + DIM.L1 * Math.cos(a1), DIM.pivotY + DIM.L1 * Math.sin(a1)];
  const s: [number, number] = [b[0] + DIM.L2 * Math.cos(a2), b[1] + DIM.L2 * Math.sin(a2)];
  const t: [number, number] = [s[0] + DIM.L3 * Math.cos(a3), s[1] + DIM.L3 * Math.sin(a3)];
  const o = a3 - Math.PI / 2;
  const m: [number, number] = [s[0] + 0.65 * Math.cos(a3) + 0.1 * Math.cos(o), s[1] + 0.65 * Math.sin(a3) + 0.1 * Math.sin(o)];
  return { boomEnd: b, stickEnd: s, tip: t, mouth: m, a3, open: Math.sin(o) };
}

export interface MachineMesh {
  root: THREE.Group;
  cab: THREE.Group;
  boomG: THREE.Group;
  stickG: THREE.Group;
  bucketG: THREE.Group;
  bucketDirt: THREE.Mesh;
  beacon: THREE.Mesh;
  treadL: THREE.Texture;
  treadR: THREE.Texture;
  headlight: THREE.SpotLight | null;
}

function treadTex() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#25272b';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#44484f';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 32, 8);
  g.fillStyle = '#17181b';
  g.fillRect(0, 0, 3, 64);
  g.fillRect(29, 0, 3, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildExcavator(color: number, headlight: boolean): MachineMesh {
  const lam = (c: number, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const paint = lam(color);
  const paintDark = lam(new THREE.Color(color).multiplyScalar(0.7).getHex());
  const dark = lam(0x2b2d31);
  const steel = lam(0x555a62);
  const glass = lam(0x1d3a5a, { transparent: true, opacity: 0.8 });
  const root = new THREE.Group();

  // undercarriage
  const treadL = treadTex();
  const treadR = treadL.clone();
  treadR.needsUpdate = true;
  const trackGeo = new THREE.BoxGeometry(1.0, 0.95, 4.6);
  for (const [sx, tx] of [[1, treadL], [-1, treadR]] as [number, THREE.Texture][]) {
    const t = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ map: tx }));
    t.position.set(sx * 1.35, 0.48, 0);
    root.add(t);
    const guard = box(1.1, 0.12, 4.6, paintDark, sx * 1.35, 1.0, 0);
    root.add(guard);
  }
  root.add(box(2.0, 0.6, 3.0, dark, 0, 0.8, 0));

  // upper structure
  const cab = new THREE.Group();
  cab.position.y = 0;
  root.add(cab);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 14), steel);
  disc.position.y = 1.15;
  cab.add(disc);
  cab.add(box(3.0, 0.85, 3.8, paint, 0, 1.65, -0.35));
  cab.add(box(2.8, 1.0, 0.9, paintDark, 0, 1.85, -2.2)); // counterweight
  cab.add(box(1.5, 0.8, 1.6, paintDark, -0.65, 2.45, -1.2)); // engine hood
  cab.add(box(1.5, 1.55, 1.7, paint, 0.8, 2.6, 0.3)); // operator cab
  const g1 = box(1.4, 0.9, 0.06, glass, 0.8, 2.85, 1.17);
  const g2 = box(0.06, 0.8, 1.2, glass, 1.56, 2.85, 0.3);
  g1.name = g2.name = 'glass';
  cab.add(g1, g2);
  cab.add(box(1.6, 0.1, 1.8, dark, 0.8, 3.4, 0.3));
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6), dark);
  exhaust.position.set(-1.1, 3.1, -0.9);
  cab.add(exhaust);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0xff9a1a }));
  beacon.position.set(0.8, 3.58, 0.3);
  cab.add(beacon);

  // boom / stick / bucket
  const boomG = new THREE.Group();
  boomG.position.set(0, DIM.pivotY, DIM.pivotR);
  cab.add(boomG);
  boomG.add(box(0.7, 0.8, DIM.L1, paint, 0, 0, DIM.L1 / 2));
  boomG.add(box(0.2, 0.2, DIM.L1 * 0.5, steel, 0, 0.62, DIM.L1 * 0.35));
  const stickG = new THREE.Group();
  stickG.position.z = DIM.L1;
  boomG.add(stickG);
  stickG.add(box(0.45, 0.55, DIM.L2, paintDark, 0, 0, DIM.L2 / 2));
  stickG.add(box(0.16, 0.16, 1.6, steel, 0, 0.42, 0.9));
  const bucketG = new THREE.Group();
  bucketG.position.z = DIM.L2;
  stickG.add(bucketG);
  const bm = lam(0x44474d);
  bucketG.add(box(0.1, 0.8, 1.3, bm, 0.7, 0.2, 0.65));
  bucketG.add(box(0.1, 0.8, 1.3, bm, -0.7, 0.2, 0.65));
  bucketG.add(box(1.5, 0.1, 1.3, bm, 0, 0.58, 0.65));
  bucketG.add(box(1.4, 0.8, 0.1, bm, 0, 0.2, 0.05));
  bucketG.add(box(1.4, 0.08, 0.12, steel, 0, -0.2, 1.3));
  for (let i = -2; i <= 2; i++) bucketG.add(box(0.12, 0.1, 0.28, steel, i * 0.3, -0.18, 1.4));
  const dirtGeo = new THREE.BoxGeometry(1.3, 1, 1.15);
  dirtGeo.translate(0, 0.5, 0);
  const bucketDirt = new THREE.Mesh(dirtGeo, lam(0x7a5230));
  bucketDirt.position.set(0, 0.5, 0.68);
  bucketDirt.scale.y = 0.001;
  bucketDirt.rotation.x = Math.PI; // grows from the back plate toward the opening
  bucketG.add(bucketDirt);

  let spot: THREE.SpotLight | null = null;
  if (headlight) {
    spot = new THREE.SpotLight(0xfff2cc, 120, 40, 0.55, 0.5, 1.2);
    spot.position.set(0.8, 3.3, 1.0);
    spot.target.position.set(0.8, 0, 12);
    cab.add(spot);
    cab.add(spot.target);
  }
  return { root, cab, boomG, stickG, bucketG, bucketDirt, beacon, treadL, treadR, headlight: spot };
}
