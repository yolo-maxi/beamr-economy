// Vercel Serverless Function: Avatar proxy with edge caching
// GET /api/avatar?url=<encoded-avatar-url>

module.exports = async function handler(req, res) {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const decoded = decodeURIComponent(url);
    
    // Only allow image URLs from known sources
    const allowed = ['imagedelivery.net', 'i.imgur.com', 'imgur.com', 'res.cloudinary.com', 
                     'imagekit.io', 'warpcast.com', 'farcaster.xyz', 'supercast.xyz',
                     'openseauserdata.com', 'lh3.googleusercontent.com', 'pbs.twimg.com',
                     'cdn.stamp.fyi', 'euc.li', 'wrpcd.net'];
    
    const urlObj = new URL(decoded);
    if (!allowed.some(h => urlObj.hostname.endsWith(h))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const response = await fetch(decoded, {
      headers: { 'User-Agent': 'BeamrEconomy/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Upstream failed' });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());

    // Cache for 7 days on CDN, 1 day in browser
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error' });
  }
};
