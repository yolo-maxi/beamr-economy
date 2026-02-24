import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import http from 'http';

const ALLOWED = ['imagedelivery.net', 'i.imgur.com', 'imgur.com', 'res.cloudinary.com', 
                 'imagekit.io', 'warpcast.com', 'farcaster.xyz', 'supercast.xyz',
                 'openseauserdata.com', 'lh3.googleusercontent.com', 'pbs.twimg.com',
                 'cdn.stamp.fyi', 'euc.li', 'wrpcd.net'];

function fetchImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'BeamrEconomy/1.0' }, timeout: 5000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/png' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const decoded = decodeURIComponent(url);
    const urlObj = new URL(decoded);
    if (!ALLOWED.some(h => urlObj.hostname.endsWith(h))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const { buffer, contentType } = await fetchImage(decoded);
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({ error: 'Proxy error', detail: err.message });
  }
}
