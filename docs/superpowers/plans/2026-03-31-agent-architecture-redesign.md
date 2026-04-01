# Agent Architecture Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rigid Temporal pipeline with an LLM-driven Director Agent that orchestrates sub-agents (Research, CreativeBrief, Post) via OpenAI tool calling, with double-layered quality control.

**Architecture:** A single Temporal activity runs the DirectorAgent, which uses OpenAI's tool-calling loop to invoke sub-agents. Each sub-agent extends BaseAgent with an execute/evaluate/retry loop. Publishing stays as a separate Temporal activity.

**Tech Stack:** TypeScript, Temporal, OpenAI SDK (gpt-4o for Director, gpt-4o-mini for sub-agents)

**Spec:** `docs/superpowers/specs/2026-03-30-agent-architecture-redesign-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/config.ts` | Create | Centralized config (models, thresholds, retries, timeouts) |
| `src/agents/base/types.ts` | Create | Evaluation, AgentResult, DirectorResult, DirectorLogEntry types |
| `src/agents/base/BaseAgent.ts` | Create | Abstract class: run/evaluate/retry loop |
| `src/agents/ResearchAgent.ts` | Create | Quote research + selection with self-evaluation |
| `src/agents/CreativeBriefAgent.ts` | Create | Creative brief generation with self-evaluation |
| `src/agents/PostAgent.ts` | Create | Post metadata generation with self-evaluation |
| `src/tools/researchTool.ts` | Create | OpenAI function def + handler for research_quotes |
| `src/tools/creativeTool.ts` | Create | OpenAI function def + handler for build_creative_brief |
| `src/tools/postTool.ts` | Create | OpenAI function def + handler for write_post |
| `src/tools/videoTool.ts` | Create | OpenAI function def + handler for generate_video (mocked) |
| `src/tools/saveTool.ts` | Create | OpenAI function def + handler for save_draft (mocked) |
| `src/tools/registry.ts` | Create | Aggregates all tool definitions and handlers |
| `src/agents/DirectorAgent.ts` | Create | LLM orchestrator with tool-calling loop |
| `src/services/videoService.ts` | Create | Mocked video generation |
| `src/services/storageService.ts` | Create | Mocked draft persistence |
| `src/services/youtubeService.ts` | Create | Mocked YouTube publishing |
| `src/activities/directorActivity.ts` | Create | Temporal activity: creates Director, runs it |
| `src/activities/publishActivity.ts` | Create | Temporal activity: calls youtubeService |
| `workflows/generateQuoteContentWorkflow.ts` | Modify | Simplify to call directorActivity + publishActivity |
| `workflows/generateQuoteContentTypes.ts` | Modify | Update WorkflowStage, add DirectorLogEntry ref |
| `workflows/generateQuoteContentOutputs.ts` | Modify | Add directorLog field |
| `src/worker.ts` | Modify | Point to new activities |
| `tsconfig.json` | Modify | Include new src subdirectories |
| `activities/generateQuoteContentActivities.ts` | Delete | Replaced by agents + services |

---

### Task 1: Config and Agent Types

**Files:**
- Create: `src/lib/config.ts`
- Create: `src/agents/base/types.ts`

- [ ] **Step 1: Create `src/lib/config.ts`**

```typescript
export const config = {
  director: {
    model: 'gpt-4o' as const,
    maxTurns: 15,
  },
  agents: {
    model: 'gpt-4o-mini' as const,
    maxRetries: 3,
    qualityThreshold: 7,
  },
  activity: {
    startToCloseTimeout: '10 minutes' as const,
  },
};
```

- [ ] **Step 2: Create `src/agents/base/types.ts`**

```typescript
import type {
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
  QuoteCandidate,
} from '../../../workflows/generateQuoteContentTypes';

export interface Evaluation {
  pass: boolean;
  score: number;
  feedback: string;
  criteria: Record<string, number>;
}

export interface AgentResult<T> {
  result: T;
  evaluation: Evaluation;
  attempts: number;
  qualityWarning?: boolean;
}

export interface ResearchResult {
  candidates: QuoteCandidate[];
  selected: SelectedQuote;
}

export interface DirectorResult {
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
  directorLog: DirectorLogEntry[];
}

export interface DirectorLogEntry {
  turn: number;
  action: string;
  tool?: string;
  reasoning: string;
  outcome: 'accepted' | 'retried' | 'adjusted';
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (new files are standalone types, no errors)

- [ ] **Step 4: Commit**

```bash
git add src/lib/config.ts src/agents/base/types.ts
git commit -m "feat: add config and agent base types"
```

---

### Task 2: BaseAgent

**Files:**
- Create: `src/agents/base/BaseAgent.ts`

- [ ] **Step 1: Create `src/agents/base/BaseAgent.ts`**

```typescript
import { openai } from '../../lib/openAIClient';
import { config } from '../../lib/config';
import type { Evaluation, AgentResult } from './types';

export abstract class BaseAgent<TInput, TResult> {
  abstract name: string;
  abstract systemPrompt: string;

  protected model: string = config.agents.model;
  protected maxRetries: number = config.agents.maxRetries;
  protected qualityThreshold: number = config.agents.qualityThreshold;

  async run(input: TInput, feedbackFromDirector?: string): Promise<AgentResult<TResult>> {
    let lastResult: TResult | undefined;
    let lastEvaluation: Evaluation | undefined;
    let feedback = feedbackFromDirector;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      lastResult = await this.execute(input, feedback);
      lastEvaluation = await this.evaluate(lastResult, input);

      if (lastEvaluation.pass) {
        return {
          result: lastResult,
          evaluation: lastEvaluation,
          attempts: attempt,
        };
      }

      feedback = lastEvaluation.feedback;
    }

    return {
      result: lastResult!,
      evaluation: lastEvaluation!,
      attempts: this.maxRetries,
      qualityWarning: true,
    };
  }

  protected abstract execute(input: TInput, feedback?: string): Promise<TResult>;
  protected abstract evaluate(result: TResult, input: TInput): Promise<Evaluation>;

  protected async callLLM(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
    const response = await openai.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`${this.name}: No response from OpenAI`);
    }
    return content;
  }

  protected async evaluateWithLLM(
    result: TResult,
    criteriaPrompt: string
  ): Promise<Evaluation> {
    const response = await this.callLLM([
      {
        role: 'system',
        content: `You are a quality evaluator. Rate the following output on a scale of 1-10 for each criterion. Return JSON: { "criteria": { "<criterion>": <score> }, "pass": <boolean>, "score": <average>, "feedback": "<if not passing, explain what to improve>" }. Pass if average score >= ${this.qualityThreshold}.`,
      },
      {
        role: 'user',
        content: `Evaluate this output:\n${JSON.stringify(result, null, 2)}\n\nCriteria:\n${criteriaPrompt}`,
      },
    ]);

    return JSON.parse(response) as Evaluation;
  }
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agents/base/BaseAgent.ts
git commit -m "feat: add BaseAgent with run/evaluate/retry loop"
```

---

### Task 3: ResearchAgent

**Files:**
- Create: `src/agents/ResearchAgent.ts`

- [ ] **Step 1: Create `src/agents/ResearchAgent.ts`**

```typescript
import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { ResearchResult } from './base/types';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';

export class ResearchAgent extends BaseAgent<GenerateQuoteContentInput, ResearchResult> {
  name = 'ResearchAgent';
  systemPrompt = 'You are a quote researcher specializing in finding powerful, memorable quotes for short-form video content.';

  protected async execute(
    input: GenerateQuoteContentInput,
    feedback?: string
  ): Promise<ResearchResult> {
    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Find different, better quotes.`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Find 5 powerful quotes about "${input.topic}" suitable for a ${input.tone} ${input.platform} video (${input.durationSeconds}s).${feedbackLine}

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
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agents/ResearchAgent.ts
git commit -m "feat: add ResearchAgent with quality self-evaluation"
```

---

### Task 4: CreativeBriefAgent

**Files:**
- Create: `src/agents/CreativeBriefAgent.ts`

- [ ] **Step 1: Create `src/agents/CreativeBriefAgent.ts`**

```typescript
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
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agents/CreativeBriefAgent.ts
git commit -m "feat: add CreativeBriefAgent with quality self-evaluation"
```

---

### Task 5: PostAgent

**Files:**
- Create: `src/agents/PostAgent.ts`

- [ ] **Step 1: Create `src/agents/PostAgent.ts`**

```typescript
import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { PostDraft, SelectedQuote, CreativeBrief } from '../../workflows/generateQuoteContentTypes';

interface PostInput {
  topic: string;
  tone: string;
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  hashtags?: string[];
}

export class PostAgent extends BaseAgent<PostInput, PostDraft> {
  name = 'PostAgent';
  systemPrompt = 'You are a social media copywriter specializing in YouTube Shorts. You write metadata that maximizes engagement and discoverability.';

  protected async execute(
    input: PostInput,
    feedback?: string
  ): Promise<PostDraft> {
    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Revise accordingly.`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Write YouTube Shorts post metadata for a ${input.tone} video about "${input.topic}".

Quote: "${input.selectedQuote.text}" — ${input.selectedQuote.author}
Hook: "${input.creativeBrief.hook}"
User-provided hashtags to include: ${JSON.stringify(input.hashtags ?? [])}${feedbackLine}

Return JSON: {
  "title": "<catchy title, under 70 characters>",
  "description": "<engaging description, 2-3 sentences, naturally includes the quote>",
  "hashtags": ["<5-8 relevant hashtags, include any user-provided ones>"]
}`,
      },
    ]);

    return JSON.parse(response) as PostDraft;
  }

  protected async evaluate(
    result: PostDraft,
    input: PostInput
  ): Promise<Evaluation> {
    return this.evaluateWithLLM(
      result,
      `Platform: YouTube Shorts, Tone: "${input.tone}"
- Title click-worthiness: Would you click this title? Is it under 70 characters?
- Description engagement: Is the description compelling and does it include the quote naturally?
- Hashtag relevance: Are the hashtags relevant and a mix of broad + niche for discoverability?
- Platform fit: Does the metadata follow YouTube Shorts conventions?`
    );
  }
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agents/PostAgent.ts
git commit -m "feat: add PostAgent with quality self-evaluation"
```

---

### Task 6: Services (mocked)

**Files:**
- Create: `src/services/videoService.ts`
- Create: `src/services/storageService.ts`
- Create: `src/services/youtubeService.ts`

- [ ] **Step 1: Create `src/services/videoService.ts`**

```typescript
import type { GeneratedAssets } from '../../workflows/generateQuoteContentTypes';

export async function generateVideo(requestId: string): Promise<GeneratedAssets> {
  return {
    videoPath: `/assets/${requestId}/quote-video.mp4`,
    thumbnailPath: `/assets/${requestId}/thumbnail.png`,
    subtitlePath: `/assets/${requestId}/subtitles.srt`,
  };
}
```

- [ ] **Step 2: Create `src/services/storageService.ts`**

```typescript
export async function saveDraft(requestId: string, data: Record<string, unknown>): Promise<{ draftId: string }> {
  return {
    draftId: `draft-${requestId}`,
  };
}
```

- [ ] **Step 3: Create `src/services/youtubeService.ts`**

```typescript
export async function publishToYoutube(requestId: string): Promise<{ youtubeUrl: string }> {
  return {
    youtubeUrl: `https://youtube.com/watch?v=mock-${requestId}`,
  };
}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/videoService.ts src/services/storageService.ts src/services/youtubeService.ts
git commit -m "feat: add mocked services (video, storage, youtube)"
```

---

### Task 7: Tools layer

**Files:**
- Create: `src/tools/researchTool.ts`
- Create: `src/tools/creativeTool.ts`
- Create: `src/tools/postTool.ts`
- Create: `src/tools/videoTool.ts`
- Create: `src/tools/saveTool.ts`
- Create: `src/tools/registry.ts`

- [ ] **Step 1: Create `src/tools/researchTool.ts`**

```typescript
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
```

- [ ] **Step 2: Create `src/tools/creativeTool.ts`**

```typescript
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
```

- [ ] **Step 3: Create `src/tools/postTool.ts`**

```typescript
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
```

- [ ] **Step 4: Create `src/tools/videoTool.ts`**

```typescript
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
```

- [ ] **Step 5: Create `src/tools/saveTool.ts`**

```typescript
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
```

- [ ] **Step 6: Create `src/tools/registry.ts`**

```typescript
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
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/tools/
git commit -m "feat: add tools layer (registry + individual tool handlers)"
```

---

### Task 8: DirectorAgent

**Files:**
- Create: `src/agents/DirectorAgent.ts`

- [ ] **Step 1: Create `src/agents/DirectorAgent.ts`**

```typescript
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
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agents/DirectorAgent.ts
git commit -m "feat: add DirectorAgent with LLM tool-calling loop"
```

---

### Task 9: Activities and workflow rewire

**Files:**
- Create: `src/activities/directorActivity.ts`
- Create: `src/activities/publishActivity.ts`
- Modify: `workflows/generateQuoteContentWorkflow.ts`
- Modify: `workflows/generateQuoteContentTypes.ts`
- Modify: `workflows/generateQuoteContentOutputs.ts`
- Modify: `src/worker.ts`
- Modify: `tsconfig.json`
- Delete: `activities/generateQuoteContentActivities.ts`

- [ ] **Step 1: Create `src/activities/directorActivity.ts`**

```typescript
import { DirectorAgent } from '../agents/DirectorAgent';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import type { DirectorResult } from '../agents/base/types';

export async function runDirectorAgent(input: GenerateQuoteContentInput): Promise<DirectorResult> {
  const director = new DirectorAgent();
  return director.run(input);
}
```

- [ ] **Step 2: Create `src/activities/publishActivity.ts`**

```typescript
import { publishToYoutube } from '../services/youtubeService';

export async function publishToYoutubeActivity(requestId: string): Promise<{ youtubeUrl: string }> {
  return publishToYoutube(requestId);
}
```

- [ ] **Step 3: Update `workflows/generateQuoteContentTypes.ts`**

Replace the `WorkflowStage` type and add `DirectorLogEntry` import reference:

```typescript
// workflows/generateQuoteContentTypes.ts

export type WorkflowStage =
  | 'RECEIVED'
  | 'RUNNING_DIRECTOR'
  | 'AWAITING_APPROVAL'
  | 'PUBLISHING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';

export type ApprovalState =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface QuoteCandidate {
  text: string;
  author?: string;
  sourceType?: 'public_domain' | 'original' | 'licensed' | 'unknown';
  score?: number;
}

export interface SelectedQuote {
  text: string;
  author?: string;
  sourceType?: 'public_domain' | 'original' | 'licensed' | 'unknown';
}

export interface CreativeBrief {
  hook: string;
  visualConcept: string;
  voiceoverText: string;
  audioMood: string;
}

export interface GeneratedAssets {
  videoPath?: string;
  thumbnailPath?: string;
  subtitlePath?: string;
}

export interface PostDraft {
  title?: string;
  description?: string;
  hashtags?: string[];
  youtubeUrl?: string;
}

export interface GenerateQuoteContentState {
  stage: WorkflowStage;
  approvalState: ApprovalState;
  selectedQuote?: SelectedQuote;
  creativeBrief?: CreativeBrief;
  assets?: GeneratedAssets;
  post?: PostDraft;
  errors: string[];
}
```

- [ ] **Step 4: Update `workflows/generateQuoteContentOutputs.ts`**

Add `directorLog` field:

```typescript
// workflows/generateQuoteContentOutputs.ts

import type {
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
  ApprovalState,
} from './generateQuoteContentTypes';

export interface DirectorLogEntry {
  turn: number;
  action: string;
  tool?: string;
  reasoning: string;
  outcome: 'accepted' | 'retried' | 'adjusted';
}

export interface GenerateQuoteContentResult {
  workflowStatus: 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'PUBLISHED' | 'CANCELLED' | 'REJECTED';
  requestId: string;
  selectedQuote?: SelectedQuote;
  creativeBrief?: CreativeBrief;
  assets?: GeneratedAssets;
  post?: PostDraft;
  approvalState: ApprovalState;
  errors: string[];
  directorLog?: DirectorLogEntry[];
}
```

- [ ] **Step 5: Rewrite `workflows/generateQuoteContentWorkflow.ts`**

```typescript
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  log,
} from '@temporalio/workflow';

import type { GenerateQuoteContentInput } from './generateQuoteContentInputs';
import type { GenerateQuoteContentResult } from './generateQuoteContentOutputs';
import type { GenerateQuoteContentState } from './generateQuoteContentTypes';

import type * as directorActivities from '../src/activities/directorActivity';
import type * as publishActivities from '../src/activities/publishActivity';

const { runDirectorAgent } = proxyActivities<typeof directorActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '60 seconds',
    maximumAttempts: 3,
  },
});

const { publishToYoutubeActivity } = proxyActivities<typeof publishActivities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 3,
  },
});

export const approveDraftSignal = defineSignal('approveDraft');
export const rejectDraftSignal = defineSignal('rejectDraft');
export const cancelGenerationSignal = defineSignal('cancelGeneration');

export const getStatusQuery =
  defineQuery<GenerateQuoteContentState>('getStatus');

export async function generateQuoteContentWorkflow(
  input: GenerateQuoteContentInput
): Promise<GenerateQuoteContentResult> {
  const state: GenerateQuoteContentState = {
    stage: 'RECEIVED',
    approvalState: input.requireApproval ? 'PENDING' : 'NOT_REQUIRED',
    errors: [],
  };

  let approved = false;
  let rejected = false;
  let cancelled = false;

  setHandler(getStatusQuery, () => state);

  setHandler(approveDraftSignal, () => {
    approved = true;
    state.approvalState = 'APPROVED';
  });

  setHandler(rejectDraftSignal, () => {
    rejected = true;
    state.approvalState = 'REJECTED';
  });

  setHandler(cancelGenerationSignal, () => {
    cancelled = true;
    state.stage = 'CANCELLED';
  });

  try {
    log.info('Workflow started', {
      requestId: input.requestId,
      topic: input.topic,
    });

    state.stage = 'RUNNING_DIRECTOR';
    const directorResult = await runDirectorAgent(input);

    state.selectedQuote = directorResult.selectedQuote;
    state.creativeBrief = directorResult.creativeBrief;
    state.assets = directorResult.assets;
    state.post = directorResult.post;

    if (input.requireApproval) {
      state.stage = 'AWAITING_APPROVAL';

      await condition(() => approved || rejected || cancelled);

      if (cancelled) {
        return {
          workflowStatus: 'CANCELLED',
          requestId: input.requestId,
          selectedQuote: state.selectedQuote,
          creativeBrief: state.creativeBrief,
          assets: state.assets,
          post: state.post,
          approvalState: state.approvalState,
          errors: ['Workflow was cancelled while awaiting approval'],
          directorLog: directorResult.directorLog,
        };
      }

      if (rejected) {
        state.stage = 'REJECTED';
        return {
          workflowStatus: 'REJECTED',
          requestId: input.requestId,
          selectedQuote: state.selectedQuote,
          creativeBrief: state.creativeBrief,
          assets: state.assets,
          post: state.post,
          approvalState: state.approvalState,
          errors: ['Draft was rejected'],
          directorLog: directorResult.directorLog,
        };
      }
    }

    if (input.mode === 'auto_publish') {
      state.stage = 'PUBLISHING';

      const publishResult = await publishToYoutubeActivity(input.requestId);

      state.post = {
        ...state.post,
        youtubeUrl: publishResult.youtubeUrl,
      };

      state.stage = 'COMPLETED';

      return {
        workflowStatus: 'PUBLISHED',
        requestId: input.requestId,
        selectedQuote: state.selectedQuote,
        creativeBrief: state.creativeBrief,
        assets: state.assets,
        post: state.post,
        approvalState: state.approvalState,
        errors: state.errors,
        directorLog: directorResult.directorLog,
      };
    }

    state.stage = 'COMPLETED';

    return {
      workflowStatus: 'COMPLETED',
      requestId: input.requestId,
      selectedQuote: state.selectedQuote,
      creativeBrief: state.creativeBrief,
      assets: state.assets,
      post: state.post,
      approvalState: state.approvalState,
      errors: state.errors,
      directorLog: directorResult.directorLog,
    };
  } catch (error) {
    state.stage = 'FAILED';
    state.errors.push(
      error instanceof Error ? error.message : 'Unknown workflow error'
    );

    return {
      workflowStatus: 'FAILED',
      requestId: input.requestId,
      selectedQuote: state.selectedQuote,
      creativeBrief: state.creativeBrief,
      assets: state.assets,
      post: state.post,
      approvalState: state.approvalState,
      errors: state.errors,
    };
  }
}
```

- [ ] **Step 6: Update `src/worker.ts`**

```typescript
import 'dotenv/config';
import { Worker } from '@temporalio/worker';
import * as directorActivities from './activities/directorActivity';
import * as publishActivities from './activities/publishActivity';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('../workflows/generateQuoteContentWorkflow'),
    activities: {
      ...directorActivities,
      ...publishActivities,
    },
    taskQueue: 'quote-content-v1',
  });

  console.log('Worker started on task queue: quote-content-v1');
  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
```

- [ ] **Step 7: Update `tsconfig.json`**

The `include` array needs to cover the new `src/` subdirectories. Current `"src/**/*.ts"` already covers them, but verify `rootDir` works correctly with the cross-directory imports (`src/` importing from `workflows/`). The current config with `"rootDir": "."` and includes of both `src/**/*.ts` and `workflows/**/*.ts` should work.

No change needed — verify with type check.

- [ ] **Step 8: Delete old activities file**

```bash
rm activities/generateQuoteContentActivities.ts
```

- [ ] **Step 9: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/activities/ workflows/ src/worker.ts
git rm activities/generateQuoteContentActivities.ts
git commit -m "feat: rewire workflow to use DirectorAgent, delete old activities"
```

---

### Task 10: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

- [ ] **Step 2: Start Temporal server (if not running)**

Run: `temporal server start-dev` (in a separate terminal)

- [ ] **Step 3: Start the worker**

Run: `npm run worker`
Expected: `Worker started on task queue: quote-content-v1`

- [ ] **Step 4: Trigger the workflow**

Run: `npm run start-workflow`
Expected: Workflow completes with JSON output containing:
- `selectedQuote` — a real AI-selected quote (not hardcoded)
- `creativeBrief` — AI-generated hook, visual concept, voiceover, audio mood
- `post` — AI-generated title, description, hashtags
- `assets` — mocked paths
- `directorLog` — array showing the Director's reasoning chain (tool calls, evaluations)
- `workflowStatus: "COMPLETED"`
- `errors: []`

- [ ] **Step 5: Verify Director log shows reasoning**

In the output JSON, check `directorLog` has entries like:
```json
[
  { "turn": 1, "action": "tool_call: research_quotes", "tool": "research_quotes", ... },
  { "turn": 2, "action": "tool_call: build_creative_brief", "tool": "build_creative_brief", ... },
  ...
  { "turn": N, "action": "final_response", "reasoning": "All content assembled...", ... }
]
```

- [ ] **Step 6: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```

(Skip this step if no fixes were needed.)
