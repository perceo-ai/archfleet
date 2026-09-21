# Brag Plan: Archfleet

## What is this app?
Archfleet is a local-first fleet manager for computer-use agents: describe a task in plain
language, it runs on a real isolated desktop VM, you watch every step, and you take the
keyboard yourself over XRDP the moment it gets stuck.

## The angle
Every computer-use agent demo cuts away right before the part that actually breaks: the login,
the 2FA prompt, the captcha, the "does this look right?" moment. Archfleet's whole thesis is
that *the failure is the feature* — the run pauses, the VM is **held**, and you get paged to
finish that one step on the same live desktop. The video is built around that pause. It is a
control-room film, not a hype reel: dark #161616, violet #8b5cf6, real UI, real copy, and one
moment of total stillness where the agent stops and asks for a human.

## Hook (first 2-3 seconds)
Black frame. One line settles in, mixed case, generous tracking:
**"Computer-use agents fail in exactly one place."**
Then the three failure points arrive underneath, monospace, one by one:
`logins · MFA · captchas`. No product yet. Just the problem, stated flatly.

## Key moments (the middle)
- The automation graph running for real: `Agent Planner → Runner VM Step → Browser Step →
  Human Takeover → Collect Artifact`, nodes flipping to green in sequence, a live desktop
  viewport beside it — then everything stops on the violet node.
- The Inbox "Needs a human" card, verbatim product copy: **"Any desktop involved is held until
  you reply."** With the live `desktop held` pill and the `paused 12s ago · held 12s ·
  operator paged 4s ago` row.
- The takeover itself: a cursor clicks **Take over**, the held viewport goes live, a 2FA code
  gets typed into the real desktop. This is the shot the product exists for.
- The resume: the run continues from the same step, `Collect Artifact` lands green.

## Outro / punchline
The run finishes. Then the mark, the wordmark, and the one claim that separates it from
everything else in the category: **"Nothing leaves your machine."**

## User flow worth showing
1. **Entry** — the Inbox: five live stats, one of them "Waiting on you".
2. **Key action** — a run hits a `human_takeover` node, pauses, holds its VM, and pages you.
   You click "Take over" and finish the 2FA step yourself on the same live desktop.
3. **Result** — the run resumes from that step and files its artifact; the desktop is released.

## Tone
- Preset: polished
- Creative direction: a quiet control-room film for local-first infrastructure — restraint as
  the flex, no hype, no SaaS verbs
- Interpretation: four scenes, long holds, slow crossfades. Motion is precise and small
  (nodes settling, a status flipping, a cursor moving). The one permitted dramatic beat is the
  pause — everything stops, and only the violet takeover node keeps breathing.

## Format: landscape — 1920x1080
## Duration: 20.0s (four scenes: 4.2 / 5.0 / 6.2 / 4.6)

## Visual identity (from the project)
- Background: `#161616` (`--bg`); surfaces `#1c1c1c` / `#212121` / `#282828`
- Accent: `#8b5cf6` (`--accent`), highlight `#c4b5fd`, gradient low `#7848e6`
- Text: `#ffffff` (`--text`), secondary `#a1a1aa`, tertiary `rgba(255,255,255,0.45)`
- Status: ok `#4ade80`, danger `#f87171`, info `#60a5fa`, human/paused `#8b5cf6` — all rendered
  as fill at 20% + light-tint text + ring at 30%, exactly as `status-colors.ts` does
- Hairlines: `rgba(255,255,255,0.08)`; every corner radius is 5px (`--radius`)
- Display font: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"`
- Body font: same stack; monospace accents in `"SFMono-Regular", Consolas, monospace`
- Strongest visual element: the automation graph canvas with a violet `Human Takeover` node,
  and the Inbox "Needs a human" card with its live `desktop held` pill
- Logo asset: `public/perceo-logo.png` (the Perceo mark, 6px radius, used in the rail and login)

## Share copy (draft)
Computer-use agents break at logins, MFA and captchas. Archfleet pauses the run, holds the VM,
and hands you the keyboard on the same live desktop. Local-first, all of it.

## Audio direction
- Role: sparse professional accents over a low, steady bed
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` — steady and clean, the
  polished/cinematic pick
- Music treatment: start at 0, volume 0.30, fade in over ~0.7s, duck to 0.13 from the stop at
  8.95s through the held beat so the stillness reads, back to 0.30 on the click at 13.35s, and
  a fade out from 18.5s to silence at 20.0s
- Music cue guidance: bundled preset read (`cues/happy-beats-business-moves-vol-12…`), 109.96 BPM.
  Strong cues to target: **8.74s** (the run stops on the takeover node), **13.11s** (the "Take
  over" click / desktop goes live), **17.47s** (wordmark lands). Beat-grid windows for
  sequential reveals: graph nodes from ~4.91s using every other beat (4.91 / 6.00 / 7.09 /
  8.19); stat cards in Scene 2 on 5.34 / 6.56 / 7.64 if used.
- Audio-reactive treatment: subtle; use music RMS/bass to let the violet takeover glow and the
  desktop viewport's presence breathe. No waveform, equalizer, or particle visuals.
- SFX posture: sparse — 4 to 6 cues total, motion-matched, nothing aggressive. Soft drops for
  node arrivals, one deep accent when the run pauses, real click + keypress sounds for the
  takeover, one restrained bell for the artifact/outro.
- Audio-coupled moments: graph nodes completing one by one; the hard stop on the takeover node;
  the cursor click on "Take over"; the 2FA code typed character by character; the final
  wordmark.
- Restraint rule: no stingers on text, no sound during the held/paused beat except the bed
  ducking — the silence is the point. Never stack two cues inside 0.25s.

## Storyboard

### Scene 1 — The failure point — 4.2s
Full-bleed `#161616`. A single line settles in at 0.5s, 64px, weight 300, +0.5px tracking,
white: **"Computer-use agents fail in exactly one place."** It holds fully settled from ~1.1s.
At 2.4s, three monospace chips arrive under it in sequence — `logins`, `MFA`, `captchas` —
each `#a1a1aa` on `#1c1c1c` with a hairline border, 5px radius. All three hold together to 4.2s.
No logo, no product, no color except the text.
Sequential/interaction: yes — the three failure chips arrive one by one, ~0.55s apart
(beat grid 2.19 / 2.73 / 3.27), then the full set holds ~0.9s.
Audio intent: the bed establishes quietly; the chips are the only movement.
Audio-coupled idea: one very soft drop per chip, or accent only the last one.
Music: steady low bed, faded in.
Transition mood: soft crossfade (0.6s) → Scene 2

### Scene 2 — The run, and the stop — 5.0s
The Archfleet workspace. Left two-thirds: the graph canvas on `#1c1c1c`, hairline grid,
five node cards connected by edges, each with an icon, a name and a kind label:
`Agent Planner` · `Runner VM Step` · `Browser Step` · `Human Takeover` · `Collect Artifact`.
Right third: a desktop viewport thumbnail (a dim Ubuntu/XFCE desktop with a browser and a
login form) with a small live status pill. Nodes flip to the green ok state one by one as the
run advances. At ~4.5s the run reaches the violet `Human Takeover` node: every animation stops,
the node fills violet at 20% with a `#c4b5fd` ring, and a small pill reads `paused`.
Sequential/interaction: yes — three nodes complete in sequence on every other beat
(4.91 / 6.00 / 7.09 / 8.19), then a hard stop on the fourth.
Audio intent: forward motion, then a floor drop — the bed ducks and the room goes quiet.
Audio-coupled idea: a soft drop per completed node; one deep, short accent exactly on the stop.
Music: bed continues, ducks to ~0.20 on the stop. **Beat-lock the stop to 8.74s.**
Transition mood: clean cut (no crossfade — the stop should feel abrupt) → Scene 3

### Scene 3 — Needs a human — 6.2s
The Inbox "Needs a human" section, violet-toned header rule. One card, verbatim product copy:
section note **"Any desktop involved is held until you reply."**; the row title
**"Two-factor code required"**; a `cuf-golden-02` chip; the held desktop viewport on the left
with a live violet `desktop held` pill; and the sub-row
`paused 12s ago · held 12s · operator paged 4s ago`. It holds, still, for ~2.3s — the only
motion is the live pill breathing with the bed, under the line **"The run stops. The desktop is
held."** Then a cursor moves in and clicks **Take over**. The card frame dissolves, the held
viewport becomes the subject (brighter, centred, `live`), and a 6-digit 2FA code types into the
field character by character under the line **"You take the keyboard."**
Sequential/interaction: yes — simulated cursor click on "Take over", then per-character typing
of the 2FA code into the live desktop.
Audio intent: held silence under the paused card, then a real, physical click, then keypresses.
Audio-coupled idea: one mouse click on the button; randomized keypress sounds per typed digit.
Music: ducked at the start, returns to 0.30 on the click. **Beat-lock the click to 13.11s.**
Transition mood: soft crossfade (0.5s) → Scene 4

### Scene 4 — Resume, then the claim — 4.6s
Back to the graph. The violet node flips to green and the run continues from that exact step;
`Collect Artifact` lands green with a small artifact thumbnail. The five steps read as a compact horizontal strip so the
resume lands fast. One line, mono, `#a1a1aa`: `run resumed from step 4 · desktop released`.
At ~17.1s the strip recedes, the Perceo mark scales in with the wordmark **Archfleet**, and the
tagline settles beneath: "Local-first fleet manager for computer-use agents." Final line,
white, holding to the end: **"Nothing leaves your machine."**
Sequential/interaction: yes — node flips green, then the artifact card arrives, then the
wordmark lands.
Audio intent: quiet resolution, one clean bell on the artifact, then space for the wordmark.
Audio-coupled idea: a restrained bell when the artifact lands; nothing under the tagline.
Music: back to 0.30, fading out from ~18.5s to silence at 20.0s.
**Beat-lock the wordmark landing to 17.47s.**
Transition mood: hold to black.

**Music mood for this video:** cinematic-restrained (steady, clean, low)
**Audio summary:** A low steady bed carries three completed steps, drops out entirely for the
held pause, returns on the physical click of a human taking the keyboard, and fades under one
bell and the wordmark.
