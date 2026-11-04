// Service-facility status of a municipality, from the MLIT population thresholds (50% / 80% presence).
import type { Facility } from './types';

export type Status = 'ok' | 'edge' | 'below';

/**
 * Status of one facility for a population `pop`:
 * - `ok`    pop >= p80 (the facility is present in at least 80% of municipalities this size)
 * - `edge`  p50 <= pop < p80
 * - `below` pop < p50
 *
 * A row with p50 == p80 has no `edge` band: pop >= p50 is `ok`, anything smaller is `below`.
 * `pop` is used as given (not rounded), so 499.9 people is below a threshold of 500. A negative population
 * (for example floating-point noise just under 0) is simply below; NaN is a caller bug and throws a RangeError.
 */
export function facilityStatus(pop: number, f: Facility): Status {
  if (Number.isNaN(pop)) throw new RangeError('facilityStatus: population is NaN');
  if (pop >= f.p80) return 'ok';
  if (pop >= f.p50) return 'edge';
  return 'below';
}

/** How many of the `essential` facilities are `below` for a population `pop`. */
export function lostEssentialCount(pop: number, facilities: Facility[]): number {
  let lost = 0;
  for (const f of facilities) {
    if (f.essential && facilityStatus(pop, f) === 'below') lost++;
  }
  return lost;
}
