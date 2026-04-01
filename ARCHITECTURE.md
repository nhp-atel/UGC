# UGC Quote Content Workflow — Architecture

## Overview

This project generates quote-based YouTube Shorts content using an AI agent architecture built on top of Temporal workflow orchestration. An LLM-powered Director Agent coordinates specialist sub-agents to research quotes, build creative briefs, and write post metadata — with double-layered quality control at every step.

## How It Works

A user triggers the workflow with a topic (e.g., "discipline"), a tone (e.g., "cinematic"), and a target platform (YouTube Shorts). The system then:

1. The **Director Agent** (gpt-4o) receives the input and decides what to do
2. It calls the **Research Agent** to find and select the best quote
3. It evaluates the result — if quality is low, it retries with feedback
4. It calls the **Creative Brief Agent** to design the video concept
5. It calls the **Post Agent** to write the YouTube title, description, and hashtags
6. It calls the video generation and storage services (currently mocked)
7. It returns the fully assembled content package

The Director doesn't follow a hardcoded script. It reasons about what to do next using OpenAI's tool-calling API, can retry any step, and can pass feedback to agents to improve their output.

## Architecture Diagram

```
[CLI Starter / Future API]
        |
        v
[Temporal Workflow]  ── signals: approve / reject / cancel
        |                queries: getStatus
        v
[Director Activity]
        |
        v
[DirectorAgent]  ── gpt-4o, tool-calling loop
        |
        |── tool: research_quotes ──> ResearchAgent ──> OpenAI (gpt-4o-mini)
        |── tool: build_creative_brief ──> CreativeBriefAgent ──> OpenAI
        |── tool: write_post ──> PostAgent ──> OpenAI
        |── tool: generate_video ──> videoService (mocked)
        |── tool: save_draft ──> storageService ──> SQLite (drafts table)
        |
        v
[Back to Workflow]
        |── record selected quote ──> SQLite (used_quotes table)
        |── if requireApproval: wait for signal
        |── if auto_publish: publishActivity ──> youtubeService (mocked)
        v
[Final Result] ──> SQLite (workflow_runs table)
```

## Three-Plane Architecture

| Plane | What it does | Components |
|-------|-------------|------------|
| **Control Plane** | Sequence, durability, retries, signals, state | Temporal Workflow |
| **Intelligence Plane** | Reasoning, decisions, quality evaluation | DirectorAgent + Sub-Agents |
| **Execution Plane** | Side effects, API calls, I/O | Services (video, storage, YouTube) |
| **Persistence Plane** | Memory, history, deduplication | SQLite (used_quotes, drafts, workflow_runs) |

## Agent Design

### BaseAgent Pattern

All sub-agents extend `BaseAgent`, which provides a consistent execute/evaluate/retry loop:

```
for each attempt (up to 3):
    result = execute(input, feedback)
    evaluation = evaluate(result)    ← LLM rates quality 1-10
    if evaluation.pass (avg >= 7):
        return result
    else:
        feedback = evaluation.feedback   ← fed into next attempt
return result with qualityWarning: true
```

This is the first layer of quality control — each agent self-evaluates before returning.

### DirectorAgent (Orchestrator)

The second layer. The Director:
- Uses **gpt-4o** for strong reasoning
- Runs an OpenAI **tool-calling loop** — it decides which tool to call, evaluates the result, and can retry with feedback
- Has a **safety limit of 15 turns** to prevent infinite loops
- Logs every decision to `directorLog` for debugging and transparency

### Sub-Agents

| Agent | Model | Job | Self-evaluation criteria |
|-------|-------|-----|------------------------|
| **ResearchAgent** | gpt-4o-mini | Find 5 quotes, score them, select the best (checks SQLite for previously used quotes) | Relevance, emotional impact, originality, attribution clarity |
| **CreativeBriefAgent** | gpt-4o-mini | Create hook, visual concept, voiceover, audio mood | Hook strength, visual-quote coherence, voiceover naturalness, tone consistency |
| **PostAgent** | gpt-4o-mini | Write title, description, hashtags | Title click-worthiness, description engagement, hashtag relevance, platform fit |

## Project Structure

```
src/
  worker.ts                      ← Temporal worker entry point
  startWorkflow.ts               ← CLI trigger to start a workflow

  activities/
    directorActivity.ts          ← Runs the DirectorAgent
    publishActivity.ts           ← Calls YouTube service (separate for durability)

  agents/
    base/
      BaseAgent.ts               ← Abstract class: run/evaluate/retry loop
      types.ts                   ← Evaluation, AgentResult, DirectorResult types
    DirectorAgent.ts             ← LLM orchestrator with tool-calling loop
    ResearchAgent.ts             ← Quote research + selection
    CreativeBriefAgent.ts        ← Creative direction
    PostAgent.ts                 ← Post metadata

  tools/
    registry.ts                  ← All tool definitions + dispatcher
    researchTool.ts              ← Wraps ResearchAgent as OpenAI function
    creativeTool.ts              ← Wraps CreativeBriefAgent
    postTool.ts                  ← Wraps PostAgent
    videoTool.ts                 ← Wraps videoService
    saveTool.ts                  ← Wraps storageService

  services/
    videoService.ts              ← [mocked] Video/thumbnail/subtitle generation
    storageService.ts            ← Draft persistence (SQLite)
    youtubeService.ts            ← [mocked] YouTube publishing

  lib/
    openAIClient.ts              ← OpenAI SDK singleton
    config.ts                    ← Models, thresholds, timeouts
    db.ts                        ← SQLite database init + table creation

data/
  ugc.db                         ← SQLite database file (gitignored)

workflows/
  generateQuoteContentWorkflow.ts  ← Temporal workflow definition
  generateQuoteContentInputs.ts    ← Input schema
  generateQuoteContentOutputs.ts   ← Output schema + DirectorLogEntry
  generateQuoteContentTypes.ts     ← Shared types (stages, quotes, briefs, etc.)
```

## Data Flow

```
startWorkflow.ts
  │  Input: { topic, tone, platform, durationSeconds, mode, requireApproval, ... }
  ▼
Temporal Workflow
  │  state.stage = "RUNNING_DIRECTOR"
  ▼
directorActivity.ts → DirectorAgent.run(input)
  │
  │  Turn 1: Director calls research_quotes
  │    → ResearchAgent: execute → evaluate (8/10 pass) → return
  │
  │  Turn 2: Director calls build_creative_brief
  │    → CreativeBriefAgent: execute → evaluate (6/10 fail)
  │    → retry with feedback → evaluate (8/10 pass) → return
  │
  │  Turn 3: Director calls write_post
  │    → PostAgent: execute → evaluate (9/10 pass) → return
  │
  │  Turn 4: Director calls generate_video → mocked paths
  │  Turn 5: Director calls save_draft → SQLite drafts table
  │  Turn 6: Director assembles and returns final JSON
  ▼
Back to Workflow
  │  if requireApproval → wait for approve/reject/cancel signal
  │  if auto_publish → call publishActivity
  ▼
Final Result: { selectedQuote, creativeBrief, assets, post, directorLog }
```

## Workflow Input

```typescript
{
  requestId: string;
  topic: string;                           // e.g., "discipline"
  platform: 'youtube_shorts';
  tone: 'cinematic' | 'calm' | 'bold' | 'minimal';
  durationSeconds: number;                 // e.g., 15
  mode: 'draft_only' | 'auto_publish';
  requireApproval: boolean;
  preferredVoice?: string;
  visualStyle?: string;
  hashtags?: string[];
}
```

## Workflow Output

```typescript
{
  workflowStatus: 'COMPLETED' | 'FAILED' | 'PUBLISHED' | 'CANCELLED' | 'REJECTED';
  requestId: string;
  selectedQuote: { text, author, sourceType };
  creativeBrief: { hook, visualConcept, voiceoverText, audioMood };
  assets: { videoPath, thumbnailPath, subtitlePath };
  post: { title, description, hashtags };
  approvalState: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  errors: string[];
  directorLog: DirectorLogEntry[];   // full reasoning trace
}
```

## Running the Project

### Prerequisites

- Node.js 20+
- Temporal server (install via `brew install temporal`)
- OpenAI API key with credits

### Setup

```bash
npm install
echo 'OPENAI_API_KEY=sk-proj-your-key' > .env
```

### Run

Terminal 1 — Start Temporal:
```bash
temporal server start-dev
```

Terminal 2 — Start the worker:
```bash
npm run worker
```

Terminal 3 — Trigger a workflow:
```bash
npm run start-workflow
```

### Signals

While a workflow is running with `requireApproval: true`, you can send signals:

```bash
# Approve
temporal workflow signal --workflow-id <id> --name approveDraft

# Reject
temporal workflow signal --workflow-id <id> --name rejectDraft

# Cancel
temporal workflow signal --workflow-id <id> --name cancelGeneration
```

### Query status

```bash
temporal workflow query --workflow-id <id> --name getStatus
```

## Configuration

All tunable parameters are in `src/lib/config.ts`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `director.model` | `gpt-4o` | Model for the orchestrator (needs strong reasoning) |
| `director.maxTurns` | `15` | Safety limit on Director loop iterations |
| `agents.model` | `gpt-4o-mini` | Model for sub-agents (cost-efficient) |
| `agents.maxRetries` | `3` | Max self-evaluation retry attempts per agent |
| `agents.qualityThreshold` | `7` | Minimum average score (1-10) to pass evaluation |
| `activity.startToCloseTimeout` | `10 minutes` | Temporal activity timeout |

## SQLite Persistence

The system uses a local SQLite database (`data/ugc.db`) for memory and persistence. The database is created automatically on first run.

### Tables

| Table | Purpose | Written by |
|-------|---------|-----------|
| `used_quotes` | Stores every selected quote to prevent repetition | `directorActivity.ts` after Director succeeds |
| `drafts` | Persists assembled content (quote, brief, assets, post) | `storageService.saveDraft()` via save_draft tool |
| `workflow_runs` | Tracks every workflow execution with inputs, results, logs | `startWorkflow.ts` on start and completion |

### Quote Deduplication Flow

```
ResearchAgent.execute()
  │  Query: SELECT DISTINCT text FROM used_quotes
  │  → ["quote A", "quote B", ...]
  ▼
LLM prompt includes: "Do NOT use these quotes: [list]"
  │
  ▼
Returns new, unused quotes
  │
  ▼  (after workflow succeeds)
directorActivity inserts selected quote into used_quotes
```

If all quotes for a topic have been used, the agent retries with feedback. After `maxRetries`, it accepts the best available quote with a `qualityWarning`.

## What's Mocked (Future Work)

| Service | Current State | Future Integration |
|---------|--------------|-------------------|
| Video generation | Returns placeholder file paths | Remotion, FFmpeg, Creatomate, or Shotstack |
| YouTube publishing | Returns a mock URL | YouTube Data API v3 |
| TTS/voiceover | Not implemented | ElevenLabs, OpenAI TTS |
| Music/audio | Not implemented | Mubert, Soundraw |

## Build History

### Phase 1: Workflow Skeleton
- Temporal workflow with 7 sequential activities
- OpenAI wired to 4 activities (research, select, brief, post)
- 3 activities mocked (video, storage, publish)
- Signals and queries for approval flow

### Phase 2: Agent Architecture Redesign
- Introduced BaseAgent with execute/evaluate/retry loop
- Created 3 specialist sub-agents (Research, CreativeBrief, Post)
- Built tools layer bridging OpenAI function calling to agents
- Created DirectorAgent as LLM-powered orchestrator
- Simplified workflow to single activity call
- Extracted services layer from activities
- Added directorLog for reasoning transparency

### Phase 3: SQLite Persistence & Quote Deduplication
- Added SQLite database (`data/ugc.db`) with `better-sqlite3`
- `used_quotes` table prevents quote repetition across runs
- ResearchAgent queries used quotes and excludes them from LLM prompt
- `drafts` table replaces mocked storage with real persistence
- `workflow_runs` table tracks execution history with full inputs, results, and director logs
- Agents now have memory — they learn from past runs
