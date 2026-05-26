# A/B Test Planner

A practical A/B testing workspace for product owners and growth teams (including iGaming use cases).

It helps you plan tests, monitor test progress, manage rollout toggles, and share experiment context quickly.

## Live Demo

[https://ab-test-planner.vercel.app](https://ab-test-planner.vercel.app)

## What this app does

### Core planning

- Sample size per variant (two-sided z-test approximation for two proportions)
- Total sample size
- Estimated test duration (based on daily traffic + traffic split)
- Expected conversion rate for variant B

### Decision support

- Launch Readiness Score (with practical checks)
- Detectable Uplift by Deadline (reverse planning for fixed timeline)

### Execution support

- Live Experiment Progress Tracker
  - Enter users collected in A and B
  - See progress bars, remaining users, and estimated days left
- Feature Toggle Management
  - Add, remove, enable/disable toggles
  - Control rollout percentage

### Workflow support

- Share URL (all planner inputs in query params)
- Copy Experiment Brief (stakeholder-ready summary for docs/chat)
- Saved Scenarios (save/load/delete common assumption sets)
- Reset to Defaults
- Dark mode toggle (default is light mode)

## Persistence

The app stores key state in local storage so it survives reloads and tab reopen:

- Feature toggles
- Saved scenarios
- Theme preference (light/dark)

## Input validation

- Current conversion rate: `0 < value < 100`
- Expected improvement: `0 < value <= 500`
- Confidence strictness: `0 < value < 50`
- Chance to detect real lift: `50 < value < 99.9`
- Users per day: integer `>= 1`
- Traffic to version B: `0 < value < 100`
- Expected B conversion rate must stay below `100%`

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy for free on Vercel

### Option 1: Vercel Dashboard (recommended)

1. Push repository to GitHub.
2. Sign in to [Vercel](https://vercel.com/).
3. Click **Add New Project**.
4. Import the GitHub repository.
5. Keep default Next.js settings.
6. Click **Deploy**.

### Option 2: Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

## Tech stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- TypeScript

## Notes

This app is for planning and execution support, not a replacement for full statistical review in business-critical releases.

For high-stakes tests, also account for seasonality, acquisition mix, player quality, novelty effects, and operational guardrails.
