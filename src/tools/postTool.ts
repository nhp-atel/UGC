import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { PostAgent } from '../agents/PostAgent';
import type { CreativeBrief } from '../../workflows/generateQuoteContentTypes';

export const postToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'write_post',
    description: 'Write YouTube Shorts post metadata (title, description, hashtags) for the video.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        tone: { type: 'string', enum: ['cinematic', 'calm', 'bold', 'minimal'] },
        quoteText: { type: 'string' },
        quoteAuthor: { type: 'string' },
        hook: { type: 'string', description: 'The creative brief hook' },
        visualConcept: { type: 'string' },
        voiceoverText: { type: 'string' },
        audioMood: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' }, description: 'User-provided hashtags to include' },
        feedback: { type: 'string', description: 'Optional feedback to improve previous attempt' },
      },
      required: ['topic', 'tone', 'quoteText', 'quoteAuthor', 'hook', 'visualConcept', 'voiceoverText', 'audioMood'],
    },
  },
};

export async function executePostTool(args: {
  topic: string;
  tone: string;
  quoteText: string;
  quoteAuthor: string;
  hook: string;
  visualConcept: string;
  voiceoverText: string;
  audioMood: string;
  hashtags?: string[];
  feedback?: string;
}): Promise<string> {
  const agent = new PostAgent();
  const creativeBrief: CreativeBrief = {
    hook: args.hook,
    visualConcept: args.visualConcept,
    voiceoverText: args.voiceoverText,
    audioMood: args.audioMood,
  };
  const result = await agent.run(
    {
      topic: args.topic,
      tone: args.tone,
      selectedQuote: { text: args.quoteText, author: args.quoteAuthor },
      creativeBrief,
      hashtags: args.hashtags,
    },
    args.feedback
  );
  return JSON.stringify(result);
}
