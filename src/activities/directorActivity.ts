import { DirectorAgent } from '../agents/DirectorAgent';
import type { GenerateQuoteContentInput } from '../../workflows/generateQuoteContentInputs';
import type { DirectorResult } from '../agents/base/types';

export async function runDirectorAgent(input: GenerateQuoteContentInput): Promise<DirectorResult> {
  const director = new DirectorAgent();
  return director.run(input);
}
