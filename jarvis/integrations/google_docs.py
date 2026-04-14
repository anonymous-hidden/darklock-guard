"""
Nova — Google Docs Integration
=================================
Read, summarize, and optionally edit Google Docs via API v1.
Uses OAuth 2.0 credentials from google_auth module.
"""

import re
from typing import Optional

from googleapiclient.discovery import build

from integrations.google_auth import get_credentials


class GoogleDocsClient:
    """Client for Google Docs API."""

    def __init__(self):
        self._service = None

    def _svc(self):
        if self._service is None:
            creds = get_credentials()
            self._service = build("docs", "v1", credentials=creds)
        return self._service

    @staticmethod
    def extract_doc_id(url_or_id: str) -> str:
        """Extract document ID from a URL or return as-is if already an ID."""
        # Full URL: https://docs.google.com/document/d/DOC_ID/edit
        m = re.search(r'/document/d/([a-zA-Z0-9_-]+)', url_or_id)
        if m:
            return m.group(1)
        # Already an ID (alphanumeric + dash + underscore)
        if re.match(r'^[a-zA-Z0-9_-]+$', url_or_id):
            return url_or_id
        raise ValueError(f"Cannot extract document ID from: {url_or_id}")

    def get_document(self, doc_id_or_url: str) -> dict:
        """Fetch a document's metadata and content."""
        doc_id = self.extract_doc_id(doc_id_or_url)
        svc = self._svc()
        return svc.documents().get(documentId=doc_id).execute()

    def read_text(self, doc_id_or_url: str, max_chars: int = 10000) -> str:
        """Extract plain text from a Google Doc."""
        doc = self.get_document(doc_id_or_url)
        text = self._extract_text(doc)
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n... (truncated at {max_chars} chars, total: {len(text)})"
        return text

    def get_summary(self, doc_id_or_url: str) -> dict:
        """Get document title, word count, and first ~500 chars preview."""
        doc = self.get_document(doc_id_or_url)
        text = self._extract_text(doc)
        words = len(text.split())
        return {
            "title": doc.get("title", "Untitled"),
            "doc_id": doc.get("documentId", ""),
            "word_count": words,
            "char_count": len(text),
            "preview": text[:500] + ("..." if len(text) > 500 else ""),
        }

    def get_headings(self, doc_id_or_url: str) -> list[str]:
        """Extract all headings from a document."""
        doc = self.get_document(doc_id_or_url)
        headings = []
        for element in doc.get("body", {}).get("content", []):
            para = element.get("paragraph")
            if not para:
                continue
            style = para.get("paragraphStyle", {}).get("namedStyleType", "")
            if style.startswith("HEADING"):
                text = self._para_text(para)
                if text.strip():
                    level = style.replace("HEADING_", "")
                    headings.append(f"H{level}: {text.strip()}")
        return headings

    def append_text(self, doc_id_or_url: str, text: str) -> bool:
        """Append text to the end of a document (requires explicit approval)."""
        doc_id = self.extract_doc_id(doc_id_or_url)
        svc = self._svc()

        # Get document length
        doc = svc.documents().get(documentId=doc_id).execute()
        body_content = doc.get("body", {}).get("content", [])
        end_index = 1
        if body_content:
            last = body_content[-1]
            end_index = last.get("endIndex", 1) - 1

        requests = [{
            "insertText": {
                "location": {"index": end_index},
                "text": text,
            }
        }]
        svc.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()
        return True

    def append_text_streaming(self, doc_id_or_url: str, text: str, chunk_size: int = None) -> None:
        """Insert text word-by-word (or in small chunks) to the end of a document.
        Each chunk is a separate batchUpdate so it appears gradually in the doc.
        `chunk_size` is the number of words per API call (1 = one word at a time)."""
        import time
        import pathlib, yaml as _yaml
        doc_id = self.extract_doc_id(doc_id_or_url)
        svc = self._svc()

        # Read typing speed from config
        delay = 0.08  # default: 80ms per word
        cfg_chunk_size = 1
        try:
            cfg_path = pathlib.Path(__file__).parent.parent / "config.yaml"
            if cfg_path.exists():
                with open(cfg_path) as f:
                    cfg = _yaml.safe_load(f) or {}
                delay = cfg.get("google_docs", {}).get("typing_delay", delay)
                cfg_chunk_size = cfg.get("google_docs", {}).get("chunk_size", cfg_chunk_size)
        except Exception:
            pass

        if chunk_size is None:
            chunk_size = cfg_chunk_size

        # Split into words, preserving newlines as separate tokens
        tokens = []
        for line in text.split("\n"):
            words = line.split()
            for i, w in enumerate(words):
                if i > 0:
                    tokens.append(" " + w)
                else:
                    tokens.append(w)
            tokens.append("\n")
        # Remove trailing empty newline if text didn't end with one
        if tokens and tokens[-1] == "\n" and not text.endswith("\n"):
            tokens.pop()

        # Group tokens into chunks
        chunks = []
        for i in range(0, len(tokens), chunk_size):
            chunk = "".join(tokens[i:i + chunk_size])
            if chunk:
                chunks.append(chunk)

        def _get_end_index():
            doc = svc.documents().get(documentId=doc_id, fields="body.content").execute()
            body_content = doc.get("body", {}).get("content", [])
            if body_content:
                return body_content[-1].get("endIndex", 2) - 1
            return 1

        cursor = _get_end_index()

        for chunk in chunks:
            try:
                svc.documents().batchUpdate(
                    documentId=doc_id,
                    body={"requests": [{"insertText": {"location": {"index": cursor}, "text": chunk}}]},
                ).execute()
            except Exception:
                # Cursor stale (doc edited externally) — re-fetch and retry once
                cursor = _get_end_index()
                svc.documents().batchUpdate(
                    documentId=doc_id,
                    body={"requests": [{"insertText": {"location": {"index": cursor}, "text": chunk}}]},
                ).execute()
            cursor += len(chunk)
            if delay > 0:
                time.sleep(delay)

    def insert_text(self, doc_id_or_url: str, text: str, index: int) -> bool:
        """Insert text at a specific character index in the document."""
        doc_id = self.extract_doc_id(doc_id_or_url)
        svc = self._svc()
        requests = [{
            "insertText": {
                "location": {"index": index},
                "text": text,
            }
        }]
        svc.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()
        return True

    def replace_text(self, doc_id_or_url: str, find: str, replace: str) -> int:
        """Find and replace text in a document. Returns number of replacements."""
        doc_id = self.extract_doc_id(doc_id_or_url)
        svc = self._svc()
        requests = [{
            "replaceAllText": {
                "containsText": {"text": find, "matchCase": True},
                "replaceText": replace,
            }
        }]
        result = svc.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()
        replies = result.get("replies", [{}])
        return replies[0].get("replaceAllText", {}).get("occurrencesChanged", 0)

    # ── Internal helpers ──

    def _extract_text(self, doc: dict) -> str:
        """Extract all plain text from a document structure."""
        parts = []
        for element in doc.get("body", {}).get("content", []):
            para = element.get("paragraph")
            if para:
                text = self._para_text(para)
                parts.append(text)
            table = element.get("table")
            if table:
                for row in table.get("tableRows", []):
                    for cell in row.get("tableCells", []):
                        for cell_element in cell.get("content", []):
                            para = cell_element.get("paragraph")
                            if para:
                                parts.append(self._para_text(para))
        return "\n".join(parts)

    @staticmethod
    def _para_text(para: dict) -> str:
        """Extract text from a paragraph element."""
        texts = []
        for element in para.get("elements", []):
            run = element.get("textRun")
            if run and run.get("content"):
                texts.append(run["content"])
        return "".join(texts)
