<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.
https://ai.studio/apps/51f1aea3-d809-4c56-8a31-f022f7beb7f3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
## Web deployment configuration

Build the web app with Node.js using `npm ci` and `npm run build`. Configure the public `VITE_FIREBASE_*`, `VITE_PROXY_SERVER_URL`, and `VITE_DRIVE_INTERNAL_PREVIEW` values in the deployment environment or an untracked `.env` file as shown in `.env.example`. Keep `VITE_RECORDING_ENABLED=false` while recording is disabled. Server credentials belong only in the server secret manager, never in `VITE_` variables or the repository. Firebase Hosting deploys the resulting `dist` directory; pushing source to GitHub does not publish the web site.

Run `npm test`, `npm run lint`, and the Python server tests before deployment. `tests/test_web_api_contract.py` checks that the web app's Drive, timetable, and feedback endpoints are registered by the backend.
