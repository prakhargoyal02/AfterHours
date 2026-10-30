export type Track = {
  id: string; provider: string; provider_id: string; title: string; artist: string;
  artist_id: string; artwork: string | null; duration: number; genre: string;
  playback: 'audio' | 'youtube'; playback_url: string; permalink: string;
};
export const modes = ['Couple', 'Friends', 'Party', 'Distance', 'Road Trip', 'Bike Ride', 'Hiking', 'Study/Focus', 'Workout'] as const;
