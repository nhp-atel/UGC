// workflows/generateQuoteContentTypes.ts

export type WorkflowStage =
  | 'RECEIVED'
  | 'RUNNING_DIRECTOR'
  | 'AWAITING_APPROVAL'
  | 'PUBLISHING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';

export type ApprovalState =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface QuoteCandidate {
  text: string;
  author?: string;
  sourceType?: 'public_domain' | 'original' | 'licensed' | 'unknown';
  score?: number;
}

export interface SelectedQuote {
  text: string;
  author?: string;
  sourceType?: 'public_domain' | 'original' | 'licensed' | 'unknown';
}

export interface CreativeBrief {
  hook: string;
  visualConcept: string;
  voiceoverText: string;
  audioMood: string;
}

export interface GeneratedAssets {
  videoPath?: string;
  thumbnailPath?: string;
  subtitlePath?: string;
}

export interface PostDraft {
  title?: string;
  description?: string;
  hashtags?: string[];
  youtubeUrl?: string;
}

export interface GenerateQuoteContentState {
  stage: WorkflowStage;
  approvalState: ApprovalState;
  selectedQuote?: SelectedQuote;
  creativeBrief?: CreativeBrief;
  assets?: GeneratedAssets;
  post?: PostDraft;
  errors: string[];
}
