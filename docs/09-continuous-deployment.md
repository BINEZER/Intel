# Continuous Deployment — Setting It Up Once

After this, **merging a pull request puts the change live on dev automatically**,
and every pull request gets its own working URL to review.

Prerequisite: [docs/00-one-time-setup.md](00-one-time-setup.md) — the repository
and the two Firebase projects must already exist.

---

## What runs when

| Trigger | What happens | Approval |
|---|---|---|
| **Open / update a PR** | CI (typecheck, 389 tests, build, 53 rules tests) + a **live preview URL** commented on the PR | none |
| **Merge to `main`** | App deploys to **dev**; Firestore rules and indexes deploy to dev | none |
| **Manual dispatch** | App and/or rules deploy to **dev or prod** | **prod requires a reviewer** |

Production is never automatic. A finance system going live on every merge is not
a feature.

---

## Step 1 — Enable Hosting on both projects

In the [Firebase console](https://console.firebase.google.com), for **each** of
`intelmotion-pcm-dev` and `intelmotion-pcm-prod`:

**Build → Hosting → Get started.** Click through the CLI instructions without
running them — this repo already carries the config. You only need Hosting
switched on.

## Step 2 — Add the Hosting role to the CI service accounts

The service accounts from the original setup can deploy rules but not the app.

Google Cloud Console → the project → **IAM & Admin → IAM** → find `github-ci` →
**Edit** → **Add another role**:

- `Firebase Hosting Admin`

Repeat for the prod project. No new key is needed — the existing
`FIREBASE_SERVICE_ACCOUNT` secret still works, it just gains permission.

## Step 3 — Register the web app config as repository *variables*

> **These are variables, not secrets.** The Firebase web config is **public by
> design** — it ships inside the client bundle and merely identifies the project.
> It authorises nothing. Access is controlled entirely by the security rules,
> which is why they are tested against the emulator.
>
> Storing them as secrets would mean GitHub masks them in every build log, so a
> genuine misconfiguration would appear as `***` and take an afternoon to find.

Get the values from **Firebase console → Project settings → General → Your apps →
Web app → Config**.

Set them per environment (Settings → Environments → `dev` → *Environment
variables*), or with the CLI:

```bash
REPO=BINEZER/Intel

# dev
gh variable set VITE_FIREBASE_API_KEY             --env dev --repo $REPO --body "AIza…"
gh variable set VITE_FIREBASE_AUTH_DOMAIN         --env dev --repo $REPO --body "intelmotion-pcm-dev.firebaseapp.com"
gh variable set VITE_FIREBASE_PROJECT_ID          --env dev --repo $REPO --body "intelmotion-pcm-dev"
gh variable set VITE_FIREBASE_STORAGE_BUCKET      --env dev --repo $REPO --body "intelmotion-pcm-dev.appspot.com"
gh variable set VITE_FIREBASE_MESSAGING_SENDER_ID --env dev --repo $REPO --body "…"
gh variable set VITE_FIREBASE_APP_ID              --env dev --repo $REPO --body "1:…:web:…"

# prod — same six, with the prod project's values
gh variable set VITE_FIREBASE_PROJECT_ID --env prod --repo $REPO --body "intelmotion-pcm-prod"
# …and the rest
```

`VITE_FIREBASE_PROJECT_ID` does double duty: it is both built into the bundle and
used as the deploy target, so the app can never be built against one project and
deployed to another.

## Step 4 — Authorise the Hosting domains for sign-in

Firebase Auth rejects sign-in from a domain it does not know, and a preview
channel is a new domain each time.

**Firebase console → Authentication → Settings → Authorized domains → Add
domain**, for each project:

- `intelmotion-pcm-dev.web.app`
- `intelmotion-pcm-dev.firebaseapp.com`
- your production domain, when you have one

> Preview channels get URLs like
> `intelmotion-pcm-dev--pr-7-abc123.web.app`. Firebase authorises
> `*.web.app` subdomains of your own project automatically, so previews work
> without adding each one. If a preview ever shows `auth/unauthorized-domain`,
> add that exact host.

## Step 5 — Protect `main` and require a reviewer on prod

```bash
gh api -X PUT repos/BINEZER/Intel/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -F "required_status_checks[contexts][]=build-and-test" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions="
```

Then **Settings → Environments → `prod` → Required reviewers → add yourself.**
A production deploy now pauses for a human, every time.

## Step 6 — Verify end to end

1. Open a trivial PR. Within a few minutes it should carry a **preview URL
   comment** and a green `build-and-test` check.
2. Open the preview URL, sign in, confirm the dashboard loads.
3. Merge. Watch **Actions → Deploy app** turn green.
4. Visit `https://intelmotion-pcm-dev.web.app` and confirm your change is live.

If step 2 fails with `auth/unauthorized-domain`, revisit step 4.

---

## Going to production

Production is deliberately a decision, not a consequence:

**Actions → Deploy app → Run workflow → target: `prod` → Run.** It pauses for
the required reviewer, then deploys.

Deploy the rules the same way (**Deploy Firestore config**) — and deploy rules
**before** the app when a release changes both, so the new client never hits
rules that do not yet permit it.

## Two things the config gets right that are easy to miss

**`index.html` is never cached.** It names the current asset hashes. A cached
copy points browsers at files the last deploy deleted, and the app fails to load
for exactly the people who visited most recently. Hashed assets under `/assets/`
are cached for a year because their contents can never change.

**Deploys are serialised per target** (`concurrency`). Two overlapping deploys
can land in either order, so without this the last to *finish* wins rather than
the last to be *merged*.

## Rolling back

```bash
firebase hosting:rollback --project prod
```

Or in the console: **Hosting → Release history → ⋮ → Rollback**. Instant, because
every release is retained.

Rules do **not** roll back with hosting. Revert the commit and re-run the
Firestore deploy.
