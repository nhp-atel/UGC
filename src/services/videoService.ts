import type { GeneratedAssets } from '../../workflows/generateQuoteContentTypes';

export async function generateVideo(requestId: string): Promise<GeneratedAssets> {
  return {
    videoPath: `/assets/${requestId}/quote-video.mp4`,
    thumbnailPath: `/assets/${requestId}/thumbnail.png`,
    subtitlePath: `/assets/${requestId}/subtitles.srt`,
  };
}
