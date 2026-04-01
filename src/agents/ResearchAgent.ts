import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { ResearchResult } from './base/types';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import { db } from '../lib/db';

export class ResearchAgent extends BaseAgent<GenerateQuoteContentInput, ResearchResult> {
  name = 'ResearchAgent';
  systemPrompt = 'You are a quote researcher specializing in finding powerful, memorable quotes for short-form video content.';

  private getUsedQuotes(topic: string): string[] {
    const rows = db.prepare(
      'SELECT DISTINCT text FROM used_quotes ORDER BY used_at DESC'
    ).all() as Array<{ text: string }>;

    return rows.map(r => r.text);
  }

  protected async execute(
    input: GenerateQuoteContentInput,
    feedback?: string
  ): Promise<ResearchResult> {
    const usedQuotes = this.getUsedQuotes(input.topic);

    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Find different, better quotes.`
      : '';

    const usedQuotesLine = usedQuotes.length > 0
      ? `\n\nIMPORTANT: The following quotes have already been used in previous videos. Do NOT select any of them:\n${usedQuotes.map(q => `- "${q}"`).join('\n')}`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Find 5 powerful quotes about "${input.topic}" suitable for a ${input.tone} ${input.platform} video (${input.durationSeconds}s).${feedbackLine}${usedQuotesLine}

Return JSON: {
  "candidates": [{ "text": "...", "author": "...", "sourceType": "public_domain"|"original"|"unknown", "score": 0.0-1.0 }],
  "selected": { "text": "...", "author": "...", "sourceType": "..." }
}

Pick the single best quote as "selected". Score based on emotional impact, relevance, and suitability for short-form video. Prefer real, well-known quotes with clear attribution.`,
      },
    ]);

    return JSON.parse(response) as ResearchResult;
  }

  protected async evaluate(
    result: ResearchResult,
    input: GenerateQuoteContentInput
  ): Promise<Evaluation> {
    return this.evaluateWithLLM(
      result,
      `Topic: "${input.topic}", Tone: "${input.tone}"
- Relevance: How well does the selected quote match the topic?
- Emotional impact: Would this quote resonate in a short-form video?
- Originality: Is this quote not overused or cliched?
- Attribution clarity: Is the author clearly identified?`
    );
  }
}
