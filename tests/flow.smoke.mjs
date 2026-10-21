// One-step flow against an inline page, used by tests/smoke.sh.
export const narration = [
    { id: 'hello', caption: 'Hello', text: 'A two second tone stands in for the voice.' },
];
export default async ({ say, hold, goto }) => {
    await goto('data:text/html,<h1 style="font:64px sans-serif;margin:2em">Flow Video Recorder smoke test</h1>');
    await say('hello');
    await hold();
};
