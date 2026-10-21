#!/usr/bin/env bash
# Record a flow to a high-quality MP4, with voice-over when the flow has one.
#
# Usage: record.sh <flow.mjs> [output.mp4]
# Requires: node, playwright (npm i -D playwright && npx playwright install chromium), ffmpeg.
# Env: BASE (app url), WIDTH/HEIGHT (default 2560x1440, the best-quality master), SCALE (dsf, default 2),
#      SLOWMO (ms), OUT_DIR (webm scratch dir), CRF (default 16, near lossless; raise only if asked),
#      TTS: ELEVENLABS_API_KEY, OPENAI_API_KEY, TTS_COMMAND or macOS say (see tts.mjs), NARRATION=0 (force silent).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
flow="${1:?Usage: record.sh <flow.mjs> [output.mp4]}"
out="${2:-demo.mp4}"
width="${WIDTH:-2560}"
height="${HEIGHT:-1440}"
crf="${CRF:-16}"

webm="$(node "$here/recorder.mjs" "$flow" | tail -1)"
timeline="${webm%.webm}.timeline.json"

# Drop the app's first paint off the front, if the recorder measured a trim. The
# same figure is subtracted from every audio offset in mux.mjs.
trim=0
if [ -f "$timeline" ]; then
  trim="$(node -e "process.stdout.write(String((JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).trimMs||0)/1000))" "$timeline")"
fi

ffmpeg -y -loglevel error -ss "$trim" -i "$webm" -r 30 \
  -vf "scale=${width}:${height}:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf "$crf" -movflags +faststart "$out"

# The recorder writes a timeline whenever the flow narrated. Lay the voice on.
if [ -f "$timeline" ]; then
  narrated="$(node "$here/mux.mjs" "$out" "$timeline" "${out%.mp4}.voiced.mp4")"
  mv "$narrated" "$out"
  # Kept beside the video: it says which line was spoken at which offset, which
  # is what you check frames against to prove the voice-over is in sync.
  mv "$timeline" "${out%.mp4}.timeline.json"
fi

rm -f "$webm"
echo "Wrote $(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
