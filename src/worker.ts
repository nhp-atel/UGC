import 'dotenv/config';
import { Worker } from '@temporalio/worker';
import * as directorActivities from './activities/directorActivity';
import * as publishActivities from './activities/publishActivity';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('../workflows/generateQuoteContentWorkflow'),
    activities: {
      ...directorActivities,
      ...publishActivities,
    },
    taskQueue: 'quote-content-v1',
  });

  console.log('Worker started on task queue: quote-content-v1');
  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
