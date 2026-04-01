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
