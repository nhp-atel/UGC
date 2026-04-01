# SQLite Persistence & Quote Deduplication — Design Spec

## Context

The UGC agent system has no memory between workflow runs. Every execution generates quotes from scratch, leading to repeated quotes across runs. Additionally, `storageService.saveDraft()` and workflow history are fully mocked — nothing is persisted.

This spec adds a SQLite database (`data/ugc.db`) that provides:
1. **Quote deduplication** — track used quotes, prevent repeats
2. **Draft persistence** — replace mocked `saveDraft()` with real storage
3. **Workflow history** — store execution records with inputs, results, and director logs

## Database Schema

### Table: `used_quotes`

Tracks every quote that has been selected by the ResearchAgent to prevent repetition.

```sql
CREATE TABLE IF NOT EXISTS used_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  author TEXT,
  topic TEXT NOT NULL,
  source_type TEXT,
  used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table: `drafts`

Replaces the mocked `storageService.saveDraft()`. Stores the full assembled content for each workflow run.

```sql
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  selected_quote TEXT NOT NULL,    -- JSON
  creative_brief TEXT NOT NULL,    -- JSON
  assets TEXT NOT NULL,            -- JSON
  post TEXT NOT NULL,              -- JSON
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | published
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table: `workflow_runs`

Stores execution history for every workflow run, including the full directorLog for debugging and analytics.

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  workflow_id TEXT,
  topic TEXT NOT NULL,
  tone TEXT NOT NULL,
  platform TEXT NOT NULL,
  input TEXT NOT NULL,             -- JSON: full GenerateQuoteContentInput
  result TEXT,                     -- JSON: full GenerateQuoteContentResult (set on completion)
  director_log TEXT,               -- JSON: DirectorLogEntry[] (set on completion)
  status TEXT NOT NULL DEFAULT 'started',  -- started | completed | failed
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

## Integration Points

### 1. Database initialization (`src/lib/db.ts`)

- Use `better-sqlite3` (synchronous, fast, no async overhead)
- On import, open/create `data/ugc.db` and run all three `CREATE TABLE IF NOT EXISTS` statements
- Export the db instance for use by other modules

### 2. Quote deduplication (`src/agents/ResearchAgent.ts`)

- In `execute()`, before calling the LLM:
  - Query `used_quotes` for all quotes matching the current topic
  - Also query for ALL used quotes (to catch cross-topic repeats)
  - Include the used quote texts in the LLM prompt: "The following quotes have already been used in previous videos. Do NOT use any of them: [list]"
- Dedup behavior: exclude and retry. If after `maxRetries` all generated quotes overlap with used ones, accept the best one with a `qualityWarning`

### 3. Quote recording (`src/activities/directorActivity.ts`)

- After `DirectorAgent.run()` succeeds, insert the `selectedQuote` into `used_quotes` with the topic from the input
- This happens inside the Temporal activity, so it's covered by Temporal's retry guarantees

### 4. Draft storage (`src/services/storageService.ts`)

- Replace the mocked `saveDraft()` with a real SQLite insert into the `drafts` table
- Accept the full content (quote, brief, assets, post) and the requestId
- Return the actual row ID as the draftId

### 5. Workflow history (`src/startWorkflow.ts`)

- Insert a `workflow_runs` row at workflow start (with input, topic, tone, platform, status='started')
- After `handle.result()` returns, update the row with result, director_log, status, completed_at

## File Changes

| File | Change |
|------|--------|
| `src/lib/db.ts` | **Create** — SQLite init, table creation, export db |
| `src/agents/ResearchAgent.ts` | **Modify** — query used_quotes in execute(), pass to LLM prompt |
| `src/activities/directorActivity.ts` | **Modify** — insert selected quote after Director succeeds |
| `src/services/storageService.ts` | **Modify** — real saveDraft() using drafts table |
| `src/startWorkflow.ts` | **Modify** — insert/update workflow_runs |
| `src/tools/saveTool.ts` | **Modify** — pass full content to storageService (not just requestId + generic object) |
| `package.json` | **Modify** — add `better-sqlite3` dependency |
| `.gitignore` | **Modify** — add `data/` to ignore the database file |

## Error Handling

- If the database file doesn't exist, `better-sqlite3` creates it automatically
- If the `data/` directory doesn't exist, `db.ts` creates it with `mkdirSync`
- Quote dedup is best-effort — if the DB query fails, the agent proceeds without dedup rather than crashing the workflow
- Draft insert failures surface as activity errors and trigger Temporal retry
