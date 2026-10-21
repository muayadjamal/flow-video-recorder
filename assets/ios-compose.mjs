// Turn a raw simulator capture plus its timeline into the finished MP4:
// head trimmed, a cursor that glides between taps, a ripple on each tap, a
// caption pill per step, and the narration laid on at the offsets the recorder
// measured.
//
// The browser recorder injects its cursor and captions into the page. A native
// app has no DOM to inject into, so the same three things are composited here
// instead, off the event log the recorder kept while it was driving.
//
// Usage: node ios-compose.mjs <flow.mov> [out.mp4]
// Env: POINTER=0 (no cursor or tap ripple), CAPTIONS=0 (no caption pill),
//      OUT_W (output width, default 1080), CRF (18), FPS (30), TAIL_MS (1200)

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const [movArg, outArg] = process.argv.slice(2);
if (!movArg) {
    console.error('Usage: node ios-compose.mjs <flow.mov> [out.mp4]');
    process.exit(1);
}
const mov = path.resolve(movArg);
const out = path.resolve(outArg || mov.replace(/\.mov$/, '.mp4'));
const timelinePath = `${mov}.timeline.json`;

// What the viewer asked for. The capture and the timeline are unchanged either
// way; this only decides what gets painted on top.
const POINTER = process.env.POINTER !== '0';
const CAPTIONS = process.env.CAPTIONS !== '0';

const OUT_W = Number(process.env.OUT_W || 1080);
const CRF = process.env.CRF || '18';
const FPS = Number(process.env.FPS || 30);
const GLIDE = 0.4;           // seconds the cursor takes to reach a tap
const RIPPLE_S = 0.6;

const run = (cmd, args) =>
    new Promise((resolve, reject) =>
        execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
            err ? reject(new Error(`${cmd} failed:\n${String(stderr || err.message).split('\n').slice(-20).join('\n')}`))
                : resolve(stdout)));

const timeline = JSON.parse(await fs.readFile(timelinePath, 'utf8'));
const trim = (timeline.trimMs || 0) / 1000;
const dev = timeline.device;
const scale = OUT_W / dev.w;
const OUT_H = Math.round(dev.h * scale / 2) * 2;

const work = path.join(path.dirname(mov), '.compose');
await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });

// ── Sprites ──────────────────────────────────────────────────────────────
// Sized off the output, so they read the same whatever resolution you render.
const CUR = Math.round(OUT_W * 0.055);   // cursor dot
const RIP = Math.round(OUT_W * 0.30);    // ripple canvas

const cursorPng = path.join(work, 'cursor.png');
if (POINTER) await run('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black@0:s=${CUR}x${CUR},format=rgba`,
    '-vf', [
        `geq=r=37:g=99:b=235`,
        // A filled translucent disc with a solid rim and a white halo, i.e. the
        // same cursor the browser recorder injects.
        `geq=r=37:g=99:b=235:a='` +
        `st(0,hypot(X-${CUR / 2},Y-${CUR / 2}));` +
        `if(lt(ld(0),${CUR * 0.30}),90,if(lt(ld(0),${CUR * 0.42}),255,if(lt(ld(0),${CUR * 0.48}),160,0)))'`,
    ].join(','),
    '-frames:v', '1', cursorPng]);

const rippleDir = path.join(work, 'ripple');
await fs.mkdir(rippleDir, { recursive: true });
if (POINTER) await run('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black@0:s=${RIP}x${RIP}:r=${FPS}:d=${RIPPLE_S},format=rgba`,
    '-vf', `geq=r=37:g=99:b=235:a='` +
    `st(0,hypot(X-${RIP / 2},Y-${RIP / 2}));` +
    `st(1,${RIP * 0.10}+${RIP * 0.36}*T/${RIPPLE_S});` +   // radius grows
    `if(lt(abs(ld(0)-ld(1)),${Math.max(3, RIP * 0.035)}),255*(1-T/${RIPPLE_S}),0)'`,
    path.join(rippleDir, '%03d.png')]);

// ── Cursor path ──────────────────────────────────────────────────────────
// One nested-if expression per axis: hold, glide over GLIDE seconds into the
// tap, hold again. overlay evaluates it per frame, so the dot moves.
const taps = (timeline.taps || [])
    .map((t) => ({ t: (t.tMs - timeline.trimMs) / 1000, x: t.x * scale, y: t.y * scale }))
    .filter((t) => t.t > 0);

function pathExpr(axis, start) {
    if (taps.length === 0) return String(Math.round(start));
    let e = taps[taps.length - 1][axis].toFixed(1);
    for (let i = taps.length - 1; i >= 0; i--) {
        const prev = (i === 0 ? start : taps[i - 1][axis]).toFixed(1);
        const to = taps[i][axis].toFixed(1);
        const g = Math.max(0, taps[i].t - GLIDE).toFixed(3);
        const T = taps[i].t.toFixed(3);
        const interp = `(${prev}+(${to}-${prev})*(t-${g})/${GLIDE})`;
        e = `if(lt(t,${g}),${prev},if(lt(t,${T}),${interp},${e}))`;
    }
    return e;
}

const startX = dev.w * scale / 2;
const startY = dev.h * scale * 0.75;

// ── Filter graph ─────────────────────────────────────────────────────────
const inputs = ['-ss', String(trim), '-i', mov];
const parts = [];
parts.push(`[0:v]scale=${OUT_W}:${OUT_H}:flags=lanczos,fps=${FPS},format=rgba[base]`);

let label = 'base';
if (POINTER) {
    inputs.push('-loop', '1', '-i', cursorPng);
    parts.push(`[1:v]format=rgba[cur]`);
    // shortest=1 matters: the cursor is a looped still, so without it the
    // overlay happily repeats the last video frame for as long as the still
    // keeps coming, which is forever.
    parts.push(`[base][cur]overlay=shortest=1:x='(${pathExpr('x', startX)})-${CUR / 2}':y='(${pathExpr('y', startY)})-${CUR / 2}'[v0]`);
    label = 'v0';

    taps.forEach((tp, i) => {
        inputs.push('-framerate', String(FPS), '-itsoffset', tp.t.toFixed(3),
            '-i', path.join(rippleDir, '%03d.png'));
        const idx = 2 + i;
        const next = `v${i + 1}`;
        parts.push(`[${idx}:v]format=rgba[r${i}]`);
        parts.push(`[${label}][r${i}]overlay=x=${Math.round(tp.x - RIP / 2)}:y=${Math.round(tp.y - RIP / 2)}` +
            `:enable='between(t,${tp.t.toFixed(3)},${(tp.t + RIPPLE_S).toFixed(3)})':eof_action=pass[${next}]`);
        label = next;
    });
}

// ── Caption pill ─────────────────────────────────────────────────────────
// One drawtext per caption, each reading its own file, so nothing has to be
// escaped and a caption can say whatever it likes.
const FONT = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial Bold.ttf']
    .find((f) => fsSync.existsSync(f));

const captions = (CAPTIONS ? (timeline.captions || []) : [])
    .map((c) => ({ ...c, s: (c.startMs - timeline.trimMs) / 1000, e: (c.endMs - timeline.trimMs) / 1000 }))
    .filter((c) => c.text && c.e > 0);

for (const [i, c] of captions.entries()) {
    const file = path.join(work, `cap${i}.txt`);
    await fs.writeFile(file, c.text);
    const next = `c${i}`;
    parts.push(`[${label}]drawtext=` + [
        FONT ? `fontfile=${FONT.replace(/([:\\])/g, '\\$1').replace(/ /g, '\\ ')}` : `font=Helvetica`,
        `textfile=${file}`,
        `fontcolor=white`,
        `fontsize=${Math.round(OUT_W * 0.037)}`,
        `box=1`, `boxcolor=0x111827@0.92`, `boxborderw=${Math.round(OUT_W * 0.026)}`,
        `x=(w-text_w)/2`, `y=h-${Math.round(OUT_H * 0.125)}`,
        `enable='between(t,${Math.max(0, c.s).toFixed(3)},${c.e.toFixed(3)})'`,
    ].join(':') + `[${next}]`);
    label = next;
}

parts.push(`[${label}]format=yuv420p[vout]`);

// Whatever the driver was still doing after the last word is dead air, and
// dead air at the end is the part a viewer actually notices. TAIL_MS=0 keeps
// the full take.
const TAIL = Number(process.env.TAIL_MS ?? 1200);
const lastSeg = (timeline.segments || []).filter((s) => s.durMs > 0).pop();
const stopAtS = lastSeg && TAIL >= 0
    ? (lastSeg.startMs + lastSeg.durMs - timeline.trimMs + TAIL) / 1000
    : null;

const silent = path.join(work, 'silent.mp4');
if (process.env.DEBUG) console.error(parts.join(';\n'));
await run('ffmpeg', ['-y', '-loglevel', process.env.DEBUG ? 'warning' : 'error', '-stats', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    ...(stopAtS ? ['-t', stopAtS.toFixed(3)] : []),
    '-movflags', '+faststart', silent]);

// ── Voice-over ───────────────────────────────────────────────────────────
const segments = (timeline.segments || []).filter((s) => s.clip && s.durMs > 0);
if (segments.length === 0) {
    await fs.rename(silent, out);
} else {
    const muxed = await run('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'mux.mjs'),
        silent, timelinePath, out]);
    if (!muxed.trim()) throw new Error('mux produced nothing');
}

await fs.rm(work, { recursive: true, force: true });
console.log(out);
