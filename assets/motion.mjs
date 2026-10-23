// Render a motion-graphics scene (an HTML file) to an MP4, with every beat of
// the animation landing on the word the voice is saying.
//
// Usage: node motion.mjs <scene.html> <out.mp4> --id x --text "{cueA}Words… {cueB}more words"
//        node motion.mjs <scene.html> <out.mp4> --ms 8000          (silent)
//
// Cues. Write {name} markers in the narration where a beat should happen. They
// are stripped before synthesis; after synthesis the clip is force-aligned
// (tts.mjs alignWords) and each cue becomes the time, in ms from the start of
// the clip, at which the word after the marker begins.
//
// Scene contract (see scene.example.html and kit.js):
//   window.__CUES        { name: ms }, already shifted by the lead-in
//   window.__DURATION_MS total clip length (lead + speech + tail)
//   window.__LEAD_MS     silence before the first word (covers the transition in)
//   window.setup()       optional; runs once, at final layout, before anything
//                        animates. Measure elements and draw connectors here.
//   window.timeline()    required; returns a paused GSAP timeline. The renderer
//                        seeks it frame by frame, so nothing plays in real time.
//   window.SFX           optional; [{ at: 'cue' or ms, role: 'pop' }], the beats
//                        that get a sound effect when SFX=1 (sfx.sh, earshot kit roles).
//
// Layout check: after setup(), every element with class "lint" is checked for
// text overflow, overlap with another .lint element, and leaving the world. Any
// problem stops the render (LINT=0 to override) because misalignment is the
// first thing a viewer notices.
//
// Env: WIDTH/HEIGHT (2560x1440), FPS (30), CRF (16), LEAD_MS (900), TAIL_MS (900), SFX=1,
//      the tts.mjs variables (any provider; ElevenLabs key also gives exact word alignment).

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { synthesize, alignWords } from './tts.mjs';

const args = process.argv.slice(2);
const [scene, out] = args;
if (!scene || !out) {
    console.error('Usage: node motion.mjs <scene.html> <out.mp4> [--id x --text "{cue}line"] [--ms 8000]');
    process.exit(1);
}
const opt = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };

const width = Number(process.env.WIDTH || 2560);
const height = Number(process.env.HEIGHT || 1440);
const fps = Number(process.env.FPS || 30);
const crf = process.env.CRF || '16';
const leadMs = Number(process.env.LEAD_MS ?? 900);
const tailMs = Number(process.env.TAIL_MS ?? 900);

/** Strip {cue} markers, remembering the character index each one sat at. */
function parseCues(marked) {
    const cues = [];
    let text = '';
    let last = 0;
    for (const m of marked.matchAll(/\{([\w-]+)\}/g)) {
        text += marked.slice(last, m.index);
        cues.push({ name: m[1], at: text.length });
        last = m.index + m[0].length;
    }
    text += marked.slice(last);
    return { text: text.replace(/\s{2,}/g, ' ').trim(), cues };
}

/** Time (s) at which the first word at or after character `at` starts. */
function cueTime(words, at) {
    let pos = 0;
    for (const w of words) {
        const start = pos;
        pos += w.text.length;
        if (start >= at && w.text.trim()) {
            return w.start;
        }
    }
    return words.at(-1)?.end ?? 0;
}

let clip = null;
let durationMs = Number(opt('ms') || 0);
const cues = {};
if (opt('text')) {
    const { text, cues: marks } = parseCues(opt('text'));
    const clips = await synthesize([{ id: opt('id') || 'motion', text }]);
    clip = [...clips.values()][0];
    const words = await alignWords(clip.file, text);
    // Alignment is against the raw text; trim leading spaces the same way.
    for (const { name, at } of marks) {
        cues[name] = Math.round(leadMs + cueTime(words, at) * 1000);
    }
    durationMs = leadMs + clip.durMs + tailMs;
    console.error(`  cues ${Object.entries(cues).map(([k, v]) => `${k}@${(v / 1000).toFixed(2)}`).join(' ')}`);
}
if (!durationMs) {
    console.error('Give --text (narrated) or --ms (silent length).');
    process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('  scene error:', e.message));
await page.addInitScript(({ c, d, l }) => {
    window.__CUES = c;
    window.__DURATION_MS = d;
    window.__LEAD_MS = l;
}, { c: cues, d: durationMs, l: leadMs });
await page.goto(pathToFileURL(path.resolve(scene)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const problems = await page.evaluate(() => {
    if (typeof window.setup === 'function') window.setup();
    return window.K?.lint ? window.K.lint() : [];
});
const sfx = process.env.SFX === '1' ? await page.evaluate(() => window.SFX || []) : [];
if (problems.length) {
    console.error(`  layout check failed for ${path.basename(scene)}:`);
    problems.forEach((p) => console.error(`    - ${p}`));
    if (process.env.LINT !== '0') {
        await browser.close();
        process.exit(3);
    }
}
await page.evaluate(() => {
    window.__tl = window.timeline();
    window.__tl.pause(0);
    document.getAnimations().forEach((a) => a.pause());
});

const frames = Math.round((durationMs / 1000) * fps);
const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    ...(clip ? ['-i', clip.file] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']),
    '-filter_complex', clip ? `[1:a]aresample=44100,adelay=${leadMs}:all=1,apad[a]` : '[1:a]anull[a]',
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-t', (durationMs / 1000).toFixed(3),
    '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

for (let i = 0; i < frames; i++) {
    const ms = (i / fps) * 1000;
    await page.evaluate((t) => {
        window.__tl.seek(t / 1000, false);
        document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; });
    }, ms);
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % fps === 0) process.stderr.write(`  motion ${path.basename(scene)} ${(ms / 1000).toFixed(0)}s/${(durationMs / 1000).toFixed(1)}s\r`);
}
ff.stdin.end();
await new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
await browser.close();
if (sfx.length) {
    const sounds = sfx.map(({ at, role }) => ({ tMs: typeof at === 'number' ? at : cues[at], role, at })).filter((s) => s.tMs != null || console.error(`  sfx: no cue "${s.at}" in the narration`));
    const side = out.replace(/\.mp4$/, '.sounds.json');
    fs.writeFileSync(side, JSON.stringify({ sounds }));
    execFileSync('bash', [path.join(path.dirname(new URL(import.meta.url).pathname), 'sfx.sh'), out, side, out], { stdio: 'inherit' });
    fs.rmSync(side);
}
console.error(`\n  motion wrote ${out} (${(durationMs / 1000).toFixed(1)}s, ${frames} frames)`);
console.log(out);
