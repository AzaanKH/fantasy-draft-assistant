export interface TimestampedObservation {
  readonly informationTimestamp: string | null;
}

/**
 * Date-only sources do not prove what time during the date the information was
 * available. Treat the following midnight as the conservative upper bound.
 */
export function dateOnlyInformationUpperBound(dateOnly: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) {
    throw new Error(`Expected an ISO date, received ${dateOnly}`);
  }

  const timestamp = Date.parse(`${dateOnly}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ISO date: ${dateOnly}`);
  }

  return new Date(timestamp + 86_400_000).toISOString();
}

export function latestAsOf<T extends TimestampedObservation>(
  observations: readonly T[],
  cutoffTimestamp: string
): T | null {
  const cutoff = Date.parse(cutoffTimestamp);
  if (!Number.isFinite(cutoff)) {
    throw new Error(`Invalid cutoff timestamp: ${cutoffTimestamp}`);
  }

  return observations.reduce<T | null>((latest, observation) => {
    if (observation.informationTimestamp === null) return latest;
    const timestamp = Date.parse(observation.informationTimestamp);
    if (!Number.isFinite(timestamp) || timestamp > cutoff) return latest;
    if (latest === null) return observation;

    const latestTimestamp = Date.parse(latest.informationTimestamp ?? '');
    return timestamp > latestTimestamp ? observation : latest;
  }, null);
}

export function assertInformationCutoff(
  informationTimestamp: string | null,
  cutoffTimestamp: string,
  label: string
): void {
  if (informationTimestamp === null) return;
  const informationTime = Date.parse(informationTimestamp);
  const cutoffTime = Date.parse(cutoffTimestamp);
  if (!Number.isFinite(informationTime) || !Number.isFinite(cutoffTime)) {
    throw new Error(`Invalid timestamp while validating ${label}`);
  }
  if (informationTime > cutoffTime) {
    throw new Error(
      `${label} violates as-of cutoff: ${informationTimestamp} > ${cutoffTimestamp}`
    );
  }
}
