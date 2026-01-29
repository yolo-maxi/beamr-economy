module.exports = {
  apps: [{
    name: 'beamr-api',
    script: 'npx',
    args: 'tsx index.ts',
    cwd: '/home/xiko/beamr-economy/server',
    env: {
      NEYNAR_API_KEY: '6D4F8EB5-790E-4594-85CD-638DDC964B4D',
      PORT: 3002
    }
  }]
};
