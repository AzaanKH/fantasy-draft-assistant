import { localDevPorts } from '@fantasy-draft/shared';

declare const __DRAFT_LOCAL_PORTS__: ReturnType<typeof localDevPorts>;
// Vite supplies this build's ports. Direct source tests retain production defaults.
export const LOCAL_PORTS = typeof __DRAFT_LOCAL_PORTS__ === 'undefined'
  ? localDevPorts() : __DRAFT_LOCAL_PORTS__;
