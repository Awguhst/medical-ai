// Railway Infrastructure as Code for MedAI Bulgaria.
//
// Two services are deployed from this one repository:
//   backend   FastAPI + X-ray Analyzer + CLIP triage, CPU only. Built from the
//             Dockerfile at the repository root; the root directory stays empty
//             so that backend/ and models/ are both in the build context.
//   frontend  Next.js, built from frontend/Dockerfile (root directory frontend).
//
// How to use (Railway CLI 5.42.1 or newer, from the repository root):
//   npm install                       # installs the `railway` SDK imported below
//   railway login && railway link     # pick the project and environment
//   railway config plan               # preview the changes
//   railway config apply              # apply them
//
// Before the first apply: fill in GITHUB_REPO below (or connect the repository
// to both services in the Railway dashboard) and generate a public domain for
// each service. The variables below refer to those domains.
//
// railway.json / railway.toml (the older "config as code") is not used: Railway
// stops reading those files on 2026-12-01.
import { defineRailway, github, preserve, project, service } from "railway/iac";

// The GitHub repository Railway deploys from, as "owner/medical-ai". Leave it
// empty to keep whatever repository each service is connected to in the dashboard.
const GITHUB_REPO = "";
const BRANCH = "main";

const source = (rootDirectory?: string) =>
  GITHUB_REPO ? github(GITHUB_REPO, { branch: BRANCH, rootDirectory }) : undefined;

export default defineRailway(() => {
  const backend = service("backend", {
    source: source(),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      // Rebuild only when the backend or its image definition changes.
      watchPatterns: ["/backend/**", "/models/README.md", "/Dockerfile", "/.dockerignore"],
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
      // CORS: the frontend's public Railway domain. Add any custom domain here too,
      // comma separated.
      FRONTEND_ORIGINS: "https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}",
      // Both models are baked into the image (see Dockerfile). Setting this to
      // "false" skips the CLIP model and roughly halves the memory, but uploads
      // are then labelled "unknown" and the assistant decides from the message.
      IMAGE_TRIAGE_ENABLED: "true",
    },
  });

  const frontend = service("frontend", {
    source: source("frontend"),
    // Without a declared source this still sets the service's root directory.
    rootDirectory: "frontend",
    build: {
      builder: "DOCKERFILE",
      watchPatterns: ["/frontend/**"],
    },
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      numReplicas: 1,
      sleepApplication: false,
    },
    env: {
      // Inlined into the browser bundle at build time (frontend/Dockerfile), so a
      // change here needs a redeploy of the frontend.
      NEXT_PUBLIC_API_URL: "https://${{backend.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("medical-ai", { resources: [backend, frontend] });
});
