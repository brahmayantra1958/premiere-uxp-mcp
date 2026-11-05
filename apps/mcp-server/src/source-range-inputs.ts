import { z } from 'zod/v4';
import { seconds } from './tool-inputs.js';

export const sourceRangeInput = z.object({ inPointSeconds: seconds, outPointSeconds: seconds })
  .refine(range => range.outPointSeconds > range.inPointSeconds, 'Source out must follow source in');
export const sourceMappingInput = z.object({ originalPath: z.string().regex(/^(?:[a-z]:[\\/]|\/|\\\\)/i, 'Original path must be absolute'), originalStartSeconds: seconds,
  originalEndSeconds: seconds, originalDurationSeconds: z.number().finite().positive().optional() })
  .refine(value => value.originalEndSeconds > value.originalStartSeconds && (value.originalDurationSeconds === undefined || value.originalEndSeconds <= value.originalDurationSeconds), 'Source mapping must lie within the original file');
export const renderChecksInput = z.array(z.object({ timeSeconds: seconds, expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(10).optional();
