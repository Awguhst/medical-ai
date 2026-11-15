// Railway Infrastructure as Code for MedAI Bulgaria: ONE service.
//
// The Dockerfile at the repository root builds the Next.js frontend and bakes
// it into the Python image, where FastAPI serves it next to the API. So there is
// a single service, a single domain, and no cross-service variables.
//
// This file is optional. Connecting the repository in the Railway dashboard
// with the root directory left empty gives the same service; what the file adds
// is the health check, the restart policy and keeping the service awake.
//
// How to use (Railway CLI 5.42.1 or newer, from the repository root):
//   npm install                       # installs the `railway` SDK imported below
//   railway login && railway link     # pick the project and environment
//   railway config plan               # preview the changes
//   railway config apply              # apply them
//
// railway.json / railway.toml (the older "config as code") is not used: Railway
// stops reading those files on 2026-12-01.
import { defineRailway, github, preserve, project, service } from "railway/iac";

// The GitHub repository Railway deploys from, and the service's name as shown
// in the dashboard (rename one or the other if they differ).
const GITHUB_REPO = "Awguhst/medical-ai";
const BRANCH = "main";
const SERVICE_NAME = "medical-ai";

export default defineRailway(() => {
  const app = service(SERVICE_NAME, {
    source: github(GITHUB_REPO, { branch: BRANCH }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      // Responds at once, even while the triage model is still warming up.
      healthcheckPath: "/api/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      // Uploaded images live in the process that received them: one replica.
      numReplicas: 1,
      // A sleeping service would need a minute to reload both models.
      sleepApplication: false,
    },
    env: {
      // Set once in the dashboard or with `railway variables set`. Never in this file.
      ANTHROPIC_API_KEY: preserve(),
      // Both models are baked into the image (see Dockerfile). Setting this to
      // "false" skips the CLIP model and roughly halves the memory, but uploads
      // are then labelled "unknown" and the assistant decides from the message.
      IMAGE_TRIAGE_ENABLED: "true",
    },
  });

  return project("medical-ai", { resources: [app] });
});
