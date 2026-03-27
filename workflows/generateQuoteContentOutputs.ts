// workflows/generateQuoteContentOutputs.ts

import type {
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
  ApprovalState,
} from './generateQuoteContentTypes';

export interface GenerateQuoteContentResult {
  workflowStatus: 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'PUBLISHED';
  requestId: string;
  selectedQuote?: SelectedQuote;
  creativeBrief?: CreativeBrief;
  assets?: GeneratedAssets;
  post?: PostDraft;
  approvalState: ApprovalState;
  errors: string[];
}