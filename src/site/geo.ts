// Map shapes for the site's pages: SVG path strings made from the TopoJSON files (public/data/geo/). Pure.
//
// Projection: equirectangular with cos(36°) on longitude, the whole country in a 1000-high frame; Okinawa's main
// island is moved into an inset box north-west of Kyushu, as atlases do. The shapes are simplified for the screen and
// are not for surveying (the sources page says so).
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { feature } from 'topojson-client';

const COS = Math.cos((36 * Math.PI) / 180);
const LON0 = 128.6;
const LON1 = 146.2;
const LAT0 = 30.0;
const LAT1 = 45.8;
const SCALE = 1000 / (LAT1 - LAT0);
export const FRAME_W = Math.round((LON1 - LON0) * COS * SCALE);
export const FRAME_H = 1000;
const OKI_SHIFT: [number, number] = [4.6, 11.4];
export const OKINAWA = '47';

export type BBox = [number, number, number, number];

export interface ShapeOut {
  code: string;
  name: string;
  d: string;
  bb: BBox;
  /** Centre of the largest ring, in frame coordinates. */
  c: [number, number];
}

/** Lon/lat to frame coordinates. Okinawa (code 47) is shifted into its inset. */
export function project(lon: number, lat: number, code?: string): [number, number] {
  if (code === OKINAWA) {
    lon += OKI_SHIFT[0];
    lat += OKI_SHIFT[1];
  }
  return [(lon - LON0) * COS * SCALE, (LAT1 - lat) * SCALE];
}

function rings(geom: Geometry): Position[][] {
  if (geom.type === 'Polygon') return [(geom as Polygon).coordinates[0]];
  if (geom.type === 'MultiPolygon') return (geom as MultiPolygon).coordinates.map((poly) => poly[0]);
  return [];
}

function decimate(pts: Position[], step: number): Position[] {
  if (step <= 1 || pts.length <= 8) return pts;
  const out: Position[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

interface PathOptions {
  step: number;
  minArea: number;
  keep?: (lon: number, lat: number) => boolean;
  code?: string;
}

function pathOf(geom: Geometry, o: PathOptions): { d: string; bb: BBox; c: [number, number] } {
  const parts: string[] = [];
  const bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  let best: Position[] | undefined;
  for (const ring of rings(geom)) {
    if (o.keep && !ring.some(([lo, la]) => o.keep!(lo, la))) continue;
    const pts = decimate(ring, o.step).map(([lo, la]) => project(lo, la, o.code));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if ((x1 - x0) * (y1 - y0) < o.minArea) continue;
    bb[0] = Math.min(bb[0], x0);
    bb[1] = Math.min(bb[1], y0);
    bb[2] = Math.max(bb[2], x1);
    bb[3] = Math.max(bb[3], y1);
    if (!best || ring.length > best.length) best = ring;
    parts.push(`M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}Z`);
  }
  let c: [number, number] = [NaN, NaN];
  if (best) {
    let lo = 0, la = 0;
    for (const p of best) {
      lo += p[0];
      la += p[1];
    }
    c = project(lo / best.length, la / best.length, o.code);
    c = [Math.round(c[0]), Math.round(c[1])];
  }
  if (!Number.isFinite(bb[0])) return { d: '', bb: [0, 0, 0, 0], c };
  return { d: parts.join(''), bb: [Math.round(bb[0]), Math.round(bb[1]), Math.round(bb[2]), Math.round(bb[3])], c };
}

function features(topo: Topology, objectName: string): Array<Feature<Geometry, { code: string; name: string }>> {
  const obj = topo.objects[objectName] as GeometryCollection | undefined;
  if (!obj) throw new Error(`geo: object ${objectName} is not in the topology`);
  const fc = feature(topo, obj);
  return fc.features as Array<Feature<Geometry, { code: string; name: string }>>;
}

/** The 47 prefectures in the national frame (Okinawa in its inset; far islands outside the frame are dropped). */
export function prefectureShapes(japanTopo: Topology): ShapeOut[] {
  return features(japanTopo, 'prefectures').map((f) => {
    const code = f.properties.code;
    const keep =
      code === OKINAWA
        ? (lo: number, la: number) => lo >= 126.6 && lo <= 128.4 && la >= 26.0 && la <= 27.0
        : (lo: number, la: number) => lo >= LON0 && lo <= LON1 && la >= LAT0 && la <= LAT1;
    const p = pathOf(f.geometry, { step: 2, minArea: 36, keep, code });
    return { code, name: f.properties.name, ...p };
  });
}

/**
 * The municipalities of one prefecture, in the same frame (so the national shapes and the town shapes line up).
 * Towns far from every other town of the prefecture (remote islands) are left out of the drawing, so the mainland
 * stays legible; they keep their figures everywhere else.
 */
export function townShapes(prefTopo: Topology, prefCode: string): ShapeOut[] {
  const all = features(prefTopo, 'areas').map((f) => {
    const p = pathOf(f.geometry, { step: 1, minArea: 1, code: prefCode === OKINAWA ? OKINAWA : undefined });
    return { code: f.properties.code, name: f.properties.name, ...p };
  });
  const FAR = 1.5 * SCALE * COS; // about 1.5 degrees in frame units
  return all.filter((t) => {
    if (!Number.isFinite(t.c[0])) return false;
    let nearest = Infinity;
    for (const o of all) {
      if (o === t || !Number.isFinite(o.c[0])) continue;
      nearest = Math.min(nearest, Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1]));
    }
    return nearest <= FAR || all.length === 1;
  });
}

/** Union of bounding boxes. */
export function unionBB(list: readonly ShapeOut[]): BBox {
  const bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of list) {
    if (!s.d) continue;
    bb[0] = Math.min(bb[0], s.bb[0]);
    bb[1] = Math.min(bb[1], s.bb[1]);
    bb[2] = Math.max(bb[2], s.bb[2]);
    bb[3] = Math.max(bb[3], s.bb[3]);
  }
  return bb;
}

/** A viewBox string around a bounding box, aspect 1:0.9, with padding in frame units. */
export function viewBoxOf(bb: BBox, pad = 20): { vb: string; w: number } {
  const w = bb[2] - bb[0] + pad * 2;
  const h = bb[3] - bb[1] + pad * 2;
  const s = Math.max(w, h * 0.9);
  const cx = (bb[0] + bb[2]) / 2;
  const cy = (bb[1] + bb[3]) / 2;
  return { vb: `${cx - s / 2} ${cy - s / 2 / 0.9} ${s} ${s / 0.9}`, w: s };
}
