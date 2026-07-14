import React, { useEffect, useRef } from 'react';

/**
 * AmbientBackground — the "liquid glass" backdrop from the ClaudeDesign mockups.
 * Three blurred colour orbs + a pointer-reactive gloss sweep behind the glass cards.
 * Purely decorative (pointer-events: none); sits at z-index 0.
 */
const AmbientBackground = () => {
  const glossRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!glossRef.current) return;
      // gloss follows the pointer horizontally (matches design --gx var)
      const gx = (e.clientX / window.innerWidth - 0.5) * 60;
      glossRef.current.style.setProperty('--gx', `${gx}px`);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -120, right: '8%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(184,149,110,0.42), transparent 70%)', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', bottom: -160, left: '12%', width: 480, height: 480, borderRadius: '50%', background: 'radial-gradient(circle, rgba(150,175,190,0.32), transparent 70%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', top: '30%', left: '40%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,169,128,0.34), transparent 70%)', filter: 'blur(55px)' }} />
      </div>
      <div
        ref={glossRef}
        style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden', opacity: 0.5, mixBlendMode: 'screen' }}
      >
        <div style={{ position: 'absolute', top: '-30%', left: 'calc(-10% + var(--gx, 0px))', width: '40%', height: '160%', transform: 'rotate(16deg)', background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%)', filter: 'blur(8px)', transition: 'left 0.15s ease-out' }} />
      </div>
    </>
  );
};

export default AmbientBackground;
