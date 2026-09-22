import { z } from "zod";

export const PeriodFields = z.object({
  startYear: z.number().int().min(1800).max(3000),
  endYear: z.number().int().min(1800).max(3000),
});
export const Period = PeriodFields.refine((p) => p.startYear <= p.endYear, "Período inválido");
export type ExplorationPeriod = z.infer<typeof Period>;

export function temporalSplit(period: ExplorationPeriod, minYear: number, maxYear: number) {
  return {
    explorationPeriod: period,
    validationCutoff: period.endYear,
    training: { startYear: minYear, endYear: period.endYear },
    holdout: { startYear: period.endYear + 1, endYear: maxYear },
  };
}
