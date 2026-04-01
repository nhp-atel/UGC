export async function saveDraft(requestId: string, data: Record<string, unknown>): Promise<{ draftId: string }> {
  return {
    draftId: `draft-${requestId}`,
  };
}
