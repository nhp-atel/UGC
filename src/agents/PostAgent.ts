import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { PostDraft, SelectedQuote, CreativeBrief } from '../../workflows/generateQuoteContentTypes';

interface PostInput {
  topic: string;
  tone: string;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  hashtags?: string[];
}

export class PostAgent extends BaseAgent<PostInput, PostDraft> {
  name = 'PostAgent';
  systemPrompt = 'You are a social media copywriter specializing in YouTube Shorts. You write metadata that maximizes engagement and discoverability.';

  protected async execute(
    input: PostInput,
    feedback?: string
  ): Promise<PostDraft> {
    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Revise accordingly.`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Write YouTube Shorts post metadata for a ${input.tone} video about "${input.topic}".

Quote: "${input.selectedQuote.text}" — ${input.selectedQuote.author}
Hook: "${input.creativeBrief.hook}"
User-provided hashtags to include: ${JSON.stringify(input.hashtags ?? [])}${feedbackLine}

Return JSON: {
  "title": "<catchy title, under 70 characters>",
  "description": "<engaging description, 2-3 sentences, naturally includes the quote>",
  "hashtags": ["<5-8 relevant hashtags, include any user-provided ones>"]
}`,
      },
    ]);

    return JSON.parse(response) as PostDraft;
  }

  protected async evaluate(
    result: PostDraft,
    input: PostInput
  ): Promise<Evaluation> {
    return this.evaluateWithLLM(
      result,
      `Platform: YouTube Shorts, Tone: "${input.tone}"
- Title click-worthiness: Would you click this title? Is it under 70 characters?
- Description engagement: Is the description compelling and does it include the quote naturally?
- Hashtag relevance: Are the hashtags relevant and a mix of broad + niche for discoverability?
- Platform fit: Does the metadata follow YouTube Shorts conventions?`
    );
  }
}
