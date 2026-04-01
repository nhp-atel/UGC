export const config = {
  director: {
    model: 'gpt-4o' as const,
    maxTurns: 15,
  },
  agents: {
    model: 'gpt-4o-mini' as const,
    maxRetries: 3,
    qualityThreshold: 7,
  },
  activity: {
    startToCloseTimeout: '10 minutes' as const,
  },
};
