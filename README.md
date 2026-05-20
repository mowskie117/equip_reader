# EQUIP Reader

A web-based analyzer for QuarkNet CRMD EQUIP `.txt` data files. Built for the Mounds View High School Fermilab QuarkNet muon absorption experiment.

## What it does

- Parses raw EQUIP `.txt` files (hexadecimal DAQ output)
- Extracts per-channel muon counts from ST/DS bin pairs (5-min intervals)
- Lets you assign channels to "above lead" or "below lead" detector groups
- Runs a 1-sample t-test on mean difference scores (α = 0.05)
- Displays count rate chart and full bin data table

## Setup

### Local development

```bash
npm install
npm run dev
```

### Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages → Source** and set to **GitHub Actions**
3. Push to `main` — the workflow auto-builds and deploys

Live at: `https://<your-username>.github.io/equip_reader/`

## Usage

1. Open the page
2. Drop an EQUIP `.txt` file onto the upload zone
3. Assign each channel (S0–S3) to above/below lead using the channel config panel
4. Read the t-test result and chart

## Channel mapping

Channels in EQUIP are 0-indexed:
- CH1 in EQUIP UI = S0
- CH2 in EQUIP UI = S1  
- CH3 in EQUIP UI = S2
- CH4 in EQUIP UI = S3

Check your physical cable connections to determine which channels are above/below the lead absorber.

## Tech stack

- React + Vite
- Recharts for visualization
- Pure JS t-test implementation (no external stats library needed)
- GitHub Actions + GitHub Pages for deployment
