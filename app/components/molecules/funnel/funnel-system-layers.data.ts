import type { SystemLayer } from './funnel-system-layers.types';
import { CORE_SYSTEM_LAYERS } from './funnel-system-layers-core.data';

export const EXTENDED_SYSTEM_LAYERS: readonly SystemLayer[] = [
  {
    id: 'generation',
    number: 5,
    name: 'Generation Layer',
    role: 'Deterministic Molecular Scaffolding',
    badgeText: 'SCAFFOLDING',
    tone: 'lime',
    icon: 'i-lucide-wand-2',
    thesis: 'Deterministic scaffolding guaranteed to comply with all 7 pillars on creation.',
    description: 'Scaffolds complete crystalline capsules containing SFC (<100 LOC), reactive controller hook, mixin SCSS, and types.',
    agentImpact: 'Agents generate clean, bounded components instantly without hallucinating boilerplate or violating line budgets.',
    headlineCommand: 'npm create chemx / pnpm chemx gen',
    keyMechanisms: ['Greenfield project generation via npm create chemx', 'In-repo capsule synthesis via pnpm chemx gen', 'Separation of template (<100 LOC), controller, and types', 'Pre-wired result tuple error handling & cleanup']
  },
  {
    id: 'evidence',
    number: 6,
    name: 'Evidence Layer',
    role: 'Empirical Task Harness & Benchmarks',
    badgeText: 'EMPIRICAL',
    tone: 'pink',
    icon: 'i-lucide-activity',
    thesis: 'No Lab, Just Reps: Grounded task-based comparison of monoliths vs molecules.',
    description: 'Empirical benchmark harness comparing a 2,700-line monolith against Chemical X architecture across 5 production tasks.',
    agentImpact: 'Empirically demonstrates how isolated molecular boundaries raise agent task completion from 38% (monolith) to 100% (Chemical X).',
    headlineCommand: '@chemx/benchmarks (100% vs 38% Task A)',
    keyMechanisms: ['Tested across Claude 3.7 Sonnet, Gemini 2.5 Pro, GPT-4o, Grok-2', 'URL parameter persistence: 100% (Chemical X) vs 38% (Monolith)', 'Export-to-JSON modal: 98% completion rate', 'Expired-token error boundary: 99% completion rate', '429 async backoff retry: 97% completion rate']
  },
  {
    id: 'implementation',
    number: 7,
    name: 'Implementation Layer',
    role: 'Starter Kits, Blueprints & Vault Access',
    badgeText: 'PRODUCTION',
    tone: 'sky',
    icon: 'i-lucide-folder-git-2',
    thesis: 'Turnkey distribution of production-ready architecture and advisory.',
    description: 'Delivers git submodule drop-ins, pre-commit hooks, CI context bots, full 7-chapter specs, and architectural advisory.',
    agentImpact: 'Teams deploy pre-configured agent guardrails in minutes, accelerating velocity while enforcing token economies.',
    headlineCommand: '@chemx/starter-kit • Vault Dashboard',
    keyMechanisms: ['$27 Individual License: full 7 chapters, .cursorrules, AGENTS.md', '$97 Team Power Puff: unlimited seats, private repo, CI blueprints', '$150 Individual Onboarding: live 1-on-1 architectural setup', '$500 Team Architecture Sprint: migration & pipeline hardening']
  }
];

export const SYSTEM_LAYERS: readonly SystemLayer[] = [
  ...CORE_SYSTEM_LAYERS,
  ...EXTENDED_SYSTEM_LAYERS
];
