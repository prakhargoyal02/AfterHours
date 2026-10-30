import { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';

export default function Sheet({ title, onClose, children, full = false }: {
  title: string; onClose: () => void; children: ReactNode; full?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    const context = gsap.context(() => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(node, { y: 54, opacity: .3 }, { y: 0, opacity: 1, duration: .55, ease: 'expo.out' });
      }
    }, node);
    return () => { context.revert(); gsap.killTweensOf(node); node.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  function close() {
    if (closing.current) return;
    closing.current = true;
    gsap.to(dialog.current, { y: 32, opacity: 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .22,
      onComplete: () => closeRef.current() });
  }
  return <dialog ref={dialog} className={'music-sheet ' + (full ? 'full-player' : '')}
    aria-label={title} onCancel={e => { e.preventDefault(); close(); }}
    onClick={e => { if (e.target === dialog.current) close(); }}>
    <div className="sheet-surface">
      <header className="sheet-heading" onPointerDown={e => { start.current = e.clientY; }}
        onPointerUp={e => { if (start.current !== null && e.clientY - start.current > 70) close(); start.current = null; }}>
        <span>{title}</span><button onClick={close} aria-label={'Close ' + title}>Close</button>
      </header>
      {children}
    </div>
  </dialog>;
}
