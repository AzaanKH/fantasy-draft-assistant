import type { FantasyProsSnapshot } from '@fantasy-draft/shared';

export interface FantasyProsProvider {
  getSnapshot(): Promise<FantasyProsSnapshot>;
}

export class CachedFantasyProsProvider implements FantasyProsProvider {
  constructor(private readonly snapshotPath: string = '/data/fantasypros-snapshot.json') {}

  async getSnapshot(): Promise<FantasyProsSnapshot> {
    const response = await fetch(this.snapshotPath);
    if (!response.ok) {
      throw new Error(`Failed to load FantasyPros snapshot: ${response.status}`);
    }

    return response.json() as Promise<FantasyProsSnapshot>;
  }
}

export const fantasyProsProvider = new CachedFantasyProsProvider();
