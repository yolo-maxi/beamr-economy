# BeamrViz

React Flow visualization for BEAMR distribution pools and streams from the Superfluid subgraph.

## Setup

1. Install dependencies:
   - `pnpm install`
2. Create a `.env` file with:
   - `VITE_SUPERFLUID_SUBGRAPH_URL` (required)
   - `VITE_BEAMR_TOKEN_ADDRESS` (optional, defaults to BEAMR)
   - `VITE_BEAMR_DECIMALS` (optional, defaults to 18)
   - `VITE_NEYNAR_API_KEY` (required for Farcaster usernames)
   - `VITE_NEYNAR_API_BASE` (optional, defaults to Neynar API)
   - `VITE_NEYNAR_BATCH_SIZE` (optional, defaults to 100)
3. Run the app:
   - `pnpm dev`

