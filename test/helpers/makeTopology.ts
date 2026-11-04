// Test-only: a tiny TopoJSON topology of unit squares, one per item, for UI tests that mount maps in jsdom.
import type { Topology } from 'topojson-specification';

export interface TopoItem {
  code: string;
  name: string;
}

/** One 1-degree square per item in a row starting at 135E 35N; object `objectName`, properties { code, name }. */
export function makeTopology(objectName: string, items: TopoItem[]): Topology {
  const arcs: number[][][] = [];
  const geometries = items.map((it, i) => {
    const x = 135 + i * 1.5;
    const y = 35;
    arcs.push([
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ]);
    return { type: 'Polygon', arcs: [[i]], properties: { code: it.code, name: it.name } };
  });
  return { type: 'Topology', objects: { [objectName]: { type: 'GeometryCollection', geometries } }, arcs } as unknown as Topology;
}
