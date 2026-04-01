import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { generateVideo } from '../services/videoService';

export const videoToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_video',
    description: 'Generate video, thumbnail, and subtitle assets for the quote video. Currently returns placeholder paths.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'The workflow request ID' },
      },
      required: ['requestId'],
    },
  },
};

export async function executeVideoTool(args: { requestId: string }): Promise<string> {
  const result = await generateVideo(args.requestId);
  return JSON.stringify(result);
}
