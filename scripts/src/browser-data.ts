import { browserDataFiles } from '@fantasy-draft/shared/catalog';

export const BROWSER_DATA_ALLOWLIST: ReadonlySet<string> = new Set(browserDataFiles('local'));
