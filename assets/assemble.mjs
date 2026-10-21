// Cut a recorded flow into parts and splice motion-graphics clips between them,
// with an animated transition at every join, and no speech ever under a join.
//
// Usage: node assemble.mjs <plan.json> <out.mp4>
//
// plan.json:
// {
//   "flow": "out/walkthrough.mp4",
//   "timeline": "out/walkthrough.timeline.json",
//   "transition": { "type": "smoothleft", "ms": 700 },
//   "parts": [
//     { "flow": ["order-head", "order-stepper"] },          first..last segment id, inclusive
//     { "motion": "scenes/journey.html", "id": "m-journey", "text": "{cue}narration with {cues}" },
//     { "flow": ["po-arrives"] }
//   ]
// }
//
// The silence rule. A transition is T long. Every part that is followed by a
// join ends with T + POST_GAP of silence, and every part that follows a join
// starts with T + PRE_GAP of silence, so the wipe and the audio crossfade only
// ever touch quiet. A flow part gets that silence by holding its first and last
// frames (the wipe covers most of the hold); a motion part gets it as lead-in
// and tail, during which its scene keeps moving. After the final encode every
// join window is measured, and the build fails if anything in it is audible.
//
// Env: WIDTH/HEIGHT/FPS/CRF as motion.mjs; PRE_GAP_MS (350), POST_GAP_MS (450),
//      SILENCE_DB (-45, the loudest a join window may be); WORK_DIR.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const [planPath, out] = process.argv.slice(2);
if (!planPath || !out) {
    console.error('Usage: node assemble.mjs <plan.json> <out.mp4>');
    process.exit(1);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
const base = path.dirname(path.resolve(planPath));
const resolve = (p) => path.resolve(base, p);
const width = Number(process.env.WIDTH || 2560);
const height = Number(process.env.HEIGHT || 1440);
const fps = Number(process.env.FPS || 30);
const crf = process.env.CRF || '16';
const T = (plan.transition?.ms ?? 700) / 1000;
const type = plan.transition?.type || 'smoothleft';
const pre = T + Number(process.env.PRE_GAP_MS ?? 350) / 1000;
const post = T + Number(process.env.POST_GAP_MS ?? 450) / 1000;
const silenceDb = Number(process.env.SILENCE_DB ?? -45);
const work = process.env.WORK_DIR || path.join(path.dirname(path.resolve(out)), 'assemble');
await fs.mkdir(work, { recursive: true });

const run = (cmd, args, opts = {}) =>
    new Promise((res, rej) => {
        execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            if (err) rej(new Error(`${cmd} failed:\n${String(stderr || err.message).split('\n').slice(-12).join('\n')}`));
            else res({ stdout, stderr });
        });
    });
const durationS = async (file) =>
    parseFloat((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])).stdout.trim());
const maxVolume = async (file, start, dur) => {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    const m = stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
    return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : -120;
};

const timeline = JSON.parse(await fs.readFile(resolve(plan.timeline), 'utf8'));
const offset = Number(timeline.offsetMs || 0);
const trim = Number(timeline.trimMs || 0);
const seg = (id) => {
    const s = timeline.segments.find((x) => x.id === id);
    if (!s) throw new Error(`segment "${id}" is not in the timeline`);
    return s;
};
// Flow time to video time, the same arithmetic mux.mjs used to place the voice.
const videoS = (flowMs) => Math.max(0, flowMs + offset - trim) / 1000;

const last = plan.parts.length - 1;
const files = [];
for (const [i, part] of plan.parts.entries()) {
    const file = path.join(work, `part-${String(i).padStart(2, '0')}.mp4`);
    const head = i > 0 ? pre : 0;
    const tail = i < last ? post : 0.8;
    if (part.flow) {
        const [firstId, lastId = firstId] = part.flow;
        const a = seg(firstId);
        const b = seg(lastId);
        const start = videoS(a.startMs);
        const end = videoS(b.startMs + b.actualMs);
        const total = end - start + head + tail;
        console.error(`  part ${i} flow ${firstId}..${lastId}  ${start.toFixed(2)}s → ${end.toFixed(2)}s, holds ${head.toFixed(2)}s / ${tail.toFixed(2)}s`);
        // Video and audio are cut separately. Inserted silence in an MP4 audio track
        // becomes an empty edit, which filter graphs ignore, sliding the voice early;
        // a WAV has no edit list, so the gap stays where it was put.
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', resolve(plan.flow), '-an',
            '-vf', `setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps},tpad=start_mode=clone:start_duration=${head.toFixed(3)}:stop_mode=clone:stop_duration=${tail.toFixed(3)}`,
            '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', file]);
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', resolve(plan.flow), '-vn',
            '-af', `aresample=44100,adelay=${Math.round(head * 1000)}:all=1,apad=whole_dur=${total.toFixed(3)}`,
            '-t', total.toFixed(3), '-ac', '2', '-c:a', 'pcm_s16le', file.replace(/\.mp4$/, '.wav')]);
    } else if (part.motion) {
        // Reuse the render when nothing that shapes it changed.
        const kit = await fs.readFile(path.join(path.dirname(resolve(part.motion)), 'kit.js'), 'utf8').catch(() => '');
        const key = crypto.createHash('sha1').update([await fs.readFile(resolve(part.motion), 'utf8'), kit, part.text || '', part.ms || '', head, tail, width, height, fps, crf].join('|')).digest('hex');
        const stamp = `${file}.key`;
        if ((await fs.readFile(stamp, 'utf8').catch(() => '')) === key) {
            console.error(`  part ${i} motion ${part.motion} (unchanged, reused)`);
            const wav = file.replace(/\.mp4$/, '.wav');
            await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);
            files.push({ file, wav, dur: await durationS(file), label: path.basename(part.motion) });
            continue;
        }
        console.error(`  part ${i} motion ${part.motion}`);
        const args = [path.join(here, 'motion.mjs'), resolve(part.motion), file];
        if (part.text) args.push('--id', part.id || `motion-${i}`, '--text', part.text);
        if (part.ms) args.push('--ms', String(part.ms));
        const { stderr } = await run('node', args, {
            env: { ...process.env, WIDTH: String(width), HEIGHT: String(height), FPS: String(fps), CRF: crf,
                LEAD_MS: String(Math.round(head * 1000 || 600)), TAIL_MS: String(Math.round(tail * 1000)) },
        });
        stderr.split(/\r|\n/).filter((l) => /cues|layout|scene error|- /.test(l)).forEach((l) => console.error(`  ${l.trim()}`));
        await fs.writeFile(stamp, key);

    } else {
        throw new Error(`part ${i} needs "flow" or "motion"`);
    }
    const wav = file.replace(/\.mp4$/, '.wav');
    if (part.motion) {
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);
    }
    files.push({ file, wav, dur: await durationS(file), label: part.flow ? part.flow.join('..') : path.basename(part.motion) });
}

// Chain the parts: each xfade starts T before the end of what has been built so far.
const inputs = [...files.flatMap((f) => ['-i', f.file]), ...files.flatMap((f) => ['-i', f.wav])];
const n = files.length;
const filters = [];
const joins = [];
let v = '[0:v]';
let a = `[${n}:a]`;
let elapsed = files[0].dur;
for (let i = 1; i < files.length; i++) {
    const at = elapsed - T;
    joins.push(at);
    filters.push(`${v}[${i}:v]xfade=transition=${type}:duration=${T}:offset=${at.toFixed(3)}[v${i}]`);
    filters.push(`${a}[${n + i}:a]acrossfade=d=${T}:c1=tri:c2=tri[a${i}]`);
    v = `[v${i}]`;
    a = `[a${i}]`;
    elapsed += files[i].dur - T;
}
const args = ['-y', '-loglevel', 'error', ...inputs];
if (filters.length) args.push('-filter_complex', filters.join(';'), '-map', v, '-map', a);
else args.push('-map', '0:v', '-map', `${n}:a`);
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
await run('ffmpeg', args);

console.error('\npart   length   source');
files.forEach((f, i) => console.error(`${String(i).padEnd(5)} ${f.dur.toFixed(1).padStart(6)}s   ${f.label}`));

// Prove it: nothing audible from 0.15s before a wipe starts to 0.15s after it ends.
let loud = 0;
console.error('\njoin   at        loudest in window');
for (const [i, at] of joins.entries()) {
    const db = await maxVolume(out, Math.max(0, at - 0.15), T + 0.3);
    const ok = db <= silenceDb;
    if (!ok) loud++;
    console.error(`${String(i + 1).padEnd(5)} ${at.toFixed(2).padStart(7)}s  ${db.toFixed(1).padStart(6)} dB ${ok ? 'silent' : '← SPEECH UNDER THE TRANSITION'}`);
}
console.error(`assembled ${files.length} parts, ${joins.length} × ${type} (${T}s) → ${elapsed.toFixed(1)}s`);
if (loud) {
    console.error(`${loud} join(s) have sound under the transition; widen PRE_GAP_MS/POST_GAP_MS.`);
    process.exit(2);
}
console.log(out);
