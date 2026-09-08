#!/usr/bin/env bash
#
# Creates BRAND-NEW, ISOLATED Firebase projects (dev + prod) for this app.
#
# ISOLATION GUARANTEES:
#   * Never runs `firebase use --add` against an existing project.
#   * Never writes to the global ~/.firebaserc; only the repo-local .firebaserc.
#   * Refuses to continue if the target project ID already exists.
#   * Prints the project list first so you can confirm nothing else is touched.
#
set -euo pipefail

# Project IDs must be globally unique across all of Firebase. Add a suffix if taken.
PROJECT_PREFIX="${PROJECT_PREFIX:-intelmotion-pcm}"
DEV_PROJECT="${DEV_PROJECT:-${PROJECT_PREFIX}-dev}"
PROD_PROJECT="${PROD_PROJECT:-${PROJECT_PREFIX}-prod}"
# nam5 (US) is the default multi-region. europe-west1 or europe-west3 is the
# closest low-latency option to Addis Ababa; Firestore location is PERMANENT.
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-eur3}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v firebase >/dev/null || die "firebase-tools is not installed. Run: npm i -g firebase-tools"
firebase login:list >/dev/null 2>&1 || die "Not logged in. Run: firebase login"

say "Existing Firebase projects on this account (NONE of these will be modified):"
firebase projects:list || true
echo
read -r -p "Create NEW projects '${DEV_PROJECT}' and '${PROD_PROJECT}'? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || die "Aborted by user."

create_project() {
  local id="$1" name="$2"
  if firebase projects:list 2>/dev/null | grep -qE "[[:space:]]${id}[[:space:]]"; then
    die "Project '${id}' already exists. Set PROJECT_PREFIX to something unique and re-run."
  fi
  say "Creating Firebase project ${id}"
  firebase projects:create "${id}" --display-name "${name}"

  say "Provisioning Firestore in ${id} (location ${FIRESTORE_LOCATION} — PERMANENT)"
  firebase firestore:databases:create "(default)" \
    --project "${id}" --location "${FIRESTORE_LOCATION}" --type firestore-native \
    2>/dev/null || say "Firestore may already exist in ${id}; continuing."
}

create_project "${DEV_PROJECT}"  "IntelMotion PCM (Dev)"
create_project "${PROD_PROJECT}" "IntelMotion PCM (Prod)"

# --- repo-local alias file only ----------------------------------------------
say "Writing repo-local .firebaserc (gitignored — never committed)"
cat > .firebaserc <<JSON
{
  "projects": {
    "default": "${DEV_PROJECT}",
    "dev": "${DEV_PROJECT}",
    "prod": "${PROD_PROJECT}"
  }
}
JSON

say "Deploying Firestore rules and indexes to ${DEV_PROJECT}"
firebase deploy --only firestore:rules,firestore:indexes --project dev

cat <<NEXT

Done. Two isolated projects exist and dev has rules + indexes deployed.

Still manual in the Firebase console (cannot be scripted):
  1. Enable Authentication > Sign-in method > Email/Password (and Google, if wanted)
     for BOTH ${DEV_PROJECT} and ${PROD_PROJECT}.
  2. Register a Web App in each and copy the config into .env.local / repo secrets.
  3. Set the billing account on ${PROD_PROJECT} only if you need Cloud Functions.

Then generate the CI deploy credential:
  firebase init hosting:github        # or see docs/00-one-time-setup.md step 6
NEXT
