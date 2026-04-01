export async function publishToYoutube(requestId: string): Promise<{ youtubeUrl: string }> {
  return {
    youtubeUrl: `https://youtube.com/watch?v=mock-${requestId}`,
  };
}
