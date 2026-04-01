# SQLite Persistence & Quote Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite persistence for quote deduplication, draft storage, and workflow history so agents learn from past runs and don't repeat quotes.

**Architecture:** A single SQLite database (`data/ugc.db`) with three tables: `used_quotes`, `drafts`, `workflow_runs`. The database is initialized on first import of `src/lib/db.ts`. ResearchAgent reads used quotes before generating, directorActivity writes the selected quote after success, storageService persists real drafts, and startWorkflow records execution history.

**Tech Stack:** `better-sqlite3` (synchronous SQLite for Node.js), `@types/better-sqlite3`

**Spec:** `docs/superpowers/specs/2026-03-31-sqlite-persistence-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/db.ts` | Create | SQLite init, table creation, export db instance |
| `src/services/storageService.ts` | Modify | Replace mock with real SQLite insert into `drafts` |
| `src/agents/ResearchAgent.ts` | Modify | Query `used_quotes` before LLM call, include in prompt |
| `src/activities/directorActivity.ts` | Modify | Insert selected quote into `used_quotes` after success |
| `src/tools/saveTool.ts` | Modify | Pass structured content to storageService |
| `src/startWorkflow.ts` | Modify | Insert/update `workflow_runs` |
| `package.json` | Modify | Add `better-sqlite3` + `@types/better-sqlite3` |
| `.gitignore` | Modify | Add `data/` |

---

### Task 1: Install dependencies and database init

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `src/lib/db.ts`

- [ ] **Step 1: Install `better-sqlite3`**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Add `data/` to `.gitignore`**

Append to `.gitignore`:
```
data/
```

- [ ] **Step 3: Create `src/lib/db.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ugc.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS used_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    author TEXT,
    topic TEXT NOT NULL,
    source_type TEXT,
    used_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    selected_quote TEXT NOT NULL,
    creative_brief TEXT NOT NULL,
    assets TEXT NOT NULL,
    post TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    workflow_id TEXT,
    topic TEXT NOT NULL,
    tone TEXT NOT NULL,
    platform TEXT NOT NULL,
    input TEXT NOT NULL,
    result TEXT,
    director_log TEXT,
    status TEXT NOT NULL DEFAULT 'started',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts .gitignore package.json package-lock.json
git commit -m "feat: add SQLite database with used_quotes, drafts, workflow_runs tables"
```

---

### Task 2: Replace mocked storageService with real SQLite persistence

**Files:**
- Modify: `src/services/storageService.ts`
- Modify: `src/tools/saveTool.ts`

- [ ] **Step 1: Rewrite `src/services/storageService.ts`**

```typescript
import { db } from '../lib/db';

interface SaveDraftInput {
  requestId: string;
  selectedQuote: Record<string, unknown>;
  creativeBrief: Record<string, unknown>;
  assets: Record<string, unknown>;
  post: Record<string, unknown>;
}

export function saveDraft(input: SaveDraftInput): { draftId: string } {
  const stmt = db.prepare(`
    INSERT INTO drafts (request_id, selected_quote, creative_brief, assets, post)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.requestId,
    JSON.stringify(input.selectedQuote),
    JSON.stringify(input.creativeBrief),
    JSON.stringify(input.assets),
    JSON.stringify(input.post),
  );

  return { draftId: `draft-${result.lastInsertRowid}` };
}
```

- [ ] **Step 2: Update `src/tools/saveTool.ts`**

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
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/storageService.ts src/tools/saveTool.ts
git commit -m "feat: replace mocked storageService with real SQLite draft persistence"
```

---

### Task 3: Quote deduplication in ResearchAgent

**Files:**
- Modify: `src/agents/ResearchAgent.ts`

- [ ] **Step 1: Update `src/agents/ResearchAgent.ts`**

```typescript
import { BaseAgent } from './base/BaseAgent';
import type { Evaluation } from './base/types';
import type { ResearchResult } from './base/types';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import { db } from '../lib/db';

export class ResearchAgent extends BaseAgent<GenerateQuoteContentInput, ResearchResult> {
  name = 'ResearchAgent';
  systemPrompt = 'You are a quote researcher specializing in finding powerful, memorable quotes for short-form video content.';

  private getUsedQuotes(topic: string): string[] {
    const rows = db.prepare(
      'SELECT DISTINCT text FROM used_quotes ORDER BY used_at DESC'
    ).all() as Array<{ text: string }>;

    return rows.map(r => r.text);
  }

  protected async execute(
    input: GenerateQuoteContentInput,
    feedback?: string
  ): Promise<ResearchResult> {
    const usedQuotes = this.getUsedQuotes(input.topic);

    const feedbackLine = feedback
      ? `\nPrevious attempt feedback: "${feedback}". Find different, better quotes.`
      : '';

    const usedQuotesLine = usedQuotes.length > 0
      ? `\n\nIMPORTANT: The following quotes have already been used in previous videos. Do NOT select any of them:\n${usedQuotes.map(q => `- "${q}"`).join('\n')}`
      : '';

    const response = await this.callLLM([
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: `Find 5 powerful quotes about "${input.topic}" suitable for a ${input.tone} ${input.platform} video (${input.durationSeconds}s).${feedbackLine}${usedQuotesLine}

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
git commit -m "feat: add quote deduplication - ResearchAgent reads used_quotes before generating"
```

---

### Task 4: Record selected quote after Director succeeds

**Files:**
- Modify: `src/activities/directorActivity.ts`

- [ ] **Step 1: Update `src/activities/directorActivity.ts`**

```typescript
import { DirectorAgent } from '../agents/DirectorAgent';
import { db } from '../lib/db';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import type { DirectorResult } from '../agents/base/types';

export async function runDirectorAgent(input: GenerateQuoteContentInput): Promise<DirectorResult> {
  const director = new DirectorAgent();
  const result = await director.run(input);

  const stmt = db.prepare(
    'INSERT INTO used_quotes (text, author, topic, source_type) VALUES (?, ?, ?, ?)'
  );
  stmt.run(
    result.selectedQuote.text,
    result.selectedQuote.author ?? null,
    input.topic,
    result.selectedQuote.sourceType ?? null,
  );

  return result;
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/activities/directorActivity.ts
git commit -m "feat: record selected quote in used_quotes after Director succeeds"
```

---

### Task 5: Workflow history tracking

**Files:**
- Modify: `src/startWorkflow.ts`

- [ ] **Step 1: Rewrite `src/startWorkflow.ts`**

```typescript
import { Client, Connection } from '@temporalio/client';
import { generateQuoteContentWorkflow } from '../workflows/generateQuoteContentWorkflow';
import { db } from './lib/db';

async function run() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  const input = {
    requestId: `req-${Date.now()}`,
    topic: 'discipline',
    platform: 'youtube_shorts' as const,
    tone: 'cinematic' as const,
    durationSeconds: 15,
    mode: 'draft_only' as const,
    requireApproval: false,
    hashtags: ['#motivation', '#discipline', '#shorts'],
  };

  const workflowId = `generate-quote-content-${Date.now()}`;

  const handle = await client.workflow.start(generateQuoteContentWorkflow, {
    taskQueue: 'quote-content-v1',
    workflowId,
    args: [input],
  });

  console.log('Workflow started');
  console.log('Workflow ID:', handle.workflowId);
  console.log('Run ID:', handle.firstExecutionRunId);

  const insertRun = db.prepare(`
    INSERT INTO workflow_runs (request_id, workflow_id, topic, tone, platform, input)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertRun.run(
    input.requestId,
    handle.workflowId,
    input.topic,
    input.tone,
    input.platform,
    JSON.stringify(input),
  );

  const result = await handle.result();
  console.log('Workflow result:', JSON.stringify(result, null, 2));

  const updateRun = db.prepare(`
    UPDATE workflow_runs
    SET result = ?, director_log = ?, status = ?, completed_at = datetime('now')
    WHERE request_id = ?
  `);
  updateRun.run(
    JSON.stringify(result),
    JSON.stringify(result.directorLog ?? null),
    result.workflowStatus === 'COMPLETED' || result.workflowStatus === 'PUBLISHED' ? 'completed' : 'failed',
    input.requestId,
  );
}

run().catch((err) => {
  console.error('Failed to start workflow:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/startWorkflow.ts
git commit -m "feat: track workflow runs in SQLite (insert on start, update on completion)"
```

---

### Task 6: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

- [ ] **Step 2: Restart worker and run workflow twice**

Restart the worker (Ctrl+C, then `npm run worker`), then:

Run: `npm run start-workflow`
Expected: Workflow completes successfully, `data/ugc.db` is created

Run: `npm run start-workflow` (second time)
Expected: Workflow completes with a DIFFERENT quote than the first run

- [ ] **Step 3: Verify database contents**

Run:
```bash
npx tsx -e "
import { db } from './src/lib/db';
console.log('Used quotes:', db.prepare('SELECT text, author, topic FROM used_quotes').all());
console.log('Drafts:', db.prepare('SELECT id, request_id, status FROM drafts').all());
console.log('Workflow runs:', db.prepare('SELECT request_id, topic, status FROM workflow_runs').all());
"
```

Expected: 2 used quotes (different texts), 2 drafts, 2 workflow runs

- [ ] **Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```

(Skip this step if no fixes were needed.)
