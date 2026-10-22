import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type ZoomEvent = { tMs: number; x: number; y: number; scale: number; holdMs: number };
export type Caption = { tMs: number; text: string };
export type FramedProps = {
  src: string; videoW: number; videoH: number; zooms: ZoomEvent[]; captions: Caption[]; durationInFrames: number;
  pad: number; radius: number; background: string; accent: string; title: string;
};

const LEAD_MS = 500;        // the push-in lands on the click, so it starts this much earlier
const HEADER = 0.085;       // step header height, fraction of the canvas height
const FONT = '"Inter", "SF Pro Text", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

// Spring-eased camera: for each event, scale rises to `scale` by tMs, holds for
// holdMs, then relaxes. Slow, heavily damped springs: the picture should drift
// in, not jump. Centre moves with the same curve, clamped so a target near an
// edge never shows empty canvas.
const camera = (frame: number, fps: number, zooms: ZoomEvent[], W: number, H: number) => {
  let s = 1, cx = W / 2, cy = H / 2;
  for (const z of zooms) {
    const inStart = Math.round(((z.tMs - LEAD_MS) / 1000) * fps);
    const outStart = Math.round(((z.tMs + z.holdMs) / 1000) * fps);
    if (frame < inStart) continue;
    const up = spring({ frame: frame - inStart, fps, config: { damping: 30, stiffness: 55, mass: 1.2 }, durationInFrames: Math.round(fps * 0.9) });
    const down = frame >= outStart ? spring({ frame: frame - outStart, fps, config: { damping: 30, stiffness: 45, mass: 1.2 }, durationInFrames: Math.round(fps * 1.0) }) : 0;
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

// The step header: a numbered badge and the step title, which slide in when
// the step changes, plus a progress rail on the right.
const Header: React.FC<{ frame: number; fps: number; captions: Caption[]; height: number; width: number; accent: string; title: string; inset: number }> =
  ({ frame, fps, captions, height, width, accent, title, inset }) => {
    const t = (frame / fps) * 1000;
    const idx = captions.reduce((acc, c, i) => (c.tMs <= t ? i : acc), -1);
    if (idx < 0) return null;
    const since = frame - Math.round((captions[idx].tMs / 1000) * fps);
    const enter = spring({ frame: since, fps, config: { damping: 24, stiffness: 120 }, durationInFrames: Math.round(fps * 0.5) });
    const fs = Math.round(height * 0.36);
    const badge = Math.round(height * 0.62);
    return (
      <div style={{ position: 'absolute', left: inset, right: inset, top: 0, height, display: 'flex', alignItems: 'center', gap: Math.round(height * 0.22), fontFamily: FONT, color: '#F5F6FA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(height * 0.22), opacity: enter, transform: `translateY(${(1 - enter) * height * 0.25}px)` }}>
          <div style={{ width: badge, height: badge, borderRadius: Math.round(badge * 0.28), background: accent, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: Math.round(badge * 0.5), color: '#0B0F19', letterSpacing: 0 }}>{idx + 1}</div>
          <div style={{ fontSize: fs, fontWeight: 600, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>{captions[idx].text}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: Math.round(height * 0.2) }}>
          {title ? <div style={{ fontSize: Math.round(fs * 0.72), fontWeight: 500, color: 'rgba(245,246,250,.62)', letterSpacing: 0.2 }}>{title}</div> : null}
          <div style={{ display: 'flex', gap: 6 }}>
            {captions.map((_, i) => (
              <div key={i} style={{ width: i === idx ? 22 : 8, height: 8, borderRadius: 4, background: i <= idx ? accent : 'rgba(245,246,250,.22)', transition: 'none' }} />
            ))}
          </div>
        </div>
      </div>
    );
  };

export const Framed: React.FC<FramedProps> = ({ src, videoW, videoH, zooms, captions, pad, radius, background, accent, title }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const inset = Math.round(height * pad);
  const header = captions.length ? Math.round(height * HEADER) : 0;
  const innerH = height - inset * 2 - header;
  const innerW = Math.min(width - inset * 2, Math.round(innerH * (videoW / videoH)));
  const left = Math.round((width - innerW) / 2);
  const top = inset + header;
  const cam = camera(frame, fps, zooms, videoW, videoH);
  const fit = innerW / videoW;

  return (
    <AbsoluteFill style={{ background }}>
      {captions.length ? <Header frame={frame} fps={fps} captions={captions} height={header + inset} width={width} accent={accent} title={title} inset={left} /> : null}
      <div style={{ position: 'absolute', left, top, width: innerW, height: Math.round(innerW * (videoH / videoW)), borderRadius: radius, overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)', background: '#000' }}>
        <div style={{ width: videoW, height: videoH, transformOrigin: '0 0',
          transform: `scale(${fit}) translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}>
          <OffthreadVideo src={staticFile(src)} style={{ width: videoW, height: videoH, display: 'block' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
