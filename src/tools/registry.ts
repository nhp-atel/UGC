import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { researchToolDefinition, executeResearchTool } from './researchTool';
import { creativeToolDefinition, executeCreativeTool } from './creativeTool';
import { postToolDefinition, executePostTool } from './postTool';
import { videoToolDefinition, executeVideoTool } from './videoTool';
import { saveToolDefinition, executeSaveTool } from './saveTool';

export const tools: ChatCompletionTool[] = [
  researchToolDefinition,
  creativeToolDefinition,
  postToolDefinition,
  videoToolDefinition,
  saveToolDefinition,
];

const handlers: Record<string, (args: any) => Promise<string>> = {
  research_quotes: executeResearchTool,
  build_creative_brief: executeCreativeTool,
  write_post: executePostTool,
  generate_video: executeVideoTool,
  save_draft: executeSaveTool,
};

export async function executeTool(name: string, args: string): Promise<string> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const parsed = JSON.parse(args);
  return handler(parsed);
}
