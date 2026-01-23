const preloadPromises = new Map<string, Promise<void>>();

export function preloadImage(url?: string | null) {
  if (!url) return Promise.resolve();
  const trimmed = url.trim();
  if (!trimmed) return Promise.resolve();
  const existing = preloadPromises.get(trimmed);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.loading = "lazy";
    img.decoding = "async";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = trimmed;
  });

  preloadPromises.set(trimmed, promise);
  return promise;
}


