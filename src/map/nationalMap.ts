// National view: the 47 prefectures. The main islands are fitted to a fixed extent (Tokyo's geometry reaches
// 南鳥島 at 154°E and Kagoshima's to 27°N, which would shrink Honshu to a sliver if the data bounds were used);
// Okinawa is drawn in an inset at the top left, as Japanese atlases do.
import { mountChoropleth, type Choropleth, type ChoroplethOptions, type Extent } from './choropleth';

/** Hokkaido to Yakushima/Tanegashima, Tsushima to Nemuro, with a little sea around them. */
export const JAPAN_MAIN_EXTENT: Extent = [
  [127.8, 30.2],
  [147.0, 45.8],
];
/** Okinawa main island with the Kerama and Kume islands. */
export const OKINAWA_EXTENT: Extent = [
  [126.6, 26.0],
  [128.4, 27.1],
];
export const OKINAWA_CODE = '47';

export type NationalMapOptions = Omit<ChoroplethOptions, 'objectName' | 'extent' | 'inset'>;

export function mountNationalMap(container: HTMLElement, opts: NationalMapOptions): Choropleth {
  return mountChoropleth(container, {
    ...opts,
    objectName: 'prefectures',
    extent: JAPAN_MAIN_EXTENT,
    inset: { codes: [OKINAWA_CODE], extent: OKINAWA_EXTENT, corner: 'top-left', size: [0.27, 0.22] },
  });
}
