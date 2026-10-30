import { useEffect, useRef } from 'react';
import { player } from './audio';

/** Chrome contour field. Geometry responds to actual audio energy, not a fake timer. */
export default function Liquid({ playing, mood = 'Unwind', rain = false }: { playing: boolean; mood?: string; rain?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext('2d')!;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0; let phase = 0; let previous = 0; let smoothed = 0;
    const focus = /focus|study/i.test(mood), warm = /couple/i.test(mood);
    const gain = focus ? .3 : /party|energy|workout/i.test(mood) ? 1.5 : .7;
    const bins = new Uint8Array(64);
    const draw = (now = performance.now()) => {
      const dt = Math.min((now - (previous || now)) / 1000, .05); previous = now;
      const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
      if (!width || !height) return;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      let energy = 0;
      if (playing && player.analyser) { player.analyser.getByteFrequencyData(bins); energy = bins.reduce((a,b) => a+b,0)/bins.length/255; }
      smoothed += (energy - smoothed) * Math.min(1, dt * 8);
      energy = preference.matches ? 0 : smoothed * gain;
      if (!preference.matches && playing) phase += dt * (.16 * gain + energy * 1.1);
      ctx.save(); ctx.translate(width * 0.5, height * 0.5); ctx.scale(Math.min(width / 610, height / 430), Math.min(width / 610, height / 430)); ctx.rotate(-0.35);
      for (let i = 0; i < 57; i++) {
        const radius = 42 + i * 2.7;
        ctx.beginPath();
        for (let j=0;j<=220;j++) {
          const a = j/220*Math.PI*2;
          const r = radius * (1 + 0.17*Math.sin(a*3 + phase) + 0.075*Math.cos(a*5-phase*0.7)) + Math.sin(a*2 + phase)*energy*24 + (rain && playing ? Math.sin(a*12-phase*2)*2 : 0);
          const x = Math.cos(a)*r*1.38, y = Math.sin(a)*r*0.83;
          if(j===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        const g = ctx.createLinearGradient(-220,-120,200,140);
        g.addColorStop(0,'#242d3c');g.addColorStop(.25,warm?'#c2a288':'#a7b9cc');g.addColorStop(.36,'#f0f4fa');g.addColorStop(.47,'#364151');g.addColorStop(.64,warm?'#e4c6aa':'#c4d8e9');g.addColorStop(.8,'#65778b');g.addColorStop(1,'#111822');
        ctx.strokeStyle=g;ctx.lineWidth=1.6;ctx.stroke();
      }
      ctx.restore(); if (!preference.matches && playing && !document.hidden) frame=requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(frame); previous = 0; draw(); };
    const resize = new ResizeObserver(restart); resize.observe(canvas);
    preference.addEventListener('change', restart); document.addEventListener('visibilitychange', restart);
    draw(); return () => { cancelAnimationFrame(frame); resize.disconnect(); preference.removeEventListener('change', restart); document.removeEventListener('visibilitychange', restart); };
  }, [playing, mood, rain]);
  return <canvas ref={ref} className="liquid" aria-hidden="true" />;
}
