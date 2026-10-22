import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type ZoomEvent = { tMs: number; x: number; y: number; scale: number; holdMs: number };
export type FramedProps = {
  src: string; videoW: number; videoH: number; zooms: ZoomEvent[]; durationInFrames: number;
  pad: number; radius: number; background: string;
};

const LEAD_MS = 450;   // the push-in lands on the click, so it starts this much earlier

// Spring-eased camera: for each event, scale rises to `scale` by tMs, holds for
// holdMs, then relaxes. Centre moves with the same curve, clamped so a target
// near an edge never shows empty canvas.
const camera = (frame: number, fps: number, zooms: ZoomEvent[], W: number, H: number) => {
  let s = 1, cx = W / 2, cy = H / 2;
  for (const z of zooms) {
    const inStart = Math.round(((z.tMs - LEAD_MS) / 1000) * fps);
    const outStart = Math.round(((z.tMs + z.holdMs) / 1000) * fps);
    if (frame < inStart) continue;
    const up = spring({ frame: frame - inStart, fps, config: { damping: 22, stiffness: 90, mass: 1 }, durationInFrames: Math.round(fps * 0.6) });
    const down = frame >= outStart ? spring({ frame: frame - outStart, fps, config: { damping: 24, stiffness: 80, mass: 1 }, durationInFrames: Math.round(fps * 0.7) }) : 0;
    const k = up * (1 - down);
    if (k <= 0.001) continue;
    s = 1 + (z.scale - 1) * k;
    cx = interpolate(k, [0, 1], [W / 2, z.x]);
    cy = interpolate(k, [0, 1], [H / 2, z.y]);
  }
  const half = { w: W / (2 * s), h: H / (2 * s) };
  cx = Math.min(Math.max(cx, half.w), W - half.w);
  cy = Math.min(Math.max(cy, half.h), H - half.h);
  return { s, tx: W / 2 - cx * s, ty: H / 2 - cy * s };
};

export const Framed: React.FC<FramedProps> = ({ src, videoW, videoH, zooms, pad, radius, background }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const inset = Math.round(height * pad);
  const innerH = height - inset * 2;
  const innerW = Math.round(innerH * (videoW / videoH));
  const left = Math.round((width - innerW) / 2);
  const cam = camera(frame, fps, zooms, videoW, videoH);
  const fit = innerW / videoW;

  return (
    <AbsoluteFill style={{ background }}>
      <div style={{ position: 'absolute', left, top: inset, width: innerW, height: innerH, borderRadius: radius, overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)', background: '#000' }}>
        <div style={{ width: videoW, height: videoH, transformOrigin: '0 0',
          transform: `scale(${fit}) translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}>
          <OffthreadVideo src={staticFile(src)} style={{ width: videoW, height: videoH, display: 'block' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
