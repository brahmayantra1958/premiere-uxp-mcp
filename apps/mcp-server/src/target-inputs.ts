/** Discovery is intentionally unpinned; subsequent operations bind to IDs. A project-item label is not Sequence.name, so the optional name is an additional observed guard, never an ID substitute. */
import { z } from 'zod/v4';

/** Discovery is unpinned; subsequent contextual operations bind to these IDs. */
export const targetInputs = {
  expectedProjectId: z.string().min(1),
  expectedSequenceId: z.string().min(1),
  expectedSequenceName: z.string().min(1).optional(),
};
