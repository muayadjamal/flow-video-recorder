// Example iOS flow. Copy this to flow.mjs and edit for your app.
//
// The default export receives a context of helpers:
//   launch()             – relaunch the app from cold (stopApp: true)
//   tap(testID)          – tap the element with that accessibility id
//   tapText(text)        – tap the element showing that text
//   type(text)           – type into whatever currently has focus
//   waitFor(testID, ms)  – wait until that element is on screen
//   waitForText(text, ms)– same, by visible text
//   say(id)              – show the segment's caption and start its voice clip
//   hold(fallbackMs)     – wait until the spoken line has finished
//   recap()              – re-show the current caption
//   cap(text)            – show a caption with no voice-over
//   beat(ms = 1100)      – pause (let the screen settle / the viewer read)
//
// HOW IT RUNS
// The flow is executed twice. The first pass is a PLAN: the helpers only write
// down what you meant to do. The recorder then synthesizes the narration,
// generates a Maestro flow from the device steps, and runs it — with the
// generated flow calling back into the recorder before every action and waiting
// for permission to proceed. So a step lasts exactly as long as its narration,
// and the audio can never drift away from the screen it is describing.
//
// This is also why you cannot branch on what is on screen: the plan is fixed
// before the app ever opens. Use waitFor() for anything that varies.
//
// Tips:
//   - Select by testID. Pixel coordinates break on the next device size.
//   - An element with `opacity: 0` does not exist as far as XCUITest is
//     concerned. Wait on a visible landmark instead.
//   - A screen that loads over the network needs waitFor(), not beat().
//   - Err LONG on narration. A line longer than its step just holds the shot;
//     a step longer than its line leaves silence. The recorder prints a
//     per-segment table flagging every line that ran short — fix those.
//   - Write `text` for the ear, not the eye: spell names the way they should be
//     read, and prefer one flowing sentence over a run of short ones.
//   - Never state on the soundtrack what you have not put on screen.

export const appId = 'com.example.myapp';

/**
 * Optional. Runs before recording starts, to put the device in the state the
 * flow assumes — signed out, seeded, cache cleared. Recordings that start from
 * wherever the last run left off are how you get a demo of the wrong screen.
 *
 * A session held in the keychain is the usual trap: it survives uninstalling
 * the app, and only `simctl keychain reset` clears it — which also removes any
 * development root certificate, so put that back.
 */
export async function before({ udid, run }) {
    await run('xcrun', ['simctl', 'terminate', udid, appId]).catch(() => { });
    await run('xcrun', ['simctl', 'keychain', udid, 'reset']);
}

export const narration = [
    {
        id: 'intro',
        caption: 'A recorded walkthrough',
        text: "Here is the app opening on a phone, and the first thing it wants is to know who you are.",
    },
    {
        id: 'signin',
        caption: 'Step 1 · Sign in',
        text: "I'll sign in with a demo account, which is the same form everyone gets — nothing about this one is special.",
    },
    {
        id: 'home',
        caption: 'Step 2 · The home screen',
        text: "And that is the home screen, with everything the day needs on it, which is rather the point of the whole thing.",
    },
];

export default async function flow({ launch, tap, type, waitFor, waitForText, say, hold, recap, beat }) {
    await launch();
    await say('intro');
    // Generous: a cold start plus a JavaScript bundle is slow the first time.
    await waitFor('welcome-screen', 60000);
    await recap();
    await hold();

    await say('signin');
    await tap('email-input');
    await type('demo@example.com');
    await beat(600);
    await tap('continue-button');
    await waitFor('home-screen');
    await recap();
    await hold();

    await say('home');
    await waitForText('Today', 30000);
    await recap();
    await hold();
}
