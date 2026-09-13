# One-Time Environment Handshake

Do this **once**. After it, Claude Code branches, commits, pushes and opens PRs
on its own — no repeated logins.

Everything below is scoped so it **cannot touch your existing Firebase projects
or GitHub repositories**. The isolation points are called out as > **Isolation**.

---

## Step 1 — Install the two CLIs

```bash
# GitHub CLI
brew install gh                       # macOS
# or: sudo apt install gh             # Debian/Ubuntu
# or: winget install GitHub.cli       # Windows

# Firebase CLI
npm install -g firebase-tools@13
```

Verify:

```bash
gh --version && firebase --version && node --version   # node must be >= 20
```

---

## Step 2 — Authenticate GitHub, once

```bash
gh auth login
#   ? What account do you want to log into?  GitHub.com
#   ? Preferred protocol for Git operations? HTTPS
#   ? Authenticate Git with your GitHub credentials? Yes
#   ? How would you like to authenticate? Login with a web browser
```

Confirm you are the right account and that the token carries `repo` + `workflow`:

```bash
gh auth status
```

> **Isolation** — `gh` stores this token in its own keychain entry. It grants
> access to repos you already own, so the scripts in this repo name the target
> repository explicitly on every call and never operate on "the current repo"
> by inference.

---

## Step 3 — Authenticate Firebase, once

```bash
firebase login
firebase projects:list          # ← read this list carefully
```

Note the IDs of your existing projects. Nothing in this repo will name them.

> **Isolation** — `firebase login` is account-wide, but *project selection is
> per-directory*. This repo pins its project in a local `.firebaserc`, which is
> gitignored. `scripts/bootstrap-firebase.sh` aborts if the target project ID
> already exists, so a name collision can never silently adopt an existing project.

---

## Step 4 — Create the isolated repository

```bash
cd /path/to/Intel
REPO_OWNER=BINEZER REPO_NAME=Intel VISIBILITY=private \
  ./scripts/bootstrap-github.sh
```

Creates the repo if missing, wires `origin`, applies branch protection on `main`
(PR required, CI must pass), and creates the workflow labels.

---

## Step 5 — Create the isolated Firebase projects

```bash
PROJECT_PREFIX=intelmotion-pcm FIRESTORE_LOCATION=eur3 \
  ./scripts/bootstrap-firebase.sh
```

Creates **two new** projects — `intelmotion-pcm-dev` and `intelmotion-pcm-prod` —
provisions Firestore in each, writes the local `.firebaserc`, and deploys the
rules and indexes to dev.

> The Firestore **location is permanent** and cannot be changed later.
> `eur3` (europe-west) is the closest low-latency multi-region to Addis Ababa;
> `nam5` is the US default. Decide before you run this.

### 5a — Console steps that cannot be scripted

In <https://console.firebase.google.com>, for **each** of the two new projects:

1. **Authentication → Get started → Sign-in method →** enable **Email/Password**.
   (Add Google sign-in if staff will use company Google accounts.)
2. **Project settings → General → Your apps → Add app → Web (`</>`)**.
   Name it `pcm-web`. Copy the `firebaseConfig` block.
3. **Authentication → Settings → Authorized domains →** add your production
   domain when you have one.
4. Leave both on the free Spark plan until you add Cloud Functions; Functions
   requires Blaze (pay-as-you-go).

Paste the dev config into a local `.env.local` (gitignored):

```bash
cp .env.example .env.local   # then fill in the values from step 5a.2
```

---

## Step 6 — Create the CI deploy credential

A service account, so CI never uses your personal login.

1. Google Cloud Console → the **`intelmotion-pcm-dev`** project →
   **IAM & Admin → Service Accounts → Create service account**.
   Name: `github-ci`.
2. Grant these roles, and only these:
   - `Firebase Rules Admin`
   - `Cloud Datastore Index Admin`
   - `Firebase Hosting Admin` *(only when you add hosting)*
3. **Keys → Add key → JSON**. Download it.
4. Repeat for `intelmotion-pcm-prod` with a separate key.

> **Isolation** — these service accounts exist *inside the new projects only*.
> They carry no permission on any other project on your account.

---

## Step 7 — Load the repository secrets

Two GitHub **Environments** (`dev`, `prod`) keep the prod credential out of
reach of a dev deploy. Create them under
**Settings → Environments** first, then:

```bash
# Repository-wide: lets Claude Code act on this repo
gh secret set ANTHROPIC_API_KEY --repo BINEZER/Intel

# Per-environment Firebase credentials
gh secret set FIREBASE_SERVICE_ACCOUNT --env dev  --repo BINEZER/Intel < ~/Downloads/dev-sa.json
gh secret set FIREBASE_PROJECT_ID      --env dev  --repo BINEZER/Intel --body "intelmotion-pcm-dev"

gh secret set FIREBASE_SERVICE_ACCOUNT --env prod --repo BINEZER/Intel < ~/Downloads/prod-sa.json
gh secret set FIREBASE_PROJECT_ID      --env prod --repo BINEZER/Intel --body "intelmotion-pcm-prod"
```

Add a **required reviewer** on the `prod` environment so a production rules
deploy always pauses for a human.

Then delete the downloaded JSON keys from your machine:

```bash
rm -f ~/Downloads/dev-sa.json ~/Downloads/prod-sa.json
```

---

## Step 8 — Install the Claude GitHub App

```bash
claude          # then, at the prompt:
/install-github-app
```

Select `BINEZER/Intel` **only** — not "All repositories". This is what lets
`@claude` on an issue open a PR without you authenticating again.

---

## Step 9 — Verify the handshake

```bash
npm ci && npm run typecheck && npm test        # local: 33 tests should pass
firebase emulators:start --only firestore,auth # local: emulators on :8080 / :9099
gh workflow list --repo BINEZER/Intel          # CI, Claude Code, Deploy Firestore config
```

Then open a throwaway issue on the repo containing `@claude say hello` and
confirm it responds. Once it does, the handshake is complete.

---

## Next: continuous deployment

[docs/09-continuous-deployment.md](09-continuous-deployment.md) turns this into a
pipeline — every pull request gets a live preview URL, and merging puts the
change on dev automatically.

## What is now automatic

| Action | Trigger | Auth used |
|---|---|---|
| Branch, commit, push, open PR | `@claude` on an issue or PR | Claude GitHub App |
| Typecheck, tests, rules compile | Every PR | `GITHUB_TOKEN` |
| Deploy rules/indexes to dev | Merge to `main` touching those files | `dev` environment secret |
| Deploy rules/indexes to prod | Manual dispatch + reviewer approval | `prod` environment secret |
| Live preview URL on every PR | Opening a PR | `dev` environment secret |
| Deploy the app to dev | Merge to `main` | `dev` environment secret |
| Deploy the app to prod | Manual dispatch + reviewer approval | `prod` environment secret |

## Standing safety rails

- `main` is protected: no direct pushes, CI must pass, one approval required.
- `.firebaserc`, `.env*` and any `*-service-account*.json` are gitignored.
- Prod deploys are manual-dispatch only and gated on a reviewer.
- Security rules reject money that does not reconcile, so a client bug cannot
  write a contract whose VAT does not add up.
