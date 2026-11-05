/** Runtime-owned purpose for a job's full baseline/final content verification.
 * It changes navigation only. Public targeted reads and native proof routes
 * retain their own follow; this purpose never applies to a content command. */
export const JOB_PRESERVATION_READ = 'job_preservation' as const;
export type BridgeReadPurpose = typeof JOB_PRESERVATION_READ;

export function isJobPreservationRead(command: string, purpose: unknown): purpose is BridgeReadPurpose {
  return command === 'query_timeline' && purpose === JOB_PRESERVATION_READ;
}
