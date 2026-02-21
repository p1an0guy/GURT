# Chrome Extension Compatibility (Demo Phase)

This project does not expose a separate extension-specific backend route in the hackathon phase.
Use the same public API route as the web app:

- `POST /chat`

## Endpoint contract

- Method: `POST`
- URL: `<DEV_BASE_URL>/chat`
- Headers:
  - `Content-Type: application/json`
- Body:

```json
{
  "courseId": "course-psych-101",
  "question": "What are the key terms for week 3?"
}
```

- Success (`200`):

```json
{
  "answer": "Grounded response text...",
  "citations": [
    "s3://<bucket>/<key>#chunk-2"
  ]
}
```

- Error (`400`):
  - malformed JSON
  - missing/empty `courseId` or `question`
- Error (`502`):
  - model retrieval/generation failure
  - knowledge base retrieval unavailable

## CORS behavior

- Demo API is configured with CORS preflight + runtime CORS headers.
- Current demo deploy default allows all origins (`*`) and `GET,POST,OPTIONS`.
- If CORS is later tightened, include the extension origin (`chrome-extension://<EXTENSION_ID>`) in the allowed origins list.

## Auth model in demo

- `POST /chat` currently uses `AuthorizationType.NONE` for hackathon/demo operation.
- No extension-only auth token is required in this phase.
- Do not assume this policy for production hardening.

## Failure-handling expectations for extension UI

- On `400`: show actionable input error and do not auto-retry.
- On `502`: show temporary backend/model failure and allow retry.
- On network/CORS failure (`TypeError: Failed to fetch`):
  - verify API base URL includes stage (for example `/dev`)
  - verify deployed CORS settings
  - verify extension host permissions include the API domain

## Quick validation command

```bash
curl -sS -X POST "$BASE_URL/chat" \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-psych-101","question":"Summarize upcoming deadlines."}' | jq
```
