"""
Activity View for FileGuard
===========================
Shows the timeline of all protection events - file changes,
restorations, verifications, and system events.

Design Philosophy:
- Clear chronological timeline
- Easy filtering by file, severity, or date
- Human-readable explanations
"""

from datetime import datetime, timedelta
from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QComboBox, QDateEdit, QLineEdit
)
from PySide6.QtCore import Qt, QDate
from PySide6.QtGui import QFont

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager
from core.audit_log import EventSeverity, EventType


class ActivityItem(QFrame):
    """
    A single activity entry in the timeline.
    """
    
    def __init__(self, entry, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.entry = entry
        self.theme = theme
        
        self.setProperty("class", "card")
        self._setup_ui()
    
    def _setup_ui(self):
        """Set up the item UI."""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(16)
        
        # Severity indicator
        severity_colors = {
            EventSeverity.INFO: '#3b82f6',
            EventSeverity.WARNING: '#f59e0b',
            EventSeverity.ALERT: '#ef4444',
            EventSeverity.CRITICAL: '#dc2626',
        }
        
        indicator = QFrame()
        indicator.setFixedSize(4, 40)
        color = severity_colors.get(self.entry.severity, '#6b7280')
        indicator.setStyleSheet(f"background-color: {color}; border-radius: 2px;")
        layout.addWidget(indicator)
        
        # Icon
        icons = {
            EventType.FILE_PROTECTED: '✅',
            EventType.FILE_UNPROTECTED: '📤',
            EventType.TAMPER_DETECTED: '🚨',
            EventType.FILE_RESTORED: '🔄',
            EventType.FILE_DELETED: '🗑️',
            EventType.FILE_RENAMED: '📝',
            EventType.VERIFICATION_PASSED: '✓',
            EventType.VERIFICATION_FAILED: '✗',
            EventType.SERVICE_STARTED: '▶️',
            EventType.SERVICE_STOPPED: '⏹️',
            EventType.BACKUP_CREATED: '💾',
            EventType.SETTINGS_CHANGED: '⚙️',
        }
        
        icon = icons.get(self.entry.event_type, '•')
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 16))
        layout.addWidget(icon_label)
        
        # Content
        content_layout = QVBoxLayout()
        content_layout.setSpacing(4)
        
        # Explanation
        explanation = QLabel(self.entry.explanation)
        explanation.setFont(QFont("Segoe UI", 11))
        explanation.setWordWrap(True)
        content_layout.addWidget(explanation)
        
        # Details row
        details_layout = QHBoxLayout()
        details_layout.setSpacing(16)
        
        # File path if present
        if self.entry.file_path:
            path = Path(self.entry.file_path)
            file_label = QLabel(f"📁 {path.name}")
            file_label.setProperty("class", "muted")
            file_label.setFont(QFont("Segoe UI", 10))
            details_layout.addWidget(file_label)
        
        # Action taken if present
        if self.entry.action_taken:
            action_label = QLabel(f"→ {self.entry.action_taken}")
            action_label.setProperty("class", "muted")
            action_label.setFont(QFont("Segoe UI", 10))
            details_layout.addWidget(action_label)
        
        details_layout.addStretch()
        content_layout.addLayout(details_layout)
        
        layout.addLayout(content_layout, 1)
        
        # Timestamp
        time_str = self.entry.timestamp.strftime("%H:%M:%S")
        date_str = self.entry.timestamp.strftime("%b %d")
        
        time_layout = QVBoxLayout()
        time_layout.setAlignment(Qt.AlignmentFlag.AlignRight)
        
        time_label = QLabel(time_str)
        time_label.setFont(QFont("Segoe UI", 11))
        time_layout.addWidget(time_label)
        
        date_label = QLabel(date_str)
        date_label.setProperty("class", "muted")
        date_label.setFont(QFont("Segoe UI", 10))
        time_layout.addWidget(date_label)
        
        layout.addLayout(time_layout)


class ActivityView(QWidget):
    """
    Activity timeline view showing all protection events.
    """
    
    def __init__(
        self,
        service: ProtectionService,
        settings: SettingsManager,
        theme: ThemeManager,
        parent=None
    ):
        super().__init__(parent)
        
        self.service = service
        self.settings = settings
        self.theme = theme
        
        self._current_file_filter = None
        
        self._setup_ui()
        self.refresh()
    
    def _setup_ui(self):
        """Set up the view UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("Activity")
        title.setProperty("class", "title")
        title.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        header.addWidget(title)
        
        header.addStretch()
        
        # Export button
        export_btn = QPushButton("Export Log")
        export_btn.clicked.connect(self._on_export)
        header.addWidget(export_btn)
        
        layout.addLayout(header)
        
        # Filters
        filter_layout = QHBoxLayout()
        filter_layout.setSpacing(12)
        
        # Search
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search events...")
        self.search_input.textChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.search_input, 1)
        
        # Severity filter
        self.severity_filter = QComboBox()
        self.severity_filter.addItem("All Severities", None)
        self.severity_filter.addItem("ℹ️ Info", EventSeverity.INFO)
        self.severity_filter.addItem("⚠️ Warning", EventSeverity.WARNING)
        self.severity_filter.addItem("🚨 Alert", EventSeverity.ALERT)
        self.severity_filter.addItem("❌ Critical", EventSeverity.CRITICAL)
        self.severity_filter.currentIndexChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.severity_filter)
        
        # Event type filter
        self.type_filter = QComboBox()
        self.type_filter.addItem("All Events", None)
        self.type_filter.addItem("Protection", "protection")
        self.type_filter.addItem("Tampering", "tamper")
        self.type_filter.addItem("Verification", "verification")
        self.type_filter.addItem("System", "system")
        self.type_filter.currentIndexChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.type_filter)
        
        # Date filter
        filter_layout.addWidget(QLabel("Since:"))
        self.date_filter = QComboBox()
        self.date_filter.addItem("All Time", None)
        self.date_filter.addItem("Today", 1)
        self.date_filter.addItem("Last 7 Days", 7)
        self.date_filter.addItem("Last 30 Days", 30)
        self.date_filter.currentIndexChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.date_filter)
        
        layout.addLayout(filter_layout)
        
        # File filter indicator (shown when viewing file history)
        self.file_filter_bar = QFrame()
        self.file_filter_bar.setProperty("class", "card")
        file_filter_layout = QHBoxLayout(self.file_filter_bar)
        file_filter_layout.setContentsMargins(12, 8, 12, 8)
        
        self.file_filter_label = QLabel("Showing history for: ")
        file_filter_layout.addWidget(self.file_filter_label)
        
        clear_filter_btn = QPushButton("✕ Clear")
        clear_filter_btn.setFixedWidth(80)
        clear_filter_btn.clicked.connect(self._clear_file_filter)
        file_filter_layout.addWidget(clear_filter_btn)
        
        layout.addWidget(self.file_filter_bar)
        self.file_filter_bar.hide()
        
        # Activity list
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        self.list_container = QWidget()
        self.list_layout = QVBoxLayout(self.list_container)
        self.list_layout.setContentsMargins(0, 0, 0, 0)
        self.list_layout.setSpacing(8)
        self.list_layout.addStretch()
        
        scroll.setWidget(self.list_container)
        layout.addWidget(scroll, 1)
        
        # Empty state
        self.empty_state = QLabel("No activity recorded yet")
        self.empty_state.setProperty("class", "muted")
        self.empty_state.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_state.setFont(QFont("Segoe UI", 14))
        layout.addWidget(self.empty_state)
        self.empty_state.hide()
    
    def refresh(self):
        """Refresh the activity list."""
        self._load_entries()
    
    def show_file_history(self, file_path: str):
        """Show history for a specific file."""
        self._current_file_filter = file_path
        self.file_filter_label.setText(f"Showing history for: {Path(file_path).name}")
        self.file_filter_bar.show()
        self._load_entries()
    
    def _clear_file_filter(self):
        """Clear the file filter."""
        self._current_file_filter = None
        self.file_filter_bar.hide()
        self._load_entries()
    
    def _on_filter_changed(self):
        """Handle filter change."""
        self._load_entries()
    
    def _load_entries(self):
        """Load and display activity entries."""
        # Clear existing items
        for i in reversed(range(self.list_layout.count() - 1)):
            item = self.list_layout.itemAt(i)
            if item.widget():
                item.widget().deleteLater()
        
        # Get filter values
        search_text = self.search_input.text().lower()
        severity = self.severity_filter.currentData()
        type_category = self.type_filter.currentData()
        days = self.date_filter.currentData()
        
        # Calculate date filter
        since = None
        if days:
            since = datetime.now() - timedelta(days=days)
        
        # Get entries
        entries = self.service.get_activity_history(limit=200)
        
        # Apply filters
        filtered = []
        for entry in entries:
            # File filter
            if self._current_file_filter:
                if entry.file_path != self._current_file_filter:
                    continue
            
            # Search filter
            if search_text:
                if search_text not in entry.explanation.lower():
                    if entry.file_path and search_text not in entry.file_path.lower():
                        continue
            
            # Severity filter
            if severity and entry.severity != severity:
                continue
            
            # Type category filter
            if type_category:
                protection_types = [EventType.FILE_PROTECTED, EventType.FILE_UNPROTECTED, 
                                   EventType.PROTECTION_MODE_CHANGED]
                tamper_types = [EventType.TAMPER_DETECTED, EventType.FILE_DELETED,
                               EventType.FILE_RENAMED, EventType.PERMISSIONS_CHANGED]
                verify_types = [EventType.VERIFICATION_PASSED, EventType.VERIFICATION_FAILED,
                               EventType.FILE_RESTORED]
                system_types = [EventType.SERVICE_STARTED, EventType.SERVICE_STOPPED,
                               EventType.SETTINGS_CHANGED, EventType.BACKUP_CREATED]
                
                if type_category == 'protection' and entry.event_type not in protection_types:
                    continue
                if type_category == 'tamper' and entry.event_type not in tamper_types:
                    continue
                if type_category == 'verification' and entry.event_type not in verify_types:
                    continue
                if type_category == 'system' and entry.event_type not in system_types:
                    continue
            
            # Date filter
            if since and entry.timestamp < since:
                continue
            
            filtered.append(entry)
        
        # Display entries
        if filtered:
            self.empty_state.hide()
            self.list_container.show()
            
            # Group by date
            current_date = None
            for entry in filtered:
                entry_date = entry.timestamp.date()
                
                if entry_date != current_date:
                    # Add date header
                    current_date = entry_date
                    if entry_date == datetime.now().date():
                        date_text = "Today"
                    elif entry_date == (datetime.now() - timedelta(days=1)).date():
                        date_text = "Yesterday"
                    else:
                        date_text = entry_date.strftime("%B %d, %Y")
                    
                    header = QLabel(date_text)
                    header.setFont(QFont("Segoe UI", 11, QFont.Weight.DemiBold))
                    header.setProperty("class", "muted")
                    header.setContentsMargins(0, 8, 0, 4)
                    self.list_layout.insertWidget(self.list_layout.count() - 1, header)
                
                item = ActivityItem(entry, self.theme)
                self.list_layout.insertWidget(self.list_layout.count() - 1, item)
        else:
            self.empty_state.show()
            self.list_container.hide()
    
    def _on_export(self):
        """Export the audit log."""
        from PySide6.QtWidgets import QFileDialog, QMessageBox
        
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Audit Log",
            "fileguard_audit_log.txt",
            "Text Files (*.txt)"
        )
        
        if file_path:
            if self.service.audit.export_human_readable(Path(file_path)):
                QMessageBox.information(
                    self,
                    "Export Complete",
                    f"Audit log exported to {file_path}"
                )
            else:
                QMessageBox.warning(
                    self,
                    "Export Failed",
                    "Failed to export the audit log."
                )
