# Hyperframes Composition Brief: Archfleet

## Objective
Create a short launch-style brag video for Archfleet — a local-first fleet manager for
computer-use agents. The film is built around one moment: the agent hits a login/2FA step,
the run pauses, the VM is held, and a human takes the keyboard on the same live desktop.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20.0 seconds (four scenes: 4.2 / 5.0 / 6.2 / 4.6)

## Source Material
- Project root: `/Users/kitts/conductor/workspaces/archfleet/hangzhou`
- Primary files read: `README.md`, `src/app/globals.css`, `src/app/layout.tsx`,
  `src/components/inbox/InboxPage.tsx`, `src/components/automations/workspace/GraphCanvas.tsx`,
  `src/components/fleet/ProfileSetupPanel.tsx`, `src/components/ui/Logo.tsx`, `src/lib/fleet/seed.ts`
- Product name: **Archfleet**
- Tagline / strongest claim: "Local-first fleet manager for computer-use agents." /
  "Nothing leaves your machine."
- Key UI to recreate:
  1. The **automation graph canvas** — node cards (icon + name + kind label) on `#1c1c1c`,
     connected by edges, statuses flipping green, one violet `Human Takeover` node.
  2. The Inbox **"Needs a human"** card — held desktop viewport with a live `desktop held`
     pill, row title, chip, and the paused/held/paged sub-row.
  3. The **Perceo mark + Archfleet wordmark** (asset already at `assets/img/perceo-logo.png`,
     6px radius, as `src/components/ui/Logo.tsx` renders it).
- Copy that must appear verbatim (all of it is real product/README copy):
  - "Computer-use agents fail in exactly one place."
  - `logins` · `MFA` · `captchas`
  - Node names/kinds: "Agent Planner", "Runner VM Step", "Browser Step", "Human Takeover",
    "Collect Artifact"
  - "Needs a human"
  - "Any desktop involved is held until you reply."
  - "Two-factor code required"
  - "desktop held"
  - "paused 12s ago · held 12s · operator paged 4s ago"
  - "Take over"
  - "You finish the step. On the same live desktop."
  - "Archfleet"
  - "Local-first fleet manager for computer-use agents."
  - "Nothing leaves your machine."

## Creative Direction
- Tone preset: **polished**
- Creative direction: a quiet control-room film for local-first infrastructure — restraint as
  the flex, no hype, no SaaS verbs
- Interpretation: four scenes, long holds, slow crossfades (0.5–0.6s), except one deliberate
  hard cut on the pause. Motion is precise and small: nodes settling, a status flipping, a
  cursor moving, characters typing. The only dramatic beat is the stop.
- Angle: every computer-use demo cuts away right before the part that breaks. Archfleet's
  thesis is that the failure is the feature — the run pauses, the VM is held, and you get
  paged to finish that one step on the same live desktop. Build the film around that pause.
- Hook: black frame, one settled line — "Computer-use agents fail in exactly one place." —
  then `logins` / `MFA` / `captchas` arriving one by one.
- Outro / punchline: mark + "Archfleet" + tagline, then "Nothing leaves your machine."
- Avoid:
  - Generic SaaS language ("streamline", "supercharge", "workflow automation")
  - Abstract filler visuals, particle fields, gradient washes
  - Unrelated visual redesign — the palette and 5px radii are the product's own
  - Any implication of cloud/SaaS; this product is local-first and that is the punchline

## Visual Identity
- Background: `#161616` (`--bg`); surfaces `#1c1c1c`, `#212121`, `#282828`
- Text: `#ffffff`; secondary `#a1a1aa`; tertiary `rgba(255,255,255,0.45)`; quaternary
  `rgba(255,255,255,0.32)`
- Accent: `#8b5cf6`, highlight `#c4b5fd`, low `#7848e6`, dim `rgba(139,92,246,0.2)`,
  line `rgba(139,92,246,0.3)`
- Status (fill /20, light-tint text, ring /30 — lifted from `status-colors.ts`):
  ok `#4ade80` → text `#8add84`; danger `#f87171` → `#fca5a5`; info `#60a5fa` → `#9ec5fb`;
  human/paused `#8b5cf6` → `#c4b5fd`
- Hairlines: `rgba(255,255,255,0.08)`, stronger `rgba(255,255,255,0.13)`
- Radii: 4 / **5** / 7 / 10px. The app rounds nearly everything to 5px — keep that.
- Display font: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Body font: same stack. Mono accents: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`
- Visual references from the project: graph node cards, status pills/chips, the desktop
  viewport thumbnail with a corner pill, the section header with a colored tone rule, the
  Perceo mark.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **The failure point** — 4.2s — the hook line, then `logins` / `MFA` / `captchas` one by one.
2. **The run, and the stop** — 5.0s — graph nodes completing in sequence beside a live desktop
   viewport, then a hard stop on the violet `Human Takeover` node.
3. **Needs a human** — 6.2s — the held takeover card holds still, then a cursor clicks
   "Take over", the viewport goes live, and a 2FA code types in character by character.
4. **Resume, then the claim** — 4.6s — node flips green, artifact lands, wordmark and
   "Nothing leaves your machine."

## Audio
- Audio role: sparse professional accents over a low, steady bed
- Audio arc: bed establishes → forward motion through three completed steps → total duck on the
  pause (the silence is the point) → physical click and keypresses when the human takes over →
  one bell on the artifact → fade under the wordmark
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: start 0, volume 0.30, ~0.6s fade-in; duck to ~0.20 from the pause (~8.9s)
  through the held beat; back to 0.30 on the "Take over" click; fade out 18.5s → 20.0s
- Music cue guidance: bundled preset copied to
  `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (109.96 BPM). Strong-cue locks: **8.74s** run stops on the takeover node, **13.11s** the
  "Take over" click / desktop goes live, **17.47s** wordmark lands. Beat-grid windows:
  failure chips 2.19 / 2.73 / 3.27; graph node completions 4.91 / 6.00 / 7.09 / 8.19
  (every other beat, so each node label stays readable).
- Audio-reactive treatment: **subtle** — use music RMS/bass so the violet takeover glow and the
  desktop viewport's presence breathe. No waveform, equalizer, particles, strobing, or
  text scaling.
- Audio-coupled moments:
  - Scene 1, failure chips — sequential reveal; accent softly, or only the last chip
  - Scene 2, node completions — one soft drop per completed node
  - Scene 2, the stop — one deep, short accent exactly on the hard cut
  - Scene 3, the held card — no SFX at all; the bed duck carries it
  - Scene 3, "Take over" — simulated cursor click (mouse click sound)
  - Scene 3, 2FA code — per-character typing, randomized keypress files
  - Scene 4, artifact lands — one restrained bell
  - Scene 4, wordmark — nothing; let the bell ring out under it
- SFX selection guidance: sound should match the visible gesture and stay quiet. Soft drops for
  element arrivals, a real click for the cursor, real keypresses for typed characters, one bell
  for the payoff. 4–6 cues total. SFX volume 0.55–0.70 (polished restraint). Never stack two
  cues within 0.25s.
- SFX analysis guidance:
  `/Users/kitts/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/sfx-analysis.md`
  (and `.json`). Prefer low high-frequency-risk files — this is a polished tone with repeated
  keypress sounds.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density and volume after the
  animation exists. SFX source library:
  `/Users/kitts/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/`
- Audio files: music and the Perceo mark are already copied into
  `brag-output/composition/assets/`. Copy any selected SFX into `assets/sfx/<family>/`.

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition
contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design
spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and
`hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the
`hyperframes` entry-point intent interview and do not route into its generic promo /
launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project (here: the graph
  canvas, the takeover card, and the Perceo mark — all three).
- Keep all text readable: short labels hold ~0.8s settled, sentences ~0.3s per word.
- Keep the video within 15–25 seconds (final: 20.0s).
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual
  animation exists.
- Treat cue metadata as optional timing hints; ignore cues that hurt readability or pacing.
  Use the three strong-cue locks above (±0.15s) and the beat-grid windows (±0.10s).
- Honor the music treatment: fade-in, the duck under the held pause, the return on the click,
  and the fade-out under the wordmark.
- Use the audio-reactive workflow for at least one element (the violet glow / viewport
  presence). If extraction is unavailable, document it and skip — do not block the render.
- Use local assets only; never absolute paths in the composition HTML.
- Run `npx hyperframes check` before render — it is brag's single gate.
