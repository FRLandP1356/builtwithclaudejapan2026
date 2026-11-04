// Prefecture view: the municipalities of one prefecture. Shapes far from the main cluster (Tokyo's islands,
// the Amami islands, the Sakishima islands) go into an automatic inset so the mainland stays legible.
import { mountChoropleth, type Choropleth, type ChoroplethOptions } from './choropleth';

export type PrefectureMapOptions = Omit<ChoroplethOptions, 'objectName' | 'extent' | 'inset'>;

export function mountPrefectureMap(container: HTMLElement, opts: PrefectureMapOptions): Choropleth {
  return mountChoropleth(container, { ...opts, objectName: 'areas', inset: 'auto' });
}
