#!/bin/bash
cd /home/xiko/beamr-economy/server
export NEYNAR_API_KEY="6D4F8EB5-790E-4594-85CD-638DDC964B4D"
export PORT=3003
exec npx tsx index.ts
