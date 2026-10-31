import type { RankingsSource } from '@fantasy-draft/shared/catalog';
import { createDraftDisplayContext } from '@fantasy-draft/shared/draft';

/**
 * Static demo builds (`pnpm build:web:demo`) run without the local API server:
 * they serve demo-data/, start a no-keeper quick mock, and never connect to a
 * draft provider.
 */
// tsx scripts import these modules outside Vite, where import.meta.env is undefined.
const env = (import.meta as { readonly env?: ImportMetaEnv }).env;
export const DRAFT_DISPLAY = createDraftDisplayContext(env?.VITE_DEMO_MODE === 'true');
export const { IS_DEMO, RANKING_LABELS, LEAGUE_LABEL } = DRAFT_DISPLAY;
export const RANKINGS_SOURCE: RankingsSource = IS_DEMO
  ? { kind: 'demo', label: `Demo rankings (${RANKING_LABELS.source})` }
  : { kind: 'live' };
