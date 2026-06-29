# 🎯 Guess It!

A tiny two-player **pass-and-play** guessing game for your phone (or any
browser). One player secretly picks an answer — a **number/age**, an
**animal**, a **word/person/place**, or anything **custom** — then hands the
device over. The other player asks questions out loud, the setter taps the
answers, and you try to guess the secret in as few questions as possible.

Built by Menso & partner from a game they actually play. No accounts, no
server, works offline, installable to your home screen.

## How to play

1. **Home screen** — enter both player names and pick who hides the secret first.
2. **Setter** — choose a category and type the secret answer.
   - *Number / Age*: also set a min–max range (e.g. 0–100).
   - *Animal* / *Word·Person·Place*: tap a preset idea or type your own.
   - *Custom*: name your own category (Movie, Food, Country…) and the answer.
   - Tap **Hide & pass** and hand the device to the other player.
3. **Guesser** — ask questions out loud. The setter taps **Yes / No / Sort of /
   Pass** to build the on-screen answer log. Tap **+ I asked a question** or use
   the answer buttons to count questions. Stuck? Tap **💡 Give a hint**
   (higher/lower for numbers, reveal-a-letter for words).
4. **Guess!** — type your guess. Right → 🎉 and a point; wrong → keep playing or
   give up to reveal the answer.
5. **Swap roles & play again** — scores are saved on the device.

## Features

- Four categories: Number/Age, Animal, Word/Person/Place, and Custom.
- Question counter, round timer, and a live answer log.
- Basic hints per category (higher/lower; reveal-a-letter).
- Persistent two-player scoreboard (saved in `localStorage`).
- **Installable PWA** — works offline, add to your home screen.

## Run it locally

It's plain HTML/CSS/JS — no build step. Either:

```bash
# open directly
open index.html          # macOS  (or just double-click the file)

# …or serve it (recommended, needed for the service worker / PWA)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy (GitHub Pages)

The whole app is static files at the repo root, so GitHub Pages can serve them
directly — no build step, no workflow. One-time setup:

1. Make the repo **public** (free Pages), or use a paid plan to keep it private.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick the branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
4. Wait ~1–3 min for the first build, then open the URL shown in the green
   "Your site is live at…" banner (e.g. `https://<user>.github.io/<repo>/`).
   On your phone, tap **Share → Add to Home Screen**.

(The empty `.nojekyll` file tells Pages to serve the files as-is.)

## Project layout

```
index.html                  app shell + all screens
styles.css                  mobile-first theme
js/categories.js            category definitions + preset ideas
js/storage.js               localStorage (names + scores)
js/game.js                  round state machine, hints, judging
js/ui.js                    DOM rendering + screen switching
js/main.js                  event wiring / controller
manifest.webmanifest, sw.js PWA install + offline cache
assets/                     app icons
```

## Ideas for later

Win streaks & a fewer-questions points formula, a "20 questions" limit mode,
hot-or-cold meter for numbers, confetti + sound effects, difficulty levels, and
shareable category packs.
