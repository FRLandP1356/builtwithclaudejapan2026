// Generic SVG choropleth over one TopoJSON object (prefectures or the municipalities of one prefecture).
//
// - One <path> per area; `update(fill)` only touches the `fill` attribute of paths whose colour changed, so moving
//   the year slider never rebuilds the DOM.
// - Hover, keyboard focus and the selected area are drawn as overlay paths (a paper halo plus an ink/accent stroke)
//   on top of everything, so a neighbour's fill never hides the outline.
// - Every area is a button, but the map is ONE Tab stop (a roving tabindex: the selected area, else the first): the
//   arrow keys move to the nearest area in that direction, PageUp and PageDown to the previous and next area, Home and
//   End to the first and last, Enter or Space drill down, and a tooltip with the numbers follows the pointer or the
//   focused shape.
// - Far-away islands can go into an inset box with its own projection: either a fixed list (Okinawa on the national
//   map) or `'auto'`, which finds the main cluster of shapes by bounding-box gaps and puts the rest in a corner.
import { geoMercator, geoPath, type GeoPath, type GeoProjection } from 'd3';
import type { Feature, FeatureCollection, Geometry, MultiPoint, Position } from 'geojson';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import { feature, mesh } from 'topojson-client';
import { changeColor } from './colors';
import { isNavigationKey, tabStopFor, targetForKey, type Anchor } from './keyboard';

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
  /** Second marker for numbers that include a reallocation (割り振り後), drawn as `.badge-alloc`. */
  allocBadge?: string;
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

/** A small count label drawn on top of an area (the national view's "+n / −n" markers). */
export interface MapMarker {
  code: string;
  text: string;
  kind: 'gain' | 'loss' | 'mixed';
}

export interface Choropleth {
  svg: SVGSVGElement;
  /** Codes of the shapes that were drawn. */
  codes: string[];
  /** Recolour; only changed fills are written. */
  update(fill: (code: string) => string): void;
  /** Outline one area persistently (or none). The selected area becomes the map's Tab stop (none: the first area). */
  setSelected(code?: string): void;
  /** Outline the areas that rose to a facility guide (solid blue) and those that fell below it (dashed rust). */
  setRings(gained: Iterable<string>, lost: Iterable<string>): void;
  /** Place count markers on areas (an empty list removes them). */
  setMarkers(markers: readonly MapMarker[]): void;
  focusArea(code: string): void;
  /** The one area that can be reached with Tab (tabindex 0). */
  tabStop(): string | undefined;
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
// Count markers ("+n −n"): a dot on the place and a label just above it, so the label never covers the place's own
// colour (a small prefecture such as 和歌山県 is about the label's size on a phone). Sizes in screen pixels: the
// marker group is scaled by the inverse of the map's on-screen scale, so it keeps its size when the map shrinks to a
// phone width (the text itself is 12px in app.css).
const MARKER_CHAR_W = 7.5; // advance of one 12px semi-bold digit, sign or space (tabular figures)
const MARKER_PAD_X = 5;
const MARKER_H = 18;
const MARKER_RX = 3;
const MARKER_GAP = 5; // between the dot and the label's bottom edge
const MARKER_DOT_R = 2.5;
const MARKER_BASELINE = 4; // text baseline below the label's centre
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
        tabindex: -1, // the roving tabindex gives 0 to exactly one area once all are drawn
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

  // Keyboard: one Tab stop for the whole map. `anchors` is in Tab (DOM) order, which Home and End follow.
  const codes = [...pathByCode.keys()];
  const anchors: Anchor[] = codes.map((code) => ({ code, x: anchorByCode.get(code)![0], y: anchorByCode.get(code)![1] }));
  let tabStop: string | undefined;
  let selectedCode: string | undefined;
  function setTabStop(code: string | undefined): void {
    if (code === tabStop || (code !== undefined && !pathByCode.has(code))) return;
    if (tabStop !== undefined) pathByCode.get(tabStop)?.setAttribute('tabindex', '-1');
    tabStop = code;
    if (code !== undefined) pathByCode.get(code)?.setAttribute('tabindex', '0');
  }
  setTabStop(tabStopFor(undefined, codes));

  // Overlay rings: halo + stroke for selected, hover and focus.
  const ring = (cls: string) => {
    const halo = svgEl('path', { class: `ring ring-halo ${cls}-halo`, d: '' });
    const line = svgEl('path', { class: `ring ${cls}`, d: '' });
    svg.append(halo, line);
    return (d: string) => {
      halo.setAttribute('d', d);
      line.setAttribute('d', d);
    };
  };
  const setGainRing = ring('ring-gain');
  const setLossRing = ring('ring-loss');
  const setSelectedRing = ring('ring-selected');
  const setHoverRing = ring('ring-hover');
  const setFocusRing = ring('ring-focus');
  const gMarkers = svgEl('g', { class: 'markers', 'aria-hidden': 'true' });
  svg.append(gMarkers);
  let markerNodes: Array<{ g: SVGGElement; x: number; y: number }> = [];

  /** viewBox units per screen pixel (1 while the map is not laid out, e.g. hidden). */
  function unitsPerPixel(): number {
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H); // the viewBox is fitted with "meet"
    return s > 0 && Number.isFinite(s) ? 1 / s : 1;
  }
  function placeMarkers(): void {
    const k = unitsPerPixel().toFixed(3);
    for (const m of markerNodes) m.g.setAttribute('transform', `translate(${m.x.toFixed(1)},${m.y.toFixed(1)}) scale(${k})`);
  }
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (markerNodes.length) placeMarkers();
        })
      : undefined;
  resizeObserver?.observe(svg);

  const joinD = (codes: Iterable<string>): string => {
    let d = '';
    for (const c of codes) {
      const part = dByCode.get(c);
      if (part) d += part;
    }
    return d;
  };

  // Tooltip.
  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const hint = document.createElement('span');
  hint.className = 'sr-only';
  hint.id = `${id}-keys`;
  hint.textContent = '矢印キーで隣の地域へ、PageUpとPageDownで前と次の地域へ、HomeとEndで最初と最後の地域へ移ります。EnterかSpaceで選びます。';
  svg.setAttribute('aria-describedby', hint.id);
  container.append(svg, hint, tip);

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
    if (content.allocBadge) {
      const badge = document.createElement('span');
      badge.className = 'badge-alloc';
      badge.textContent = content.allocBadge;
      if (content.badge) parts.push(document.createTextNode(' '));
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
    const code = codeFromEvent(e);
    if (!code) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      opts.onPick(code);
      return;
    }
    // Arrows, PageUp/PageDown and Home/End rove the focus; a modified key (Alt+Left is "back") belongs to the browser.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!isNavigationKey(e.key)) return;
    e.preventDefault(); // also at an edge: the page must not scroll under the map
    const next = targetForKey(e.key, code, anchors);
    if (next) pathByCode.get(next)?.focus({ preventScroll: true });
  });
  on('focusin', (e) => {
    const code = codeFromEvent(e);
    if (!code) return;
    setTabStop(code);
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
    codes,
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
      if (code === selectedCode) return; // a repeated call must not undo where the keyboard has roved to
      selectedCode = code;
      setTabStop(tabStopFor(code, codes));
    },
    setRings(gained, lost) {
      setGainRing(joinD(gained));
      setLossRing(joinD(lost));
    },
    setMarkers(markers) {
      markerNodes = [];
      for (const m of markers) {
        const anchor = anchorByCode.get(m.code);
        if (!anchor) continue;
        const w = m.text.length * MARKER_CHAR_W + 2 * MARKER_PAD_X;
        const g = svgEl('g', { class: `marker marker-${m.kind}`, 'data-for': m.code });
        const top = -(MARKER_GAP + MARKER_H);
        g.append(svgEl('circle', { class: 'marker-dot', cx: 0, cy: 0, r: MARKER_DOT_R }));
        g.append(svgEl('rect', { x: -w / 2, y: top, width: w, height: MARKER_H, rx: MARKER_RX }));
        const t = svgEl('text', { x: 0, y: top + MARKER_H / 2 + MARKER_BASELINE, 'text-anchor': 'middle' });
        t.textContent = m.text;
        g.append(t);
        markerNodes.push({ g, x: anchor[0], y: anchor[1] });
      }
      placeMarkers();
      gMarkers.replaceChildren(...markerNodes.map((m) => m.g));
    },
    focusArea(code) {
      pathByCode.get(code)?.focus({ preventScroll: true });
    },
    tabStop: () => tabStop,
    clearHover,
    refresh() {
      for (const [code, p] of pathByCode) p.setAttribute('aria-label', opts.ariaLabel(code, nameByCode.get(code) ?? code));
      const open = hoverCode ?? focusCode;
      if (open && !tip.hidden) renderTip(open);
    },
    destroy() {
      ac.abort();
      resizeObserver?.disconnect();
      hoverCode = undefined;
      focusCode = undefined;
      svg.remove();
      tip.remove();
    },
  };
}
