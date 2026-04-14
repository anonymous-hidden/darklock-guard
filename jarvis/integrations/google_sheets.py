"""
Nova — Google Sheets Integration
===================================
Read, write, and manipulate Google Sheets via API v4.
Uses OAuth 2.0 credentials from google_auth module.
"""

import re
from typing import Optional

from googleapiclient.discovery import build

from integrations.google_auth import get_credentials


class GoogleSheetsClient:
    """Client for Google Sheets API."""

    def __init__(self):
        self._service = None

    def _svc(self):
        if self._service is None:
            creds = get_credentials()
            self._service = build("sheets", "v4", credentials=creds)
        return self._service

    @staticmethod
    def extract_sheet_id(url_or_id: str) -> str:
        """Extract spreadsheet ID from a URL or return as-is if already an ID."""
        m = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', url_or_id)
        if m:
            return m.group(1)
        if re.match(r'^[a-zA-Z0-9_-]+$', url_or_id):
            return url_or_id
        raise ValueError(f"Cannot extract spreadsheet ID from: {url_or_id}")

    def get_spreadsheet(self, sheet_id_or_url: str) -> dict:
        """Fetch spreadsheet metadata (title, sheets list)."""
        sid = self.extract_sheet_id(sheet_id_or_url)
        svc = self._svc()
        return svc.spreadsheets().get(spreadsheetId=sid).execute()

    def get_info(self, sheet_id_or_url: str) -> dict:
        """Get spreadsheet title and sheet names."""
        data = self.get_spreadsheet(sheet_id_or_url)
        sheets = [s["properties"]["title"] for s in data.get("sheets", [])]
        return {
            "title": data.get("properties", {}).get("title", "Untitled"),
            "spreadsheet_id": data.get("spreadsheetId", ""),
            "sheets": sheets,
            "sheet_count": len(sheets),
        }

    def read_range(self, sheet_id_or_url: str, range_str: str = "A1:Z100") -> list[list]:
        """Read a range of cells. Returns a 2D list of values."""
        sid = self.extract_sheet_id(sheet_id_or_url)
        svc = self._svc()
        result = svc.spreadsheets().values().get(
            spreadsheetId=sid,
            range=range_str,
        ).execute()
        return result.get("values", [])

    def read_sheet(self, sheet_id_or_url: str, sheet_name: str = "Sheet1",
                   max_rows: int = 200) -> dict:
        """Read an entire sheet tab. Returns headers + rows."""
        rows = self.read_range(sheet_id_or_url, f"'{sheet_name}'!A1:Z{max_rows}")
        if not rows:
            return {"headers": [], "rows": [], "row_count": 0}
        headers = rows[0] if rows else []
        data_rows = rows[1:] if len(rows) > 1 else []
        return {
            "headers": headers,
            "rows": data_rows,
            "row_count": len(data_rows),
        }

    def read_cell(self, sheet_id_or_url: str, cell: str,
                  sheet_name: str = "Sheet1") -> str:
        """Read a single cell value."""
        rows = self.read_range(sheet_id_or_url, f"'{sheet_name}'!{cell}")
        if rows and rows[0]:
            return rows[0][0]
        return ""

    def write_range(self, sheet_id_or_url: str, range_str: str,
                    values: list[list]) -> dict:
        """Write values to a range. values is a 2D list."""
        sid = self.extract_sheet_id(sheet_id_or_url)
        svc = self._svc()
        body = {"values": values}
        result = svc.spreadsheets().values().update(
            spreadsheetId=sid,
            range=range_str,
            valueInputOption="USER_ENTERED",
            body=body,
        ).execute()
        return {
            "updated_range": result.get("updatedRange", ""),
            "updated_rows": result.get("updatedRows", 0),
            "updated_cols": result.get("updatedColumns", 0),
            "updated_cells": result.get("updatedCells", 0),
        }

    def write_cell(self, sheet_id_or_url: str, cell: str, value: str,
                   sheet_name: str = "Sheet1") -> dict:
        """Write a single cell value."""
        return self.write_range(sheet_id_or_url, f"'{sheet_name}'!{cell}", [[value]])

    def append_row(self, sheet_id_or_url: str, values: list,
                   sheet_name: str = "Sheet1") -> dict:
        """Append a row to the bottom of a sheet."""
        sid = self.extract_sheet_id(sheet_id_or_url)
        svc = self._svc()
        body = {"values": [values]}
        result = svc.spreadsheets().values().append(
            spreadsheetId=sid,
            range=f"'{sheet_name}'!A:A",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        ).execute()
        return {
            "updated_range": result.get("updates", {}).get("updatedRange", ""),
            "updated_rows": result.get("updates", {}).get("updatedRows", 0),
        }

    def clear_range(self, sheet_id_or_url: str, range_str: str) -> dict:
        """Clear a range of cells."""
        sid = self.extract_sheet_id(sheet_id_or_url)
        svc = self._svc()
        result = svc.spreadsheets().values().clear(
            spreadsheetId=sid,
            range=range_str,
            body={},
        ).execute()
        return {"cleared_range": result.get("clearedRange", "")}

    def format_as_table(self, rows: list[list], headers: list = None) -> str:
        """Format a 2D list as a readable text table."""
        if not rows:
            return "(empty)"
        all_rows = [headers] + rows if headers else rows
        # Calculate column widths
        cols = max(len(r) for r in all_rows)
        widths = [0] * cols
        for row in all_rows:
            for i, cell in enumerate(row):
                widths[i] = max(widths[i], len(str(cell)))

        lines = []
        for j, row in enumerate(all_rows):
            cells = [str(row[i] if i < len(row) else "").ljust(widths[i]) for i in range(cols)]
            lines.append(" | ".join(cells))
            if j == 0 and headers:
                lines.append("-+-".join("-" * w for w in widths))
        return "\n".join(lines)
