"""
Nova — Google OAuth 2.0 Authentication
=========================================
Handles OAuth 2.0 flow for Google APIs (Calendar, Docs).
Stores tokens securely in the data directory.

Setup:
  1. Go to https://console.cloud.google.com
  2. Create a new project (or select existing)
  3. Enable: Google Calendar API, Google Docs API
  4. Go to Credentials → Create OAuth 2.0 Client ID (Desktop app)
  5. Download the JSON → save as jarvis/data/google_credentials.json
  6. Run: python -m integrations.google_auth   (first-time auth)
"""

import json
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request as GoogleAuthRequest

# Scopes needed for Calendar + Docs
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
]

_DATA_DIR = Path(__file__).parent.parent / "data"
_CREDS_FILE = _DATA_DIR / "google_credentials.json"
_TOKEN_FILE = _DATA_DIR / "google_token.json"


def get_credentials() -> Credentials:
    """Load or refresh Google OAuth credentials.

    Returns valid Credentials or raises RuntimeError if setup incomplete.
    """
    creds = None

    # Load existing token
    if _TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(_TOKEN_FILE), SCOPES)

    # Refresh if expired
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleAuthRequest())
            _save_token(creds)
            return creds
        except Exception:
            # Token refresh failed — need re-auth
            creds = None

    if creds and creds.valid:
        return creds

    # Need new auth
    if not _CREDS_FILE.exists():
        raise RuntimeError(
            "Google credentials not found. "
            "Download OAuth 2.0 Client ID JSON from Google Cloud Console "
            "and save it as jarvis/data/google_credentials.json"
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(_CREDS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)
    _save_token(creds)
    return creds


def _save_token(creds: Credentials):
    """Persist token to disk (refresh token survives restarts)."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _TOKEN_FILE.write_text(creds.to_json())


def is_configured() -> bool:
    """Check if Google auth is set up (credentials file exists)."""
    return _CREDS_FILE.exists()


def is_authenticated() -> bool:
    """Check if we have a valid (or refreshable) token."""
    if not _TOKEN_FILE.exists():
        return False
    try:
        creds = Credentials.from_authorized_user_file(str(_TOKEN_FILE), SCOPES)
        if creds.valid:
            return True
        if creds.expired and creds.refresh_token:
            creds.refresh(GoogleAuthRequest())
            _save_token(creds)
            return True
    except Exception:
        pass
    return False


# ── CLI entry point for first-time auth ──

if __name__ == "__main__":
    print("Nova — Google OAuth 2.0 Setup")
    print("=" * 40)
    if not _CREDS_FILE.exists():
        print(f"\n❌ Credentials file not found at:\n   {_CREDS_FILE}")
        print("\nSteps:")
        print("  1. Go to https://console.cloud.google.com")
        print("  2. Create a project → Enable Calendar API + Docs API")
        print("  3. Credentials → Create OAuth Client ID (Desktop app)")
        print("  4. Download JSON → save as:")
        print(f"     {_CREDS_FILE}")
        print("\nThen run this script again.")
    else:
        print("\n✅ Credentials file found. Starting OAuth flow...")
        print("   A browser window will open for Google sign-in.\n")
        creds = get_credentials()
        print(f"\n✅ Authenticated! Token saved to:\n   {_TOKEN_FILE}")
        print("   Nova can now access your Google Calendar and Docs.")
