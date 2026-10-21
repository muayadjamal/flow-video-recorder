// Example flow. Copy this to flow.mjs and edit for your app.
//
// The default export receives a context of helpers:
//   page   – the Playwright Page (full API available)
//   say    – async (id) => show that segment's caption and start its voice clip
//   hold   – async (fallbackMs=2200) => wait until the spoken line has finished
//   recap  – async () => re-show the current caption (after a navigation)
//   cap    – async (text) => show a caption pill with no voice-over
//   click  – async (locatorOrSelector) => glide the cursor then click (ripple)
//   type   – async (locatorOrSelector, text) => click then type slowly
//   glide  – async (locatorOrSelector) => move the cursor onto an element
//   goto   – (url) => page.goto
//   beat   – (ms=1100) => pause (let the viewer read / the UI settle)
//   safe   – async (fn) => run fn, swallow errors (for optional steps)
//   speaking – () => is the current line still playing?
//
// VOICE-OVER
// Export `narration` and every step becomes say() … work … hold(). The clips are
// synthesized and measured before the browser opens, so hold() knows exactly how
// long to keep the step on screen: the picture waits for the voice, never the
// other way round. Without any TTS configured the same flow records silently.
//
// Tips:
//   - Prefer role/label locators: page.getByRole('button', { name: 'Save' }).
//   - Write `text` for the ear, not the eye: spell names the way they should be
//     read, and prefer one flowing sentence over a run of short ones.
//   - Err LONG on narration. A line longer than its step just holds the shot;
//     a step longer than its line leaves silence. The recorder prints a
//     per-segment table flagging every line that ran short — fix those.
//   - Never state on the soundtrack what you have not asserted on screen. If the
//     line says "two batches", assert two batches and fail the run otherwise.
//   - Wait for async work: await page.getByText('Completed').waitFor({ timeout: 60000 }).
//   - A navigation wipes the caption pill: say() → goto() → recap() → hold().
//   - File upload: page.setInputFiles('input[type=file]', absPath).

const BASE = process.env.BASE || 'http://localhost:8000';

export const narration = [
    {
        id: 'intro',
        caption: 'A recorded walkthrough',
        text: "Let me show you how this works, starting from the login screen.",
    },
    {
        id: 'login',
        caption: 'Step 1 · Log in',
        text: "I'll sign in with a demo account. Nothing here is special — it's the same form everyone gets.",
    },
    {
        id: 'dashboard',
        caption: 'Step 2 · The dashboard',
        text: "And this is the dashboard. Everything you need for the day is on one screen, which is the whole point of it.",
    },
    {
        id: 'outro',
        caption: 'That is the tour',
        text: "That's the tour. Short, but you've seen the shape of it.",
    },
];

export default async function flow({ page, say, hold, recap, click, type, glide, goto, safe }) {
    await goto(`${BASE}/login`);
    await say('intro');
    await hold();

    await say('login');
    await type(page.getByRole('textbox', { name: 'Email' }), 'demo@example.com');
    await type(page.getByRole('textbox', { name: 'Password' }), 'password');
    await click(page.getByRole('button', { name: 'Log in' }));
    await page.waitForURL('**/dashboard');
    await recap();
    await hold();

    await say('dashboard');
    await safe(() => glide(page.getByRole('heading', { name: 'Dashboard' })));
    await hold();

    await say('outro');
    await hold();
}
