# Google OAuth Setup for NAVI (Supabase)

> **Project Reference:** `oltfaepqcktrumfhadzb`  
> **Supabase URL:** `https://oltfaepqcktrumfhadzb.supabase.co`  
> **Last Updated:** 2026-06-20

This guide walks through enabling Google OAuth authentication for the NAVI multi-campus navigation platform. It covers both Google Cloud Console configuration and Supabase dashboard configuration.

---

## Table of Contents

- [Part 1: Google Cloud Console Setup](#part-1-google-cloud-console-setup)
- [Part 2: Supabase Dashboard Setup](#part-2-supabase-dashboard-setup)
- [Testing & Verification](#testing--verification)
- [Post-Setup Configuration](#post-setup-configuration)
  - [Restricting by Email Domain](#restricting-by-email-domain)
  - [Assigning User Roles](#assigning-user-roles)
- [Troubleshooting](#troubleshooting)

---

## Part 1: Google Cloud Console Setup

### Step 1 — Go to Google Cloud Console

Open your browser and navigate to:

```
https://console.cloud.google.com
```

Sign in with the Google account that owns or manages your organization's Google Cloud projects.

### Step 2 — Create or Select a Project

1. At the top of the page, click the **project selector dropdown** (next to "Google Cloud").
2. Click **New Project** (or select an existing project if reusing one).
3. Give your project a descriptive name, e.g. `NAVI - Multi-Campus Navigation`.
4. Click **Create**.

> Wait a few seconds for the project to be provisioned, then ensure it is selected in the project dropdown.

### Step 3 — Navigate to Credentials

1. Open the **navigation menu** (☰ hamburger icon, top-left).
2. Go to **APIs & Services** → **Credentials**.
   - If prompted, **Enable** the required APIs first.
3. You should now see the **Credentials** dashboard.

### Step 4 — Configure the OAuth Consent Screen

> If you have not configured the consent screen yet, you'll be prompted to do so before creating credentials.

1. Click **Configure Consent Screen** (or **OAuth consent screen** in the sidebar).
2. Choose **External** (recommended for production) or **Internal** (if all users belong to your Google Workspace).
3. Fill in:
   - **App name:** `NAVI`
   - **User support email:** your email
   - **Developer contact information:** your email
4. Click **Save and Continue** through the remaining sections (Scopes, Test Users). You can skip adding scopes for now — the default `email` and `profile` scopes are sufficient.

### Step 5 — Create OAuth 2.0 Client ID

1. In the **Credentials** tab, click **Create Credentials** → **OAuth 2.0 Client ID**.
2. Set **Application type** to **Web application**.
3. Give it a name, e.g. `NAVI Web Client`.

### Step 6 — Add Authorized Redirect URI

Under **Authorized redirect URIs**, click **Add URI** and enter:

```
https://oltfaepqcktrumfhadzb.supabase.co/auth/v1/callback
```

> ⚠️ **This URI must match exactly.** Supabase uses this endpoint to complete the OAuth exchange.

### Step 7 — Copy Client ID and Client Secret

1. Click **Create**.
2. A dialog will appear showing your **Client ID** and **Client Secret**.
3. **Copy both values immediately** and store them securely (e.g. in a password manager or `.env` file).
   - You will not be able to see the secret again after closing this dialog — though you can create a new one at any time.

| Field | Example |
|-------|---------|
| Client ID | `123456789012-abc123def456.apps.googleusercontent.com` |
| Client Secret | `GOCSPX-xxxxxxxxxxxxxxxxxxxx` |

---

## Part 2: Supabase Dashboard Setup

### Step 1 — Go to Supabase Dashboard

Navigate to your project in the Supabase dashboard:

```
https://supabase.com/dashboard/project/oltfaepqcktrumfhadzb
```

### Step 2 — Open Authentication Settings

1. In the left sidebar, click **Authentication**.
2. Click the **Providers** tab (or **Settings** → **Providers**, depending on dashboard version).

### Step 3 — Enable Google Provider

1. Find the **Google** card in the provider list.
2. Toggle the **Enabled** switch to **ON**.

### Step 4 — Enter OAuth Credentials

Two fields will appear:

| Field | Value |
|-------|-------|
| **Client ID** | Paste your Google OAuth Client ID |
| **Client Secret** | Paste your Google OAuth Client Secret |

### Step 5 — Save

Click **Save**. The Google provider is now active.

### Step 6 — (Optional) Add Test Authorized Domains

If you need to test from `localhost` or a custom development domain:

1. Scroll down to **Additional Settings** (or similar section).
2. Under **Authorized domains**, add:
   - `localhost`
   - Any staging or preview domains (e.g., `your-app.vercel.app`)

---

## Testing & Verification

1. Open your NAVI application in a browser.
2. Navigate to `/admin/login` — you should see a **"Sign in with Google"** button.
3. Click the button and complete the Google OAuth flow.
4. After successful sign-in, the callback route at `/auth/callback` handles the redirect and creates the session.

> **Expected result:** You are redirected back to the app and logged in as a `viewer` role (the default).

---

## Post-Setup Configuration

### Restricting by Email Domain

By default, **any** Google account can sign in. To restrict access to a specific domain (e.g., `asu.edu.ph`):

1. In the Supabase dashboard, go to **Authentication** → **Settings**.
2. Under **General**, find **"Allow only specific email domains"**.
3. Toggle it **ON** and enter the allowed domain(s):
   ```
   asu.edu.ph
   ```
4. Click **Save**.

Now only users with an `@asu.edu.ph` email can sign in.

### Assigning User Roles

User roles are stored in the Supabase Auth `user_metadata` field. By default, all new users get the `"viewer"` role.

To assign a specific role:

1. In the Supabase dashboard, go to **Authentication** → **Users**.
2. Find the target user and click their email/row.
3. Under **User Metadata**, click **Edit** (or the pencil icon).
4. Set the metadata JSON:
   ```json
   {
     "role": "super_admin",
     "campus_id": "asu-ibajay"
   }
   ```
5. Click **Save**.

**Available Roles:**

| Role | Description |
|------|-------------|
| `viewer` | Default — read-only access |
| `admin` | Can manage campus-specific data |
| `super_admin` | Full system access across all campuses |

> 💡 **Tip:** You can also set role metadata programmatically via a Supabase Edge Function or database trigger for automatic role assignment on user creation.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `redirect_uri_mismatch` | Wrong or missing redirect URI in Google Cloud Console | Verify `https://oltfaepqcktrumfhadzb.supabase.co/auth/v1/callback` is exactly as shown |
| Invalid client ID or secret | Credentials entered incorrectly in Supabase | Re-copy both values from Google Cloud Console and re-paste |
| User cannot sign in | Domain restriction blocking the user | Check **Allow only specific email domains** setting in Supabase Auth Settings |
| "Sign in with Google" button not appearing | Google provider not enabled | Confirm Google toggle is **ON** under Supabase Authentication → Providers |

---

## Reference

- [Supabase Auth — Google OAuth Docs](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google Cloud — OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
