export interface Tokens { input: number; cached: number; write: number; output: number; reasoning: number }
export type Outcome = 'running' | 'stopping' | 'completed' | 'interrupted' | 'failed' | 'unknown';
export interface Thread {
  id: string; parent: string | null; root: string; kind: string; started: string;
}
export interface Turn {
  thread: string; id: string; rootThread: string; rootTurn: string; started: string;
  ended: string | null; durationMs: number | null; status: Outcome; error: string | null;
  model: string; effort: string; tier: string;
}
export interface Sample extends Tokens {
  id: string; thread: string; turn: string; rootThread: string; rootTurn: string;
  at: string; model: string; effort: string; tier: string; account: string; device: string;
  format: 'native' | 'legacy'; pricePico: string | null; priceSnapshot: string | null;
  priceReason: string | null;
}
export interface Quota {
  id: string; thread: string; at: string; account: string; limit: string;
  window: string; minutes: number | null; used: number | null; resets: string | null;
  reached: string | null;
}
export interface Issue { scope: string; code: string; at: string }
export interface ParseState {
  owner: Thread | null; active: string; rootTurn: string; model: string; effort: string;
  tier: string; ownStartOrdinal: number | null; forked: boolean; ownStarted: boolean;
  previous: Tokens | null; previousAt: string; nativeTurns: string[];
}
export interface Batch {
  threads: Thread[]; turns: Turn[]; samples: Sample[]; quotas: Quota[];
  issues: Issue[]; tools: { id: string; thread: string; turn: string; kind: string; at: string }[];
}
export function emptyBatch(): Batch { return { threads: [], turns: [], samples: [], quotas: [], issues: [], tools: [] }; }
export function initialState(): ParseState {
  return { owner: null, active: '', rootTurn: '', model: '', effort: '', tier: '',
    ownStartOrdinal: null, forked: false, ownStarted: false, previous: null, previousAt: '', nativeTurns: [] };
}
