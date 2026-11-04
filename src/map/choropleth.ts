// Generic SVG choropleth over one TopoJSON object (prefectures or the municipalities of one prefecture).
//
// - One <path> per area; `update(fill)` only touches the `fill` attribute of paths whose colour changed, so moving
//   the year slider never rebuilds the DOM.
// - Hover, keyboard focus and the selected area are drawn as overlay paths (a paper halo plus an ink/accent stroke)
//   on top of everything, so a neighbour's fill never hides the outline.
// - Every area is a focusable button: Tab moves between areas, Enter or Space drills down, a tooltip with the
//   numbers follows the pointer or the focused shape.
// - Far-away islands can go into an inset box with its own projection: either a fixed list (Okinawa on the national
//   map) or `'auto'`, which finds the main cluster of shapes by bounding-box gaps and puts the rest in a corner.
import { geoMercator, geoPath, type GeoPath, type GeoProjection } from 'd3';
import type { Feature, FeatureCollection, Geometry, MultiPoint, Position } from 'geojson';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import { feature, mesh } from 'topojson-client';
import { changeColor } from './colors';

export interface AreaProps {
  code: string;
  name: string;
}
export type LonLat = [number, number];
/** [[lonMin, latMin], [lonMax, latMax]] */
export type Extent = [LonLat, LonLat];
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface InsetSpec {
  codes: string[];
  /** Fixed geographic extent for the inset; defaults to the inset shapes' own bounds. */
  extent?: Extent;
  /** Where the box goes; defaults to the emptiest corner. */
  corner?: Corner;
  /** Box size as fractions of the map width and height. */
  size?: [number, number];
  label?: string;
}

export interface TooltipContent {
  title: string;
  lines: string[];
  /** Small dashed marker text (e.g. 試算) appended to the tooltip. */
  badge?: string;
}

export interface ChoroplethOptions {
  topology: Topology;
  objectName: string;
  /** Fixed geographic extent for the main view; defaults to the bounds of the main shapes. */
  extent?: Extent;
  inset?: InsetSpec | 'auto';
  /** viewBox width; the height follows the projected aspect (clamped). */
  width?: number;
  /** aria-label of the whole map. */
  label: string;
  ariaLabel(code: string, name: string): string;
  tooltip(code: string, name: string): TooltipContent | null;
  onPick(code: string): void;
}

export interface Choropleth {
  svg: SVGSVGElement;
  /** Codes of the shapes that were drawn. */
  codes: string[];
  /** Recolour; only changed fills are written. */
  update(fill: (code: string) => string): void;
  /** Outline one area persistently (or none). */
  setSelected(code?: string): void;
  focusArea(code: string): void;
  /** Drop the hover state and hide the tooltip (call when the map is hidden or replaced). */
  clearHover(): void;
  /** Re-read aria labels and the open tooltip (after the year or the data changed). */
  refresh(): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 12;
const INSET_PAD = 10;
const CLUSTER_GAP_DEG = 0.6;
let uid = 0;

type Box = [number, number, number, number]; // lonMin, latMin, lonMax, latMax
type AreaFeature = Feature<Geometry, AreaProps>;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function walkPositions(coords: unknown, visit: (p: Position) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') visit(coords as Position);
  else for (const c of coords) walkPositions(c, visit);
}

function bboxOfRing(ring: Position[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  walkPositions(ring, ([x, y]) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  });
  return b;
}

/** Unsigned shoelace area of a ring in degrees squared (only used to compare parts). */
function ringArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

function boxesTouch(a: Box, b: Box, gap: number): boolean {
  return a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3];
}

/** One polygon of a feature (a MultiPolygon has several: the mainland part, each island). */
interface Part {
  fi: number;
  box: Box;
  area: number;
  polygon: Position[][];
}

function partsOf(features: AreaFeature[]): Part[] {
  const parts: Part[] = [];
  features.forEach((f, fi) => {
    const g = f.geometry;
    const polygons: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer || outer.length < 3) continue;
      parts.push({ fi, box: bboxOfRing(outer), area: ringArea(outer), polygon });
    }
  });
  return parts;
}

interface Clustering {
  /** Geographic box of the main group of polygon parts. */
  mainBox: Box;
  /** Features that have at least one part in the main group. */
  mainFeatures: Set<number>;
  /** Largest part of every feature, for tooltip anchors. */
  largestPart: Map<number, Part>;
}

/**
 * Group polygon parts whose bounding boxes chain together within `gap` degrees; the group with the largest
 * total area is the main view. A municipality stays in the main view when any of its parts does (its far
 * islets are clipped); a municipality with no part in the main group goes to the inset.
 */
function clusterParts(features: AreaFeature[], gap: number): Clustering {
  const parts = partsOf(features);
  const n = parts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (boxesTouch(parts[i].box, parts[j].box, gap)) parent[find(i)] = find(j);
    }
  }
  const areaByRoot = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    areaByRoot.set(r, (areaByRoot.get(r) ?? 0) + parts[i].area);
  }
  let bestRoot = -1;
  let bestArea = -1;
  for (const [r, a] of areaByRoot) {
    if (a > bestArea) {
      bestArea = a;
      bestRoot = r;
    }
  }
  const mainBox: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const mainFeatures = new Set<number>();
  const largestPart = new Map<number, Part>();
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    const big = largestPart.get(p.fi);
    if (!big || p.area > big.area) largestPart.set(p.fi, p);
    if (find(i) !== bestRoot) continue;
    mainFeatures.add(p.fi);
    mainBox[0] = Math.min(mainBox[0], p.box[0]);
    mainBox[1] = Math.min(mainBox[1], p.box[1]);
    mainBox[2] = Math.max(mainBox[2], p.box[2]);
    mainBox[3] = Math.max(mainBox[3], p.box[3]);
  }
  return { mainBox, mainFeatures, largestPart };
}

/** The largest polygon of a feature as its own feature (tooltip anchor; the islets are ignored). */
function largestPolygonFeature(f: AreaFeature, largest: Part | undefined): AreaFeature {
  if (!largest) return f;
  return { type: 'Feature', properties: f.properties, geometry: { type: 'Polygon', coordinates: largest.polygon } };
}

function extentPoints(extent: Extent): MultiPoint {
  const [[x0, y0], [x1, y1]] = extent;
  return { type: 'MultiPoint', coordinates: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cornerRect(corner: Corner, W: number, H: number, w: number, h: number): Rect {
  const x = corner.endsWith('left') ? PAD : W - PAD - w;
  const y = corner.startsWith('top') ? PAD : H - PAD - h;
  return { x, y, w, h };
}

/** The corner whose box covers the fewest main shapes (by projected centroid). */
function emptiestCorner(path: GeoPath, mainFeatures: AreaFeature[], W: number, H: number, w: number, h: number): Corner {
  const centroids = mainFeatures.map((f) => path.centroid(f));
  const order: Corner[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
  let best: Corner = order[0];
  let bestCount = Infinity;
  for (const c of order) {
    const r = cornerRect(c, W, H, w, h);
    let count = 0;
    for (const [cx, cy] of centroids) if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) count++;
    if (count < bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function codeOf(g: GeometryObject): string {
  const p = g.properties as Partial<AreaProps> | undefined;
  return p?.code ?? '';
}

export function mountChoropleth(container: HTMLElement, opts: ChoroplethOptions): Choropleth {
  const W = opts.width ?? 720;
  const id = `map${++uid}`;
  const object = opts.topology.objects[opts.objectName] as GeometryCollection<AreaProps> | undefined;
  if (!object) throw new Error(`mountChoropleth: object "${opts.objectName}" not in topology`);
  const fc = feature(opts.topology, object) as FeatureCollection<Geometry, AreaProps>;
  const all = fc.features.filter((f) => f.geometry && f.properties?.code);

  // Split into main shapes and inset shapes.
  const clustering = clusterParts(all, CLUSTER_GAP_DEG);
  let insetSpec: InsetSpec | undefined;
  let mainExtent: Extent | undefined = opts.extent;
  if (opts.inset === 'auto') {
    const codes = all.filter((_, i) => !clustering.mainFeatures.has(i)).map((f) => f.properties.code);
    if (codes.length) insetSpec = { codes, label: '離島は別の縮尺' };
    const [x0, y0, x1, y1] = clustering.mainBox;
    if (!mainExtent && Number.isFinite(x0)) mainExtent = [[x0, y0], [x1, y1]];
  } else if (opts.inset) {
    insetSpec = opts.inset;
  }
  const insetCodes = new Set(insetSpec?.codes ?? []);
  const mainFeatures = all.filter((f) => !insetCodes.has(f.properties.code));
  const insetFeatures = all.filter((f) => insetCodes.has(f.properties.code));
  const mainFC: FeatureCollection<Geometry, AreaProps> = { type: 'FeatureCollection', features: mainFeatures };

  // Main projection: fit, read the aspect, size the viewBox, fit again with padding.
  const fitObj = mainExtent ? extentPoints(mainExtent) : mainFC;
  const proj: GeoProjection = geoMercator();
  proj.fitSize([W, W], fitObj);
  const b0 = geoPath(proj).bounds(fitObj);
  const aspect = (b0[1][1] - b0[0][1]) / Math.max(1e-9, b0[1][0] - b0[0][0]);
  const H = Math.round(W * clamp(aspect, 0.6, 1.1));
  proj.fitExtent([[PAD, PAD], [W - PAD, H - PAD]], fitObj);
  const path = geoPath(proj);

  // Inset projection and box.
  let insetRect: Rect | undefined;
  let insetPath: GeoPath | undefined;
  if (insetSpec && insetFeatures.length) {
    const [fw, fh] = insetSpec.size ?? [0.3, 0.3];
    const w = Math.round(W * fw);
    const h = Math.round(H * fh);
    const corner = insetSpec.corner ?? emptiestCorner(path, mainFeatures, W, H, w, h);
    insetRect = cornerRect(corner, W, H, w, h);
    const insetFC: FeatureCollection<Geometry, AreaProps> = { type: 'FeatureCollection', features: insetFeatures };
    const iproj = geoMercator();
    iproj.fitExtent(
      [
        [insetRect.x + INSET_PAD, insetRect.y + INSET_PAD],
        [insetRect.x + insetRect.w - INSET_PAD, insetRect.y + insetRect.h - INSET_PAD],
      ],
      insetSpec.extent ? extentPoints(insetSpec.extent) : insetFC,
    );
    insetPath = geoPath(iproj);
  }

  // Build the SVG.
  // tabindex -1: Chromium otherwise gives the SVG root its own tab stop before the first area.
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map-svg', role: 'group', 'aria-label': opts.label, tabindex: -1 });
  const defs = svgEl('defs');
  svg.append(defs);

  const pathByCode = new Map<string, SVGPathElement>();
  const dByCode = new Map<string, string>();
  const nameByCode = new Map<string, string>();
  const anchorByCode = new Map<string, [number, number]>(); // viewBox coordinates of the largest polygon's centroid
  const lastFill = new Map<string, string>();
  const neutral = changeColor(1);
  const indexByFeature = new Map(all.map((f, i) => [f, i] as const));

  function drawGroup(features: AreaFeature[], gen: GeoPath, inMain: boolean, parent: SVGGElement): void {
    const gAreas = svgEl('g', { class: 'areas' });
    for (const f of features) {
      const d = gen(f);
      if (!d) continue;
      const { code, name } = f.properties;
      anchorByCode.set(code, gen.centroid(largestPolygonFeature(f, clustering.largestPart.get(indexByFeature.get(f)!))));
      const p = svgEl('path', {
        d,
        class: 'area',
        fill: neutral,
        'data-code': code,
        tabindex: 0,
        role: 'button',
        'aria-label': opts.ariaLabel(code, name),
      });
      gAreas.append(p);
      pathByCode.set(code, p);
      dByCode.set(code, d);
      nameByCode.set(code, name);
      lastFill.set(code, neutral);
    }
    parent.append(gAreas);
    const inGroup = (g: GeometryObject) => insetCodes.has(codeOf(g)) !== inMain;
    const interior = mesh(opts.topology, object, (a, b) => a !== b && inGroup(a) && inGroup(b));
    const coast = mesh(opts.topology, object, (a, b) => a === b && inGroup(a));
    parent.append(svgEl('path', { d: gen(interior) ?? '', class: 'mesh' }), svgEl('path', { d: gen(coast) ?? '', class: 'coast' }));
    if (!inMain) {
      // Tiny islands get a ring so they can be seen and tapped.
      for (const f of features) {
        const [[x0, y0], [x1, y1]] = gen.bounds(f);
        if (Math.max(x1 - x0, y1 - y0) < 10) {
          const [cx, cy] = gen.centroid(f);
          gAreas.append(svgEl('circle', { cx, cy, r: 8, class: 'hit', 'data-code': f.properties.code, 'aria-hidden': 'true' }));
        }
      }
    }
  }

  const gMain = svgEl('g', { class: 'map-main' });
  drawGroup(mainFeatures, path, true, gMain);
  svg.append(gMain);

  if (insetRect && insetPath) {
    const clip = svgEl('clipPath', { id: `${id}-clip` });
    clip.append(svgEl('rect', { x: insetRect.x, y: insetRect.y, width: insetRect.w, height: insetRect.h }));
    defs.append(clip);
    const gInset = svgEl('g', { class: 'map-inset', 'clip-path': `url(#${id}-clip)` });
    gInset.append(svgEl('rect', { x: insetRect.x, y: insetRect.y, width: insetRect.w, height: insetRect.h, class: 'inset-bg' }));
    drawGroup(insetFeatures, insetPath, false, gInset);
    svg.append(gInset);
    svg.append(svgEl('rect', { x: insetRect.x, y: insetRect.y, width: insetRect.w, height: insetRect.h, class: 'inset-frame' }));
    if (insetSpec?.label) {
      const t = svgEl('text', { x: insetRect.x + 6, y: insetRect.y + insetRect.h - 6, class: 'inset-label' });
      t.textContent = insetSpec.label;
      svg.append(t);
    }
  }

  // Overlay rings: halo + stroke for selected, hover and focus.
  const ring = (cls: string) => {
    const halo = svgEl('path', { class: 'ring ring-halo', d: '' });
    const line = svgEl('path', { class: `ring ${cls}`, d: '' });
    svg.append(halo, line);
    return (d: string) => {
      halo.setAttribute('d', d);
      line.setAttribute('d', d);
    };
  };
  const setSelectedRing = ring('ring-selected');
  const setHoverRing = ring('ring-hover');
  const setFocusRing = ring('ring-focus');

  // Tooltip.
  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  container.append(svg, tip);

  let hoverCode: string | undefined;
  let focusCode: string | undefined;

  function renderTip(code: string): boolean {
    const content = opts.tooltip(code, nameByCode.get(code) ?? code);
    if (!content) {
      tip.hidden = true;
      return false;
    }
    const title = document.createElement('b');
    title.textContent = content.title;
    const parts: Node[] = [title];
    for (const line of content.lines) {
      const div = document.createElement('div');
      div.textContent = line;
      parts.push(div);
    }
    if (content.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge-estimate';
      badge.textContent = content.badge;
      parts.push(badge);
    }
    tip.replaceChildren(...parts);
    tip.hidden = false;
    return true;
  }

  function placeTip(x: number, y: number): void {
    // x, y are container-relative; prefer above-right of the point, clamp inside the container.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = x + 14;
    let top = y - th - 10;
    if (left + tw > cw - 4) left = Math.max(4, x - tw - 14);
    if (top < 4) top = Math.min(ch - th - 4, y + 18);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  /** Place the tooltip at an area's anchor (the centroid of its largest polygon, so far-off islets do not pull it away). */
  function placeTipAt(code: string, el: Element): void {
    const r = container.getBoundingClientRect();
    const anchor = anchorByCode.get(code);
    const ctm = typeof DOMPoint === 'function' ? svg.getScreenCTM?.() : null; // absent in jsdom
    if (anchor && ctm) {
      const p = new DOMPoint(anchor[0], anchor[1]).matrixTransform(ctm);
      placeTip(p.x - r.left, p.y - r.top - 8);
      return;
    }
    const b = el.getBoundingClientRect();
    placeTip(b.left + b.width / 2 - r.left, b.top - r.top);
  }

  function codeFromEvent(e: Event): string | undefined {
    const t = e.target as Element | null;
    const hit = t?.closest?.('[data-code]');
    return hit?.getAttribute('data-code') ?? undefined;
  }

  const ac = new AbortController();
  const on = <K extends keyof SVGSVGElementEventMap>(type: K, fn: (e: SVGSVGElementEventMap[K]) => void) =>
    svg.addEventListener(type, fn, { signal: ac.signal });

  on('pointerover', (e) => {
    const code = codeFromEvent(e);
    if (!code || code === hoverCode) return;
    hoverCode = code;
    setHoverRing(dByCode.get(code) ?? '');
    if (renderTip(code)) {
      const r = container.getBoundingClientRect();
      placeTip(e.clientX - r.left, e.clientY - r.top);
    }
  });
  on('pointermove', (e) => {
    if (!hoverCode || tip.hidden) return;
    const r = container.getBoundingClientRect();
    placeTip(e.clientX - r.left, e.clientY - r.top);
  });
  function clearHover(): void {
    hoverCode = undefined;
    setHoverRing('');
    if (focusCode) {
      renderTip(focusCode);
      placeTipAt(focusCode, pathByCode.get(focusCode)!);
    } else tip.hidden = true;
  }

  on('pointerleave', clearHover);
  on('click', (e) => {
    const code = codeFromEvent(e);
    if (code) opts.onPick(code);
  });
  on('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const code = codeFromEvent(e);
    if (!code) return;
    e.preventDefault();
    opts.onPick(code);
  });
  on('focusin', (e) => {
    const code = codeFromEvent(e);
    if (!code) return;
    focusCode = code;
    setFocusRing(dByCode.get(code) ?? '');
    if (renderTip(code)) placeTipAt(code, e.target as Element);
  });
  on('focusout', () => {
    focusCode = undefined;
    setFocusRing('');
    if (!hoverCode) tip.hidden = true;
  });

  return {
    svg,
    codes: [...pathByCode.keys()],
    update(fill) {
      for (const [code, p] of pathByCode) {
        const c = fill(code);
        if (lastFill.get(code) !== c) {
          p.setAttribute('fill', c);
          lastFill.set(code, c);
        }
      }
    },
    setSelected(code) {
      setSelectedRing((code && dByCode.get(code)) || '');
    },
    focusArea(code) {
      pathByCode.get(code)?.focus({ preventScroll: true });
    },
    clearHover,
    refresh() {
      for (const [code, p] of pathByCode) p.setAttribute('aria-label', opts.ariaLabel(code, nameByCode.get(code) ?? code));
      const open = hoverCode ?? focusCode;
      if (open && !tip.hidden) renderTip(open);
    },
    destroy() {
      ac.abort();
      hoverCode = undefined;
      focusCode = undefined;
      svg.remove();
      tip.remove();
    },
  };
}
