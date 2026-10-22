#!/usr/bin/env bash
# Optional last step: spring-eased zooms on the moments the flow marked with
# zoom() or click(..., { zoom }), inside a framed canvas. Rendered with Remotion.
#
# Usage: frame.sh <recording.mp4> <recording.timeline.json> [output.mp4]
# Requires: node, and the frame/ directory next to this script (copied with the
#           assets). Installs Remotion into frame/node_modules on first run,
#           which downloads a headless Chrome; budget a few minutes and ~500 MB.
# Env: FRAME_PAD (inset as a fraction of height, default 0.06), FRAME_RADIUS (18),
#      FRAME_BG (CSS background, default a dark gradient), CRF (16).
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

node -e '
const fs = require("fs");
const tl = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const dur = Number(process.argv[2]);
const trim = tl.trimMs || 0;
fs.writeFileSync(process.argv[3], JSON.stringify({
  src: "input.mp4",
  videoW: tl.width || 1920, videoH: tl.height || 1080,
  zooms: (tl.zooms || []).map((z) => ({ ...z, tMs: z.tMs - trim })).filter((z) => z.tMs > 0),
  durationInFrames: Math.round(dur * 30),
  pad: Number(process.env.FRAME_PAD || 0.06),
  radius: Number(process.env.FRAME_RADIUS || 18),
  background: process.env.FRAME_BG || "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #312e81 100%)",
}));
' "$timeline" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")" "$proj/props.json"

(cd "$proj" && npx remotion render src/index.ts Framed "$out" --props=props.json --crf="${CRF:-16}" --concurrency=4 --log=error)

rm -f "$proj/public/input.mp4" "$proj/props.json"
echo "Wrote $out"
