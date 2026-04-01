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
