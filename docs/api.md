# API Reference

The Fish Finder REST API is a Flask application that serves two purposes:

1. **Presigned URL generation** — Issues short-lived S3 POST URLs so clients upload images directly to S3 without the image bytes passing through this server.
2. **Result polling** — Reads ML inference results from DynamoDB by image ID.

**Base URL:** `https://<cloudfront_url>` (production) or `http://localhost:5000` (local dev)

---

## Authentication

All API endpoints require a valid Cognito JWT passed in the `Authorization` header:

```
Authorization: Bearer <id_token>
```

The `id_token` is obtained by signing in through Cognito (SRP auth flow). In the browser frontend, the `amazon-cognito-identity-js` library handles this automatically.

**Token validity:**
- Access token / ID token: 1 hour
- Refresh token: 30 days

When the ID token expires, refresh it using the Cognito refresh token before making further API calls. The frontend handles this automatically.

**If the token is missing or invalid**, the API returns:

```json
HTTP 401 Unauthorized
{
  "error": "Unauthorized"
}
```

---

## Endpoints

### GET /api/upload-url

Generates a presigned S3 POST URL. The client uses the returned URL and fields to upload the fish image directly to S3.

**Query Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filename` | string | No | Original filename from the user (e.g. `my_fish.jpg`). Used only to preserve the file extension. Defaults to `image.jpg`. |

**Response — 200 OK**

```json
{
  "image_id":   "uploads/3f7a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.jpg",
  "upload_url": "https://fish-finder-uploads-xxxx.s3.eu-north-1.amazonaws.com/",
  "fields": {
    "key":                      "uploads/3f7a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.jpg",
    "x-amz-algorithm":         "AWS4-HMAC-SHA256",
    "x-amz-credential":        "AKIAIOSFODNN7EXAMPLE/20260214/eu-north-1/s3/aws4_request",
    "x-amz-date":              "20260214T120000Z",
    "policy":                   "eyJleH...",
    "x-amz-signature":         "abc123..."
  }
}
```

| Field | Description |
|---|---|
| `image_id` | The S3 object key. Save this value — it is the identifier used to poll for results. |
| `upload_url` | The S3 endpoint URL to POST to. |
| `fields` | All form fields that must be included in the multipart POST. |

The presigned URL expires **5 minutes** after it is issued.

**Response — 500 Internal Server Error**

```json
{
  "error": "Could not generate upload URL. Check AWS credentials and S3 bucket config."
}
```

**Example: Uploading with the presigned POST**

```javascript
// 1. Get the presigned URL
const resp = await fetch('/api/upload-url?filename=fish.jpg', {
  headers: { Authorization: `Bearer ${idToken}` }
});
const { image_id, upload_url, fields } = await resp.json();

// 2. Build the multipart form
const formData = new FormData();
Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
formData.append('file', imageBlob);   // 'file' must be the last field

// 3. POST directly to S3 (no Authorization header for this request)
await fetch(upload_url, { method: 'POST', body: formData });

// 4. Poll for the result using image_id
```

---

### GET /api/results/\<image_id\>

Polls DynamoDB for the ML inference result for a given image. Clients should call this endpoint every few seconds until `status` is `"ready"`.

**Path Parameters**

| Parameter | Type | Description |
|---|---|---|
| `image_id` | string | The `image_id` returned by `GET /api/upload-url`. This is the S3 object key, e.g. `uploads/3f7a1b2c-....jpg`. |

**Response — 200 OK (pending)**

Returned when the worker has not yet processed the image:

```json
{
  "status": "pending"
}
```

**Response — 200 OK (ready)**

Returned when ML inference is complete:

```json
{
  "status":       "ready",
  "species":      "Sparus aurata",
  "hebrew_name":  "דניס (צ׳יפורה)",
  "native":       "מקומי (גם מגודל בחקלאות ימית)",
  "population":   "נפוץ מאוד",
  "avg_size_cm":  35,
  "min_size_cm":  0,
  "seasonal_ban": false,
  "notes":        "מין נפוץ מאוד ומגודל באופן מסחרי.",
  "description":  "דג ממשפחת הספרוסיים, נפוץ בקרקעית חולית וסלעית."
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | `"pending"` or `"ready"` |
| `species` | string | Latin species name |
| `hebrew_name` | string | Common Hebrew name (may include colloquial name in parentheses) |
| `native` | string | Origin status: native, invasive (`פולש`), or aquaculture note |
| `population` | string | Population status in Hebrew |
| `avg_size_cm` | integer | Typical adult length in centimetres |
| `min_size_cm` | integer | Minimum legal catch size in cm; `0` means no regulation |
| `seasonal_ban` | boolean | `true` if there is a seasonal fishing ban for this species |
| `notes` | string | Additional regulation or safety notes in Hebrew |
| `description` | string | Brief species description in Hebrew |

**Response — 500 Internal Server Error**

```json
{
  "error": "Could not query results database."
}
```

**Example: Polling loop**

```javascript
async function pollForResult(imageId, idToken, timeoutMs = 120000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`/api/results/${encodeURIComponent(imageId)}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const data = await resp.json();

    if (data.status === 'ready') {
      return data;
    }

    // Wait 3 seconds before the next poll
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error('Timed out waiting for identification result.');
}
```

---

## Error Responses

| HTTP Status | Condition |
|---|---|
| `400 Bad Request` | Malformed request (e.g. missing required fields) |
| `401 Unauthorized` | Missing, expired, or invalid Cognito JWT |
| `404 Not Found` | Route does not exist |
| `500 Internal Server Error` | AWS service error (S3, DynamoDB); details in the `error` field |

All error responses are JSON objects with an `"error"` string field:

```json
{
  "error": "Human-readable error description."
}
```

---

## Local Development

To run the API locally without Cognito authentication (development only):

```bash
cd webapp/
pip install -r requirements.txt

export FF_S3_BUCKET="your-bucket-name"
export FF_AWS_REGION="eu-north-1"

python app.py
```

The server starts at `http://localhost:5000`. The static frontend is served from `webapp/static/` at the root path `/`.

Note: JWT verification is handled differently in local mode. Consult `app.py` for the current local auth configuration.
