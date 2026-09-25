/** Presentation is distinct from the original persisted lifecycle status. */
export interface DisplayOutcome {
  code: string;
  label: string;
}
export function displayOutcome(status: string, error: string | null): DisplayOutcome {
  if (status === 'failed' && error === 'usage_limit_exceeded')
    return { code: 'usage-exceeded', label: 'Usage exceeded' };
  const labels: Record<string, string> = {
    running: 'Running',
    stopping: 'Stopping point',
    completed: 'Completed',
    interrupted: 'Interrupted',
    failed: 'Failed',
    unknown: 'Unknown',
  };
  if (!Object.prototype.hasOwnProperty.call(labels, status))
    return { code: 'unknown', label: 'Unknown' };
  return { code: status, label: labels[status] ?? 'Unknown' };
}
