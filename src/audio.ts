import type { Track } from './types';

/** A provider seam: replace local audio URLs with entitled provider playback later. */
export class MusicPlayer {
  audio = new Audio();
  context?: AudioContext;
  analyser?: AnalyserNode;
  currentId = '';
  constructor() { this.audio.crossOrigin = 'anonymous'; this.audio.preload = 'metadata'; this.audio.volume = 0.65; }
  async load(track: Track, play = true, position = 0) {
    if (track.playback !== 'audio') throw new Error('Open this track in the official YouTube player.');
    if (this.currentId !== track.id) { this.audio.src = track.playback_url; this.currentId = track.id; }
    this.audio.currentTime = position;
    if (play) await this.play(); else this.audio.pause();
  }
  async play() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 128;
      this.context.createMediaElementSource(this.audio).connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
    await this.audio.play();
  }
}
export const player = new MusicPlayer();
