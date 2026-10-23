import { createDraftDisplayContext } from '@fantasy-draft/shared/draft';

/**
 * Static demo builds (`pnpm build:web:demo`) run without the local API server:
 * they serve demo-data/, start a no-keeper quick mock, and never connect to a
 * draft provider. Vite sets VITE_DEMO_MODE from BROWSER_DATA_SOURCE=demo.
 */
// tsx scripts import these modules outside Vite, where import.meta.env is undefined.
const env = (import.meta as { readonly env?: ImportMetaEnv }).env;
export const DRAFT_DISPLAY = createDraftDisplayContext(env?.VITE_DEMO_MODE === 'true');
export const { IS_DEMO, RANKING_LABELS, LEAGUE_LABEL } = DRAFT_DISPLAY;

/** The demo snapshot's source type; live readiness accepts only API or reviewed manual refreshes. */
export const DEMO_RANKINGS_SOURCE_TYPE = 'fixture';
