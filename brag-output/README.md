# brag-output

Source for the launch video in the repo README.

The rendered deliverables live in `public/` so the app serves them too:

- `public/brag.mp4` — the 20s video (poster baked as frame 0)
- `public/brag.jpg` — the poster still

This directory keeps the material that produced them:

- `brag-plan.md` — the angle, storyboard, and beat timings
- `composition-brief.md` — the handoff brief
- `share-copy.txt` — the launch caption
- `composition/` — the HyperFrames project

Re-render from `composition/`:

```bash
cd brag-output/composition
npx hyperframes check                                  # the pre-render gate
npx hyperframes render --quality looks --output ../../public/brag.mp4
```

Re-baking the poster as frame 0 (so every player's idle thumbnail is the poster,
not a black first frame) is a separate ffmpeg pass — see `brag-plan.md`.
