// Reusable iOS-simulator flow recorder: drives a real native build on a booted
// simulator, captures the device screen with `simctl io recordVideo`, and logs
// every tap and caption so the overlay (cursor, ripple, caption pill) can be
// composited afterwards. Optional ElevenLabs voice-over, on the same contract
// as the browser recorder: the picture is paced to the audio, never the other
// way round.
//
// Usage:  node ios-recorder.mjs <flow.mjs>
// Prints the raw .mov path on stdout; writes <mov>.timeline.json beside it.
//
// HOW IT DRIVES THE APP
// Xcode 27 ships no Simulator.app, so there is no window to click and the whole
// cliclick approach is dead. Taps go through Maestro's XCUITest driver instead,
// which talks to the booted simulator directly and selects by testID — steadier
// than pixel coordinates, and the app already has the testIDs.
//
// Maestro runs a static YAML, which on its own cannot interleave narration. So
// the flow module runs twice over: first in PLAN mode, where its helpers only
// record what it means to do, and then for real, with the generated YAML calling
// back into this process before every action (`- runScript` → HTTP) and waiting
// for the answer. That makes this process the clock: a step lasts exactly as
// long as its spoken line, and the offsets in the timeline and the offsets the
// browser sees are the same numbers.
//
// Env: UDID (default: the booted simulator), BUNDLE_ID, OUT_DIR (default ./out),
//      NARRATION=0 to force silent, SEGMENT_GAP_MS (280), LEAD_IN_MS (400),
//      SCALE (points→pixels, default auto), MAESTRO (path to the binary),
//      ELEVENLABS_API_KEY / OPENAI_API_KEY / TTS_COMMAND (see tts.mjs).

import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const flowPath = process.argv[2] || process.env.FLOW;
if (!flowPath) {
    console.error('Usage: node ios-recorder.mjs <flow.mjs>');
    process.exit(1);
}

const OUT = process.env.OUT_DIR || 'out';
const GAP = Number(process.env.SEGMENT_GAP_MS || 280);
const MAESTRO = process.env.MAESTRO || path.join(os.homedir(), '.maestro/bin/maestro');

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const run = (cmd, args) =>
    new Promise((resolve, reject) =>
        execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
            err ? reject(new Error(`${cmd} failed: ${String(stderr || err.message).slice(-500)}`)) : resolve(stdout)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Simulator ────────────────────────────────────────────────────────────
function bootedUdid() {
    const list = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', '-j']));
    const all = Object.values(list.devices).flat();
    if (process.env.UDID) {
        const want = all.find((d) => d.udid === process.env.UDID);
        // Worth naming, because the way this otherwise shows up is a screenshot
        // failing with "Timeout waiting for screen surfaces", which reads like a
        // graphics problem rather than a shut-down device. Quitting Device Hub
        // shuts its simulator down with it.
        if (want && want.state !== 'Booted') {
            throw new Error(`Simulator ${want.name} is ${want.state}. Run: xcrun simctl boot ${want.udid}`);
        }
        return process.env.UDID;
    }
    const booted = all.find((d) => d.state === 'Booted');
    if (booted) return booted.udid;
    throw new Error('No booted simulator. Boot one, or set UDID.');
}
const udid = bootedUdid();

await fs.mkdir(OUT, { recursive: true });

/** Device screen size in pixels, straight from a screenshot. A device that has
 * just booted refuses the first screenshot or two while its display comes up. */
async function deviceSize() {
    const tmp = path.join(OUT, '.probe.png');
    for (let i = 0; ; i++) {
        try { await run('xcrun', ['simctl', 'io', udid, 'screenshot', tmp]); break; }
        catch (e) { if (i === 5) throw e; await sleep(2000); }
    }
    const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', tmp]);
    await fs.rm(tmp, { force: true });
    const [w, h] = out.trim().split(',').map(Number);
    return { w, h };
}
const dev = await deviceSize();

// ── Flow module, pass one: plan ──────────────────────────────────────────
const mod = await import(pathToFileURL(path.resolve(flowPath)).href);
const flow = mod.default ?? mod.flow;
if (typeof flow !== 'function') {
    console.error(`Flow module ${flowPath} must export a default async function.`);
    process.exit(1);
}
const BUNDLE = process.env.BUNDLE_ID || mod.appId;
if (!BUNDLE) throw new Error('No app id: set BUNDLE_ID or export `appId` from the flow.');

const ops = [];
const push = (op) => { ops.push(op); return Promise.resolve(); };
const plan = {
    // Paced here, in this process.
    say: (id) => push({ kind: 'say', id }),
    hold: (fallbackMs) => push({ kind: 'hold', fallbackMs }),
    cap: (text) => push({ kind: 'cap', text }),
    recap: () => push({ kind: 'recap' }),
    beat: (ms = 1100) => push({ kind: 'beat', ms }),
    // Handed to Maestro.
    // `what` is how the alignment check reads the flow's intent: a step that
    // waits for something is the author saying "this line crosses to a new
    // screen on purpose".
    launch: () => push({ kind: 'action', what: 'wait', yaml: [`- launchApp:`, `    appId: "${BUNDLE}"`, `    stopApp: true`] }),
    tap: (id) => push({ kind: 'action', what: 'tap', yaml: [`- tapOn:`, `    id: "${id}"`] }),
    tapText: (text) => push({ kind: 'action', what: 'tap', yaml: [`- tapOn:`, `    text: "${text}"`] }),
    type: (text) => push({ kind: 'action', what: 'type', yaml: [`- inputText: "${String(text).replace(/"/g, '\\"')}"`] }),
    waitFor: (id, timeout = 20000) => push({
        kind: 'action', what: 'wait',
        yaml: [`- extendedWaitUntil:`, `    visible:`, `      id: "${id}"`, `    timeout: ${timeout}`],
    }),
    waitForText: (text, timeout = 20000) => push({
        kind: 'action', what: 'wait',
        yaml: [`- extendedWaitUntil:`, `    visible:`, `      text: "${text}"`, `    timeout: ${timeout}`],
    }),
};
await flow(plan);

const actions = ops.filter((o) => o.kind === 'action');
console.error(`planned ${ops.length} steps (${actions.length} on the device)`);

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

// ── Generate the Maestro flow ────────────────────────────────────────────
const PORT = 7799 + (process.pid % 200);
const work = path.resolve(OUT, '.maestro');
await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });

// Polls rather than blocking on one long request: a hold can run twenty seconds
// and nothing here should depend on the driver's HTTP timeout being generous.
await fs.writeFile(path.join(work, 'sync.js'), `
var url = 'http://127.0.0.1:${PORT}/sync/' + STEP
var go = false
while (!go) {
    var r = http.get(url)
    go = (r.body === 'go')
}
output.step = STEP
`.trim() + '\n');

const yaml = [`appId: "${BUNDLE}"`, '---'];
const syncStep = (step) => yaml.push(`- runScript:`, `    file: sync.js`, `    env:`, `      STEP: "${step}"`);
syncStep('ready');
actions.forEach((a, i) => { syncStep(String(i)); yaml.push(...a.yaml); });
syncStep('end');
await fs.writeFile(path.join(work, 'flow.yaml'), yaml.join('\n') + '\n');

// ── Recording state ──────────────────────────────────────────────────────
let t0 = 0;
const now = () => Date.now() - t0;
const segments = [];
const captions = [];
let current = null;
let speakEndsAt = 0;
let player = null;

function showCaption(text) {
    const last = captions[captions.length - 1];
    if (last && last.endMs === null) last.endMs = now();
    if (text) captions.push({ text, startMs: now(), endMs: null });
}

async function doSay(id) {
    const seg = script.get(id);
    if (!seg) throw new Error(`No narration segment "${id}".`);
    showCaption(seg.caption);
    const clip = clips.get(id);
    if (!clip) { current = { id, startMs: now(), durMs: 0 }; return; }
    // Played locally only so the run is watchable; what lands in the file is
    // laid on afterwards, at this exact offset.
    player = spawn('afplay', [clip.file], { stdio: 'ignore' });
    speakEndsAt = Date.now() + clip.durMs;
    current = { id, clip: clip.file, startMs: now(), durMs: clip.durMs };
    segments.push(current);
}

// Every stretch where the flow deliberately does nothing. A screen that changes
// inside one of these changed on its own, while a line was still being spoken
// about the screen before it — which is the one misalignment the segment table
// cannot see, because the timings still add up perfectly.
const idle = [];

async function doHold(fallbackMs = 2200) {
    const from = now();
    const segId = current?.id ?? null;
    if (!current?.durMs) {
        await sleep(fallbackMs);
    } else {
        const left = speakEndsAt - Date.now();
        if (left > 0) await sleep(left);
    }
    idle.push({ segId, kind: 'hold', fromMs: from, toMs: now() });
    await sleep(GAP);
}

async function runOp(op) {
    switch (op.kind) {
        case 'say': return doSay(op.id);
        case 'hold': return doHold(op.fallbackMs);
        case 'cap': return showCaption(op.text);
        case 'recap': return showCaption(current ? script.get(current.id)?.caption : null);
        case 'beat': {
            const from = now();
            const segId = current?.id ?? null;
            await sleep(op.ms);
            idle.push({ segId, kind: 'beat', fromMs: from, toMs: now() });
            return;
        }
    }
}

// ── The control server: this process decides when Maestro may move on ────
const movPath = path.resolve(OUT, `flow-${Date.now()}.mov`);
let rec = null;
let cursor = 0;              // next op to run
let pending = null;          // step currently being served
let finished = false;
let failure = null;

async function startRecording() {
    rec = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '--force', movPath],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    // simctl holds the whole capture in memory and only writes the file when it
    // is told to stop, so the file's size says nothing about when recording
    // began. It does announce itself on stderr, and that line is t=0. A constant
    // error here shifts the whole soundtrack and nothing else (AUDIO_OFFSET_MS).
    let started = 0;
    rec.stderr.on('data', (d) => {
        if (!started && /Recording started/i.test(String(d))) started = Date.now();
        if (process.env.DEBUG) console.error(`  rec: ${String(d).trim()}`);
    });
    for (let i = 0; i < 400 && !started; i++) await sleep(25);
    t0 = started;
    if (!t0) throw new Error('simctl recordVideo never reported "Recording started".');
    await sleep(400);
    console.error(`recording → ${movPath}`);
}

let actionsPassed = 0;

/** Run every planned step up to (but not including) the nth device action.
 * The count has to survive across calls: counting from the cursor each time
 * walks the recorder past one extra action per step, and the narration then
 * runs away from the screen it is describing. */
async function advanceTo(nth) {
    while (cursor < ops.length) {
        const op = ops[cursor];
        if (op.kind === 'action') {
            if (actionsPassed === nth) return;
            actionsPassed++;
            cursor++;
            continue;
        }
        cursor++;
        await runOp(op);
    }
}

const server = http.createServer(async (req, res) => {
    const step = decodeURIComponent((req.url || '').replace('/sync/', ''));
    if (pending === step) { res.end('wait'); return; }       // poll while we work
    pending = step;

    const answer = async () => {
        try {
            if (step === 'ready') {
                await startRecording();
            } else if (step === 'end') {
                while (cursor < ops.length) { const op = ops[cursor++]; if (op.kind !== 'action') await runOp(op); }
                finished = true;
            } else {
                const nth = Number(step);
                await advanceTo(nth);
                // The action fires the moment this returns, so this is when the
                // tap lands to within a few milliseconds.
                actions[nth].firedMs = now();
                actions[nth].segId = current?.id ?? null;
            }
        } catch (e) {
            failure = e;
        }
        pending = null;
        res.end('go');
    };
    answer();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ── Put the device in the state the flow expects ─────────────────────────
// Recordings have to start from the same place every time, and "the same
// place" is app-specific: signed out, a seeded database, a cleared cache.
if (typeof mod.before === 'function') {
    console.error('running flow.before()…');
    await mod.before({ udid, run, sleep });
}

// ── Drive it ─────────────────────────────────────────────────────────────
console.error(`maestro → ${path.join(work, 'flow.yaml')}`);
const maestro = spawn(MAESTRO, ['--device', udid, 'test', 'flow.yaml'], { cwd: work });
let maestroOut = '';
maestro.stdout.on('data', (d) => { maestroOut += d; process.env.DEBUG && process.stderr.write(d); });
maestro.stderr.on('data', (d) => { maestroOut += d; process.env.DEBUG && process.stderr.write(d); });
const code = await new Promise((r) => maestro.on('close', r));

if (code !== 0) {
    failure = failure || new Error(`maestro exited ${code}`);
    console.error(maestroOut.split('\n').filter((l) => /FAILED|Error|error:/.test(l)).slice(-10).join('\n'));
}

showCaption(null);
await sleep(600);
player?.kill();
rec?.kill('SIGINT');                       // SIGINT is what finalizes the file
if (rec) await new Promise((r) => rec.on('close', r));
server.close();

// ── Where the taps landed ────────────────────────────────────────────────
// Maestro's driver logs every touch it delivers, in points and wall-clock, so
// the ripples can be composited exactly where and when the app was tapped.
async function tapsFromDriverLog() {
    const root = path.join(os.homedir(), '.maestro/tests');
    let dirs = [];
    try {
        dirs = (await fs.readdir(root)).sort().reverse().slice(0, 4);
    } catch { return []; }
    for (const d of dirs) {
        const hits = [];
        const walk = async (p) => {
            for (const e of await fs.readdir(p, { withFileTypes: true })) {
                const full = path.join(p, e.name);
                if (e.isDirectory()) await walk(full);
                else if (e.name === 'device-xctest.log') hits.push(full);
            }
        };
        try { await walk(path.join(root, d)); } catch { continue; }
        for (const log of hits) {
            const text = await fs.readFile(log, 'utf8');
            const taps = [...text.matchAll(/^(\S+ \S+) .*?Tapping ([\d.]+), ([\d.]+)/gm)]
                .map((m) => ({ at: Date.parse(m[1].replace(' ', 'T')), x: Number(m[2]), y: Number(m[3]) }))
                .filter((t) => Number.isFinite(t.at) && t.at >= t0 && t.at <= Date.now());
            if (taps.length) return taps;
        }
    }
    return [];
}

const raw = await tapsFromDriverLog();
// Points → pixels. Apple ships @2x and @3x simulators; whichever keeps every
// tap on the screen is the right one.
const SCALE = Number(process.env.SCALE || 0) ||
    (raw.every((t) => t.x * 3 <= dev.w && t.y * 3 <= dev.h) ? 3 : 2);
const taps = raw.map((t) => ({ tMs: t.at - t0, x: Math.round(t.x * SCALE), y: Math.round(t.y * SCALE) }));

// ── Did the screen move while a line was still talking? ──────────────────
// The measure is the fraction of the picture that differs from how the hold
// started. ffmpeg's own scene score is no use here: it compares neighbouring
// frames, and a navigation is an animated cross-fade whose frames each differ
// only slightly, so it slides underneath any threshold that is not also tripped
// by ordinary redraws.
//
// Measured on a real sign-in flow: two frames of the same screen differ by
// under 1%, text being typed into a field by about 10%, and a navigation to a
// different screen by 15% to 32%. Typing does not land inside a hold anyway,
// since the action that types finishes before the hold begins.
const CHANGED = Number(process.env.CHANGE_FRACTION || 0.13);
const PIXEL = 24;          // per-pixel delta (0-255) that counts as changed
const HZ = 5;              // samples per second
const GRID = 64;           // signature is GRID x GRID greyscale
// A transition the flow's own last action set off may still be animating as the
// hold begins, so ignore the first moment of each idle stretch.
const SETTLE = Number(process.env.SETTLE_GRACE_MS || 900);

/** One small greyscale thumbnail per sample, on the video's own clock. */
async function signatures() {
    return new Promise((resolve) => {
        const chunks = [];
        const ff = spawn('ffmpeg', ['-v', 'error', '-i', movPath,
            '-vf', `fps=${HZ},scale=${GRID}:${GRID},format=gray`, '-f', 'rawvideo', '-'],
            { stdio: ['ignore', 'pipe', 'ignore'] });
        ff.stdout.on('data', (c) => chunks.push(c));
        ff.on('close', () => {
            const buf = Buffer.concat(chunks);
            const size = GRID * GRID;
            const out = [];
            for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size));
            resolve(out);
        });
        ff.on('error', () => resolve([]));
    });
}

function changedFraction(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL) n++;
    return n / a.length;
}

const sigs = await signatures();
const sampleAt = (ms) => sigs[Math.min(Math.max(0, Math.round((ms / 1000) * HZ)), sigs.length - 1)];
const disturbed = [];

if (sigs.length > 2) {
    // Check one: a line that never waits for a new screen must not end on one.
    // This is the fault that hides from the segment table, because the timings
    // still add up: the app navigates inside the action, and the line then
    // spends the rest of itself describing a screen the viewer has left. A
    // segment that does contain a wait is the author saying the line is meant
    // to carry the viewer across, so it is allowed to.
    for (const s of segments) {
        const endMs = s.startMs + s.durMs;
        const mine = actions.filter((a) => a.segId === s.id);
        if (mine.some((a) => a.what === 'wait')) continue;
        const from = s.startMs + SETTLE;
        if (endMs - from < 1000) continue;
        const f = changedFraction(sampleAt(from), sampleAt(endMs - 200));
        if (f > CHANGED) {
            // Find where it went, so the report can say how long it talked over it.
            let atMs = endMs;
            for (let t = from; t < endMs; t += 1000 / HZ) {
                if (changedFraction(sampleAt(from), sampleAt(t)) > CHANGED) { atMs = t; break; }
            }
            disturbed.push({
                segId: s.id, kind: 'line', fromMs: s.startMs, toMs: endMs,
                atMs: Math.round(atMs), fraction: Number(f.toFixed(3)),
                talkedOverMs: Math.round(endMs - atMs),
            });
        }
    }

    // Check two: once the flow has stopped acting, the screen stays put. This
    // catches an app that navigates on a timer after the line's work is done.
    for (const w of idle) {
        if (disturbed.some((d) => d.segId === w.segId)) continue;
        const from = w.fromMs + SETTLE;
        if (w.toMs - from < 500) continue;
        const base = sampleAt(from);
        for (let t = from + 1000 / HZ; t < w.toMs; t += 1000 / HZ) {
            const f = changedFraction(base, sampleAt(t));
            if (f > CHANGED) {
                disturbed.push({ ...w, atMs: Math.round(t), fraction: Number(f.toFixed(3)), talkedOverMs: Math.round(w.toMs - t) });
                break;
            }
        }
    }
}

// ── Timeline ─────────────────────────────────────────────────────────────
const LEAD_IN = Number(process.env.LEAD_IN_MS || 400);
const firstStart = segments.length ? segments[0].startMs : (captions[0]?.startMs ?? 0);
const trimMs = Math.max(0, firstStart - LEAD_IN);

await fs.writeFile(`${movPath}.timeline.json`, JSON.stringify({
    device: dev,
    scale: SCALE,
    trimMs,
    offsetMs: Number(process.env.AUDIO_OFFSET_MS || 0),
    segments,
    captions: captions.map((c) => ({ ...c, endMs: c.endMs ?? now() })),
    taps,
    idle,
    disturbed,
}, null, 2));

// ── The segment table ────────────────────────────────────────────────────
// Two different faults live here. A line that ran short leaves silence. A line
// that talked over a screen change is describing the wrong picture, and its
// timings look perfect while it does it.
if (segments.length) {
    console.error('\n  segment            spoken   on screen');
    segments.forEach((s, i) => {
        const nextStart = segments[i + 1]?.startMs ?? now();
        const onScreen = nextStart - s.startMs;
        const short = onScreen > s.durMs + GAP + 250 ? '  ← SHORT (silence)' : '';
        const moved = disturbed.find((d) => d.segId === s.id);
        const over = moved ? `  ← TALKED OVER the next screen for ${(moved.talkedOverMs / 1000).toFixed(1)}s` : '';
        console.error(`  ${s.id.padEnd(18)} ${(s.durMs / 1000).toFixed(1)}s     ${(onScreen / 1000).toFixed(1)}s${short}${over}`);
    });
}
console.error(`\n${taps.length} taps · scale ${SCALE}x · ${(now() / 1000).toFixed(1)}s recorded · ${idle.length} idle stretches checked`);

if (disturbed.length) {
    console.error(`\nThe screen moved while a line was still speaking:`);
    for (const d of disturbed) {
        const where = d.kind === 'line' ? 'line' : `${d.kind} (after its last action)`;
        console.error(`  "${d.segId}": ${Math.round(d.fraction * 100)}% of the screen changed ` +
            `${((d.atMs - d.fromMs) / 1000).toFixed(1)}s into its ${where}, and the line then kept ` +
            `talking for ${(d.talkedOverMs / 1000).toFixed(1)}s over the new screen.`);
    }
    console.error(`\nThe line is describing a screen the viewer is no longer looking at, and the`);
    console.error(`segment table cannot see it: the timings still add up. Fix the flow, not the`);
    console.error(`audio. Either hold the screen still for the whole line (split the action so`);
    console.error(`the part that navigates falls under the next line), or let this line carry`);
    console.error(`the viewer across on purpose, by waiting for the new screen inside it and`);
    console.error(`writing words that describe arriving there. Re-run; cached clips are free.`);
    process.exitCode = 2;
}

if (failure) { console.error(`\nFlow failed: ${failure.message}`); process.exitCode = 1; }
console.log(movPath);
