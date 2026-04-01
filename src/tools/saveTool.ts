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
        selectedQuote: { type: 'object', description: 'The selected quote object' },
        creativeBrief: { type: 'object', description: 'The creative brief object' },
        assets: { type: 'object', description: 'The generated assets object' },
        post: { type: 'object', description: 'The post draft object' },
      },
      required: ['requestId', 'selectedQuote', 'creativeBrief', 'assets', 'post'],
    },
  },
};

export async function executeSaveTool(args: {
  requestId: string;
  selectedQuote: Record<string, unknown>;
  creativeBrief: Record<string, unknown>;
  assets: Record<string, unknown>;
  post: Record<string, unknown>;
}): Promise<string> {
  const result = saveDraft(args);
  return JSON.stringify(result);
}
