import 'dotenv/config';
import { Worker } from '@temporalio/worker';
import * as activities from '../activities/generateQuoteContentActivities';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('../workflows/generateQuoteContentWorkflow'),
    activities,
    taskQueue: 'quote-content-v1',
  });

  console.log('Worker started on task queue: quote-content-v1');
  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});