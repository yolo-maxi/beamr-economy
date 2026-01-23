# BeamrViz

React Flow visualization for BEAMR distribution pools and streams from the Superfluid subgraph.

## Setup

### Option 1: Secure Backend Proxy (Recommended)

This keeps your Neynar API key secure on the server-side.

1. Install frontend dependencies:
   ```bash
   pnpm install
   ```

2. Install server dependencies:
   ```bash
   cd server
   pnpm install
   ```

3. Create `server/.env` from `server/.env.example`:
   ```bash
   cp server/.env.example server/.env
   # Edit server/.env and add your NEYNAR_API_KEY
   ```

4. Create a `.env` file in the root with:
   - `VITE_SUPERFLUID_SUBGRAPH_URL` (required)
   - `VITE_BEAMR_TOKEN_ADDRESS` (optional, defaults to BEAMR)
   - `VITE_BEAMR_DECIMALS` (optional, defaults to 18)
   - `VITE_API_BASE_URL=http://localhost:3001` (points to backend proxy)
   - `VITE_NEYNAR_BATCH_SIZE` (optional, defaults to 100)

5. Run both servers:
   ```bash
   # Terminal 1: Start backend proxy
   cd server
   pnpm dev

   # Terminal 2: Start frontend
   cd ..
   pnpm dev
   ```

### Option 2: Direct API (Not Recommended - Exposes API Key)

⚠️ **Warning**: This exposes your API key in the client bundle. Only use for development.

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create a `.env` file with:
   - `VITE_SUPERFLUID_SUBGRAPH_URL` (required)
   - `VITE_BEAMR_TOKEN_ADDRESS` (optional, defaults to BEAMR)
   - `VITE_BEAMR_DECIMALS` (optional, defaults to 18)
   - `VITE_NEYNAR_API_KEY` (required for Farcaster usernames)
   - `VITE_NEYNAR_API_BASE` (optional, defaults to Neynar API)
   - `VITE_NEYNAR_BATCH_SIZE` (optional, defaults to 100)

3. Run the app:
   ```bash
   pnpm dev
   ```

## Deployment to Vercel

This project is configured for Vercel deployment with serverless API routes.

**Quick Deploy**:
1. Push to GitHub
2. Import project in Vercel
3. Set environment variables in Vercel Dashboard:
   - `NEYNAR_API_KEY` (server-side, secret)
   - `NEYNAR_API_BASE` (optional, defaults to https://api.neynar.com)
   - `VITE_SUPERFLUID_SUBGRAPH_URL` (client-side)
   - `VITE_BEAMR_TOKEN_ADDRESS` (client-side, optional)
   - `VITE_BEAMR_DECIMALS` (client-side, optional)

See [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) for detailed instructions.

## Security Notes

- **Never commit `.env` files** - they're already in `.gitignore`
- **Use the backend proxy** for production to keep API keys secure
- `VITE_` prefixed variables are bundled into the client code and visible in the browser
- Server-side environment variables (in `server/.env` or Vercel) are never exposed to the client
- On Vercel, API routes automatically use server-side environment variables

