import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { saveDraft } from '../services/storageService';

export const saveToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'save_draft',
    description: 'Save the completed content draft to storage. Call this after all content has been generated and reviewed.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        content: { type: 'object', description: 'The assembled content to save' },
      },
      required: ['requestId', 'content'],
    },
  },
};

export async function executeSaveTool(args: { requestId: string; content: Record<string, unknown> }): Promise<string> {
  const result = await saveDraft(args.requestId, args.content);
  return JSON.stringify(result);
}
