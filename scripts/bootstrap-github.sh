#!/usr/bin/env bash
#
# Creates the isolated GitHub repository for this app and pushes the first commit.
# Safe to re-run: every step checks before it acts.
#
# Prereqs: gh (GitHub CLI) authenticated as the repo owner — see docs/00-one-time-setup.md
#
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-BINEZER}"
REPO_NAME="${REPO_NAME:-Intel}"
VISIBILITY="${VISIBILITY:-private}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v gh  >/dev/null || die "gh is not installed. See docs/00-one-time-setup.md step 1."
command -v git >/dev/null || die "git is not installed."
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

# --- 1. repository -----------------------------------------------------------
if gh repo view "${REPO_OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
  say "Repository ${REPO_OWNER}/${REPO_NAME} already exists — leaving it as is."
else
  say "Creating ${VISIBILITY} repository ${REPO_OWNER}/${REPO_NAME}"
  gh repo create "${REPO_OWNER}/${REPO_NAME}" \
    --"${VISIBILITY}" \
    --description "Project, Contract & Task Management — ETB / 15% VAT / WHT / dual GC-EC calendar" \
    --disable-wiki
fi

# --- 2. local git ------------------------------------------------------------
[ -d .git ] || { say "Initialising local repository"; git init -b "${DEFAULT_BRANCH}"; }

if git remote get-url origin >/dev/null 2>&1; then
  say "Remote 'origin' already set to $(git remote get-url origin)"
else
  git remote add origin "https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
fi

# --- 3. branch protection ----------------------------------------------------
# Requires CI to pass and a PR before anything lands on the default branch.
# This is what makes the automated-PR workflow safe to leave running.
say "Applying branch protection to ${DEFAULT_BRANCH}"
gh api -X PUT "repos/${REPO_OWNER}/${REPO_NAME}/branches/${DEFAULT_BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -F "required_status_checks[contexts][]=build-and-test" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=" \
  2>/dev/null || say "Branch protection skipped (needs the branch to exist and a plan that supports it on private repos)."

# --- 4. labels ---------------------------------------------------------------
say "Ensuring labels"
while IFS='|' read -r name color desc; do
  gh label create "$name" --color "$color" --description "$desc" \
    --repo "${REPO_OWNER}/${REPO_NAME}" 2>/dev/null \
  || gh label edit "$name" --color "$color" --description "$desc" \
       --repo "${REPO_OWNER}/${REPO_NAME}" >/dev/null 2>&1 || true
done <<'LABELS'
module|0e8a16|A delivery module from the roadmap
tax-logic|b60205|Touches VAT or WHT arithmetic — requires finance review
calendar|1d76db|Touches GC/EC conversion
security-rules|d93f0b|Changes Firestore security rules
claude|5319e7|Opened by Claude Code
LABELS

say "Done. Next: scripts/bootstrap-firebase.sh"
