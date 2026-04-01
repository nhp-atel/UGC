import { publishToYoutube } from '../services/youtubeService';

export async function publishToYoutubeActivity(requestId: string): Promise<{ youtubeUrl: string }> {
  return publishToYoutube(requestId);
}
