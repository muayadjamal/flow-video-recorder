// Reusable Playwright flow recorder: visible arrow cursor + click ripple,
// on-screen step captions, optional ElevenLabs voice-over, high-resolution
// supersampled output.
//
// Usage:  node recorder.mjs <flow.mjs>
// The flow module exports a default async function that receives a context of
// helpers and drives the browser. Produces a .webm in OUT_DIR (convert to mp4
// with ffmpeg — see record.sh). Prints the .webm path on stdout.
//
// VOICE-OVER
// A flow may also export `narration`: an array of { id, caption, text }. Every
// clip is synthesized and measured BEFORE the browser opens, then the flow paces
// itself to the audio via say()/hold() — the step lasts as long as the sentence
// takes to speak, so the words always land on the thing they describe. The flow
// writes a timeline (clip start offsets) that mux.mjs lays onto the MP4.
// Without any TTS configured the same flow records silently, captions intact.
//
// Env knobs: POINTER=0 (no cursor or click ripple), CAPTIONS=0 (no caption
// pill), NARRATION=0 (no voice-over), ZOOM_SCALE (1.6), ZOOM_HOLD_MS (1500),
//            OUT_DIR (default storage/app/recording), WIDTH/HEIGHT (1920x1080),
// SCALE (deviceScaleFactor, default 2 = supersampled/crisp), SLOWMO (ms, 55),
// NARRATION (set to 0 to skip voice-over), SEGMENT_GAP_MS (280).

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const flowPath = process.argv[2] || process.env.FLOW;
if (!flowPath) {
    console.error('Usage: node recorder.mjs <flow.mjs>');
    process.exit(1);
}

const OUT = process.env.OUT_DIR || 'storage/app/recording';
const VIEW = { width: Number(process.env.WIDTH || 1920), height: Number(process.env.HEIGHT || 1080) };
const SCALE = Number(process.env.SCALE || 2);
const SLOWMO = Number(process.env.SLOWMO || 55);
const GAP = Number(process.env.SEGMENT_GAP_MS || 280);

// Injected into every page: a macOS-style arrow cursor that follows the mouse,
// squashes while the button is down, and leaves a ripple on every click.
const mouseHelper = () => {
    const ensure = () => {
        if (document.getElementById('__cursor') || !document.body) return document.getElementById('__cursor');
        const s = document.createElement('style');
        s.textContent = `
      #__cursor{position:fixed;top:-60px;left:-60px;width:30px;height:44px;margin:-2px 0 0 -3px;
        pointer-events:none;z-index:2147483647;transform-origin:3px 2px;transition:transform .08s ease-out;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
      #__cursor.__down{transform:scale(.82)}
      .__ring{position:fixed;width:14px;height:14px;border-radius:50%;border:3px solid rgba(0,0,0,.6);
        box-shadow:0 0 0 2px rgba(255,255,255,.9);margin:-7px 0 0 -7px;pointer-events:none;z-index:2147483646;
        animation:__r .55s ease-out forwards}
      @keyframes __r{to{width:64px;height:64px;margin:-32px 0 0 -32px;opacity:0}}`;
        document.head.appendChild(s);
        const c = document.createElement('div');
        c.id = '__cursor';
        // The standard arrow: tip at (3,2) so the hotspot sits on the mouse point.
        c.innerHTML = '<svg viewBox="0 0 26 38" width="30" height="44" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M3 2 L3 30 L10.2 23.4 L15 35 L19.6 33 L14.8 21.4 L24 21.4 Z" fill="#000" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>';
        document.body.appendChild(c);
        return c;
    };
    document.addEventListener('mousemove', (e) => {
        const c = ensure();
        if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }
    }, true);
    document.addEventListener('mousedown', (e) => {
        const c = ensure();
        if (c) c.classList.add('__down');
        const r = document.createElement('div');
        r.className = '__ring';
        r.style.left = e.clientX + 'px';
        r.style.top = e.clientY + 'px';
        (document.body || document.documentElement).appendChild(r);
        setTimeout(() => r.remove(), 600);
    }, true);
    document.addEventListener('mouseup', () => {
        const c = document.getElementById('__cursor');
        if (c) c.classList.remove('__down');
    }, true);
};

// Injected into every page: a caption pill controlled via window.__cap(text).
const captionHelper = () => {
    window.__cap = (text) => {
        let el = document.getElementById('__cap');
        if (!el) {
            el = document.createElement('div');
            el.id = '__cap';
            el.style.cssText = 'position:fixed;left:50%;bottom:38px;transform:translateX(-50%);z-index:2147483647;' +
                'background:rgba(17,24,39,.94);color:#fff;padding:16px 30px;border-radius:999px;' +
                'font:600 22px/1.25 system-ui,-apple-system,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4);' +
                'pointer-events:none;max-width:82vw;text-align:center;letter-spacing:.2px';
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = text;
    };
};

const mod = await import(pathToFileURL(path.resolve(flowPath)).href);
const flow = mod.default ?? mod.flow;
if (typeof flow !== 'function') {
    console.error(`Flow module ${flowPath} must export a default async function.`);
    process.exit(1);
}

// ── Voice-over: synthesize and measure everything up front ───────────────
const narration = Array.isArray(mod.narration) ? mod.narration : [];
const tts = narration.length > 0
    ? await import(pathToFileURL(path.resolve(path.dirname(flowPath), 'tts.mjs')).href)
    : null;
const ttsProvider = tts ? tts.provider() : null;
const wantVoice = narration.length > 0 && process.env.NARRATION !== '0' && !!ttsProvider;
let clips = new Map();

if (narration.length > 0 && !wantVoice) {
    console.error(ttsProvider
        ? 'Narration disabled (NARRATION=0) — recording captions only.'
        : 'No TTS configured (ELEVENLABS_API_KEY, OPENAI_API_KEY, TTS_COMMAND, or macOS say) — recording captions only.');
}

if (wantVoice) {
    console.error(`Synthesizing ${narration.length} narration clips…`);
    clips = await tts.synthesize(narration);
}

const script = new Map(narration.map((s) => [s.id, s]));

const browser = await chromium.launch({ slowMo: SLOWMO });
const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    recordVideo: { dir: OUT, size: VIEW },
});
// What the viewer asked for. The flow file never changes: a run without the
// pointer simply does not inject it, and a run without subtitles leaves the
// caption calls as no-ops.
const POINTER = process.env.POINTER !== '0';
const CAPTIONS = process.env.CAPTIONS !== '0';

if (POINTER) await context.addInitScript(mouseHelper);
if (CAPTIONS) await context.addInitScript(captionHelper);

const page = await context.newPage();
const video = page.video();

// The screencast starts with the page, so this is the flow clock's zero — the
// same zero the muxed audio offsets are measured from.
const t0 = Date.now();
const since = () => Date.now() - t0;

const beat = (ms = 1100) => page.waitForTimeout(ms);
const setCaption = async (t) => {
    if (!CAPTIONS) return;
    await page.evaluate((x) => window.__cap?.(x), t).catch(() => {});
};
const cap = async (t) => { await setCaption(t); await beat(650); };

const glide = async (loc) => {
    const l = typeof loc === 'string' ? page.locator(loc) : loc;
    const first = l.first();
    await first.scrollIntoViewIfNeeded().catch(() => {});
    const box = await first.boundingBox();
    if (!box) return false;
    lastPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(lastPoint.x, lastPoint.y, { steps: 30 });
    await beat(300);
    return true;
};
// ── zoom(): a camera push-in, rendered later by frame.sh ─────────────────
// Nothing changes in the page. The recorder logs where and when; the optional
// Remotion step eases into that point, holds, and eases back out.
const zooms = [];
const ZOOM_SCALE = Number(process.env.ZOOM_SCALE || 1.6);
const ZOOM_HOLD_MS = Number(process.env.ZOOM_HOLD_MS || 1500);
let lastPoint = { x: VIEW.width / 2, y: VIEW.height / 2 };
const zoom = async (loc, { scale = ZOOM_SCALE, ms = ZOOM_HOLD_MS, hold = true } = {}) => {
    let x, y;
    if (loc && typeof loc === 'object' && 'x' in loc) ({ x, y } = loc);
    else if (loc) {
        const l = typeof loc === 'string' ? page.locator(loc) : loc;
        const box = await l.first().boundingBox();
        if (!box) return;
        x = box.x + box.width / 2; y = box.y + box.height / 2;
    } else ({ x, y } = lastPoint);
    zooms.push({ tMs: since(), x: Math.round(x), y: Math.round(y), scale, holdMs: ms });
    if (hold) await beat(ms);
};

const click = async (loc, { zoom: z } = {}) => {
    if (!(await glide(loc))) return;
    if (z) await zoom(lastPoint, { scale: z === true ? ZOOM_SCALE : z, hold: false });
    await page.mouse.down();
    await beat(100);
    await page.mouse.up();
    await beat(z ? ZOOM_HOLD_MS : 500);
};
const type = async (loc, txt) => {
    await click(loc);
    const l = typeof loc === 'string' ? page.locator(loc) : loc;
    await l.first().fill('');
    await page.keyboard.type(txt, { delay: 42 });
    await beat(300);
};
const goto = (url) => page.goto(url);
const safe = async (fn) => { try { await fn(); } catch (e) { console.error('skip:', String(e.message).split('\n')[0]); } };

// ── say() / hold(): the narration-paced step ─────────────────────────────
const timeline = [];
let current = null;

/**
 * Start a narration segment: show its caption and stamp the moment its clip
 * begins. Everything the flow does next happens while that line is spoken.
 */
const say = async (id) => {
    const seg = script.get(id);
    if (!seg) {
        throw new Error(`Flow asked to say "${id}", which is not in the narration script.`);
    }
    const clip = clips.get(id);
    await setCaption(seg.caption ?? seg.text);
    current = { id, startMs: since(), clip: clip?.file ?? null, durMs: clip?.durMs ?? 0 };
    timeline.push(current);
};

/**
 * Close the current segment: wait until the spoken line has finished (plus a
 * breath), so the next line never starts over the top of this one. Without a
 * clip it falls back to `fallbackMs`, which keeps silent runs watchable.
 */
const hold = async (fallbackMs = 2200) => {
    if (!current) return;
    const target = (current.durMs || fallbackMs) + GAP;
    const spent = since() - current.startMs;
    if (spent < target) {
        await beat(target - spent);
    }
    current.actualMs = since() - current.startMs;
    current = null;
};

/** Whether the current segment still has speech left to play. */
const speaking = () => !!current && since() - current.startMs < current.durMs;

/**
 * Put the current segment's caption back. A page load wipes the injected pill,
 * so a step that navigates mid-sentence needs this to keep the caption on
 * screen while the line finishes.
 */
const recap = async () => {
    const seg = current && script.get(current.id);
    if (seg) {
        await setCaption(seg.caption ?? seg.text);
    }
};

const ctx = { page, context, browser, cap, beat, glide, click, zoom, type, goto, safe, say, hold, recap, speaking };

let failure = null;
try {
    await flow(ctx);
} catch (e) {
    failure = e;
} finally {
    const flowMs = since();
    await context.close();
    await browser.close();

    const webm = await video.path();

    if (timeline.length > 0 || zooms.length > 0) {
        const durOut = await new Promise((resolve) => {
            import('node:child_process').then(({ execFile }) => {
                execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                    '-of', 'default=noprint_wrappers=1:nokey=1', webm], (err, stdout) =>
                    resolve(err ? null : Math.round(parseFloat(stdout.trim()) * 1000)));
            });
        });

        // Everything the screencast holds beyond the flow's own clock is padding
        // around it. Half of it sits in front of t0, which is what the audio has
        // to shift by; it is normally well under 300ms.
        const padMs = durOut === null ? 0 : Math.max(0, durOut - flowMs);
        const offsetMs = Number(process.env.AUDIO_OFFSET_MS ?? Math.round(padMs / 2));

        // The first second or two is the app still painting itself, which is an
        // ugly way to open. Cut the head back to a short beat before the first
        // spoken line; record.sh seeks the encode there and mux.mjs shifts every
        // clip by the same amount, so the trim cannot desync the voice-over.
        const leadInMs = Number(process.env.LEAD_IN_MS || 400);
        const trimMs = Math.max(0, (timeline[0]?.startMs ?? 0) - leadInMs);

        const timelinePath = webm.replace(/\.webm$/, '.timeline.json');
        await fs.writeFile(timelinePath, JSON.stringify({
            flowMs, videoMs: durOut, padMs, offsetMs, leadInMs, trimMs, width: VIEW.width, height: VIEW.height, segments: timeline, zooms,
        }, null, 2));

        // A per-segment report: where the words ran out before the step did is
        // exactly where the finished video will sit in silence.
        if (timeline.length > 0) console.error('\nsegment            spoken   onscreen   silence');
        for (const s of timeline) {
            const spoken = (s.durMs / 1000).toFixed(1);
            const actual = ((s.actualMs ?? 0) / 1000).toFixed(1);
            const gap = ((s.actualMs ?? 0) - s.durMs) / 1000;
            const flag = gap > 1.2 ? '  <-- lengthen this line' : '';
            console.error(`${s.id.padEnd(18)} ${spoken.padStart(5)}s ${actual.padStart(9)}s ${gap.toFixed(1).padStart(8)}s${flag}`);
        }
        const speech = timeline.reduce((n, s) => n + s.durMs, 0);
        console.error(`\nflow ${(flowMs / 1000).toFixed(1)}s · video ${((durOut ?? 0) / 1000).toFixed(1)}s · ` +
            `speech ${(speech / 1000).toFixed(1)}s (${Math.round((speech / (durOut || 1)) * 100)}% voiced) · ` +
            `pad ${padMs}ms · audio offset ${offsetMs}ms\n`);
    }

    if (failure) {
        console.error(failure.stack || String(failure));
        process.stdout.write(webm + '\n');
        process.exit(1);
    }

    process.stdout.write(webm + '\n');
}
