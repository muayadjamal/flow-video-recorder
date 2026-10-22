// Builds the props for the Remotion frame step out of a recording's timeline.
// Usage: node frame-props.mjs <timeline.json> <duration seconds> <props.json>
//
// Subtitles follow the voice: each narrated segment is word-aligned (ElevenLabs
// forced alignment when a key is available, otherwise an estimate from text
// length; both cached beside the clip) and cut into short lines.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [file, durationS, out] = process.argv.slice(2);
const tl = JSON.parse(fs.readFileSync(file, 'utf8'));
const trim = tl.trimMs || 0;
const shift = (ms) => ms - trim;

const MAX_CHARS = Number(process.env.SUB_MAX_CHARS || 44);

// The bar shows host and path only. Query strings and fragments are where
// tokens, codes and signatures live, and a video is forever; FRAME_URL_QUERY=1
// keeps them, with the usual secret names blanked.
const SECRET = /^(code|token|state|key|api_?key|sig|signature|password|pass|secret|access_token|refresh_token|id_token|auth|session|otp)$/i;
function clean(raw) {
    let u; try { u = new URL(raw); } catch { return raw.replace(/[?#].*$/, ''); }
    if (process.env.FRAME_URL_QUERY !== '1') return u.origin + u.pathname;
    for (const k of [...u.searchParams.keys()]) if (SECRET.test(k)) u.searchParams.set(k, '…');
    u.hash = '';
    return u.toString();
}
// FRAME_URL: an origin ("https://app.example.com") swaps the host and keeps each
// recorded path; a full URL with a path pins the bar to that one address.
function rewriteUrls(urls) {
    const cleaned = urls.map((u) => ({ ...u, url: clean(u.url) }));
    const override = process.env.FRAME_URL;
    if (!override) return cleaned;
    let o; try { o = new URL(override); } catch { return [{ tMs: 0, url: override }]; }
    if (o.pathname !== '/' || o.search) return [{ tMs: 0, url: clean(override) }];
    if (!cleaned.length) return [{ tMs: 0, url: o.origin }];
    return cleaned.map((u) => { try { const p = new URL(u.url); return { ...u, url: o.origin + p.pathname + p.search }; } catch { return { ...u, url: o.origin }; } });
}
const subtitles = [];
const segments = (tl.segments || []).filter((s) => s.clip && s.text && s.durMs > 0);
if (segments.length) {
    const { alignWords } = await import(pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), 'tts.mjs')).href);
    for (const seg of segments) {
        let words;
        try { words = await alignWords(seg.clip, seg.text); } catch (e) { console.error(`  align ${seg.id}: ${e.message.split('\n')[0]}`); continue; }
        const toks = words.filter((w) => w.text.trim());
        let line = [];
        const flush = () => {
            if (!line.length) return;
            subtitles.push({ startMs: Math.round(shift(seg.startMs) + line[0].start * 1000), endMs: Math.round(shift(seg.startMs) + line[line.length - 1].end * 1000), text: line.map((w) => w.text.trim()).join(' ') });
            line = [];
        };
        for (const w of toks) {
            const len = line.reduce((n, x) => n + x.text.trim().length + 1, 0) + w.text.trim().length;
            if (len > MAX_CHARS) flush();
            line.push(w);
            if (/[.!?]$/.test(w.text.trim()) && line.length > 3) flush();
        }
        flush();
    }
    // A line stays up until the next one starts, within reason, so the box does not blink between phrases.
    for (let i = 0; i < subtitles.length - 1; i++) subtitles[i].endMs = Math.min(subtitles[i + 1].startMs, subtitles[i].endMs + 900);
}

fs.writeFileSync(out, JSON.stringify({
    src: 'input.mp4',
    videoW: tl.width || 1920, videoH: tl.height || 1080,
    zooms: (tl.zooms || []).map((z) => ({ ...z, tMs: shift(z.tMs) })).filter((z) => z.tMs > 0),
    captions: (tl.captions || []).map((c) => ({ ...c, tMs: Math.max(0, shift(c.tMs)) })),
    urls: rewriteUrls((tl.urls || []).map((u) => ({ ...u, tMs: Math.max(0, shift(u.tMs)) }))),
    subtitles,
    durationInFrames: Math.round(Number(durationS) * 30),
    pad: Number(process.env.FRAME_PAD || 0.083),
    radius: Number(process.env.FRAME_RADIUS || 14),
    background: process.env.FRAME_BG || 'radial-gradient(120% 120% at 20% 10%, #0b3a8a 0%, #072a66 45%, #04173d 100%)',
    accent: process.env.FRAME_ACCENT || '#2563eb',
    title: process.env.FRAME_TITLE || '',
    chrome: process.env.FRAME_CHROME !== '0',
}));
console.error(`  frame: ${subtitles.length} subtitle lines, ${(tl.captions || []).length} steps, ${(tl.zooms || []).length} zooms`);
