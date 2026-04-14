"""
Nova — GitHub Repository Integration
======================================
Fetches public repo info from the GitHub REST API (no auth needed for public repos).
Pulls: description, stars, forks, language, topics, open issues, last updated, README.

Rate limit: 60 requests/hour without auth (plenty for casual lookups).
"""

import httpx

API_BASE = "https://api.github.com"

_HEADERS = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "Nova-AI/2.1",
}


async def lookup_repo(owner: str, repo: str, max_readme_chars: int = 4000) -> str:
    """
    Fetch a GitHub repo's metadata + README and return a formatted summary
    that Nova can read and form opinions on.
    """
    async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
        # 1. Repo metadata
        r = await client.get(f"{API_BASE}/repos/{owner}/{repo}")
        if r.status_code == 404:
            return f"Repository '{owner}/{repo}' not found on GitHub."
        r.raise_for_status()
        data = r.json()

        # 2. Languages breakdown
        lang_resp = await client.get(f"{API_BASE}/repos/{owner}/{repo}/languages")
        languages = list(lang_resp.json().keys()) if lang_resp.status_code == 200 else []

        # 3. README (best-effort)
        readme_text = ""
        readme_resp = await client.get(
            f"{API_BASE}/repos/{owner}/{repo}/readme",
            headers={**_HEADERS, "Accept": "application/vnd.github.v3.raw"},
        )
        if readme_resp.status_code == 200:
            readme_text = readme_resp.text
            if len(readme_text) > max_readme_chars:
                readme_text = readme_text[:max_readme_chars] + "\n… [truncated]"

    # Format metadata
    stars = data.get("stargazers_count", 0)
    forks = data.get("forks_count", 0)
    issues = data.get("open_issues_count", 0)
    topics = data.get("topics", [])
    license_name = (data.get("license") or {}).get("spdx_id", "None")
    archived = data.get("archived", False)
    default_branch = data.get("default_branch", "main")

    parts = [
        f"# GitHub: {data.get('full_name', f'{owner}/{repo}')}",
        f"**Description:** {data.get('description') or 'No description'}",
        f"**Stars:** {stars:,}  |  **Forks:** {forks:,}  |  **Open Issues:** {issues:,}",
        f"**Primary Language:** {data.get('language') or 'Unknown'}",
    ]
    if languages:
        parts.append(f"**All Languages:** {', '.join(languages)}")
    if topics:
        parts.append(f"**Topics:** {', '.join(topics)}")
    parts.append(f"**License:** {license_name}")
    parts.append(f"**Default Branch:** {default_branch}")
    parts.append(f"**Created:** {data.get('created_at', '?')[:10]}  |  **Last Push:** {data.get('pushed_at', '?')[:10]}")
    if archived:
        parts.append("**⚠ This repository is archived (read-only).**")
    parts.append(f"**URL:** https://github.com/{owner}/{repo}")

    if readme_text:
        parts.append(f"\n## README\n{readme_text}")
    else:
        parts.append("\n_No README found._")

    return "\n".join(parts)


def parse_repo_input(text: str) -> tuple[str, str] | None:
    """
    Extract owner/repo from various input formats:
      - "owner/repo"
      - "https://github.com/owner/repo"
      - "github.com/owner/repo"
      - "github.com/owner/repo/tree/main/..."
    Returns (owner, repo) or None if it can't parse.
    """
    import re
    # URL format
    m = re.search(r'github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)', text)
    if m:
        return m.group(1), m.group(2).rstrip("/")
    # owner/repo format
    m = re.search(r'\b([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)\b', text)
    if m:
        return m.group(1), m.group(2)
    return None
