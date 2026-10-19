import { IS_DEMO } from '@/lib/demo-mode';
import { CATALOG, catalogPath, decodeFantasyProsSnapshot, type FantasyProsSnapshot } from '@fantasy-draft/shared/catalog';

interface FantasyProsProvider {
  getSnapshot(): Promise<FantasyProsSnapshot>;
}

export class CachedFantasyProsProvider implements FantasyProsProvider {
  constructor(private readonly snapshotPath: string = `/${catalogPath(CATALOG.snapshot)}`) {}

  async getSnapshot(): Promise<FantasyProsSnapshot> {
    const response = await fetch(this.snapshotPath);
    if (!response.ok) {
      throw new Error(`Failed to load ${IS_DEMO ? 'demo rankings' : 'FantasyPros snapshot'}: ${response.status}`);
    }

    const parsed: unknown = await response.json();
    return decodeFantasyProsSnapshot(parsed);
  }
}

export const fantasyProsProvider = new CachedFantasyProsProvider();
