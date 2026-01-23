# Security Guide: Protecting API Keys

## The Problem

Vite bundles all environment variables prefixed with `VITE_` into the client-side JavaScript bundle. This means **anyone can view your API keys** by inspecting the browser's JavaScript files.

## Solutions

### ✅ Solution 1: Backend Proxy (Recommended)

**Best for**: Production deployments, protecting sensitive API keys

**How it works**: 
- API keys stay on the server (never sent to client)
- Client makes requests to your backend
- Backend proxies requests to Neynar with the API key

**Setup**:
1. The `server/` directory contains a simple Express proxy
2. Set `NEYNAR_API_KEY` in `server/.env` (server-side only)
3. Set `VITE_API_BASE_URL=http://localhost:3001` in root `.env`
4. Run both frontend and backend servers

**Pros**:
- ✅ API keys never exposed to client
- ✅ Can add rate limiting, caching, etc.
- ✅ Works in production

**Cons**:
- Requires running two servers
- Slightly more complex setup

### ⚠️ Solution 2: Environment Variables at Build Time

**Best for**: Development only

**How it works**:
- Use `.env.local` (already gitignored)
- Set variables in CI/CD for production builds
- Still exposed in bundle, but not in git

**Setup**:
1. Create `.env.local` (not committed to git)
2. Set `VITE_NEYNAR_API_KEY` there
3. Never commit this file

**Pros**:
- Simple setup
- Works for development

**Cons**:
- ❌ Still exposed in browser bundle
- ❌ Anyone can extract the key from your deployed app
- Not suitable for production

### 🔒 Solution 3: Public API Keys (If Available)

**Best for**: Services that support public/private key separation

**How it works**:
- Some APIs provide public keys for client-side use
- Public keys have limited permissions
- Check if Neynar supports this

**Setup**:
- Check Neynar documentation for public API keys
- Use public key in `VITE_NEYNAR_API_KEY`

**Pros**:
- Simple client-side setup
- No backend needed

**Cons**:
- May not be available for all APIs
- Limited functionality

## Current Implementation

The code now supports **both** approaches:

1. **If `VITE_API_BASE_URL` is set**: Uses secure backend proxy
2. **If `VITE_NEYNAR_API_KEY` is set**: Falls back to direct API (with warning)

This allows you to:
- Use the proxy in production
- Fall back to direct API for quick development (if you accept the risk)

## Best Practices

1. ✅ **Always use the backend proxy in production**
2. ✅ **Never commit `.env` files** (already in `.gitignore`)
3. ✅ **Use `.env.example`** to document required variables
4. ✅ **Rotate API keys** if they're ever exposed
5. ✅ **Use environment-specific keys** (dev vs prod)

## Deployment

For production deployments:

1. Set `VITE_API_BASE_URL` to your deployed backend URL
2. Deploy the backend server with `NEYNAR_API_KEY` as an environment variable
3. Never set `VITE_NEYNAR_API_KEY` in production

Example:
```bash
# Production .env
VITE_API_BASE_URL=https://api.yourdomain.com
# No VITE_NEYNAR_API_KEY here!
```

