// activities/generateQuoteContentActivities.ts

import type { GenerateQuoteContentInput } from '../workflows/generateQuoteContentInputs';
import type {
  QuoteCandidate,
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
} from '../workflows/generateQuoteContentTypes';

export async function researchQuotes(
  input: GenerateQuoteContentInput
): Promise<QuoteCandidate[]> {
  return [
    {
      text: 'Discipline is choosing between what you want now and what you want most.',
      author: 'Abraham Lincoln',
      sourceType: 'unknown',
      score: 0.91,
    },
    {
      text: 'We must all suffer one of two things: the pain of discipline or the pain of regret.',
      author: 'Jim Rohn',
      sourceType: 'unknown',
      score: 0.88,
    },
    {
      text: 'Success does not come from motivation. It comes from consistency.',
      author: 'Unknown',
      sourceType: 'unknown',
      score: 0.84,
    },
  ];
}

export async function selectBestQuote(input: {
  input: GenerateQuoteContentInput;
  quoteCandidates: QuoteCandidate[];
}): Promise<SelectedQuote> {
  const best = [...input.quoteCandidates].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  )[0];

  return {
    text: best.text,
    author: best.author,
    sourceType: best.sourceType,
  };
}

export async function buildCreativeBrief(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
}): Promise<CreativeBrief> {
  return {
    hook: `A powerful reminder about ${input.input.topic}.`,
    visualConcept: `${input.input.tone} motivational short with bold on-screen typography and subtle motion background.`,
    voiceoverText: input.selectedQuote.text,
    audioMood: 'inspirational cinematic rise',
  };
}

export async function generateVideoDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
}): Promise<GeneratedAssets> {
  return {
    videoPath: `/mock-assets/${input.input.requestId}/quote-video.mp4`,
    thumbnailPath: `/mock-assets/${input.input.requestId}/thumbnail.png`,
    subtitlePath: `/mock-assets/${input.input.requestId}/subtitles.srt`,
  };
}

export async function generatePostDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
}): Promise<PostDraft> {
  return {
    title: `${input.input.topic.toUpperCase()} - A Quote to Remember`,
    description: `${input.selectedQuote.text}\n\nA short motivational video about ${input.input.topic}.`,
    hashtags: input.input.hashtags ?? ['#motivation', '#quotes', '#shorts'],
  };
}

export async function saveDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
}): Promise<{ draftId: string }> {
  return {
    draftId: `draft-${input.input.requestId}`,
  };
}

export async function publishToYoutube(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
}): Promise<{ youtubeUrl: string }> {
  return {
    youtubeUrl: `https://youtube.com/watch?v=mock-${input.input.requestId}`,
  };
}