#!/bin/bash
# Watch for changes and auto-deploy
cd /home/xiko/beamr-economy
pnpm build && cp -r dist/* /var/www/repo.box/subdomains/beamr-dev/
echo "[$(date)] Deployed!"
