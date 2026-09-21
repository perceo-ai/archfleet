# brag-output

Source for the launch video linked from the repo README.

The rendered deliverables live in `public/` so the app serves them too:

- `public/brag.mp4` — the 20s video, with the poster baked in as frame 0
- `public/brag.jpg` — the poster still

This directory keeps the material that produced them:

- `brag-plan.md` — the angle, storyboard, and beat timings
- `composition-brief.md` — the handoff brief
- `share-copy.txt` — the launch caption
- `composition/` — the HyperFrames project

## Re-rendering

Run these from the repository root. All three steps are required: stopping after
the render leaves a video whose first frame is black, which is what every player
and platform grabs for the idle thumbnail.

```bash
# 1. render (the check is the pre-render gate — fix anything it reports)
cd brag-output/composition
npx hyperframes check
npx hyperframes render --quality looks --output ../../public/brag.mp4
cd ../..

# 2. pull the poster from the strongest settled beat (10.6s = the held
#    takeover card). Nudge the timestamp if the frame lands mid-transition.
ffmpeg -y -ss 10.6 -i public/brag.mp4 -frames:v 1 -q:v 2 public/brag.jpg

# 3. bake that poster over frame 0 only — same duration, same frame count,
#    audio copied through. At 30fps it shows for 1/30s, imperceptible on
#    playback, but it is what thumbnail grabbers see.
ffmpeg -y -i public/brag.mp4 -i public/brag.jpg \
  -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" \
  -map "[v]" -map "0:a?" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a copy -movflags +faststart public/brag.poster.mp4 \
&& mv public/brag.poster.mp4 public/brag.mp4
```

Verify frame 0 is the poster and the audio survived:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,nb_frames public/brag.mp4
```

## Why the composition loads GSAP from a CDN

`composition/index.html` pins its animation runtime with

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
```

That line is scaffolded by `hyperframes init` and is the framework's documented
composition shape, so `npx hyperframes check` and `render` both expect it. It
does not conflict with the determinism rules those same docs impose: the ban is
on non-deterministic *composition logic* — render-time clocks, unseeded
randomness, network calls made while frames are being produced — not on loading
a version-pinned runtime before the timeline is built. The URL is pinned to an
exact version, so a re-render either fetches those identical bytes or fails
loudly rather than drifting.

The practical consequence is that **re-rendering needs network access**. The
committed `public/brag.mp4` does not: it is a finished artifact, and nothing in
the app's build or runtime path reads this directory. If the video ever needs to
be reproducible offline, vendor `gsap.min.js` into `composition/assets/` and
point the tag at it — but check it against the HyperFrames version in
`composition/package.json` first, since the runtime contract is theirs, not ours.
