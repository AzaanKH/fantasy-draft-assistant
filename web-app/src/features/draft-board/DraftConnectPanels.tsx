/**
 * Freshness, sync-detail, and readiness panels shown by the draft connection
 * card, strip, and dialog. Presentational only: state stays in DraftConnect.
 */
import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MotionExpandable } from '@/components/motion';
import { Button } from '@/components/ui/button';
import {
  formatDraftReadinessTimestamp,
  type DraftReadinessReport,
} from '@fantasy-draft/shared/catalog';
import type { LeagueSettings } from '@fantasy-draft/shared/league';
import { cn } from '@/lib/utils';
import type { DataFreshnessItem } from '@/lib/data-freshness';
import {
  formatRelativeAge,
  formatTimestamp,
  getOldestTimestamp,
  marketFreshnessTone,
  type ConfidenceTone,
} from './draft-connect-parsing';

type DegradedSignals = DraftReadinessReport['optionalSignalDegradations'];

export function DataConfidenceItem({
  children,
  title,
  tone,
}: {
  children: React.ReactNode;
  title?: string;
  tone: ConfidenceTone;
}): React.ReactElement {
  const dotClass = {
    neutral: 'bg-muted-foreground/60',
    good: 'bg-green-600',
    warn: 'bg-warning',
    bad: 'bg-danger',
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      <span>{children}</span>
    </span>
  );
}

export function SyncDetail({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function scoringSummary(leagueSettings: LeagueSettings): string {
  return [
    `${String(leagueSettings.scoringRules.passing.touchdown)}/pass TD`,
    `${String(leagueSettings.scoringRules.receiving.reception)} PPR`,
    leagueSettings.scoringRules.receiving.tePremium > 0
      ? `TE +${String(leagueSettings.scoringRules.receiving.tePremium)}/rec`
      : null,
    leagueSettings.scoringRules.rushing.attemptBonus > 0
      ? `rush +${String(leagueSettings.scoringRules.rushing.attemptBonus)}/att`
      : null,
  ].filter((value): value is string => value !== null).join(' · ');
}

export interface SyncConfidence {
  readonly tone: ConfidenceTone;
  readonly label: string;
}

/** The row of freshness dots on the connection card. */
export function DataConfidenceSummary({
  sync,
  now,
  fantasyProsRefreshedAt,
  sleeperFetchedAt,
  fantasyProsSourceType,
  dataFreshness,
  leagueSettings,
  predictionModelVersion,
  predictionGeneratedAt,
  shadowRecommendationAvailable,
  recommendationPolicyReason,
  degradedOptionalData,
}: {
  readonly sync: SyncConfidence;
  readonly now: number;
  readonly fantasyProsRefreshedAt?: string;
  readonly sleeperFetchedAt?: string;
  readonly fantasyProsSourceType?: string;
  readonly dataFreshness: readonly DataFreshnessItem[];
  readonly leagueSettings: LeagueSettings;
  readonly predictionModelVersion?: string;
  readonly predictionGeneratedAt?: string | null;
  readonly shadowRecommendationAvailable: boolean;
  readonly recommendationPolicyReason?: string;
  readonly degradedOptionalData: DegradedSignals;
}): React.ReactElement {
  const ffcAdpFreshness = dataFreshness.find((item) => item.key === 'ffc-adp');
  const marketRefreshedAt = getOldestTimestamp([
    fantasyProsRefreshedAt,
    ffcAdpFreshness?.timestamp ?? sleeperFetchedAt,
  ]);
  const marketAge = marketRefreshedAt ? formatRelativeAge(marketRefreshedAt, now) : null;
  const marketTitle = [
    `FantasyPros snapshot: ${formatTimestamp(fantasyProsRefreshedAt)}${fantasyProsSourceType ? ` (${fantasyProsSourceType})` : ''}`,
    ffcAdpFreshness?.timestamp
      ? `Fantasy Football Calculator ADP: ${formatTimestamp(ffcAdpFreshness.timestamp)}`
      : `FFC ADP unavailable; FantasyPros/Sleeper fallback: ${formatTimestamp(sleeperFetchedAt)}`,
  ].join('\n');
  const settingsWarnings =
    leagueSettings.unsupportedScoringKeys.length +
    leagueSettings.unsupportedRosterSlots.length;
  const scoringLabel = scoringSummary(leagueSettings);
  const leagueSettingsTitle = [
    `Scoring: ${scoringLabel}`,
    `Teams: ${String(leagueSettings.totalTeams)}`,
    `Keepers: ${leagueSettings.keepersEnabled === null ? 'provider did not report' : leagueSettings.keepersEnabled ? 'enabled' : 'disabled'}`,
    `Settings fingerprint: ${leagueSettings.fingerprint}`,
    ...(leagueSettings.unsupportedScoringKeys.length > 0
      ? [`Unsupported scoring keys: ${leagueSettings.unsupportedScoringKeys.join(', ')}`]
      : []),
    ...(leagueSettings.unsupportedRosterSlots.length > 0
      ? [`Unsupported roster slots: ${leagueSettings.unsupportedRosterSlots.join(', ')}`]
      : []),
  ].join('\n');
  const hasPredictionModel =
    predictionModelVersion !== undefined && predictionModelVersion !== 'none';
  const providerSettings = leagueSettings.source === 'sleeper' || leagueSettings.source === 'espn';
  const predictionDegradation = degradedOptionalData.find((item) => item.key === 'experimental-predictions');
  const contractDegradation = degradedOptionalData.find((item) => item.key === 'contract-context');
  const sportsbookDegradation = degradedOptionalData.find((item) => item.key === 'sportsbook-context');

  return (
    <>
      <DataConfidenceItem tone={sync.tone}>{sync.label}</DataConfidenceItem>
      <DataConfidenceItem tone={marketFreshnessTone(marketRefreshedAt, now)} title={marketTitle}>
        {marketAge ? `Market data refreshed ${marketAge}` : 'Market data unavailable'}
      </DataConfidenceItem>
      <DataConfidenceItem
        tone={settingsWarnings > 0 ? 'warn' : providerSettings ? 'good' : 'neutral'}
        title={leagueSettingsTitle}
      >
        {providerSettings
          ? settingsWarnings > 0
            ? `${leagueSettings.source === 'espn' ? 'ESPN' : 'Sleeper'} settings applied · ${String(settingsWarnings)} warning${settingsWarnings === 1 ? '' : 's'}`
            : `${leagueSettings.source === 'espn' ? 'ESPN' : 'Sleeper'} settings applied · ${scoringLabel}`
          : `Default settings · ${scoringLabel}`}
      </DataConfidenceItem>
      <DataConfidenceItem
        tone={predictionDegradation ? 'warn' : shadowRecommendationAvailable ? 'good' : 'neutral'}
        title={predictionDegradation?.message ??
          (shadowRecommendationAvailable && hasPredictionModel
            ? `Experimental prediction artifact · model ${predictionModelVersion} · generated ${formatTimestamp(predictionGeneratedAt ?? undefined)} · used only for Shadow Recommendation`
            : recommendationPolicyReason)}
      >
        {predictionDegradation
          ? 'Shadow Recommendation unavailable'
          : shadowRecommendationAvailable && hasPredictionModel
            ? 'Shadow Recommendation ready · live order isolated'
            : 'Shadow Recommendation unavailable'}
      </DataConfidenceItem>
      {contractDegradation && (
        <DataConfidenceItem tone="warn" title={contractDegradation.message}>
          Contract context unavailable
        </DataConfidenceItem>
      )}
      {sportsbookDegradation && (
        <DataConfidenceItem tone="warn" title={sportsbookDegradation.message}>
          Sportsbook context unavailable
        </DataConfidenceItem>
      )}
      {degradedOptionalData.length > 1 && (
        <DataConfidenceItem tone="warn">
          {degradedOptionalData.length} optional feeds degraded
        </DataConfidenceItem>
      )}
    </>
  );
}

export function OptionalSignalPanel({
  degradedOptionalData,
  expanded,
  onExpandedChange,
}: {
  readonly degradedOptionalData: DegradedSignals;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}): React.ReactElement | null {
  if (degradedOptionalData.length === 0) return null;
  return (
    <section
      className="overflow-hidden rounded-lg border border-warning/35 bg-warning/[0.07]"
      aria-labelledby="optional-signal-heading"
    >
      <Button
        variant="ghost"
        className="h-auto w-full justify-between rounded-none px-3 py-3 text-left hover:bg-warning/[0.08]"
        aria-controls="optional-signal-details"
        aria-expanded={expanded}
        onClick={() => { onExpandedChange(!expanded); }}
      >
        <span>
          <span
            id="optional-signal-heading"
            className="block text-xs font-semibold text-warning"
          >
            Optional Signals
          </span>
          <span className="mt-0.5 block text-2xs font-normal text-muted-foreground">
            {String(degradedOptionalData.length)} degraded · Recommendations remain available
          </span>
        </span>
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Button>
      <MotionExpandable open={expanded}>
        <ul id="optional-signal-details" className="space-y-2 border-t border-warning/20 p-3 text-2xs">
          {degradedOptionalData.map((item) => (
            <li key={item.key} className="rounded-md border border-warning/20 bg-background/70 px-3 py-2">
              <div className="font-medium">{item.label}</div>
              <div className="mt-0.5 text-muted-foreground">
                {item.sourceLabel} · {item.timestampLabel}{' '}
                <span className="font-mono tabular-nums">
                  {formatDraftReadinessTimestamp(item.timestamp)}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{item.message}</p>
              <div className="mt-1 font-medium text-warning">
                Optional action: {item.correctiveAction}
              </div>
            </li>
          ))}
        </ul>
      </MotionExpandable>
    </section>
  );
}

export function ReadinessWarningPanel({
  warnings,
}: {
  readonly warnings: DraftReadinessReport['actionableWarnings'];
}): React.ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <section
      className="rounded-lg border border-warning/30 bg-warning/[0.04] px-3 py-3"
      aria-labelledby="readiness-warning-heading"
    >
      <h3 id="readiness-warning-heading" className="text-xs font-semibold text-warning">
        Actionable warnings
      </h3>
      <ul className="mt-2 space-y-1 text-2xs text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning.key}>
            <span className="font-medium text-foreground">{warning.label}:</span>{' '}
            {warning.message}{warning.correctiveAction ? ` ${warning.correctiveAction}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
