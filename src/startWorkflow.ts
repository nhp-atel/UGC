import { Client, Connection } from '@temporalio/client';
import { generateQuoteContentWorkflow } from '../workflows/generateQuoteContentWorkflow';

async function run() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  const handle = await client.workflow.start(generateQuoteContentWorkflow, {
    taskQueue: 'quote-content-v1',
    workflowId: `generate-quote-content-${Date.now()}`,
    args: [
      {
        requestId: `req-${Date.now()}`,
        topic: 'discipline',
        platform: 'youtube_shorts',
        tone: 'cinematic',
        durationSeconds: 15,
        mode: 'draft_only',
        requireApproval: false,
        hashtags: ['#motivation', '#discipline', '#shorts'],
      },
    ],
  });

  console.log('Workflow started');
  console.log('Workflow ID:', handle.workflowId);
  console.log('Run ID:', handle.firstExecutionRunId);

  const result = await handle.result();
  console.log('Workflow result:', JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error('Failed to start workflow:', err);
  process.exit(1);
});