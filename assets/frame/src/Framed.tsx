import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type ZoomEvent = { tMs: number; x: number; y: number; scale: number; holdMs: number };
export type Caption = { tMs: number; text: string };
export type UrlEvent = { tMs: number; url: string };
export type Subtitle = { startMs: number; endMs: number; text: string };
export type FramedProps = {
  src: string; videoW: number; videoH: number; durationInFrames: number;
  zooms: ZoomEvent[]; captions: Caption[]; urls: UrlEvent[]; subtitles: Subtitle[];
  pad: number; radius: number; background: string; accent: string; title: string; chrome: boolean;
};

const LEAD_MS = 500;   // the drift lands on the click, so it starts this much earlier
const FONT = '"Inter", "SF Pro Text", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

// Slow, heavily damped camera over the whole browser window: it drifts in on a
// marked moment, holds, and drifts back. Centre is clamped so the enlarged
// window always covers its resting rectangle and only spills outward.
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

const current = <T extends { tMs: number }>(items: T[], tMs: number) => items.reduce<number>((acc, c, i) => (c.tMs <= tMs ? i : acc), -1);

// Step header: a small numbered badge and the step title, sliding in on change.
const Header: React.FC<{ frame: number; fps: number; captions: Caption[]; x: number; y: number; h: number; width: number; accent: string; title: string }> =
  ({ frame, fps, captions, x, y, h, width, accent, title }) => {
    const idx = current(captions, (frame / fps) * 1000);
    if (idx < 0) return null;
    const since = frame - Math.round((captions[idx].tMs / 1000) * fps);
    const enter = spring({ frame: since, fps, config: { damping: 24, stiffness: 120 }, durationInFrames: Math.round(fps * 0.5) });
    const fs = Math.round(h * 0.5);
    const badge = Math.round(h * 0.62);
    return (
      <div style={{ position: 'absolute', left: x, top: y, width, height: h, display: 'flex', alignItems: 'center', gap: Math.round(h * 0.3), fontFamily: FONT, color: '#F5F6FA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(h * 0.3), opacity: enter, transform: `translateY(${(1 - enter) * h * 0.3}px)` }}>
          <div style={{ minWidth: badge, height: badge, padding: '0 6px', borderRadius: Math.round(badge * 0.2), background: accent, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: Math.round(badge * 0.46), color: '#fff', letterSpacing: 0.5 }}>{String(idx + 1).padStart(2, '0')}</div>
          <div style={{ fontSize: fs, fontWeight: 600, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>{captions[idx].text}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: Math.round(h * 0.3) }}>
          {title ? <div style={{ fontSize: Math.round(fs * 0.7), fontWeight: 500, color: 'rgba(245,246,250,.6)' }}>{title}</div> : null}
          <div style={{ display: 'flex', gap: 5 }}>
            {captions.map((_, i) => <div key={i} style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, background: i <= idx ? '#fff' : 'rgba(245,246,250,.28)' }} />)}
          </div>
        </div>
      </div>
    );
  };

// Browser chrome: traffic lights and the URL the page was on at this moment.
const Chrome: React.FC<{ frame: number; fps: number; urls: UrlEvent[]; h: number; width: number }> = ({ frame, fps, urls, h, width }) => {
  const idx = current(urls, (frame / fps) * 1000);
  let host = '', path = '';
  if (idx >= 0) { try { const u = new URL(urls[idx].url); host = u.host; path = u.pathname + u.search; } catch { host = urls[idx].url; } }
  const dot = Math.round(h * 0.26);
  return (
    <div style={{ height: h, background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', fontFamily: FONT, position: 'relative' }}>
      <div style={{ position: 'absolute', left: Math.round(h * 0.4), display: 'flex', gap: Math.round(dot * 0.6) }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: dot, height: dot, borderRadius: '50%', background: c }} />)}
      </div>
      {host ? (
        <div style={{ margin: '0 auto', height: Math.round(h * 0.62), minWidth: Math.round(width * 0.34), padding: '0 14px', borderRadius: 8, background: '#fff', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: Math.round(h * 0.34), color: '#111827' }}>
          <svg width={Math.round(h * 0.3)} height={Math.round(h * 0.3)} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span style={{ fontWeight: 600 }}>{host}</span><span style={{ color: '#6b7280' }}>{path === '/' ? '' : path}</span>
        </div>
      ) : null}
    </div>
  );
};

// Spoken-word subtitles: the phrase being said right now, in a dark box at the
// bottom of the picture. Drawn on the canvas, not in the window, so the camera
// does not scale them.
const Subtitles: React.FC<{ frame: number; fps: number; subtitles: Subtitle[]; width: number; bottom: number; scale: number }> = ({ frame, fps, subtitles, width, bottom, scale }) => {
  const t = (frame / fps) * 1000;
  const sub = subtitles.find((s) => t >= s.startMs && t < s.endMs);
  if (!sub) return null;
  const fadeIn = Math.min(1, (t - sub.startMs) / 160);
  const fadeOut = Math.min(1, (sub.endMs - t) / 160);
  const fs = Math.round(30 * scale);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', opacity: Math.min(fadeIn, fadeOut) }}>
      <div style={{ maxWidth: width * 0.56, padding: `${Math.round(fs * 0.45)}px ${Math.round(fs * 0.9)}px`, borderRadius: Math.round(fs * 0.4), background: 'rgba(17,24,39,.92)', color: '#fff', fontFamily: FONT, fontSize: fs, fontWeight: 500, lineHeight: 1.3, textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>{sub.text}</div>
    </div>
  );
};

export const Framed: React.FC<FramedProps> = ({ src, videoW, videoH, zooms, captions, urls, subtitles, pad, radius, background, accent, title, chrome }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // Geometry: the frame takes the width minus a side margin (`pad`, fraction of
  // the width), the header sits close to the top, and whatever is left is the
  // bottom margin. A video taller than 16:9 is shrunk to fit instead.
  const side = Math.round(width * pad);
  const topPad = Math.round(height * 0.025);
  const headerH = captions.length ? Math.round(height * 0.045) : 0;
  const gap = captions.length ? Math.round(height * 0.012) : 0;
  const chromeH = chrome ? Math.round(height * 0.04) : 0;
  const bottomMin = Math.round(height * 0.03);
  let innerW = width - side * 2;
  let picH = Math.round(innerW * (videoH / videoW));
  const maxPic = height - topPad - headerH - gap - chromeH - bottomMin;
  if (picH > maxPic) { picH = maxPic; innerW = Math.round(picH * (videoW / videoH)); }
  const left = Math.round((width - innerW) / 2);
  const top = topPad + headerH + gap;
  const fit = innerW / videoW;
  const boxH = chromeH + picH;
  // The camera moves the whole browser window, chrome included, so marks are
  // mapped from video pixels into window pixels before the drift is computed.
  const cam = camera(frame, fps, zooms.map((z) => ({ ...z, x: z.x * fit, y: chromeH + z.y * fit })), innerW, boxH);

  return (
    <AbsoluteFill style={{ background }}>
      {captions.length ? <Header frame={frame} fps={fps} captions={captions} x={left} y={topPad} h={headerH} width={innerW} accent={accent} title={title} /> : null}
      <div style={{ position: 'absolute', left, top, width: innerW, height: boxH, borderRadius: radius, overflow: 'hidden', background: '#000',
        boxShadow: '0 30px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08)',
        transformOrigin: '0 0', transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` }}>
        {chrome ? <Chrome frame={frame} fps={fps} urls={urls} h={chromeH} width={innerW} /> : null}
        <div style={{ width: videoW, height: videoH, transformOrigin: '0 0', transform: `scale(${fit})` }}>
          <OffthreadVideo src={staticFile(src)} style={{ width: videoW, height: videoH, display: 'block' }} />
        </div>
      </div>
      <Subtitles frame={frame} fps={fps} subtitles={subtitles} width={innerW} bottom={height - (top + boxH) + Math.round(picH * 0.04)} scale={innerW / 1920} />
    </AbsoluteFill>
  );
};
