// workflows/generateQuoteContentInputs.ts

export interface GenerateQuoteContentInput {
  requestId: string;
  topic: string;
  platform: 'youtube_shorts';
  tone: 'cinematic' | 'calm' | 'bold' | 'minimal';
  durationSeconds: number;
  mode: 'draft_only' | 'auto_publish';
  requireApproval: boolean;
  preferredVoice?: string;
  visualStyle?: string;
  hashtags?: string[];
}