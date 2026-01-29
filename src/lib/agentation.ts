const AGENTATION_API = "https://agentation.repo.box";
const STORAGE_KEY = "agentation_edit_token";

// Check URL for edit token and save to localStorage
export function checkAndSaveEditToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("edit");
  
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
    // Clean URL
    params.delete("edit");
    const newUrl = params.toString() 
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
    return token;
  }
  
  return localStorage.getItem(STORAGE_KEY);
}

// Validate token with backend
export async function validateToken(token: string): Promise<{ valid: boolean; project?: string }> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/validate-token?token=${encodeURIComponent(token)}`);
    return await res.json();
  } catch {
    return { valid: false };
  }
}

// Submit annotation to backend
export async function submitAnnotation(token: string, annotation: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editToken: token,
        annotation: {
          ...annotation,
          pageUrl: window.location.href,
        },
      }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Clear stored token
export function clearEditToken() {
  localStorage.removeItem(STORAGE_KEY);
}

// Get stored token
export function getEditToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
