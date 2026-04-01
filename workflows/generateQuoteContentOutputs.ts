// workflows/generateQuoteContentOutputs.ts

import type {
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
  ApprovalState,
} from './generateQuoteContentTypes';

export interface DirectorLogEntry {
  turn: number;
  action: string;
  tool?: string;
  reasoning: string;
  outcome: 'accepted' | 'retried' | 'adjusted';
}

export interface GenerateQuoteContentResult {
  workflowStatus: 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'PUBLISHED' | 'CANCELLED' | 'REJECTED';
  requestId: string;
  selectedQuote?: SelectedQuote;
  creativeBrief?: CreativeBrief;
  assets?: GeneratedAssets;
  post?: PostDraft;
  approvalState: ApprovalState;
  errors: string[];
  directorLog?: DirectorLogEntry[];
}
