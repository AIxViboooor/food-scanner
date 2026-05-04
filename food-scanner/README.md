# Food scanner

Personal supermarket-shelf scanner. Snap a label, get a verdict tuned to your
actual health profile (uric acid, BP, glucose, LDL, allergies, MTHFR, the
"bad chemicals" list). Hosted privately on Vercel.

## Privacy model

Three layers:

1. **HTTP Basic Auth at the edge.** `middleware.js` runs before any HTML or
   API response is served. Wrong credentials = 401, no content sent. Browser
   shows a native login dialog.
2. **API key never touches the browser.** Anthropic key lives in Vercel env
   vars. The browser POSTs photos to `/api/scan` which calls Claude
   server-side.
3. **No indexing.** `vercel.json` adds `X-Robots-Tag: noindex` so the URL
   won't appear in search engines even if leaked.

## Files

```
food-scanner/
├── index.html          PWA UI (single file, embedded CSS + JS)
├── manifest.json       PWA manifest (lets you add to home screen)
├── middleware.js       Edge middleware — Basic Auth gate
├── api/
│   └── scan.js         Edge function — Claude API call with health profile
├── vercel.json         Headers + clean URLs config
├── package.json        Just the metadata
├── .gitignore
└── README.md           This file
```

## Setup (one-time, ~5 minutes)

### 1. Get your Anthropic API key

Go to <https://console.anthropic.com>, create an API key. Top up $5-10 in
credits. At ~$0.01-0.02 per scan, that's 250-500 scans.

### 2. Push to a private GitHub repo

From this folder:

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create food-scanner --private --source=. --push
```

(Or create the repo manually on github.com and push.)

### 3. Deploy to Vercel

- Go to <https://vercel.com/new>
- Import the GitHub repo
- Framework preset: **Other** (no framework)
- Click Deploy
- Wait ~30 seconds

You'll get a URL like `food-scanner-xxxxx.vercel.app`. Don't open it yet —
the auth isn't configured.

### 4. Set environment variables

In the Vercel dashboard, go to your project → Settings → Environment
Variables. Add three:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (your key) |
| `BASIC_AUTH_USER` | pick a username, e.g. `ignas` |
| `BASIC_AUTH_PASS` | a strong password (you'll only type it once per device) |

Apply to **Production**, **Preview**, and **Development**.

### 5. Redeploy

After setting env vars, trigger a redeploy:

- Vercel dashboard → Deployments → click the latest → Redeploy
- Or push any change to GitHub and it auto-redeploys

### 6. Open on your phone

- Visit the Vercel URL on your iPhone or Android
- Browser asks for username + password — enter what you set
- Page loads
- iPhone: Share button → **Add to Home Screen**. The app gets its own icon
  and runs full-screen like a native app
- Android: Browser menu → **Install app**

The Basic Auth credentials are remembered by the browser, so you only enter
them once per device.

## Usage

- Tap **Scan label** → camera opens
- Snap the ingredient list (close-up, even lighting)
- ~3-5 seconds later you get the verdict:
  - 🟢 **Good** = eat freely
  - 🟡 **Sometimes** = okay occasionally, watch the flagged items
  - 🔴 **Avoid** = hard block — has something on your red list
- Each scan logs locally to your phone (history at the bottom)

## Tuning the verdict

The brain of the app is the `HEALTH_PROFILE` constant at the top of
`api/scan.js`. Edit that file when:

- Lab results change (e.g. uric acid drops below 6, you can soften the
  hyperuricemia rules)
- Conditions resolve or change priority
- You want to add or remove items from your "bad chemicals" list
- You want different verdict thresholds (e.g. allow products with
  300-500mg sodium as Good, not Sometimes)

After editing, push to GitHub. Vercel auto-redeploys.

## Cost

Roughly per scan, with `claude-sonnet-4-6`:

- Input: ~1500 tokens (system prompt) + image (~1500 tokens compressed) = ~3000 tokens × $3/M = $0.009
- Output: ~300 tokens × $15/M = $0.0045
- **Total: ~$0.013 per scan**

5 scans/day = ~$2/month. Easy to keep an eye on at console.anthropic.com.

## Future tweaks (when you want them)

- Barcode scanning + Open Food Facts lookup before sending to Claude.
  Cheaper for branded products with known ingredients (no image roundtrip).
- Lingo CSV ingestion to feed CGM data into the verdict ("you spiked on
  this brand last time").
- Save flagged ingredients to a personal "avoid" list that persists.
- Multi-language label support (Korean labels at HMart, Lithuanian labels
  when you visit home).

## Local development

```bash
npm i -g vercel
vercel dev
```

Opens `http://localhost:3000`. You'll need `.env.local` with the same env
vars as production.
