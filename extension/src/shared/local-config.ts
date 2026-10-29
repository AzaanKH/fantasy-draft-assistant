import type { localDevPorts } from '@fantasy-draft/shared/sync';

declare const __DRAFT_LOCAL_PORTS__: ReturnType<typeof localDevPorts>;
export const LOCAL_PORTS = __DRAFT_LOCAL_PORTS__;
