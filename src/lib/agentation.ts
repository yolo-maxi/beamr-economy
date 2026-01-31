export const AGENTATION_API = "https://agentation.repo.box";
const STORAGE_KEY = "agentation_edit_token";

// =============================================================================
// Types
// =============================================================================

export type AnnotationStatus = 
  | "pending" 
  | "processing" 
  | "implemented" 
  | "approved" 
  | "rejected" 
  | "revision_requested" 
  | "failed" 
  | "interrupted";

export interface AnnotationSummary {
  id: string;
  status: AnnotationStatus;
  timestamp: number;
  processingStartedAt?: number;
  completedAt?: number;
  element: string;
  comment: string;
  x: number;
  y: number;
  pageUrl?: string;
  imageUrl?: string;
  commitSha?: string;
  tokenOwner: string;
  isOwn: boolean;
  revisionCount: number;
}

export interface TokenValidation {
  valid: boolean;
  project?: string;
  name?: string;
  isAdmin?: boolean;
}

type AnnotationInput = Record<string, unknown> & { id: string };
type SendResult = { id: string; remoteId: string; success: boolean; error?: string };

// =============================================================================
// Token management
// =============================================================================

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
export async function validateToken(token: string): Promise<TokenValidation> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/validate-token?token=${encodeURIComponent(token)}`);
    return await res.json();
  } catch {
    return { valid: false };
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

// =============================================================================
// Annotation submission
// =============================================================================

// Submit single annotation to backend
export async function submitAnnotation(token: string, annotation: AnnotationInput): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
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

// Submit batch of annotations to backend (API mode)
export async function submitAnnotations(token: string, annotations: AnnotationInput[]): Promise<SendResult[]> {
  const results: SendResult[] = [];
  
  for (const annotation of annotations) {
    try {
      const res = await fetch(`${AGENTATION_API}/api/annotations`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          editToken: token,
          annotation: {
            ...annotation,
            pageUrl: window.location.href,
          },
        }),
      });
      const data = await res.json();
      results.push({
        id: annotation.id,
        remoteId: data.id || '',
        success: data.success,
        error: data.error,
      });
    } catch (err) {
      results.push({
        id: annotation.id,
        remoteId: '',
        success: false,
        error: String(err),
      });
    }
  }
  
  return results;
}

// =============================================================================
// Annotation fetching
// =============================================================================

// Fetch all annotations for the project
export async function fetchAnnotations(token: string, all: boolean = true): Promise<AnnotationSummary[]> {
  try {
    const url = `${AGENTATION_API}/api/annotations?editToken=${encodeURIComponent(token)}&all=${all}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return await res.json();
  } catch (err) {
    console.error("[Agentation] Failed to fetch annotations:", err);
    return [];
  }
}

// Fetch single annotation detail
export async function fetchAnnotation(token: string, id: string): Promise<AnnotationSummary | null> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations/${id}?editToken=${encodeURIComponent(token)}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// =============================================================================
// Annotation actions (approve/reject/revise)
// =============================================================================

export interface ActionResult {
  success: boolean;
  status?: AnnotationStatus;
  error?: string;
  revisionCount?: number;
}

// Approve an annotation
export async function approveAnnotation(token: string, id: string): Promise<ActionResult> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations/${id}/approve`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ editToken: token }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Reject an annotation
export async function rejectAnnotation(token: string, id: string, reason?: string): Promise<ActionResult> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations/${id}/reject`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ editToken: token, reason }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Request revision on an annotation
export async function reviseAnnotation(token: string, id: string, prompt: string): Promise<ActionResult> {
  try {
    const res = await fetch(`${AGENTATION_API}/api/annotations/${id}/revise`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ editToken: token, prompt }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
