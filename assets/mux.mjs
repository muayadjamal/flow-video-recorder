// Lay the narration clips onto a recorded MP4 at the offsets the flow measured.
//
// Usage: node mux.mjs <video.mp4> <timeline.json> [out.mp4]
//
// Each clip is delayed to its own start offset and the lot is mixed into one
// track, so a clip plays at exactly the moment its step happened on screen.
// Video is copied, never re-encoded.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const [video, timelinePath, outArg] = process.argv.slice(2);
if (!video || !timelinePath) {
    console.error('Usage: node mux.mjs <video.mp4> <timeline.json> [out.mp4]');
    process.exit(1);
}
const out = outArg || video.replace(/\.mp4$/, '.narrated.mp4');

const run = (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`${cmd} failed:\n${String(stderr || err.message).split('\n').slice(-15).join('\n')}`));
            } else {
                resolve(stdout);
            }
        });
    });

const timeline = JSON.parse(await fs.readFile(timelinePath, 'utf8'));
const segments = timeline.segments.filter((s) => s.clip && s.durMs > 0);
if (segments.length === 0) {
    console.error('No narration segments in the timeline; nothing to mux.');
    process.exit(1);
}

// A constant shift for the gap between "Playwright started the screencast" and
// "the flow's clock started". Measured by the recorder; overridable.
const offset = Number(process.env.AUDIO_OFFSET_MS ?? timeline.offsetMs ?? 0);

// How much was cut off the front of the video, which every clip has to move back
// by. record.sh seeks the encode to the same figure.
const trim = Number(process.env.AUDIO_TRIM_MS ?? timeline.trimMs ?? 0);

const videoDurS = parseFloat(
    (await run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video,
    ])).trim(),
);

const args = ['-y', '-i', video];
segments.forEach((s) => args.push('-i', s.clip));

const chains = segments.map((s, i) => {
    const delay = Math.max(0, Math.round(s.startMs + offset - trim));
    return `[${i + 1}:a]aresample=44100,adelay=delays=${delay}ms:all=1[a${i}]`;
});
const mix =
    `${segments.map((_, i) => `[a${i}]`).join('')}` +
    `amix=inputs=${segments.length}:normalize=0:dropout_transition=0[mixed];` +
    `[mixed]apad[aout]`;

args.push(
    '-filter_complex', `${chains.join(';')};${mix}`,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-t', String(videoDurS),
    '-movflags', '+faststart',
    out,
);

await run('ffmpeg', args);

const last = segments[segments.length - 1];
const speechMs = segments.reduce((sum, s) => sum + s.durMs, 0);
console.error(
    `muxed ${segments.length} clips · speech ${(speechMs / 1000).toFixed(1)}s of ` +
    `${videoDurS.toFixed(1)}s video (${Math.round((speechMs / 1000 / videoDurS) * 100)}% voiced) · ` +
    `head trim ${trim}ms · last clip ends at ${((last.startMs + offset - trim + last.durMs) / 1000).toFixed(1)}s`,
);
console.log(out);
