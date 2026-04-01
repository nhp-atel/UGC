import type {
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
  QuoteCandidate,
} from '../../../workflows/generateQuoteContentTypes';

export interface Evaluation {
  pass: boolean;
  score: number;
  feedback: string;
  criteria: Record<string, number>;
}

export interface AgentResult<T> {
  result: T;
  evaluation: Evaluation;
  attempts: number;
  qualityWarning?: boolean;
}

export interface ResearchResult {
  candidates: QuoteCandidate[];
  selected: SelectedQuote;
}

export interface DirectorResult {
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
  directorLog: DirectorLogEntry[];
}

export interface DirectorLogEntry {
  turn: number;
  action: string;
  tool?: string;
  reasoning: string;
  outcome: 'accepted' | 'retried' | 'adjusted';
}
