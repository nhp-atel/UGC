import { openai } from '../lib/openAIClient';
import { config } from '../lib/config';
import { tools, executeTool } from '../tools/registry';
import type { DirectorResult, DirectorLogEntry } from './base/types';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export class DirectorAgent {
  private messages: ChatCompletionMessageParam[] = [];
  private log: DirectorLogEntry[] = [];
  private turn = 0;

  async run(input: GenerateQuoteContentInput): Promise<DirectorResult> {
    this.messages = [
      {
        role: 'system',
        content: `You are a content director for short-form video. Your job is to produce the highest quality UGC content by coordinating specialist agents via tools.

Input:
- Topic: "${input.topic}"
- Platform: ${input.platform}
- Tone: ${input.tone}
- Duration: ${input.durationSeconds}s
- Request ID: ${input.requestId}
- Visual style: ${input.visualStyle ?? 'not specified'}
- Hashtags: ${JSON.stringify(input.hashtags ?? [])}

Process:
1. Call research_quotes to find the best quote for this topic and tone.
2. Evaluate the research result. If the quote quality is poor (check the evaluation in the response), call research_quotes again with feedback.
3. Call build_creative_brief with the selected quote.
4. Evaluate the creative brief. If the hook is weak or tone doesn't match, call build_creative_brief again with feedback.
5. Call write_post with the quote and creative brief details.
6. Call generate_video with the request ID.
7. Call save_draft with the request ID and all assembled content.
8. When all steps are complete, respond with a final JSON summary (no tool call).

Important:
- You may call any tool multiple times if quality is not satisfactory.
- Each tool returns an AgentResult with an evaluation. Check "qualityWarning" — if true, consider retrying with feedback.
- Your final response (no tool call) MUST be valid JSON with this shape:
{
  "selectedQuote": { "text": "...", "author": "...", "sourceType": "..." },
  "creativeBrief": { "hook": "...", "visualConcept": "...", "voiceoverText": "...", "audioMood": "..." },
  "assets": { "videoPath": "...", "thumbnailPath": "...", "subtitlePath": "..." },
  "post": { "title": "...", "description": "...", "hashtags": [...] }
}`,
      },
      {
        role: 'user',
        content: `Begin producing content for topic "${input.topic}" with ${input.tone} tone for ${input.platform}. Start by researching quotes.`,
      },
    ];

    while (this.turn < config.director.maxTurns) {
      this.turn++;

      const response = await openai.chat.completions.create({
        model: config.director.model,
        messages: this.messages,
        tools,
      });

      const choice = response.choices[0];
      if (!choice?.message) {
        throw new Error('DirectorAgent: No response from OpenAI');
      }

      this.messages.push(choice.message);

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        const content = choice.message.content;
        if (!content) {
          throw new Error('DirectorAgent: Empty final response');
        }

        this.log.push({
          turn: this.turn,
          action: 'final_response',
          reasoning: 'All content assembled, returning final result',
          outcome: 'accepted',
        });

        const parsed = JSON.parse(content);
        return {
          selectedQuote: parsed.selectedQuote,
          creativeBrief: parsed.creativeBrief,
          assets: parsed.assets,
          post: parsed.post,
          directorLog: this.log,
        };
      }

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') {
          continue;
        }
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;

        this.log.push({
          turn: this.turn,
          action: `tool_call: ${toolName}`,
          tool: toolName,
          reasoning: `Calling ${toolName} with args`,
          outcome: 'accepted',
        });

        let toolResult: string;
        try {
          toolResult = await executeTool(toolName, toolArgs);
        } catch (error) {
          toolResult = JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        this.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    }

    throw new Error(`DirectorAgent: Exceeded max turns (${config.director.maxTurns})`);
  }
}
