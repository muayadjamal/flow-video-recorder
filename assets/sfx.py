# Lay sound effects from earshot's bank on a finished video, under its voice.
# Run by sfx.sh with earshot's Python; see that file for usage and knobs.
#
# cues.json is a recorder timeline (its `sounds` and `trimMs`) or the sidecar
# motion.mjs writes for a scene ({ sounds: [{ tMs, role }] }). Each cue names a
# role of the kit (click, key, pop, ...); the role's takes rotate so repeats
# differ, and its sync point (onset, or a whoosh's peak) lands on the cue.
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from earshot.forge import kit

SR = 48000
KEY_GAP = 0.09   # a typing run keeps a key every 90 ms at most: 42 ms per character reads as a buzz
MIN_GAP = 0.06   # any other two cues closer than this are one event to the ear: keep the first

video, cues_path, out, cache = sys.argv[1:5]
cues = json.load(open(cues_path))
# the same shift mux.mjs gives the voice: the screencast's lead padding, less the head trim
shift = ((cues.get('offsetMs') or 0) - (cues.get('trimMs') or 0)) / 1000


def ffprobe(*a):
    return subprocess.run(['ffprobe', '-v', 'error', *a, video], capture_output=True, text=True, check=True).stdout.strip()


dur = float(ffprobe('-show_entries', 'format=duration', '-of', 'csv=p=0'))
has_audio = 'audio' in ffprobe('-show_entries', 'stream=codec_type', '-of', 'csv=p=0')

# The kit: a preset name (calm by default: soft natural touches) or a kit.json of your own.
name = os.environ.get('SFX_KIT', 'calm')
kit_json = name if name.endswith('.json') else os.path.join(cache, 'kits', f'{name}.json')
if not os.path.exists(kit_json):
    kit.init(name, kit_json)
take_dir = os.path.join(cache, 'kits', os.path.basename(kit_json)[:-5])   # cached takes: rendered once, reused
lock = kit.render(kit_json, take_dir)
roles = lock['roles']

with tempfile.TemporaryDirectory() as tmp:
    if has_audio:
        wav = os.path.join(tmp, 'src.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-vn', '-ac', '2', '-ar', str(SR), wav], check=True)
        mix = sf.read(wav, dtype='float64')[0]
    else:
        mix = np.zeros((int(dur * SR), 2))
    voiced = has_audio and np.abs(mix).max() > 1e-3
    # Under a voice the effects sit back, and follow the voice's loudness (the kit's
    # levels assume about -16 LUFS); a silent video carries them at the kit's own levels.
    offset = float(os.environ.get('SFX_DB', -6 if voiced else 0))
    if voiced:
        import pyloudnorm
        offset += min(6.0, max(-12.0, pyloudnorm.Meter(SR).integrated_loudness(mix) + 16))

    kept, dropped, last, last_key, used = [], {}, -1.0, -1.0, {}
    for c in sorted(cues.get('sounds') or [], key=lambda c: c['tMs']):
        t, role = c['tMs'] / 1000 + shift, c['role']
        why = None
        if not 0 <= t < dur:
            why = 'outside the video'
        elif not roles.get(role):
            why = 'not in the kit'
        elif role.startswith('key') and t - last_key < KEY_GAP:
            why = 'typing thinned'
        elif not role.startswith('key') and t - last < MIN_GAP:
            why = 'too close to the one before'
        if why:
            dropped[why] = dropped.get(why, 0) + 1
            continue
        last = t
        if role.startswith('key'):
            last_key = t
        kept.append((t, role))

    for t, role in kept:
        r = roles[role]
        take = r['takes'][used.get(role, 0) % len(r['takes'])]
        used[role] = used.get(role, 0) + 1
        y = sf.read(os.path.join(take_dir, take['file']), dtype='float64')[0]
        y = np.stack([y, y], 1) if y.ndim == 1 else y
        y = y * 10 ** ((kit.gain_db(take, r) + offset) / 20)
        s = int(kit.place(take, r, t) * SR)
        if s < 0:
            y, s = y[-s:], 0
        n = min(len(y), len(mix) - s)
        if n > 0:
            mix[s:s + n] += y[:n]

    peak = np.abs(mix).max()
    if peak > 0.97:   # rare: an effect on a voice peak; scale the whole track rather than clip
        mix *= 0.97 / peak
    wav = os.path.join(tmp, 'mix.wav')
    sf.write(wav, mix.astype(np.float32), SR, subtype='PCM_24')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], check=True)

summary = ', '.join(f'{n} {r}' for r, n in sorted(used.items()))
skipped = ', '.join(f'{n} {w}' for w, n in dropped.items())
print(f'  sfx: {summary or "no cues"} ({lock["name"]} kit, {offset:+.1f} dB){"; skipped " + skipped if skipped else ""}', file=sys.stderr)
