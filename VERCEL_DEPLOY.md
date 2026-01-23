# Deploying to Vercel

## Quick Setup

1. **Push your code to GitHub** (already done ✅)

2. **Import project in Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your `beamr-economy` repository

3. **Set Environment Variables in Vercel Dashboard**:
   
   Go to Project Settings → Environment Variables and add:

   ### Server-side (API Routes) - Keep these SECRET:
   ```
   NEYNAR_API_KEY=your_neynar_api_key_here
   NEYNAR_API_BASE=https://api.neynar.com
   ```
   
   ### Client-side (Public - visible in bundle):
   ```
   VITE_SUPERFLUID_SUBGRAPH_URL=your_subgraph_url
   VITE_BEAMR_TOKEN_ADDRESS=0x...
   VITE_BEAMR_DECIMALS=18
   VITE_FARCASTER_TIMEOUT_MS=5000
   VITE_NEYNAR_BATCH_SIZE=100
   ```
   
   **Important**: Do NOT set `VITE_NEYNAR_API_KEY` or `VITE_API_BASE_URL` in Vercel. The API routes will automatically use the server-side `NEYNAR_API_KEY`.

4. **Deploy**: Vercel will automatically detect Vite and deploy!

## How It Works

- **Frontend**: Built with Vite and deployed to Vercel's CDN
- **API Routes**: The `/api/farcaster/*` routes are deployed as serverless functions
- **Security**: `NEYNAR_API_KEY` stays server-side and is never exposed to the client

## Local Development

For local development, you can either:

### Option A: Use Vercel CLI (Recommended)
```bash
pnpm add -D vercel
pnpm vercel dev
```
This will run both frontend and API routes locally.

### Option B: Use Express Server
```bash
# Terminal 1: Express server
cd server
pnpm install
pnpm dev

# Terminal 2: Frontend
cd ..
# Set VITE_API_BASE_URL=http://localhost:3001 in .env
pnpm dev
```

## Environment Variables Summary

| Variable | Where | Purpose | Secret? |
|----------|-------|---------|---------|
| `NEYNAR_API_KEY` | Vercel Dashboard | Server-side API key | ✅ Yes |
| `NEYNAR_API_BASE` | Vercel Dashboard | Neynar API base URL | ✅ Yes |
| `VITE_SUPERFLUID_SUBGRAPH_URL` | Vercel Dashboard | Subgraph endpoint | ❌ No |
| `VITE_BEAMR_TOKEN_ADDRESS` | Vercel Dashboard | Token address | ❌ No |
| `VITE_BEAMR_DECIMALS` | Vercel Dashboard | Token decimals | ❌ No |

## Troubleshooting

- **API routes return 500**: Make sure `NEYNAR_API_KEY` is set in Vercel environment variables
- **CORS errors**: Vercel API routes handle CORS automatically
- **Build fails**: Check that all dependencies are in `package.json`

