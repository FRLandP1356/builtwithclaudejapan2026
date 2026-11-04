// Test-only reference implementation of the scenario rules, written straight from the spec so that it shares
// no code with src/engine except the one-period `step`. Used as an oracle for projectArea.
import { total } from '../../src/engine/aggregate';
import { step } from '../../src/engine/step';
import type { Area, Facility, Pop, Scenario, Series } from '../../src/engine/types';

/**
 * For a period that STARTS in year y >= 2050 the net-migration rate of every age class is
 *   mig * migScale * fade(y) - infraStrength * lost,
 * where fade(y) = max(0, 1 - (y + 5 - 2050) / 50) for 'fade' (1 for 'hold') and `lost` is the number of
 * essential facilities with p50 above the area's own running total population at the start of the period.
 * The child-woman ratio is multiplied by cwrMult for those same periods. Earlier periods are official.
 */
export function referenceProject(area: Area, s: Scenario, facilities: Facility[] = []): Series {
  const periods = area.assumptions;
  if (!periods) throw new Error('reference projection needs assumptions');
  const out: Series = { 2020: { M: area.base.M.slice(), F: area.base.F.slice() } };
  let pop: Pop = area.base;
  for (let y = 2020; y < 2100; y += 5) {
    const a = periods[Math.min((y - 2020) / 5, periods.length - 1)];
    if (y < 2050) {
      pop = step(pop, a);
    } else {
      const fade = s.migMode === 'fade' ? Math.max(0, 1 - (y + 5 - 2050) / 50) : 1;
      let lost = 0;
      if (s.infraStrength > 0) {
        const here = total(pop);
        for (const f of facilities) if (f.essential && here < f.p50) lost++;
      }
      const adjust = (rates: number[]): number[] => rates.map((r) => r * s.migScale * fade - s.infraStrength * lost);
      pop = step(pop, { ...a, mig: { M: adjust(a.mig.M), F: adjust(a.mig.F) } }, s.cwrMult);
    }
    out[y + 5] = pop;
  }
  return out;
}
