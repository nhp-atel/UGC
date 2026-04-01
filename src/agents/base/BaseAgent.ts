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
