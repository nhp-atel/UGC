import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ResearchAgent } from '../agents/ResearchAgent';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';

export const researchToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'research_quotes',
    description: 'Research and find the best quote candidates for a given topic, then select the strongest one. Returns scored candidates and the selected quote.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic to research quotes about' },
        tone: { type: 'string', enum: ['cinematic', 'calm', 'bold', 'minimal'], description: 'Desired tone' },
        platform: { type: 'string', description: 'Target platform' },
        durationSeconds: { type: 'number', description: 'Video duration in seconds' },
        feedback: { type: 'string', description: 'Optional feedback from a previous attempt to guide the research in a different direction' },
      },
      required: ['topic', 'tone', 'platform', 'durationSeconds'],
    },
  },
};

export async function executeResearchTool(args: {
  topic: string;
  tone: string;
  platform: string;
  durationSeconds: number;
  feedback?: string;
}): Promise<string> {
  const agent = new ResearchAgent();
  const input = {
    requestId: '',
    topic: args.topic,
    platform: args.platform as GenerateQuoteContentInput['platform'],
    tone: args.tone as GenerateQuoteContentInput['tone'],
    durationSeconds: args.durationSeconds,
    mode: 'draft_only' as const,
    requireApproval: false,
  };
  const result = await agent.run(input, args.feedback);
  return JSON.stringify(result);
}
