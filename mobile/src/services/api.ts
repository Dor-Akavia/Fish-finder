/**
 * src/services/api.ts - Fish Finder API client
 *
 * Upload-and-poll flow:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  1. getUploadUrl(filename)                                       │
 * │     POST /upload-url → { image_id, upload_url, fields }         │
 * │     The backend generates a pre-signed S3 POST URL.             │
 * │                                                                  │
 * │  2. uploadToS3(upload_url, fields, imageUri)                    │
 * │     Construct a multipart FormData payload with the S3 fields   │
 * │     and the image file, then PUT/POST directly to S3.           │
 * │     S3 triggers a Lambda which runs the ML identification.      │
 * │                                                                  │
 * │  3. pollResults(image_id)                                        │
 * │     GET /results/{image_id} every 3 seconds.                    │
 * │     The Lambda writes its result to DynamoDB; the API reads it. │
 * │     Returns when status === 'completed', rejects on error or    │
 * │     after maxAttempts (default 20, i.e. ~60 seconds).           │
 * └──────────────────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Configuration
// Replace with your actual CloudFront distribution URL (or API Gateway URL).
// ---------------------------------------------------------------------------
export const API_BASE_URL = 'https://your-cloudfront-url.cloudfront.net';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pre-signed upload URL response from the backend */
export interface UploadUrlResponse {
  image_id: string;
  upload_url: string;
  /** Additional form fields required by the S3 pre-signed POST policy */
  fields: Record<string, string>;
}

/** Fish identification result returned by the backend after ML processing */
export interface FishResult {
  /** Latin/scientific species name, e.g. "Sparus aurata" */
  species: string;
  /** Common Hebrew name, e.g. "דניס" */
  hebrew_name: string;
  /** Whether the fish is native to Israeli Mediterranean / Red Sea waters */
  native: boolean;
  /** Population conservation status, e.g. "Stable", "Declining", "Endangered" */
  population: string;
  /** Average adult size in centimetres */
  avg_size_cm: number;
  /** Minimum legal catch size in centimetres (per Israeli fishing regulations) */
  min_size_cm: number;
  /**
   * Active seasonal ban information.
   * null means no current ban; a string describes the ban period.
   */
  seasonal_ban: string | null;
  /** Regulation or ecological notes */
  notes: string;
  /** General description of the species */
  description: string;
}

/** Raw polling response envelope from the backend */
interface PollResponse {
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: FishResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Step 1 – Request a pre-signed S3 upload URL from the backend.
 *
 * The backend (Lambda behind CloudFront/API Gateway) creates a short-lived
 * pre-signed POST policy and returns:
 *   - image_id: unique identifier used to poll for the result
 *   - upload_url: the S3 bucket endpoint to POST the file to
 *   - fields: policy fields that must be included in the multipart body
 */
export async function getUploadUrl(filename: string): Promise<UploadUrlResponse> {
  const response = await fetch(`${API_BASE_URL}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get upload URL (${response.status}): ${text}`);
  }

  return response.json() as Promise<UploadUrlResponse>;
}

/**
 * Step 2 – Upload the image directly to S3 using the pre-signed POST URL.
 *
 * S3 pre-signed POST requires a multipart/form-data body where:
 *   - All policy fields come BEFORE the file field.
 *   - The file field key is "file" (or whatever the policy specifies).
 *
 * We use the native fetch + FormData so this works on both iOS and Android
 * without any additional libraries.
 *
 * @param upload_url - The S3 endpoint returned by getUploadUrl()
 * @param fields     - Policy fields that must be echoed back to S3
 * @param imageUri   - Local file:// URI of the image chosen by the user
 */
export async function uploadToS3(
  upload_url: string,
  fields: Record<string, string>,
  imageUri: string,
): Promise<void> {
  const formData = new FormData();

  // Append all pre-signed POST policy fields FIRST (S3 requirement)
  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, value);
  });

  // Determine MIME type from the URI extension (default to JPEG)
  const extension = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

  // React Native's FormData accepts an object with uri/name/type for files
  formData.append('file', {
    uri: imageUri,
    name: `photo.${extension}`,
    type: mimeType,
  } as unknown as Blob);

  const response = await fetch(upload_url, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type manually — fetch will set the correct
    // multipart boundary automatically when the body is FormData.
  });

  // S3 pre-signed POST returns 204 No Content on success
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${text}`);
  }
}

/**
 * Step 3 – Poll the backend for the ML identification result.
 *
 * The ML Lambda writes its output to DynamoDB.  The backend's GET /results
 * endpoint reads that record and returns the current status.
 *
 * Polling strategy:
 *   - Check every POLL_INTERVAL_MS (3 000 ms).
 *   - Resolve with FishResult when status === 'completed'.
 *   - Reject immediately if status === 'error'.
 *   - Reject after maxAttempts polls (~60 s with defaults) to avoid hanging.
 *
 * @param image_id    - The identifier returned by getUploadUrl()
 * @param maxAttempts - Maximum number of poll attempts before giving up (default 20)
 */
export async function pollResults(
  image_id: string,
  maxAttempts = 20,
): Promise<FishResult> {
  const POLL_INTERVAL_MS = 3_000;

  const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${API_BASE_URL}/results/${image_id}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Polling request failed (${response.status}): ${text}`);
    }

    const data: PollResponse = await response.json();

    if (data.status === 'completed' && data.result) {
      return data.result;
    }

    if (data.status === 'error') {
      throw new Error(data.error ?? 'Fish identification failed on the server.');
    }

    // status is 'pending' or 'processing' — wait and try again
    if (attempt < maxAttempts) {
      await delay(POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Identification timed out after ${maxAttempts} attempts (~${
      (maxAttempts * POLL_INTERVAL_MS) / 1000
    }s). Please try again.`,
  );
}
