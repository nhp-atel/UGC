# UGC Agent Architecture Redesign — Design Spec

## Context

The UGC project is a Temporal-based workflow that generates quote-based YouTube Shorts content. Phase 1 established the workflow skeleton with OpenAI-powered text generation in activities. However, the current design is a rigid pipeline — not an agent system. The AI fills in templates but makes no decisions.

This redesign introduces an **LLM-Driven Orchestrator (Director Agent)** pattern where a central AI agent reasons about what to do, calls specialist sub-agents as tools, evaluates results, and retries or adjusts until quality meets a bar. Sub-agents also self-evaluate internally, creating double-layered quality control.

**Goal:** Better content quality through autonomous AI decision-making and self-evaluation.

---

## Architecture Overview

```
Trigger (CLI / API / Scheduler)
  └─▶ Temporal Workflow (thin shell)
        ├─▶ runDirectorAgent(input)       ← single activity
        ├─▶ handle signals (approve/reject/cancel)
        └─▶ return final result

DirectorAgent (gpt-4o, tool-calling loop)
  ├─▶ research_quotes tool   → ResearchAgent
  ├─▶ build_creative_brief   → CreativeBriefAgent
  ├─▶ write_post tool        → PostAgent
  ├─▶ generate_video tool    → videoService (mocked)
  ├─▶ save_draft tool        → storageService (mocked)
  (publish stays as separate Temporal activity — not inside Director)

Each sub-agent: execute → self-evaluate → retry (up to 3x)
Director: evaluates each tool result → re-invokes with feedback if needed
```

### Layer Responsibilities

| Layer | Role | Changes from Phase 1 |
|-------|------|---------------------|
| **Temporal Workflow** | Durability, signals, approval gate, final result | Simplified — calls one activity instead of seven |
| **Activity** | Bridges Temporal ↔ Agent layer | Single `directorActivity` replaces all previous activities |
| **Director Agent** | LLM-powered orchestrator with tools | New — this is the brain |
| **Sub-Agents** | Domain-specific AI with quality loops | New — replaces inline OpenAI calls |
| **Tools** | OpenAI function definitions, bridges Director ↔ agents/services | New layer |
| **Services** | External API integrations (no AI logic) | New — extracted from activities |
| **Lib** | OpenAI client, config | Unchanged |

---

## Agent Designs

### BaseAgent (shared pattern)

All agents extend `BaseAgent`:

```
class BaseAgent {
  name: string
  systemPrompt: string
  maxRetries: number = 3
  model: string = "gpt-4o-mini"

  async run(input, feedbackFromDirector?):
    for attempt in 1..maxRetries:
      result = await this.execute(input, feedbackFromDirector)
      evaluation = await this.evaluate(result)
      if evaluation.pass:
        return { result, evaluation, attempts: attempt }
      feedbackFromDirector = evaluation.feedback
    return { result, evaluation, attempts: maxRetries, qualityWarning: true }

  abstract execute(input, feedback?): Promise<T>
  abstract evaluate(result: T): Promise<Evaluation>
}
```

**Types:**
```typescript
interface AgentResult<T> {
  result: T;
  evaluation: Evaluation;
  attempts: number;
  qualityWarning?: boolean;
}

interface Evaluation {
  pass: boolean;
  score: number;        // 1-10
  feedback: string;     // reason for pass/fail, used in retry
  criteria: Record<string, number>;  // per-criterion scores
}
```

### DirectorAgent

- **Model:** gpt-4o (needs strong reasoning for orchestration)
- **Pattern:** OpenAI chat completion loop with tool calling
- **System prompt:** Instructs the Director to coordinate sub-agents, evaluate quality, retry when needed, and assemble final content
- **Tools:** `research_quotes`, `build_creative_brief`, `write_post`, `generate_video`, `save_draft`
- **Loop:** Sends messages to OpenAI, executes any tool calls, appends results, repeats until the model returns a final text response (no more tool calls)
- **Returns:** `{ selectedQuote, creativeBrief, assets, post, directorLog }`
- **`directorLog`:** Array of decisions the Director made — useful for debugging ("retried research because quote was overused", "brief tone didn't match, revised")

### ResearchAgent

- **Model:** gpt-4o-mini
- **execute():** Calls OpenAI to find 5+ quotes on the topic, score them, and select the best. Accepts optional feedback to find different quotes on retry.
- **evaluate():** Calls OpenAI to rate the selection on: relevance to topic, emotional impact, originality, attribution clarity. Pass threshold: average >= 7/10.
- **Returns:** `{ candidates: QuoteCandidate[], selected: SelectedQuote }`

### CreativeBriefAgent

- **Model:** gpt-4o-mini
- **execute():** Calls OpenAI to create hook, visual concept, voiceover text, and audio mood for the given quote/tone/platform.
- **evaluate():** Rates on: hook strength, visual-quote coherence, voiceover naturalness, tone consistency. Pass threshold: average >= 7/10.
- **Returns:** `CreativeBrief { hook, visualConcept, voiceoverText, audioMood }`

### PostAgent

- **Model:** gpt-4o-mini
- **execute():** Calls OpenAI to write YouTube Shorts title (< 70 chars), description, and 5-8 hashtags.
- **evaluate():** Rates on: title click-worthiness, description engagement, hashtag relevance, platform fit. Pass threshold: average >= 7/10.
- **Returns:** `PostDraft { title, description, hashtags }`

---

## Folder Structure

```
src/
  ├── worker.ts
  ├── startWorkflow.ts
  │
  ├── workflows/
  │     ├── generateQuoteContentWorkflow.ts
  │     ├── generateQuoteContentInputs.ts
  │     ├── generateQuoteContentOutputs.ts
  │     └── generateQuoteContentTypes.ts
  │
  ├── activities/
  │     └── directorActivity.ts
  │
  ├── agents/
  │     ├── base/
  │     │     ├── BaseAgent.ts
  │     │     └── types.ts
  │     ├── DirectorAgent.ts
  │     ├── ResearchAgent.ts
  │     ├── CreativeBriefAgent.ts
  │     └── PostAgent.ts
  │
  ├── tools/
  │     ├── registry.ts
  │     ├── researchTool.ts
  │     ├── creativeTool.ts
  │     ├── postTool.ts
  │     ├── videoTool.ts
  │     └── saveTool.ts
  │
  ├── services/
  │     ├── videoService.ts
  │     ├── storageService.ts
  │     └── youtubeService.ts
  │
  └── lib/
        ├── openAIClient.ts
        └── config.ts
```

### What moves where

| Current file | Becomes |
|-------------|---------|
| `activities/generateQuoteContentActivities.ts` | Deleted — logic splits into agents + services |
| `researchQuotes()` + `selectBestQuote()` | `agents/ResearchAgent.ts` |
| `buildCreativeBrief()` | `agents/CreativeBriefAgent.ts` |
| `generatePostDraft()` | `agents/PostAgent.ts` |
| `generateVideoDraft()` | `services/videoService.ts` |
| `saveDraft()` | `services/storageService.ts` |
| `publishToYoutube()` | `services/youtubeService.ts` |
| `workflows/` | Simplified — workflow calls one activity |

### What's new

| File | Purpose |
|------|---------|
| `agents/base/BaseAgent.ts` | Shared run/evaluate/retry loop |
| `agents/base/types.ts` | AgentResult, Evaluation types |
| `agents/DirectorAgent.ts` | LLM orchestrator with tool-calling loop |
| `activities/directorActivity.ts` | Temporal activity that creates and runs the Director |
| `tools/registry.ts` | OpenAI function definitions + execution map |
| `tools/*.ts` | Individual tool handlers bridging Director → agents/services |
| `lib/config.ts` | Centralized config (models, thresholds, max retries) |

---

## Data Flow

```
startWorkflow.ts
  │  { topic, tone, platform, mode, requireApproval, ... }
  ▼
Temporal Workflow
  │  state.stage = "RUNNING_DIRECTOR"
  │  calls directorActivity(input)
  ▼
directorActivity.ts
  │  creates DirectorAgent with tools from registry
  │  calls director.run(input)
  ▼
DirectorAgent — OpenAI tool-calling loop
  │
  │  Turn 1: tool_call research_quotes → ResearchAgent.run()
  │    Agent: execute (OpenAI) → evaluate (OpenAI) → retry if < 7
  │    Returns: { candidates, selected, evaluation }
  │
  │  Turn 2: Director evaluates result, decides next step
  │    tool_call build_creative_brief → CreativeBriefAgent.run()
  │    Agent: execute → evaluate → retry if needed
  │    Returns: { hook, visualConcept, voiceoverText, audioMood, evaluation }
  │
  │  Turn 3: tool_call write_post → PostAgent.run()
  │    Agent: execute → evaluate → retry if needed
  │    Returns: { title, description, hashtags, evaluation }
  │
  │  Turn 4: tool_call generate_video → videoService (mocked)
  │  Turn 5: tool_call save_draft → storageService (mocked)
  │  Turn 6: Director returns final assembled result
  ▼
Back to workflow
  │  if requireApproval → wait for signal
  │  if auto_publish → call publishActivity
  │  return GenerateQuoteContentResult
```

---

## Workflow Changes

The workflow simplifies significantly:

```typescript
// Before: 7 sequential activity calls with inline logic
// After: 1 activity call + approval handling

export async function generateQuoteContentWorkflow(input) {
  // ... signal/query handlers (unchanged) ...

  state.stage = 'RUNNING_DIRECTOR';
  const directorResult = await runDirectorAgent(input);

  state.selectedQuote = directorResult.selectedQuote;
  state.creativeBrief = directorResult.creativeBrief;
  state.assets = directorResult.assets;
  state.post = directorResult.post;

  if (input.requireApproval) {
    state.stage = 'AWAITING_APPROVAL';
    await condition(() => approved || rejected || cancelled);
    // ... handle approval/rejection ...
  }

  if (input.mode === 'auto_publish') {
    state.stage = 'PUBLISHING';
    const publishResult = await publishToYoutube(/* ... */);
    // ...
  }

  state.stage = 'COMPLETED';
  return { /* ... */ };
}
```

**Note:** `publishToYoutube` stays as a separate Temporal activity (not inside the Director) because publishing is a side effect that benefits from Temporal's durability guarantees independently of the Director's reasoning.

---

## Configuration

`src/lib/config.ts`:
```typescript
export const config = {
  director: {
    model: 'gpt-4o',
    maxTurns: 15,           // safety limit on Director loop
  },
  agents: {
    model: 'gpt-4o-mini',
    maxRetries: 3,
    qualityThreshold: 7,    // minimum average score to pass
  },
  activity: {
    startToCloseTimeout: '10 minutes',  // longer — Director loop takes time
  },
};
```

---

## Error Handling

- **Agent quality warning:** If an agent exhausts retries without passing the quality bar, it returns the best result with `qualityWarning: true`. The Director decides whether to accept it or try a different approach.
- **Director max turns:** Safety limit (15 turns). If reached, Director returns whatever it has assembled so far with an error note.
- **Temporal retry:** The `directorActivity` has Temporal-level retry (3 attempts). If the entire Director crashes, Temporal retries the whole thing.
- **OpenAI API errors:** Caught inside agents, surfaced as evaluation failures. Temporal retry handles persistent API outages.

---

## Types Changes

### New types (`agents/base/types.ts`)
```typescript
interface Evaluation {
  pass: boolean;
  score: number;
  feedback: string;
  criteria: Record<string, number>;
}

interface AgentResult<T> {
  result: T;
  evaluation: Evaluation;
  attempts: number;
  qualityWarning?: boolean;
}

interface DirectorResult {
  selectedQuote: SelectedQuote;
  creativeBrief: CreativeBrief;
  assets: GeneratedAssets;
  post: PostDraft;
  directorLog: DirectorLogEntry[];
}

interface DirectorLogEntry {
  turn: number;
  action: string;
  tool?: string;
  reasoning: string;
  outcome: 'accepted' | 'retried' | 'adjusted';
}
```

### Existing types unchanged
- `GenerateQuoteContentInput` — no changes
- `GenerateQuoteContentResult` — add optional `directorLog` field
- `QuoteCandidate`, `SelectedQuote`, `CreativeBrief`, `GeneratedAssets`, `PostDraft` — no changes
- `WorkflowStage` — replace granular stages with `'RUNNING_DIRECTOR'`, keep `'AWAITING_APPROVAL'`, `'PUBLISHING'`, `'COMPLETED'`, `'FAILED'`, `'CANCELLED'`, `'REJECTED'`

---

## Verification Plan

1. **Unit test each agent:** Create a test that runs each agent in isolation with sample input, verifies it returns a valid result with evaluation scores
2. **Test Director tool loop:** Mock the sub-agents, verify the Director calls tools in a reasonable order and handles retry scenarios
3. **Integration test:** Run `npm run worker` + `npm run start-workflow` end-to-end, verify the output contains real AI-generated content with quality scores
4. **Check Director log:** Verify `directorLog` shows the reasoning chain and any retries
5. **Type check:** `npx tsc --noEmit` passes clean
6. **Approval flow:** Test with `requireApproval: true`, send approve/reject signals, verify correct behavior
