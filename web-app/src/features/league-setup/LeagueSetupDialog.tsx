import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEFAULT_QUICK_MOCK, isQuickMockPreferences } from '@/lib/quick-mock-settings';
import { useLeagueSetupStore, type LocalLeagueProfile } from '@/stores/leagueSetupStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { useDraftStore } from '@/stores/draftStore';

export function LeagueSetupDialog({ open, onOpenChange, onConnectPrimary }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnectPrimary: () => void;
}): React.ReactElement {
  const savedProfile = useLeagueSetupStore((state) => state.profile);
  const savedQuickMock = useLeagueSetupStore((state) => state.quickMock);
  const save = useLeagueSetupStore((state) => state.save);
  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const setQuickMock = useDraftSyncConnectionStore((state) => state.setQuickMockSettings);
  const setPrimaryPractice = useDraftSyncConnectionStore((state) => state.setPrimaryLeagueSettings);
  const hasPicks = useDraftStore((state) => state.draftHistory.some((pick) => pick.source !== 'keeper'));
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const config = useDraftStore((state) => state.config);
  const [profile, setProfile] = React.useState<LocalLeagueProfile>(savedProfile);
  const [preferences, setPreferences] = React.useState(savedQuickMock);
  const transferringFocus = React.useRef(false);
  React.useEffect(() => {
    if (!open) return;
    setProfile(connection ? connection.settingsProfile === 'quick-mock' ? 'quick-mock' : 'primary-league' : savedProfile);
    setPreferences(savedQuickMock);
  }, [open, connection, savedProfile, savedQuickMock]);
  const localDraftInProgress = !connection && (sessionMode === 'mock' || hasPicks);
  const unsupportedProvider = !!connection && connection.provider !== 'sleeper';
  const canApply = !localDraftInProgress && !unsupportedProvider && (profile === 'primary-league' || isQuickMockPreferences(preferences));
  const rounds = connection ? config.totalRounds : preferences.totalRounds;
  const apply = (): void => {
    if (!canApply) return;
    save(profile, profile === 'quick-mock' ? preferences : savedQuickMock);
    if (connection) {
      if (profile === 'quick-mock') setQuickMock(true);
      else setPrimaryPractice(true);
    }
    toast.success(profile === 'quick-mock' ? 'Quick mock settings saved' : 'Primary League practice settings selected', { id: 'league-settings' });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (transferringFocus.current) transferringFocus.current = false;
        else document.querySelector<HTMLButtonElement>('.draft-session-status')?.focus();
      }}>
        <DialogHeader>
          <DialogTitle>League setup</DialogTitle>
          <DialogDescription>Choose the rules for this draft. Quick mocks work without a Primary League connection.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="League setup path">
          {(['quick-mock', 'primary-league'] as const).map((value) => <Button key={value} variant={profile === value ? 'secondary' : 'outline'} aria-pressed={profile === value} onClick={() => { setProfile(value); }}>
            {value === 'quick-mock' ? 'Quick mock' : 'Primary League'}
          </Button>)}
        </div>
        {profile === 'quick-mock' ? <section className="space-y-4" aria-label="Quick mock settings">
          <div>
            <h3 className="text-sm font-semibold">Start with standard rules</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">No keepers, TE premium, or rush-attempt bonus. Your Primary League configuration stays separate.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2 text-sm">Teams<Input type="number" min={2} max={20} value={connection ? config.totalTeams : preferences.totalTeams} disabled={!!connection} onChange={(event) => { setPreferences({ ...preferences, totalTeams: Number(event.target.value) }); }} /></label>
            <label className="space-y-2 text-sm">Rounds<Input type="number" min={10} max={30} value={rounds} disabled={!!connection} onChange={(event) => { setPreferences({ ...preferences, totalRounds: Number(event.target.value) }); }} /></label>
            <div><label htmlFor="mock-scoring" className="mb-2 block text-sm">Reception scoring</label><Select id="mock-scoring" className="w-full" value={String(preferences.reception)} onValueChange={(value) => { setPreferences({ ...preferences, reception: Number(value) as 0 | 0.5 | 1 }); }} options={[{ value: '1', label: 'Full PPR' }, { value: '0.5', label: 'Half PPR' }, { value: '0', label: 'Standard' }]} /></div>
            <div><label htmlFor="mock-passing" className="mb-2 block text-sm">Passing touchdown</label><Select id="mock-passing" className="w-full" value={String(preferences.passingTouchdown)} onValueChange={(value) => { setPreferences({ ...preferences, passingTouchdown: Number(value) as 4 | 6 }); }} options={[{ value: '4', label: '4 points' }, { value: '6', label: '6 points' }]} /></div>
          </div>
          {connection ? <p className="text-xs text-muted-foreground">Sleeper supplies teams, rounds, picks, and draft order. Change the draft size in Sleeper.</p> : null}
          <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX · 1 K · 1 DEF<br />{String(Math.max(1, rounds - 9))} bench spots · No keepers</p>
          <Button variant="ghost" size="sm" onClick={() => { setPreferences(DEFAULT_QUICK_MOCK); }}>Restore defaults</Button>
        </section> : <section className="space-y-4" aria-label="Primary League setup">
          <h3 className="text-sm font-semibold">Review your Primary League rules</h3>
          <p className="rounded-md bg-muted p-3 text-sm leading-6">10 teams · 14 rounds · Snake<br />Full PPR · +0.5 TE premium · +0.2 per rush · 4-point passing touchdowns<br />1 QB · 2 RB · 2 WR · 1 TE · 2 FLEX · 1 K · 5 bench<br />Confirmed Primary League keepers</p>
          <p className="text-sm leading-relaxed text-muted-foreground">For practice, use these rules with the Primary League keeper list. For your real draft, connect Sleeper to verify its scoring and roster settings.</p>
          <Button variant="outline" className="w-full" disabled={localDraftInProgress} onClick={() => {
            save('primary-league', savedQuickMock);
            setPrimaryPractice(false);
            setQuickMock(false);
            transferringFocus.current = true;
            onOpenChange(false);
            onConnectPrimary();
          }}>Connect Primary League</Button>
        </section>}
        {localDraftInProgress ? <p role="status" className="text-sm text-muted-foreground">Exit the current mock before changing its league rules. Existing picks will stay intact until you exit.</p> : null}
        {unsupportedProvider ? <p role="status" className="text-sm text-muted-foreground">Local practice rules are available for local mocks and Sleeper mocks. This connection uses its provider settings.</p> : null}
        {profile === 'quick-mock' && (!isQuickMockPreferences(preferences) || rounds < 10) ? <p role="alert" className="text-sm text-destructive">Use 2–20 teams and 10–30 rounds for this roster.</p> : null}
        <Button className="w-full" disabled={!canApply || (profile === 'quick-mock' && rounds < 10)} onClick={apply}>{profile === 'quick-mock' ? 'Use quick mock settings' : 'Use Primary League practice settings'}</Button>
      </DialogContent>
    </Dialog>
  );
}
