// ElevenLabs narration for flow recordings.
//
// Synthesizes one clip per narration segment, trims the silence ElevenLabs pads
// on either end, normalizes loudness, and reports each clip's real duration so
// the recorder can pace the browser to the voice instead of the other way round.
//
// Clips are cached by a hash of (voice, model, text, neighbouring text), so
// re-recording a flow costs nothing unless the words actually changed.
//
// Env: ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID,
//      NARRATION_SPEED, TTS_CACHE_DIR.

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

async function speak({ text, previous, next, voiceId, modelId, speed, apiKey }) {
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

    return Buffer.from(await res.arrayBuffer());
}

/**
 * @param {Array<{id: string, text: string}>} narration
 * @returns {Promise<Map<string, {file: string, durMs: number}>>}
 */
export async function synthesize(narration) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY is not set.');
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
    const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
    const speed = Math.min(1.2, Math.max(0.7, Number(process.env.NARRATION_SPEED || DEFAULT_SPEED)));
    const cacheDir = process.env.TTS_CACHE_DIR || path.resolve('storage/app/recording/tts');
    await fs.mkdir(cacheDir, { recursive: true });

    console.error(`  tts voice=${voiceId} model=${modelId} speed=${speed}`);

    const clips = new Map();

    for (const [i, seg] of narration.entries()) {
        const previous = narration[i - 1]?.text ?? '';
        const next = narration[i + 1]?.text ?? '';
        const key = crypto
            .createHash('sha1')
            .update([FILTER_VERSION, voiceId, modelId, String(speed), seg.text, previous, next].join('|'))
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
            const raw = path.join(cacheDir, `${key}.raw.mp3`);
            await fs.writeFile(raw, await speak({ text: seg.text, previous, next, voiceId, modelId, speed, apiKey }));
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
 * character cost). Cached beside the clip as <key>.words.json, so a scene can be
 * re-rendered offline once its line has been aligned.
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
