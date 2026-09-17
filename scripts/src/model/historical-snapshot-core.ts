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
