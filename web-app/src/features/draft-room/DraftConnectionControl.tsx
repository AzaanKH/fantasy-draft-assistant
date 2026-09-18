import type { DraftReadinessReport } from '@fantasy-draft/shared';
import { DraftConnect } from '@/features/draft-board/DraftConnect';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';

export function DraftConnectionControl({ readiness }: { readonly readiness: DraftReadinessReport }) {
  const { dataInfo } = usePlayerDataQuery();
  return <DraftConnect {...dataInfo} dataFreshness={dataInfo.dataFreshness} readiness={readiness} variant="status-control" />;
}
