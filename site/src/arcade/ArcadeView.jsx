import { useEffect, useRef } from 'react';
import { machines, WORLD_WIDTH, WORLD_HEIGHT } from './world.js';

// GameBoy DMG palette
const PALETTE = {
  darkest: '#0f380f',
  dark: '#306230',
  light: '#8bac0f',
  lightest: '#9bbc0f',
};

const SCALE = 3;
const SPEED = 1.5;

export default function ArcadeView() {
  const canvasRef = useRef(null);
  const player = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
  const keys = useRef({});

  useEffect(() => {
    const onDown = (e) => { keys.current[e.key.toLowerCase()] = true; };
    const onUp = (e) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let raf;

    const tick = () => {
      const k = keys.current;
      const p = player.current;
      if (k['arrowleft'] || k['a']) p.x -= SPEED;
      if (k['arrowright'] || k['d']) p.x += SPEED;
      if (k['arrowup'] || k['w']) p.y -= SPEED;
      if (k['arrowdown'] || k['s']) p.y += SPEED;
      p.x = Math.max(4, Math.min(WORLD_WIDTH - 4, p.x));
      p.y = Math.max(4, Math.min(WORLD_HEIGHT - 4, p.y));

      // Draw
      ctx.fillStyle = PALETTE.lightest;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Floor grid
      ctx.fillStyle = PALETTE.light;
      for (let y = 0; y < WORLD_HEIGHT; y += 16) {
        for (let x = 0; x < WORLD_WIDTH; x += 16) {
          ctx.fillRect(x, y, 1, 1);
        }
      }

      // Machines (none yet)
      ctx.fillStyle = PALETTE.dark;
      for (const m of machines) {
        ctx.fillRect(m.x - 6, m.y - 8, 12, 16);
      }

      // Player
      ctx.fillStyle = PALETTE.darkest;
      ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8);

      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <h1 className="text-xl tracking-widest">ARCADE</h1>
      <p className="text-xs text-gb-light">Move with WASD or arrow keys. Press Enter at a machine to play.</p>
      <canvas
        ref={canvasRef}
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        style={{
          width: WORLD_WIDTH * SCALE,
          height: WORLD_HEIGHT * SCALE,
          imageRendering: 'pixelated',
          border: `4px solid ${PALETTE.dark}`,
        }}
      />
      {machines.length === 0 && (
        <p className="text-xs text-gb-light">No machines yet — they appear as games are deployed.</p>
      )}
    </div>
  );
}
