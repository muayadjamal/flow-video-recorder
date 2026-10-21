// Narration for flow recordings, from whichever TTS the user has.
//
// Synthesizes one clip per narration segment, trims the silence most engines pad
// on either end, normalizes loudness, and reports each clip's real duration so
// the recorder can pace the browser to the voice instead of the other way round.
//
// Clips are cached by a hash of (provider, voice, model, text, neighbouring
// text), so re-recording a flow costs nothing unless the words actually changed.
//
// Providers (TTS_PROVIDER, auto-detected from the env when unset):
//   elevenlabs  ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID
//   openai      OPENAI_API_KEY, OPENAI_TTS_VOICE (alloy), OPENAI_TTS_MODEL (gpt-4o-mini-tts)
//   say         macOS built-in, no key. SAY_VOICE (system default)
//   command     TTS_COMMAND: a shell line run once per clip with $TTS_TEXT,
//               $TTS_OUT (file to write, any format ffmpeg reads) and
//               $TTS_SPEED in its env. Use it for a local model (Piper, Kokoro,
//               Coqui, an HTTP server you run).
// Shared: NARRATION_SPEED (1.1), TTS_CACHE_DIR.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE = 'cjVigY5qzO86Huf0OWal'; // Eric — smooth, trustworthy, American
const DEFAULT_MODEL = 'eleven_v4'; // best quality by default; the user asked for that as the standing rule

// ElevenLabs reads at a slightly languid pace out of the box, which is fine for
// an audiobook and too slow for someone talking you through a screen. 1.1 is
// about 9% quicker and still unhurried. The API accepts 0.7 to 1.2; past ~1.15
// it starts to sound clipped.
const DEFAULT_SPEED = 1.1;

const run = (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`${cmd} failed: ${String(stderr || err.message).split('\n').slice(-6).join('\n')}`));
            } else {
                resolve(stdout);
            }
        });
    });

async function durationMs(file) {
    const out = await run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file,
    ]);
    return Math.round(parseFloat(out.trim()) * 1000);
}

// Bump when the audio filter chain changes, so cached clips are re-rendered
// instead of being served with the old treatment.
const FILTER_VERSION = 'v2-pausecap';

/**
 * Tighten a raw ElevenLabs clip:
 *  - drop the silence it pads onto the front,
 *  - cap every internal and trailing pause (the voice takes a full beat at each
 *    full stop, which on a run of short sentences adds up to seconds of dead
 *    air in the middle of a line),
 *  - normalize loudness so no segment is noticeably louder than the next.
 */
async function clean(rawFile, outFile) {
    const tighten = [
        'silenceremove=' + [
            'start_periods=1',
            'start_duration=0',
            'start_threshold=-40dB',
            'start_silence=0.05',
            'stop_periods=-1',
            'stop_duration=0.40',
            'stop_threshold=-40dB',
            'stop_silence=0.30',
        ].join(':'),
        'loudnorm=I=-16:TP=-1.5:LRA=11',
    ].join(',');

    await run('ffmpeg', [
        '-y', '-i', rawFile,
        '-af', tighten,
        '-ar', '44100', '-ac', '1', '-b:a', '192k',
        outFile,
    ]);
}

const PROVIDERS = {
    elevenlabs: {
        available: () => !!process.env.ELEVENLABS_API_KEY,
        voice: () => process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE,
        model: () => process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
        // The API accepts 0.7 to 1.2; past ~1.15 it starts to sound clipped.
        speed: (s) => Math.min(1.2, Math.max(0.7, s)),
        speak: (o) => elevenlabs(o),
    },
    openai: {
        available: () => !!process.env.OPENAI_API_KEY,
        voice: () => process.env.OPENAI_TTS_VOICE || 'alloy',
        model: () => process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        speed: (s) => Math.min(4, Math.max(0.25, s)),
        speak: (o) => openai(o),
    },
    say: {
        available: () => process.platform === 'darwin',
        voice: () => process.env.SAY_VOICE || 'default',
        model: () => 'macos',
        speed: (s) => s,
        speak: (o) => say(o),
    },
    command: {
        available: () => !!process.env.TTS_COMMAND,
        voice: () => process.env.TTS_COMMAND,
        model: () => 'command',
        speed: (s) => s,
        speak: (o) => command(o),
    },
};

/** Which provider a run will use, or null when none is configured. */
export function provider() {
    const name = process.env.TTS_PROVIDER;
    if (name) {
        if (!PROVIDERS[name]) throw new Error(`TTS_PROVIDER=${name}: expected one of ${Object.keys(PROVIDERS).join(', ')}`);
        return name;
    }
    // Paid keys first, so a user who set one is not surprised by the system voice.
    return ['elevenlabs', 'openai', 'command', 'say'].find((n) => PROVIDERS[n].available()) ?? null;
}

async function elevenlabs({ text, previous, next, voiceId, modelId, speed, out }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
            text,
            model_id: modelId,
            // Feeding the neighbouring lines makes the reads flow into each other
            // instead of sounding like 18 separate takes stitched together.
            previous_text: previous || undefined,
            next_text: next || undefined,
            voice_settings: {
                stability: 0.45,
                similarity_boost: 0.8,
                style: 0.1,
                use_speaker_boost: true,
                speed,
            },
        }),
    });

    if (!res.ok) {
        throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
}

async function openai({ text, voiceId, modelId, speed, out }) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, voice: voiceId, input: text, speed, response_format: 'mp3' }),
    });
    if (!res.ok) {
        throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
}

// macOS speaks at roughly 175 words a minute by default; NARRATION_SPEED scales that.
async function say({ text, voiceId, speed, out }) {
    // `say` picks the container from the extension and refuses a bare name.
    const aiff = `${out}.aiff`;
    const args = ['-r', String(Math.round(175 * speed)), '-o', aiff, text];
    if (voiceId !== 'default') args.unshift('-v', voiceId);
    await run('say', args);
    await fs.rename(aiff, out);
}

async function command({ text, speed, out }) {
    await new Promise((resolve, reject) => {
        execFile('sh', ['-c', process.env.TTS_COMMAND], {
            env: { ...process.env, TTS_TEXT: text, TTS_OUT: out, TTS_SPEED: String(speed) },
            maxBuffer: 32 * 1024 * 1024,
        }, (err, _stdout, stderr) => (err ? reject(new Error(`TTS_COMMAND failed: ${String(stderr || err.message).split('\n').slice(-6).join('\n')}`)) : resolve()));
    });
    try {
        if ((await fs.stat(out)).size === 0) throw new Error('empty');
    } catch {
        throw new Error('TTS_COMMAND finished but wrote nothing to $TTS_OUT');
    }
}

/**
 * @param {Array<{id: string, text: string}>} narration
 * @returns {Promise<Map<string, {file: string, durMs: number}>>}
 */
export async function synthesize(narration) {
    const name = provider();
    if (!name) {
        throw new Error('No TTS configured: set ELEVENLABS_API_KEY, OPENAI_API_KEY, TTS_COMMAND, or run on macOS for `say`.');
    }
    const p = PROVIDERS[name];
    const voiceId = p.voice();
    const modelId = p.model();
    const speed = p.speed(Number(process.env.NARRATION_SPEED || DEFAULT_SPEED));
    const cacheDir = process.env.TTS_CACHE_DIR || path.resolve('storage/app/recording/tts');
    await fs.mkdir(cacheDir, { recursive: true });

    console.error(`  tts provider=${name} voice=${voiceId} model=${modelId} speed=${speed}`);

    const clips = new Map();

    for (const [i, seg] of narration.entries()) {
        const previous = narration[i - 1]?.text ?? '';
        const next = narration[i + 1]?.text ?? '';
        const key = crypto
            .createHash('sha1')
            .update([FILTER_VERSION, name, voiceId, modelId, String(speed), seg.text, previous, next].join('|'))
            .digest('hex')
            .slice(0, 16);
        const file = path.join(cacheDir, `${key}.mp3`);

        let cached = true;
        try {
            await fs.access(file);
        } catch {
            cached = false;
        }

        if (!cached) {
            // Raw clip in whatever container the engine produced; ffmpeg sniffs it.
            const raw = path.join(cacheDir, `${key}.raw`);
            await p.speak({ text: seg.text, previous, next, voiceId, modelId, speed, out: raw });
            await clean(raw, file);
            await fs.rm(raw, { force: true });
        }

        const durMs = await durationMs(file);
        clips.set(seg.id, { file, durMs });
        console.error(`  tts ${cached ? 'cache' : 'new  '} ${seg.id.padEnd(18)} ${(durMs / 1000).toFixed(1)}s`);
    }

    return clips;
}

/**
 * Word timings for a synthesized clip, from ElevenLabs forced alignment (no
 * character cost) when a key is available, whichever engine spoke the clip.
 * Without one, timings are estimated by spreading the words over the clip in
 * proportion to their length; cues then land within a word or two of the
 * truth, which is fine for a scene and wrong for a lip. Cached beside the clip
 * as <key>.words.json, so a scene can be re-rendered offline once aligned.
 *
 * @param {string} file the cleaned clip synthesize() returned
 * @param {string} text exactly the text that was spoken
 * @returns {Promise<Array<{text: string, start: number, end: number}>>} seconds
 */
export async function alignWords(file, text) {
    const cache = file.replace(/\.mp3$/, '.words.json');
    try {
        return JSON.parse(await fs.readFile(cache, 'utf8'));
    } catch {
        // not aligned yet
    }
    if (!process.env.ELEVENLABS_API_KEY) {
        console.error('  align: no ELEVENLABS_API_KEY, estimating word timings from text length');
        const words = estimateWords(text, (await durationMs(file)) / 1000);
        await fs.writeFile(cache, JSON.stringify(words));
        return words;
    }
    const form = new FormData();
    form.append('file', new Blob([await fs.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
    form.append('text', text);
    const res = await fetch('https://api.elevenlabs.io/v1/forced-alignment', {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: form,
    });
    if (!res.ok) {
        throw new Error(`ElevenLabs alignment ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const words = (await res.json()).words.map(({ text: t, start, end }) => ({ text: t, start, end }));
    await fs.writeFile(cache, JSON.stringify(words));
    return words;
}

function estimateWords(text, seconds) {
    // Keep whitespace as zero-length tokens: cueTime() in motion.mjs walks the
    // tokens by character count to find a cue's offset, as ElevenLabs returns them.
    const tokens = text.split(/(\s+)/).filter(Boolean);
    const weight = (w) => (/^\s+$/.test(w) ? 0 : w.length + 1 + (/[.,;:!?]$/.test(w) ? 3 : 0)); // pause after punctuation
    const total = tokens.reduce((n, w) => n + weight(w), 0);
    let t = 0;
    return tokens.map((w) => {
        const start = t;
        t += (weight(w) / total) * seconds;
        return { text: w, start, end: t };
    });
}
