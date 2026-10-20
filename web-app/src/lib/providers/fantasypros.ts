import { requestJson } from '@/lib/http';
import { IS_DEMO } from '@/lib/demo-mode';
import { CATALOG, catalogPath, decodeFantasyProsSnapshot, type FantasyProsSnapshot } from '@fantasy-draft/shared/catalog';

interface FantasyProsProvider {
  getSnapshot(): Promise<FantasyProsSnapshot>;
}

export class CachedFantasyProsProvider implements FantasyProsProvider {
  constructor(private readonly snapshotPath: string = `/${catalogPath(CATALOG.snapshot)}`) {}

  async getSnapshot(): Promise<FantasyProsSnapshot> {
    return requestJson(this.snapshotPath, decodeFantasyProsSnapshot,
      `Failed to load ${IS_DEMO ? 'demo rankings' : 'FantasyPros snapshot'}`);
  }
}

export const fantasyProsProvider = new CachedFantasyProsProvider();
