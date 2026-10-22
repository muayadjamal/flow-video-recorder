#!/usr/bin/env bash
# Optional last step: spring-eased zooms on the moments the flow marked with
# zoom() or click(..., { zoom }), inside a framed canvas. Rendered with Remotion.
#
# Usage: frame.sh <recording.mp4> <recording.timeline.json> [output.mp4]
# Requires: node, and the frame/ directory next to this script (copied with the
#           assets). Installs Remotion into frame/node_modules on first run,
#           which downloads a headless Chrome; budget a few minutes and ~500 MB.
# Env: FRAME_PAD (inset as a fraction of height, default 0.06), FRAME_RADIUS (14),
#      FRAME_BG (CSS background, default a deep blue gradient), FRAME_ACCENT
#      (step badge colour), FRAME_TITLE (label at the top right, e.g. the app
#      name), FRAME_URL (what the browser chrome shows instead of the recorded
#      URLs, e.g. the production domain when recording against localhost),
#      FRAME_CHROME=0 (no browser chrome), FRAME_URL_QUERY=1 (keep query strings
#      in the bar; off by default because that is where tokens live),
#      SUB_MAX_CHARS (44), CRF (16).
#      Run record.sh with FRAME=1 CAPTIONS=0 first: the step header replaces
#      the in-page caption pill, and the spoken-word subtitles come from the
#      narration clips.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
in="${1:?Usage: frame.sh <recording.mp4> <timeline.json> [output.mp4]}"
timeline="${2:?Usage: frame.sh <recording.mp4> <timeline.json> [output.mp4]}"
out="${3:-${in%.mp4}.framed.mp4}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
proj="$here/frame"

[ -d "$proj/node_modules/remotion" ] || (cd "$proj" && npm install --no-audit --no-fund >/dev/null)

mkdir -p "$proj/public"
cp "$in" "$proj/public/input.mp4"

node "$here/frame-props.mjs" "$timeline" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")" "$proj/props.json"

(cd "$proj" && npx remotion render src/index.ts Framed "$out" --props=props.json --crf="${CRF:-16}" --concurrency=4 --log=error)

rm -f "$proj/public/input.mp4" "$proj/props.json"
echo "Wrote $out"
