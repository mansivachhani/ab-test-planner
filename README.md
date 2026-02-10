# A/B Test Planner

A micro project for product owners and growth teams to estimate:

- Sample size required per variant
- Total users needed for the experiment
- Estimated test duration in days based on traffic split and daily users

Built with Next.js (App Router) + Tailwind CSS and ready for free Vercel deployment.

## Features

- Two-proportion sample size calculator (two-sided z-test approximation)
- Duration estimator using traffic allocation and daily eligible users
- Input validation with clear inline error messages
- Responsive UI for desktop and mobile

## Inputs

- Baseline conversion rate (%)
- Minimum detectable uplift (%)
- Significance level / alpha (%)
- Statistical power (%)
- Daily eligible users
- Traffic allocated to variant B (%)

## Validation Rules

- Baseline conversion rate: `0 < value < 100`
- Minimum detectable uplift: `0 < value <= 500`
- Significance: `0 < value < 50`
- Power: `50 < value < 99.9`
- Daily eligible users: integer `>= 1`
- Variant B traffic: `0 < value < 100`
- Calculated variant conversion rate must stay below `100%`

## How to use

1. Fill in your experiment assumptions.
2. Click **Calculate Sample Size & Duration**.
3. Review:
   - required sample size per variant
   - total sample size
   - estimated duration
   - expected variant conversion rate

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy for free on Vercel

### Option 1: Vercel dashboard (recommended)

1. Push this project to GitHub.
2. Go to [Vercel](https://vercel.com/) and sign in.
3. Click **Add New Project**.
4. Import your GitHub repository.
5. Keep default settings for Next.js.
6. Click **Deploy**.

### Option 2: Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts, then deploy production:

```bash
vercel --prod
```

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- TypeScript

## Notes

This calculator gives planning estimates. For business-critical tests, always pair results with domain-specific constraints (seasonality, user quality, risk tolerance, and experiment guardrails).
