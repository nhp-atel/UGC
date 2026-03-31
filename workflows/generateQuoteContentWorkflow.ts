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
import type {
  GenerateQuoteContentState,
  QuoteCandidate,
  SelectedQuote,
  CreativeBrief,
  GeneratedAssets,
  PostDraft,
} from './generateQuoteContentTypes';

import type * as activities from '../activities/generateQuoteContentActivities';

const {
  researchQuotes,
  selectBestQuote,
  buildCreativeBrief,
  generateVideoDraft,
  generatePostDraft,
  saveDraft,
  publishToYoutube,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
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

    state.stage = 'RESEARCHING_QUOTES';
    const quoteCandidates: QuoteCandidate[] = await researchQuotes(input);

    if (!quoteCandidates.length) {
      throw new Error('No quote candidates returned from research step');
    }

    state.stage = 'SELECTING_QUOTE';
    const selectedQuote: SelectedQuote = await selectBestQuote({
      input,
      quoteCandidates,
    });
    state.selectedQuote = selectedQuote;

    state.stage = 'BUILDING_CREATIVE_BRIEF';
    const creativeBrief: CreativeBrief = await buildCreativeBrief({
      input,
      selectedQuote,
    });
    state.creativeBrief = creativeBrief;

    state.stage = 'GENERATING_MEDIA';
    const assets: GeneratedAssets = await generateVideoDraft({
      input,
      selectedQuote,
      creativeBrief,
    });
    state.assets = assets;

    state.stage = 'PREPARING_POST';
    const post: PostDraft = await generatePostDraft({
      input,
      selectedQuote,
      creativeBrief,
    });
    state.post = post;

    state.stage = 'SAVING_DRAFT';
    await saveDraft({
      input,
      selectedQuote,
      creativeBrief,
      assets,
      post,
    });

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
        };
      }
    }

    if (input.mode === 'auto_publish') {
      state.stage = 'PUBLISHING';

      const publishResult = await publishToYoutube({
        input,
        selectedQuote: state.selectedQuote!,
        creativeBrief: state.creativeBrief!,
        assets: state.assets!,
        post: state.post!,
      });

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