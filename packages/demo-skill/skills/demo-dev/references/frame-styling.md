# Frame styling — getting Screen Studio quality

The browser frame is rendered as a CSS template (in headless Chromium) then composited over the recording with FFmpeg. Every visual knob is exposed as a CLI flag.

## Anatomy

```
┌──────────────────────────── canvas ─────────────────────────────┐
│                                                                 │
│   padding                                                       │
│         ┌──────────────── window ─────────────┐                 │
│   pad   │  ◉ ◉ ◉    [ url-bar          ]  ··· │  pad            │
│         │ ───────────────────────────────── chrome              │
│         │                                                       │
│         │             your screen recording                     │
│         │             (contentWidth × contentHeight)            │
│         │                                                       │
│         └───────────────────────────────────┘                   │
│                       shadow                                    │
│   padding                                                       │
│                                                                 │
└─────────────────── background (preset / image / color) ─────────┘
```

## Knobs

### `--background-preset` (built-in mesh gradients)

| Name | Vibe |
|---|---|
| `sunset` | warm orange→pink→peach, marketing-friendly |
| `ocean` | navy→blue, calm B2B feel |
| `forest` | teal→green, natural |
| `mesh-purple` | layered purple+pink mesh — default for `demo` |
| `mesh-pink` | layered pink+coral mesh, playful |
| `midnight` | deep purple→black, premium / late-night |
| `paper` | light gray, lets dark UI screenshots pop |

### `--background-image <path>`
Any local image. Inlined as a data URI so chromium does not have to fetch it. `cover`-sized over the canvas. Takes precedence over preset / color.

### `--background-color #hex`
Solid color. Use when you want neutral.

### `--frame-chrome`
| Mode | Looks like |
|---|---|
| `macos` | full traffic lights + URL bar (default) |
| `minimal` | just traffic lights, no URL bar — sleek |
| `none` | no chrome at all, just a rounded window — best when the screen content already has its own UI |

### `--frame-shadow`
| Level | Style |
|---|---|
| `none` | flat |
| `soft` | subtle, single shadow |
| `medium` | multi-layer (default) |
| `strong` | dramatic, depth-y |

### `--frame-radius PX`
Corner radius. `14` is the default. Try `0` for a hard window, `24+` for a softer look.

### `--frame-padding PX`
Space between the window and the canvas edge. `64` default. Bigger padding = more breathing room.

### `--display-url`
Only used when `--frame-chrome macos`. Sets the URL label in the address bar.

## Recipes

### "Clean SaaS demo" (default safe choice)
```bash
demo-dev demo ... \
  --frame \
  --background-preset mesh-purple \
  --frame-chrome macos \
  --frame-shadow medium \
  --frame-radius 14 \
  --display-url app.example.com
```

### "Launch trailer" (high drama)
```bash
demo-dev demo ... \
  --frame \
  --background-preset midnight \
  --frame-chrome minimal \
  --frame-shadow strong \
  --frame-radius 22 \
  --frame-padding 96
```

### "Hero on your brand background"
```bash
demo-dev demo ... \
  --frame \
  --background-image ./brand-hero.jpg \
  --frame-chrome none \
  --frame-shadow strong \
  --frame-radius 24 \
  --frame-padding 120
```

### "Twitter / X-friendly vertical"
```bash
demo-dev demo ... \
  --aspect-ratio 9:16 \
  --frame \
  --background-preset sunset \
  --frame-chrome minimal \
  --frame-padding 48
```

### "Bare recording" (no frame, for reuse in your own editor)
Just omit `--frame` and any frame-* / background-* flags.

## Tips

- **Frame compositing time scales with quality + resolution.** `--quality high` (2560×1440) with `--frame-shadow strong` and a `--background-image` can push the frame-overlay step past 4 minutes. Use `--quality standard` if you don't need 1440p.
- **For a non-mac feel, set `--frame-chrome none`** and provide your own brand-feel background.
- **Backgrounds bigger than ~2560×1440** are wasted; the image is rasterized to canvas size.
- **Solid backgrounds are fastest** — `--background-color #0a0a0a` skips the chromium gradient render.

## Programmatic listing

```bash
demo-dev styles            # named style presets (separate from frame background)
demo-dev exports           # aspect ratios + quality presets
```
