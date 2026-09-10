import { z } from 'zod';
import { periodShape } from '../../../../packages/domain/periods';
export const jobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SYNC_ITEM'), itemId: z.string() }),
  z.object({ type: z.literal('REFRESH_ACCOUNTS'), itemId: z.string() }),
  z.object({ type: z.literal('REBUILD_AGGREGATES') }),
  z.object({ type: z.literal('DETECT_RECURRING') }),
  z.object({ type: z.literal('RUN_DATA_HEALTH_CHECK') }),
  z.object({
    type: z.literal('GENERATE_REPORT'),
    reportType: z.enum(['weekly', 'monthly']),
    period: z.object(periodShape),
  }),
]);
export type FinanceJob = z.infer<typeof jobSchema>;
