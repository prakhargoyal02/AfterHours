import { useRef } from 'react';
import { Heart, Pause, Play, Radio, Repeat, Shuffle, SkipBack, SkipForward, ListMusic } from 'lucide-react';
import Sheet from './Sheet';
import Liquid from './Liquid';
import type { Track } from './types';

const clock = (n: number) => Math.floor(n / 60) + ':' + Math.floor(n % 60).toString().padStart(2, '0');
export default function NowPlaying({ track, playing, position, mood, rain, shuffle, repeat, liked, locked,
  onClose, onToggle, onSeek, onNext, onShuffle, onRepeat, onLike, onQueue, onTogether }: {
  track: Track; playing: boolean; position: number; mood: string; rain: boolean; shuffle: boolean; repeat: boolean; liked: boolean; locked: boolean;
  onClose: () => void; onToggle: () => void; onSeek: (n: number) => void; onNext: (n: number) => void;
  onShuffle: () => void; onRepeat: () => void; onLike: () => void; onQueue: () => void; onTogether: () => void;
}) {
  const touch = useRef<number | null>(null);
  return <Sheet title="Now playing" onClose={onClose} full>
    {track.artwork && <img className="artwork-atmosphere" src={track.artwork} alt="" />}
    <div className="listening-stage">
      <div className="listening-art" onTouchStart={e => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={e => { if (touch.current !== null && !locked) { const delta = e.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 70) onNext(delta < 0 ? 1 : -1); } touch.current = null; }}>
        <Liquid playing={playing} mood={mood} rain={rain}/>
        {track.artwork && <img className="record-art" src={track.artwork} alt={'Artwork for ' + track.title}/>}
      </div>
      <div className="listening-details">
        <h1>{track.title}</h1><p>{track.artist}</p>
        <div className="listening-progress"><input aria-label="Seek song" type="range" min={0} max={track.duration || 1} step={.1}
          value={Math.min(position, track.duration || 1)} disabled={locked} onChange={e => onSeek(Number(e.target.value))}/>
          <div><span>{clock(position)}</span><span>{clock(track.duration)}</span></div></div>
        <div className="listening-controls">
          <button aria-label="Shuffle" aria-pressed={shuffle} disabled={locked} onClick={onShuffle}><Shuffle/></button>
          <button aria-label="Previous song" disabled={locked} onClick={() => onNext(-1)}><SkipBack/></button>
          <button className="primary large-play" aria-label={playing ? 'Pause' : 'Play'} disabled={locked} onClick={onToggle}>{playing ? <Pause/> : <Play/>}</button>
          <button aria-label="Next song" disabled={locked} onClick={() => onNext(1)}><SkipForward/></button>
          <button aria-label="Repeat song" aria-pressed={repeat} disabled={locked} onClick={onRepeat}><Repeat/></button>
        </div>
        {locked && <p>Playback follows your SyncWave host. Open the room for shared controls.</p>}
        <div className="listening-actions">
          <button onClick={onLike} aria-label={liked ? 'Unlike song' : 'Like song'} aria-pressed={liked}><Heart/>Save</button>
          <button onClick={onQueue}><ListMusic/>Queue</button>
          <button onClick={onTogether}><Radio/>Together</button>
        </div>
        <a className="provider-credit" href={track.permalink} target="_blank" rel="noreferrer">Listen on {track.provider}</a>
      </div>
    </div>
  </Sheet>;
}
