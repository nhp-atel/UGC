import { Client, Connection } from '@temporalio/client';
import { generateQuoteContentWorkflow } from '../workflows/generateQuoteContentWorkflow';
import { db } from './lib/db';

async function run() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  const input = {
    requestId: `req-${Date.now()}`,
    topic: 'discipline',
    platform: 'youtube_shorts' as const,
    tone: 'cinematic' as const,
    durationSeconds: 15,
    mode: 'draft_only' as const,
    requireApproval: false,
    hashtags: ['#motivation', '#discipline', '#shorts'],
  };

  const workflowId = `generate-quote-content-${Date.now()}`;

  const handle = await client.workflow.start(generateQuoteContentWorkflow, {
    taskQueue: 'quote-content-v1',
    workflowId,
    args: [input],
  });

  console.log('Workflow started');
  console.log('Workflow ID:', handle.workflowId);
  console.log('Run ID:', handle.firstExecutionRunId);

  const insertRun = db.prepare(`
    INSERT INTO workflow_runs (request_id, workflow_id, topic, tone, platform, input)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertRun.run(
    input.requestId,
    handle.workflowId,
    input.topic,
    input.tone,
    input.platform,
    JSON.stringify(input),
  );

  const result = await handle.result();
  console.log('Workflow result:', JSON.stringify(result, null, 2));

  const updateRun = db.prepare(`
    UPDATE workflow_runs
    SET result = ?, director_log = ?, status = ?, completed_at = datetime('now')
    WHERE request_id = ?
  `);
  updateRun.run(
    JSON.stringify(result),
    JSON.stringify(result.directorLog ?? null),
    result.workflowStatus === 'COMPLETED' || result.workflowStatus === 'PUBLISHED' ? 'completed' : 'failed',
    input.requestId,
  );
}

run().catch((err) => {
  console.error('Failed to start workflow:', err);
  process.exit(1);
});
