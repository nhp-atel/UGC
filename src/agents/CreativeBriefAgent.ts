import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { CreativeBrief, SelectedQuote } from '../../workflows/generateQuoteContentTypes';

interface CreativeBriefInput {
  topic: string;
  tone: string;
  platform: string;
  durationSeconds: number;
  selectedQuote: SelectedQuote;
  visualStyle?: string;
}

export class CreativeBriefAgent extends BaseAgent<CreativeBriefInput, CreativeBrief> {
  name = 'CreativeBriefAgent';
  systemPrompt = 'You are a creative director for short-form video content. You create compelling creative briefs that guide video production.';

  protected async execute(
    input: CreativeBriefInput,
    feedback?: string
  ): Promise<CreativeBrief> {
    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Revise accordingly.`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Create a creative brief for a ${input.tone} ${input.platform} video (${input.durationSeconds}s) featuring this quote:

"${input.selectedQuote.text}" — ${input.selectedQuote.author}

Visual style preference: ${input.visualStyle ?? 'not specified'}${feedbackLine}

Return JSON: {
  "hook": "<attention grabber for first 2 seconds>",
  "visualConcept": "<visual style and motion description>",
  "voiceoverText": "<full voiceover script incorporating the quote>",
  "audioMood": "<background music mood description>"
}`,
      },
    ]);

    return JSON.parse(response) as CreativeBrief;
  }

  protected async evaluate(
    result: CreativeBrief,
    input: CreativeBriefInput
  ): Promise<Evaluation> {
    return this.evaluateWithLLM(
      result,
      `Tone: "${input.tone}", Duration: ${input.durationSeconds}s
- Hook strength: Would the hook stop a scroller in the first 2 seconds?
- Visual-quote coherence: Does the visual concept complement the quote?
- Voiceover naturalness: Does the voiceover flow naturally when read aloud?
- Tone consistency: Does everything match the requested "${input.tone}" tone?`
    );
  }
}
