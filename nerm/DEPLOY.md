# Putting this online — a step-by-step guide

This gets the platform onto a real web address you can open and share.

**You do not need to write any code or use a terminal.** You will create two free
accounts and fill in some boxes on two websites.

**Time:** about 15 minutes.
**Cost:** nothing. Both services have free tiers that comfortably cover a demo.

---

## Before you start — read this bit

To let you sign in without your company's single sign-on, this deployment uses a
**shared demo password**. Anyone who has the web address and that password can get in,
including as an administrator.

So:

- Only put **example data** in it. The seeded people are invented.
- Do not enter real names, real contractors, or anything from a real supplier.
- Treat the web address as semi-public. Share it with colleagues, not the internet.

There is a permanent orange warning bar across the top of every page saying exactly this.
That is intentional — it should be obvious to anyone you show it to that this is a demo.

---

## Step 1 — Create a Neon account (the database)

1. Go to **https://neon.com** and click **Sign up**.
2. Choose **Continue with GitHub** and approve.
3. When it asks you to create a project:
   - **Project name:** `nerm`
   - **Postgres version:** leave the default
   - **Region:** pick **Europe (Frankfurt)** — closest to the Netherlands
4. Click **Create**.

Leave this tab open. You will come back for one piece of text.

---

## Step 2 — Copy your database address

1. In Neon, on the project dashboard, find the box labelled **Connection string**.
2. Make sure the dropdown next to it says **Pooled connection**.
3. Click the **copy** icon.

You now have a long line of text on your clipboard starting with `postgresql://`.
**Paste it somewhere safe for a moment** — a Notes window is fine. You need it in Step 5.

---

## Step 3 — Create a Vercel account (the website)

1. Go to **https://vercel.com** and click **Sign Up**.
2. Choose **Continue with GitHub** and approve.
3. Pick the **Hobby** plan (free) when asked. If it asks about a team, choose personal.

---

## Step 4 — Import the project

1. On the Vercel dashboard click **Add New…** → **Project**.
2. Find **Menzowski/Claude** in the repository list and click **Import**.
   - If you do not see it, click **Adjust GitHub App Permissions** and give Vercel access
     to that repository.
3. You will land on a **Configure Project** screen. Three things matter here:

   **a) Branch.** Look for **Git Branch** (you may need to expand a section). Set it to:

   ```
   claude/jolly-sagan-pw7rdy
   ```

   **b) Root Directory.** This is the one people get wrong. Click **Edit** next to
   *Root Directory* and choose the folder:

   ```
   nerm
   ```

   The application lives in that subfolder, not at the top of the repository. If you skip
   this, the build fails with something like *"No Next.js version detected"*.

   **c) Framework Preset** should say **Next.js**. It usually detects this by itself once
   the root directory is right.

Do not click Deploy yet — do Step 5 first, on the same screen.

---

## Step 5 — Fill in the settings

Still on the Configure Project screen, expand **Environment Variables**. Add these one at
a time. For each: type the name in the left box, the value in the right box, click **Add**.

| Name | Value |
|---|---|
| `DATABASE_URL` | The `postgresql://...` line you copied in Step 2 |
| `AUTH_SECRET` | A long random string — see below |
| `DEMO_MODE` | `true` |
| `DEMO_PASSWORD` | A password you invent — **at least 12 characters** |
| `DEMO_API_TOKEN` | `nerm_` followed by any random letters, e.g. `nerm_demo_token_abc123xyz` |
| `JOB_TRIGGER_SECRET` | Any random string |

**For `AUTH_SECRET`:** open https://generate-secret.vercel.app/32 in a new tab. It shows a
random string. Copy the whole thing and paste it in. (This is what keeps login sessions
tamper-proof. It just needs to be long and random — nobody has to remember it.)

**Write down your `DEMO_PASSWORD`.** You need it to log in, and it is not recoverable.

---

## Step 6 — Deploy

Click **Deploy**.

It takes two to four minutes. You will see a build log scrolling. It is setting up the
database tables and filling them with example data, then building the site.

When it finishes you get a **Congratulations** screen with a preview image and a link like:

```
https://claude-something.vercel.app
```

Click it. You should see the sign-in page with the orange demo warning across the top.

---

## Step 7 — Log in and look around

On the sign-in page, under **Internal staff**, pick who you want to be and enter your
`DEMO_PASSWORD`.

Try them in this order — each one sees a genuinely different application:

**1. Ada Admin (IAM administrator)** — sees everything.
   - **Workflows** → click *Contractor onboarding*. This is the approval process as
     editable JSON. Press **Simulate** to see which steps a high-risk contractor would go
     through. Press **Validate** to check your edits. This is the "easy to configure
     workflows" part.
   - **Vendors** — the supplier companies and who administers them.
   - **API clients** — how you would connect Identity Security Cloud.
   - **Audit** — every action anyone has taken.

**2. Sam Sponsor (a business owner)** — the everyday view.
   - The home screen leads with *what needs your decision*, not a data table.
   - **Onboard someone** walks through a five-step form. On the first step it tells you
     which approval process your choice will start, before you start it.
   - **Tasks** is where approvals land.
   - Notice Sam cannot open Workflows, Vendors or Audit at all.

**3. Iris Auditor** — read-only, plus the audit log. Cannot change anything.

**Then try a supplier's view.** Sign out, and on the sign-in page use the lower form,
**Vendor administrators**:

- Email: `vic.admin@acme.example`
- Password: `Vendor!Passw0rd`
- Authenticator code: this one needs a 6-digit code from an authenticator app, so skip it
  unless you want to set that up. The internal accounts above show the more interesting
  parts anyway.

---

## If something goes wrong

**"No Next.js version detected"** or the build fails immediately.
The Root Directory is not set to `nerm`. Go to your project → **Settings** → **General** →
**Root Directory** → set it to `nerm` → **Save**, then **Deployments** → **⋯** →
**Redeploy**.

**Build fails mentioning `DATABASE_URL` or "Can't reach database server".**
The connection string is missing or wrong. Go to **Settings** → **Environment Variables**,
check `DATABASE_URL` is there and starts with `postgresql://`. Re-copy it from Neon (make
sure **Pooled connection** is selected) and redeploy.

**Build fails mentioning `DEMO_PASSWORD`.**
Your demo password is shorter than 12 characters. The app refuses to start with a weak
password guarding administrator accounts. Make it longer and redeploy.

**The site loads but says "Configuration" when you try to log in.**
Usually a missing `AUTH_SECRET`. Add it and redeploy.

**You see the sign-in page but no "Internal staff" section.**
`DEMO_MODE` is not set to exactly `true` (lower case). Fix it and redeploy.

**How to redeploy after changing a setting:** project → **Deployments** → the **⋯** menu on
the top entry → **Redeploy**. Environment variable changes only take effect on a new
deployment.

---

## Trying the API (optional)

If you want to see the Identity Security Cloud integration:

1. Install **Postman** (free) from https://postman.com.
2. Import the file `nerm/postman/nerm-platform.postman_collection.json` from the
   repository.
3. In the collection's **Variables** tab set:
   - `baseUrl` → your Vercel address, e.g. `https://claude-something.vercel.app`
   - `token` → the `DEMO_API_TOKEN` you chose in Step 5
4. Open the **Workflow round trip** folder and run the requests top to bottom. It exports
   an approval process, edits it, publishes a new version, tests it, and switches to it —
   the same thing the admin screen does, which is the point.

---

## Turning it off

Delete the Vercel project and the Neon project. Nothing else is left behind, and neither
free tier charges you.

## Before this ever holds real data

Remove `DEMO_MODE` and `DEMO_PASSWORD` entirely, and configure real single sign-on
(`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) against Entra ID, Okta or Identity
Security Cloud. The demo login exists only because a throwaway deployment has no identity
provider attached. See the *Known gaps* section of `README.md` for the rest of what a
production deployment still needs.
