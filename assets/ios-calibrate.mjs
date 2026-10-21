// Measure how a simulator capture's own clock relates to wall-clock.
//
// Flips the simulator's light/dark appearance at known wall-clock moments,
// which changes the whole screen at once, then finds those flips in the
// recorded video by luminance and fits video-time against wall-clock-time.
//
//   slope     1.0 means the video runs at real speed. Anything else is drift:
//             the picture pulls away from the soundtrack as the take goes on.
//   intercept where wall-clock zero lands in the video. This is the constant
//             AUDIO_OFFSET_MS correction.
//
// Usage: node ios-calibrate.mjs [marks]        (default 6)

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const udid = process.env.UDID || 'booted';
const MARKS = Number(process.argv[2] || 6);
const EVERY = Number(process.env.MARK_EVERY_MS || 3000);
const OUT = process.env.OUT_DIR || 'cal';

const run = (cmd, args) => new Promise((res, rej) =>
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (e, so, se) =>
        e ? rej(new Error(`${cmd}: ${se || e.message}`)) : res(so)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(OUT, { recursive: true });
const mov = path.resolve(OUT, `cal-${Date.now()}.mov`);

// Start from a known appearance so the first flip is a real change.
await run('xcrun', ['simctl', 'ui', udid, 'appearance', 'light']);
await sleep(1200);

const rec = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '--force', mov],
    { stdio: ['ignore', 'ignore', 'pipe'] });
let t0 = 0;
rec.stderr.on('data', (d) => { if (!t0 && /Recording started/i.test(String(d))) t0 = Date.now(); });
for (let i = 0; i < 400 && !t0; i++) await sleep(25);
if (!t0) throw new Error('recordVideo never started');

const marks = [];
for (let i = 0; i < MARKS; i++) {
    await sleep(EVERY);
    const want = i % 2 === 0 ? 'dark' : 'light';
    const at = Date.now();
    await run('xcrun', ['simctl', 'ui', udid, 'appearance', want]);
    marks.push({ i, want, wallMs: at - t0 });
}
await sleep(1500);
rec.kill('SIGINT');
await new Promise((r) => rec.on('close', r));
await run('xcrun', ['simctl', 'ui', udid, 'appearance', 'light']);

// ── Find the flips in the video by mean luminance ────────────────────────
const stats = await new Promise((res, rej) => {
    execFile('ffmpeg', ['-v', 'error', '-i', mov,
        '-vf', 'scale=48:48,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
        '-f', 'null', '-'], { maxBuffer: 256 * 1024 * 1024 },
        (e, so, se) => e ? rej(new Error(se || e.message)) : res(so));
});

const frames = [];
let pts = null;
for (const line of stats.split('\n')) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) { pts = Number(t[1]); continue; }
    const y = line.match(/YAVG=([\d.]+)/);
    if (y && pts !== null) { frames.push({ t: pts, y: Number(y[1]) }); pts = null; }
}
if (frames.length < 10) throw new Error(`only ${frames.length} frames of luminance data`);

// Each flip is animated, so neighbouring frames differ only slightly and a
// frame-to-frame threshold catches some transitions and sleeps through others,
// which silently pairs each flip with the wrong mark. Classify every frame as
// light or dark instead, and take the transition where the classification
// changes: an appearance flip is a two-state signal, so read it as one.
const ys = frames.map((f) => f.y);
const lo = Math.min(...ys), hi = Math.max(...ys);
const span = hi - lo;
const mid = (lo + hi) / 2;
const state = frames.map((f) => (f.y > mid ? 'light' : 'dark'));

const flips = [];
for (let i = 1; i < frames.length; i++) {
    if (state[i] === state[i - 1]) continue;
    // Require it to stick, so a single odd frame mid-animation is not a flip.
    const ahead = state.slice(i, i + 5);
    if (ahead.length && !ahead.every((s) => s === state[i])) continue;
    const last = flips[flips.length - 1];
    if (last && frames[i].t - last.t < 1.0) continue;
    flips.push({ t: frames[i].t, dir: state[i] });
}

console.log(`\nvideo: ${path.basename(mov)} · ${frames.length} frames · luminance span ${span.toFixed(1)}`);
console.log(`marks requested ${marks.length}, flips detected ${flips.length}`);

if (flips.length !== marks.length) {
    console.log(`\nMismatch: ${marks.length} marks, ${flips.length} flips detected. Pairing them`);
    console.log('in order would invent a slope (missing every other flip reads as 2x speed).');
    console.log('Raise MARK_EVERY_MS so each flip finishes before the next begins.');
    process.exit(1);
}

const n = marks.length;
if (n < 3) {
    console.log('\nNot enough matched flips to fit. Raise MARK_EVERY_MS, or check that');
    console.log('the screen actually changes with system appearance.');
    process.exit(1);
}

console.log('\n  mark  wanted  wall-clock   video   diff');
const xs = [], vs = [];
for (let i = 0; i < n; i++) {
    const x = marks[i].wallMs / 1000, v = flips[i].t;
    xs.push(x); vs.push(v);
    console.log(`  ${String(i).padStart(4)}  ${marks[i].want.padEnd(6)}  ${x.toFixed(3)}s   ${v.toFixed(3)}s  ${(v - x >= 0 ? '+' : '')}${(v - x).toFixed(3)}s`);
}

// Least squares: video = slope * wall + intercept
const mx = xs.reduce((a, b) => a + b) / n, mv = vs.reduce((a, b) => a + b) / n;
let num = 0, den = 0;
for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (vs[i] - mv); den += (xs[i] - mx) ** 2; }
const slope = num / den;
const intercept = mv - slope * mx;
const resid = Math.max(...xs.map((x, i) => Math.abs(vs[i] - (slope * x + intercept))));

console.log(`\nslope      ${slope.toFixed(5)}   (1.0 = video runs at real speed)`);
console.log(`intercept  ${(intercept * 1000).toFixed(0)}ms  (where wall-clock zero lands in the video)`);
console.log(`worst residual ${(resid * 1000).toFixed(0)}ms`);

const driftOverAMinute = (slope - 1) * 60;
console.log(`\ndrift over a 60s take: ${(driftOverAMinute * 1000).toFixed(0)}ms`);
if (Math.abs(driftOverAMinute) > 0.25) {
    console.log('→ The capture does not run at real speed. Audio placed by wall-clock will');
    console.log('  pull away from the picture. ios-compose.mjs has to rescale, not just offset.');
} else {
    console.log('→ No meaningful drift; a constant offset is the only correction needed.');
}
console.log(`→ suggested AUDIO_OFFSET_MS=${Math.round(-intercept * 1000)}`);
console.log(mov);
