import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { CreativeBriefAgent } from '../agents/CreativeBriefAgent';

export const creativeToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'build_creative_brief',
    description: 'Create a creative brief with hook, visual concept, voiceover, and audio mood for a quote video.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        tone: { type: 'string', enum: ['cinematic', 'calm', 'bold', 'minimal'] },
        platform: { type: 'string' },
        durationSeconds: { type: 'number' },
        quoteText: { type: 'string', description: 'The selected quote text' },
        quoteAuthor: { type: 'string', description: 'The quote author' },
        visualStyle: { type: 'string', description: 'Optional visual style preference' },
        feedback: { type: 'string', description: 'Optional feedback to improve previous attempt' },
      },
      required: ['topic', 'tone', 'platform', 'durationSeconds', 'quoteText', 'quoteAuthor'],
    },
  },
};

export async function executeCreativeTool(args: {
  topic: string;
  tone: string;
  platform: string;
  durationSeconds: number;
  quoteText: string;
  quoteAuthor: string;
  visualStyle?: string;
  feedback?: string;
}): Promise<string> {
  const agent = new CreativeBriefAgent();
  const result = await agent.run(
    {
      topic: args.topic,
      tone: args.tone,
      platform: args.platform,
      durationSeconds: args.durationSeconds,
      selectedQuote: { text: args.quoteText, author: args.quoteAuthor },
      visualStyle: args.visualStyle,
    },
    args.feedback
  );
  return JSON.stringify(result);
}
