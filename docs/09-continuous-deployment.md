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
| **Merge to `main`** | App and Firestore rules deploy to `intel-afc60` | none |
| **Manual dispatch** | Same, on demand | none |

**Note on production.** Only one Firebase project exists today, so there is no
separate production environment and no reviewer gate. Before real client data
goes in, create a second project and I will reinstate the split: automatic
deploys to the practice project, and production behind a manual dispatch with a
required reviewer. A finance system going live on every merge is not a feature —
that guard just cannot be meaningful until there are two projects to guard
between.

---

## Step 1 — Enable Hosting on both projects

In the [Firebase console](https://console.firebase.google.com), for **each** of
`intel-afc60` (a production project comes later):

**Build → Hosting → Get started.** Click through the CLI instructions without
running them — this repo already carries the config. You only need Hosting
switched on.

## Step 2 — Confirm the services are on

In **https://console.firebase.google.com/project/intel-afc60**, check the left
sidebar under **Build**. Each of these must be set up rather than showing a
*Get started* button:

- **Authentication** — with Email/Password enabled
- **Firestore Database** — created
- **Hosting** — started

## Step 3 — Add the one secret CI needs

Only **one** value has to be stored in GitHub: the service account key that lets
CI publish on your behalf.

The Firebase web config is **not** stored in GitHub. It lives in
`.env.production`, committed to the repository, because those six values are
public by design — they ship inside the compiled website, so every visitor's
browser already has them. They identify the project and authorise nothing;
`firestore.rules` is what protects the data, which is why it carries 53 tests.

Committing them removes six error-prone settings fields and means a fresh clone
builds correctly with no configuration at all.

### Create the key

1. **https://console.cloud.google.com/iam-admin/serviceaccounts?project=intel-afc60**
2. **Create service account** → name `github-ci` → **Create and continue**
3. Grant these three roles, and only these:
   - `Firebase Hosting Admin`
   - `Firebase Rules Admin`
   - `Cloud Datastore Index Admin`
4. **Continue** → **Done**
5. Click the new `github-ci` account → **Keys** tab → **Add key** → **Create new
   key** → **JSON** → **Create**. A file downloads.

### Store it in GitHub

1. **https://github.com/BINEZER/Intel/settings/secrets/actions**
2. **New repository secret**
3. Name: `FIREBASE_SERVICE_ACCOUNT`
4. Secret: open the downloaded `.json` file in a text editor, copy **everything**
   including the outer `{` and `}`, and paste it
5. **Add secret**
6. **Delete the downloaded file from your computer.** It is a real credential —
   anyone holding it can publish to your Firebase project.

## Step 4 — Authorise the Hosting domains for sign-in

Firebase Auth rejects sign-in from a domain it does not know, and a preview
channel is a new domain each time.

**Firebase console → Authentication → Settings → Authorized domains → Add
domain**, for each project:

- `intel-afc60.web.app`
- `intel-afc60.firebaseapp.com`
- your production domain, when you have one

> Preview channels get URLs like
> `intel-afc60--pr-7-abc123.web.app`. Firebase authorises
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

Then Environment reviewers come later, with the production project.

## Step 6 — Verify end to end

1. Open a trivial PR. Within a few minutes it should carry a **preview URL
   comment** and a green `build-and-test` check.
2. Open the preview URL, sign in, confirm the dashboard loads.
3. Merge. Watch **Actions → Deploy app** turn green.
4. Visit `https://intel-afc60.web.app` and confirm your change is live.

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
