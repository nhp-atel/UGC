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
