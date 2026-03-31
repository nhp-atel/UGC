// activities/generateQuoteContentActivities.ts

import { openai, OPENAI_MODEL } from '../src/lib/openAIClient';
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
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a quote researcher. Return a JSON object with a "quotes" array containing exactly 5 quote candidates about the given topic. Each quote must have: "text" (the quote), "author" (who said it, or "Unknown"), "sourceType" (one of "public_domain", "original", "licensed", "unknown"), and "score" (relevance score from 0.0 to 1.0). Prefer real, well-known quotes. Score based on how well the quote fits the topic and would resonate in a short-form video.`,
      },
      {
        role: 'user',
        content: `Find 5 powerful quotes about "${input.topic}" suitable for a ${input.tone} ${input.platform} video.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI in researchQuotes');

  const parsed = JSON.parse(content) as { quotes: QuoteCandidate[] };
  return parsed.quotes;
}

export async function selectBestQuote(input: {
  input: GenerateQuoteContentInput;
  quoteCandidates: QuoteCandidate[];
}): Promise<SelectedQuote> {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a content strategist. Given a list of quote candidates, select the single best quote for a ${input.input.tone} ${input.input.platform} video. Return a JSON object with "text", "author", and "sourceType" for the chosen quote. Pick the one that is most impactful, memorable, and suited to short-form video.`,
      },
      {
        role: 'user',
        content: `Topic: "${input.input.topic}"\nTone: ${input.input.tone}\nDuration: ${input.input.durationSeconds}s\n\nCandidates:\n${JSON.stringify(input.quoteCandidates, null, 2)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI in selectBestQuote');

  return JSON.parse(content) as SelectedQuote;
}

export async function buildCreativeBrief(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
}): Promise<CreativeBrief> {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a creative director for short-form video content. Given a quote and content parameters, create a creative brief. Return a JSON object with: "hook" (a 1-sentence attention grabber for the first 2 seconds), "visualConcept" (description of the visual style and motion), "voiceoverText" (the full voiceover script including the quote), and "audioMood" (description of the background music mood).`,
      },
      {
        role: 'user',
        content: `Quote: "${input.selectedQuote.text}" — ${input.selectedQuote.author}\nTone: ${input.input.tone}\nPlatform: ${input.input.platform}\nDuration: ${input.input.durationSeconds}s\nVisual style preference: ${input.input.visualStyle ?? 'not specified'}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI in buildCreativeBrief');

  return JSON.parse(content) as CreativeBrief;
}

export async function generateVideoDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
}): Promise<GeneratedAssets> {
  // Video generation requires a dedicated service (e.g., Remotion, FFmpeg, or a video API)
  // Returning mock paths for now
  return {
    videoPath: `/assets/${input.input.requestId}/quote-video.mp4`,
    thumbnailPath: `/assets/${input.input.requestId}/thumbnail.png`,
    subtitlePath: `/assets/${input.input.requestId}/subtitles.srt`,
  };
}

export async function generatePostDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
}): Promise<PostDraft> {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a social media copywriter specializing in YouTube Shorts. Given a quote and creative brief, write the post metadata. Return a JSON object with: "title" (catchy, under 70 characters), "description" (engaging description with the quote, 2-3 sentences), and "hashtags" (array of 5-8 relevant hashtags including any provided by the user).`,
      },
      {
        role: 'user',
        content: `Quote: "${input.selectedQuote.text}" — ${input.selectedQuote.author}\nHook: ${input.creativeBrief.hook}\nTone: ${input.input.tone}\nUser hashtags: ${JSON.stringify(input.input.hashtags ?? [])}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI in generatePostDraft');

  return JSON.parse(content) as PostDraft;
}

export async function saveDraft(input: {
  input: GenerateQuoteContentInput;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
}): Promise<{ draftId: string }> {
  // Storage integration (database, S3, etc.) would go here
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
  // YouTube API integration would go here
  return {
    youtubeUrl: `https://youtube.com/watch?v=mock-${input.input.requestId}`,
  };
}
