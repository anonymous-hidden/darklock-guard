"""GitHub connector — thin wrapper over REST v3 (token-authenticated)."""
from __future__ import annotations
import os
import httpx
from .base import BaseConnector, ConnectorAction, ConnectorResult


class GitHubConnector(BaseConnector):
    name = "github"
    description = "GitHub repos, issues, PRs (token-scoped)."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.token = os.environ.get(self.cfg.get("token_env", "GITHUB_TOKEN"), "")
        self.default_repo = os.environ.get(
            self.cfg.get("default_repo_env", "GITHUB_DEFAULT_REPO"), "")

    def is_configured(self) -> bool:
        return bool(self.token)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"}

    def _register_actions(self) -> None:
        self.register(ConnectorAction("whoami", "Current GitHub user", "read",
                                      handler=self._whoami))
        self.register(ConnectorAction("list_issues", "List repo issues", "read",
                                      handler=self._list_issues))
        self.register(ConnectorAction("get_issue", "Fetch a single issue", "read",
                                      handler=self._get_issue))
        self.register(ConnectorAction("list_prs", "List pull requests", "read",
                                      handler=self._list_prs))
        self.register(ConnectorAction("repo_info", "Repository metadata", "read",
                                      handler=self._repo_info))
        self.register(ConnectorAction("create_issue", "Create an issue", "write",
                                      requires_approval=True,
                                      handler=self._create_issue))
        self.register(ConnectorAction("comment_issue", "Comment on an issue", "write",
                                      requires_approval=True,
                                      handler=self._comment_issue))

    def _repo(self, repo: str | None) -> str:
        return repo or self.default_repo

    def _whoami(self) -> dict:
        r = httpx.get("https://api.github.com/user", headers=self._headers(), timeout=15)
        return {"ok": r.status_code == 200, "status": r.status_code,
                "user": r.json() if r.status_code == 200 else None}

    def _list_issues(self, *, repo: str | None = None, state: str = "open",
                     limit: int = 20) -> dict:
        rp = self._repo(repo)
        if not rp:
            return {"ok": False, "error": "repo not set"}
        r = httpx.get(f"https://api.github.com/repos/{rp}/issues",
                      params={"state": state, "per_page": limit},
                      headers=self._headers(), timeout=15)
        if r.status_code != 200:
            return {"ok": False, "status": r.status_code, "error": r.text[:500]}
        return {"ok": True, "issues": [
            {"number": x["number"], "title": x["title"], "state": x["state"],
             "url": x["html_url"], "user": (x.get("user") or {}).get("login")}
            for x in r.json() if "pull_request" not in x]}

    def _get_issue(self, *, number: int, repo: str | None = None) -> dict:
        rp = self._repo(repo)
        r = httpx.get(f"https://api.github.com/repos/{rp}/issues/{number}",
                      headers=self._headers(), timeout=15)
        return {"ok": r.status_code == 200, "status": r.status_code,
                "issue": r.json() if r.status_code == 200 else None}

    def _list_prs(self, *, repo: str | None = None, state: str = "open",
                  limit: int = 20) -> dict:
        rp = self._repo(repo)
        r = httpx.get(f"https://api.github.com/repos/{rp}/pulls",
                      params={"state": state, "per_page": limit},
                      headers=self._headers(), timeout=15)
        return {"ok": r.status_code == 200,
                "prs": [{"number": x["number"], "title": x["title"],
                         "url": x["html_url"], "state": x["state"]} for x in r.json()]
                if r.status_code == 200 else []}

    def _repo_info(self, *, repo: str | None = None) -> dict:
        rp = self._repo(repo)
        r = httpx.get(f"https://api.github.com/repos/{rp}",
                      headers=self._headers(), timeout=15)
        return {"ok": r.status_code == 200, "repo": r.json() if r.status_code == 200 else None}

    def _create_issue(self, *, title: str, body: str = "",
                      repo: str | None = None, labels: list[str] | None = None) -> dict:
        rp = self._repo(repo)
        r = httpx.post(f"https://api.github.com/repos/{rp}/issues",
                       json={"title": title, "body": body, "labels": labels or []},
                       headers=self._headers(), timeout=20)
        return {"ok": r.status_code in (200, 201), "status": r.status_code,
                "issue": r.json() if r.status_code in (200, 201) else r.text[:500]}

    def _comment_issue(self, *, number: int, body: str,
                       repo: str | None = None) -> dict:
        rp = self._repo(repo)
        r = httpx.post(f"https://api.github.com/repos/{rp}/issues/{number}/comments",
                       json={"body": body}, headers=self._headers(), timeout=20)
        return {"ok": r.status_code in (200, 201), "status": r.status_code}

    def health(self) -> ConnectorResult:
        if not (self.enabled and self.is_configured()):
            return ConnectorResult(False, error="disabled or token missing")
        try:
            r = httpx.get("https://api.github.com/rate_limit",
                          headers=self._headers(), timeout=10)
            return ConnectorResult(r.status_code == 200, data=r.json()
                                   if r.status_code == 200 else {})
        except Exception as e:
            return ConnectorResult(False, error=str(e))
