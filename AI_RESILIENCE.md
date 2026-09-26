# AI request recovery

- Primary: `GEMINI_MODEL` (default `gemini-3.8-flash`).
- Ordered fallback: `GEMINI_FALLBACK_MODELS` (default `gemini-3.6-flash`). Set an empty string to disable. At most three distinct configured models are considered; no model catalog auto-selection.
- At most four provider attempts total, two per model, under the existing 55-second deadline. Retry temporary 500/502/503/504 after one second; then try the next configured model. 404 skips the model for five minutes; exhausted transient failures cool down for 30 seconds. Cooldowns are process-local routing hints, not quota controls.
- Never fail over on 400/401/403/429. Redis still counts each incoming application request atomically across replicas. Provider attempts can incur provider usage even when a request fails.
- Logs contain generated request ID, model, attempt, numeric status, and elapsed milliseconds. No source files, summaries, credentials, or upstream error messages.
- Files run sequentially with 6.2-second spacing. Application minute/concurrency quota waits once according to Retry-After. Daily and provider quota errors pause for manual retry.
- Pending source data and successful per-file summaries are stored in account-scoped IndexedDB on this device. Successful source payloads are removed when their summaries are checkpointed. Completed documents retain the existing account-scoped localStorage format.
- Reopening the app restores pending work in AI processing; choose **이어서 시도**. Completed files are not re-requested. **완료분 보기** opens the available partial summary. Cancel aborts browser requests/waits and deletes the pending job. Closing the app stops execution; this is not a server background queue.
- Browser Web Locks prevent two tabs from running the same job concurrently where supported. Clearing site storage deletes local pending jobs. A response interrupted before its durable checkpoint may need to be requested again.

Validation: synthetic image, one-second silent WAV, and JSON output probes passed for `gemini-3.6-flash` on 2026-09-26 with the local key. This verifies input paths, not real lecture recognition quality or ongoing provider availability. Automated tests cover retries, fallback, cooldown, quota boundaries, cancellation, persistence, account separation and failed final document saves.
