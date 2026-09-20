export type LayerTone = 'sky' | 'lime' | 'pink' | 'purple';

export interface SystemLayer {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly role: string;
  readonly badgeText: string;
  readonly tone: LayerTone;
  readonly icon: string;
  readonly thesis: string;
  readonly description: string;
  readonly agentImpact: string;
  readonly headlineCommand: string;
  readonly keyMechanisms: readonly string[];
}
