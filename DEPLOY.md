# Deploying Samajh (Cloud Run + Firebase Hosting)

## 1. Prerequisites
Install and sign in to Google Cloud CLI and Firebase CLI:
```bash
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
firebase login
```

## 2. Deploy Backend to Cloud Run
From the repo root (`samajh/`):
```bash
gcloud run deploy samajh-backend \
  --source ./backend \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=YOUR_KEY,GEMINI_MODEL=gemini-4-hydrogen,MONGO_CONNECTION_STRING=YOUR_FIRESTORE_MONGO_URI,MONGODB_DB_NAME=samajh,GOOGLE_CLOUD_PROJECT=YOUR_GCP_PROJECT_ID"
```
*(Optional: add `,VERTEX_SEARCH_DATASTORE_ID=YOUR_DATASTORE_ID` if you provisioned a Vertex AI Search datastore for NISM PDFs.)*

Copy the Cloud Run service URL printed at the end (e.g. `https://samajh-backend-xxxx-el.a.run.app`).

Verify it is live:
```bash
curl https://YOUR_CLOUD_RUN_URL/api/health
```

## 3. Build & Deploy Frontend to Firebase Hosting
Point the Next.js static export at your live Cloud Run backend:
```bash
cp .firebaserc.example .firebaserc
# Edit .firebaserc and replace your-gcp-project-id

NEXT_PUBLIC_API_BASE_URL=https://YOUR_CLOUD_RUN_URL npm run build --prefix frontend
firebase deploy --only hosting
```

Your live demo URL (`https://YOUR_GCP_PROJECT_ID.web.app`) is now ready for judges!
