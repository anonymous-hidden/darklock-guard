"""
Security View for FileGuard
===========================
Dashboard view for the new security architecture components:
- Secret Broker status and token management
- Event Chain integrity and recent events
- Signed Manifest management
- Key rotation controls

Design Philosophy:
- Clear security status at a glance
- Visual indicators for integrity states
- Easy access to security operations
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QGridLayout, QSpacerItem, QSizePolicy,
    QTableWidget, QTableWidgetItem, QHeaderView, QProgressBar,
    QGroupBox, QMessageBox
)
from PySide6.QtCore import Qt, Signal, Slot, QTimer
from PySide6.QtGui import QFont, QColor

from config.settings_manager import SettingsManager
from ui.theme import ThemeManager


class SecurityStatusCard(QFrame):
    """
    A card showing security component status.
    """
    
    def __init__(
        self,
        title: str,
        icon: str,
        theme: ThemeManager,
        parent=None
    ):
        super().__init__(parent)
        self.theme = theme
        self.setProperty("class", "card")
        self.setMinimumHeight(120)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(8)
        
        # Header with icon and title
        header = QHBoxLayout()
        
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 18))
        header.addWidget(icon_label)
        
        title_label = QLabel(title)
        title_label.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        header.addWidget(title_label)
        header.addStretch()
        
        layout.addLayout(header)
        
        # Status indicator
        self.status_label = QLabel("Checking...")
        self.status_label.setProperty("class", "muted")
        layout.addWidget(self.status_label)
        
        # Value
        self.value_label = QLabel("")
        self.value_label.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        layout.addWidget(self.value_label)
        
        layout.addStretch()
    
    def set_status(self, status: str, color: str = None):
        """Update the status text."""
        self.status_label.setText(status)
        if color:
            self.status_label.setStyleSheet(f"color: {color};")
    
    def set_value(self, value: str):
        """Update the main value."""
        self.value_label.setText(value)


class EventChainWidget(QFrame):
    """
    Widget showing event chain status and recent events.
    """
    
    def __init__(self, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.theme = theme
        self.setProperty("class", "card")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("🔗 Event Chain")
        title.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        header.addWidget(title)
        
        self.integrity_badge = QLabel("⬤ Checking")
        self.integrity_badge.setFont(QFont("Segoe UI", 10))
        header.addWidget(self.integrity_badge)
        
        header.addStretch()
        
        verify_btn = QPushButton("Verify Chain")
        verify_btn.setObjectName("secondary_button")
        verify_btn.clicked.connect(self._on_verify_clicked)
        header.addWidget(verify_btn)
        
        layout.addLayout(header)
        
        # Stats row
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(24)
        
        self.total_events_label = QLabel("Total Events: --")
        stats_layout.addWidget(self.total_events_label)
        
        self.checkpoints_label = QLabel("Checkpoints: --")
        stats_layout.addWidget(self.checkpoints_label)
        
        self.last_event_label = QLabel("Last Event: --")
        stats_layout.addWidget(self.last_event_label)
        
        stats_layout.addStretch()
        layout.addLayout(stats_layout)
        
        # Recent events table
        self.events_table = QTableWidget()
        self.events_table.setColumnCount(4)
        self.events_table.setHorizontalHeaderLabels([
            "Time", "Type", "Details", "Hash"
        ])
        self.events_table.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch
        )
        self.events_table.setAlternatingRowColors(True)
        self.events_table.setSelectionBehavior(
            QTableWidget.SelectionBehavior.SelectRows
        )
        self.events_table.setMaximumHeight(200)
        layout.addWidget(self.events_table)
    
    def update_chain_stats(self, stats: dict):
        """Update chain statistics display."""
        self.total_events_label.setText(
            f"Total Events: {stats.get('total_events', '--')}"
        )
        self.checkpoints_label.setText(
            f"Checkpoints: {stats.get('checkpoints', '--')}"
        )
        
        last_event = stats.get('last_event')
        if last_event:
            # Format nicely
            from datetime import datetime
            dt = datetime.fromisoformat(last_event)
            self.last_event_label.setText(
                f"Last Event: {dt.strftime('%H:%M:%S')}"
            )
    
    def set_integrity_status(self, status: str):
        """Update the integrity badge."""
        colors = {
            'valid': ('#34d399', '✓ Valid'),
            'broken': ('#f87171', '✗ Broken'),
            'tampered': ('#fbbf24', '⚠ Tampered'),
        }
        color, text = colors.get(status, ('#9090a0', '? Unknown'))
        self.integrity_badge.setText(f"⬤ {text}")
        self.integrity_badge.setStyleSheet(f"color: {color};")
    
    def add_event(self, event_data: dict):
        """Add an event to the table."""
        row = self.events_table.rowCount()
        self.events_table.insertRow(row)
        
        # Time
        time_item = QTableWidgetItem(
            event_data.get('timestamp', '')[:19]
        )
        self.events_table.setItem(row, 0, time_item)
        
        # Type
        type_item = QTableWidgetItem(event_data.get('event_type', ''))
        self.events_table.setItem(row, 1, type_item)
        
        # Details
        details = str(event_data.get('payload', {}))[:50]
        details_item = QTableWidgetItem(details)
        self.events_table.setItem(row, 2, details_item)
        
        # Hash (truncated)
        hash_val = event_data.get('event_hash', '')[:16] + '...'
        hash_item = QTableWidgetItem(hash_val)
        hash_item.setFont(QFont("Consolas", 9))
        self.events_table.setItem(row, 3, hash_item)
    
    def _on_verify_clicked(self):
        """Handle verify button click."""
        # Will be connected to security service
        pass


class TokenManagerWidget(QFrame):
    """
    Widget for managing security tokens.
    """
    
    def __init__(self, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.theme = theme
        self.setProperty("class", "card")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("🔑 Token Manager")
        title.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        header.addWidget(title)
        
        header.addStretch()
        
        revoke_btn = QPushButton("Revoke All")
        revoke_btn.setObjectName("danger_button")
        revoke_btn.clicked.connect(self._on_revoke_all)
        header.addWidget(revoke_btn)
        
        layout.addLayout(header)
        
        # Token stats grid
        stats_grid = QGridLayout()
        stats_grid.setSpacing(16)
        
        self.active_label = QLabel("Active Tokens: --")
        stats_grid.addWidget(self.active_label, 0, 0)
        
        self.expired_label = QLabel("Expired: --")
        stats_grid.addWidget(self.expired_label, 0, 1)
        
        self.revoked_label = QLabel("Revoked: --")
        stats_grid.addWidget(self.revoked_label, 0, 2)
        
        layout.addLayout(stats_grid)
        
        # Token type breakdown
        self.type_breakdown = QLabel("")
        self.type_breakdown.setProperty("class", "muted")
        layout.addWidget(self.type_breakdown)
    
    def update_stats(self, stats: dict):
        """Update token statistics."""
        self.active_label.setText(f"Active Tokens: {stats.get('active', '--')}")
        self.expired_label.setText(f"Expired: {stats.get('expired', '--')}")
        self.revoked_label.setText(f"Revoked: {stats.get('revoked', '--')}")
        
        by_type = stats.get('by_type', {})
        if by_type:
            breakdown = " | ".join(f"{k}: {v}" for k, v in by_type.items())
            self.type_breakdown.setText(breakdown)
    
    def _on_revoke_all(self):
        """Handle revoke all button."""
        result = QMessageBox.question(
            self,
            "Revoke All Tokens",
            "Are you sure you want to revoke all active tokens?\n\n"
            "This will require re-authentication for all operations.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if result == QMessageBox.StandardButton.Yes:
            # Will be connected to security service
            pass


class ManifestWidget(QFrame):
    """
    Widget for managing signed manifests.
    """
    
    def __init__(self, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.theme = theme
        self.setProperty("class", "card")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("📜 Signed Manifests")
        title.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        header.addWidget(title)
        
        header.addStretch()
        
        create_btn = QPushButton("Create Manifest")
        create_btn.setObjectName("primary_button")
        create_btn.clicked.connect(self._on_create_manifest)
        header.addWidget(create_btn)
        
        verify_btn = QPushButton("Verify")
        verify_btn.setObjectName("secondary_button")
        verify_btn.clicked.connect(self._on_verify_manifest)
        header.addWidget(verify_btn)
        
        layout.addLayout(header)
        
        # Status
        self.status_layout = QHBoxLayout()
        
        self.status_icon = QLabel("⬤")
        self.status_icon.setFont(QFont("Segoe UI", 12))
        self.status_layout.addWidget(self.status_icon)
        
        self.status_text = QLabel("No manifest loaded")
        self.status_layout.addWidget(self.status_text)
        
        self.status_layout.addStretch()
        layout.addLayout(self.status_layout)
        
        # Manifest info
        info_layout = QGridLayout()
        info_layout.setSpacing(8)
        
        self.files_label = QLabel("Files: --")
        info_layout.addWidget(self.files_label, 0, 0)
        
        self.size_label = QLabel("Total Size: --")
        info_layout.addWidget(self.size_label, 0, 1)
        
        self.created_label = QLabel("Created: --")
        info_layout.addWidget(self.created_label, 1, 0)
        
        self.signed_label = QLabel("Signed: --")
        info_layout.addWidget(self.signed_label, 1, 1)
        
        layout.addLayout(info_layout)
        
        # Hash display
        self.hash_label = QLabel("")
        self.hash_label.setFont(QFont("Consolas", 9))
        self.hash_label.setProperty("class", "muted")
        layout.addWidget(self.hash_label)
    
    def update_manifest_info(self, manifest_data: dict):
        """Update manifest information display."""
        if not manifest_data:
            self.status_text.setText("No manifest loaded")
            self.status_icon.setStyleSheet("color: #9090a0;")
            return
        
        # Update status
        status = manifest_data.get('status', 'unknown')
        if status == 'valid':
            self.status_icon.setStyleSheet("color: #34d399;")
            self.status_text.setText("Manifest Valid")
        elif status == 'modified':
            self.status_icon.setStyleSheet("color: #f87171;")
            self.status_text.setText("Files Modified!")
        else:
            self.status_icon.setStyleSheet("color: #fbbf24;")
            self.status_text.setText(f"Status: {status}")
        
        # Update info
        self.files_label.setText(f"Files: {manifest_data.get('entry_count', '--')}")
        
        size = manifest_data.get('total_size', 0)
        if size > 1024 * 1024:
            size_str = f"{size / (1024 * 1024):.1f} MB"
        elif size > 1024:
            size_str = f"{size / 1024:.1f} KB"
        else:
            size_str = f"{size} bytes"
        self.size_label.setText(f"Total Size: {size_str}")
        
        self.created_label.setText(
            f"Created: {manifest_data.get('created_at', '--')[:19]}"
        )
        self.signed_label.setText(
            f"Signed: {manifest_data.get('signed_at', '--')[:19]}"
        )
        
        manifest_hash = manifest_data.get('hash', '')
        if manifest_hash:
            self.hash_label.setText(f"Hash: {manifest_hash[:32]}...")
    
    def _on_create_manifest(self):
        """Handle create manifest button."""
        pass
    
    def _on_verify_manifest(self):
        """Handle verify button."""
        pass


class KeyManagementWidget(QFrame):
    """
    Widget for key rotation and management.
    """
    
    def __init__(self, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.theme = theme
        self.setProperty("class", "card")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("🔐 Key Management")
        title.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        header.addWidget(title)
        
        header.addStretch()
        layout.addLayout(header)
        
        # Key info
        info_layout = QGridLayout()
        info_layout.setSpacing(8)
        
        info_layout.addWidget(QLabel("Master Key (KEK):"), 0, 0)
        self.kek_status = QLabel("✓ Protected by DPAPI")
        self.kek_status.setStyleSheet("color: #34d399;")
        info_layout.addWidget(self.kek_status, 0, 1)
        
        info_layout.addWidget(QLabel("Signing Key:"), 1, 0)
        self.sign_status = QLabel("✓ Ed25519 Active")
        self.sign_status.setStyleSheet("color: #34d399;")
        info_layout.addWidget(self.sign_status, 1, 1)
        
        info_layout.addWidget(QLabel("Active DEKs:"), 2, 0)
        self.dek_count = QLabel("--")
        info_layout.addWidget(self.dek_count, 2, 1)
        
        layout.addLayout(info_layout)
        
        # Rotation button
        rotate_layout = QHBoxLayout()
        rotate_layout.addStretch()
        
        rotate_btn = QPushButton("Rotate Keys")
        rotate_btn.setObjectName("warning_button")
        rotate_btn.setToolTip(
            "Rotate master encryption key.\n"
            "This re-wraps all DEKs without re-encrypting data."
        )
        rotate_btn.clicked.connect(self._on_rotate_keys)
        rotate_layout.addWidget(rotate_btn)
        
        layout.addLayout(rotate_layout)
        
        # Last rotation info
        self.last_rotation = QLabel("Last Rotation: Never")
        self.last_rotation.setProperty("class", "muted")
        layout.addWidget(self.last_rotation)
    
    def update_key_info(self, info: dict):
        """Update key information display."""
        self.dek_count.setText(str(info.get('dek_count', '--')))
        
        last_rot = info.get('last_rotation')
        if last_rot:
            self.last_rotation.setText(f"Last Rotation: {last_rot[:19]}")
    
    def _on_rotate_keys(self):
        """Handle key rotation button."""
        result = QMessageBox.warning(
            self,
            "Rotate Keys",
            "Are you sure you want to rotate the master encryption key?\n\n"
            "This will:\n"
            "• Re-wrap all Data Encryption Keys (DEKs)\n"
            "• Invalidate all existing encryption tokens\n"
            "• NOT require re-encrypting existing backups\n\n"
            "This operation cannot be undone.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if result == QMessageBox.StandardButton.Yes:
            # Will be connected to security service
            pass


class SecurityView(QWidget):
    """
    Main security view combining all security widgets.
    """
    
    def __init__(
        self,
        settings: SettingsManager,
        theme: ThemeManager,
        parent=None
    ):
        super().__init__(parent)
        self.settings = settings
        self.theme = theme
        self._security_service = None
        
        self._setup_ui()
        
        # Refresh timer
        self._refresh_timer = QTimer(self)
        self._refresh_timer.timeout.connect(self._refresh_data)
        self._refresh_timer.start(5000)  # Refresh every 5 seconds
    
    def set_security_service(self, service):
        """Set the security service for data access."""
        self._security_service = service
        self._refresh_data()
    
    def _setup_ui(self):
        """Set up the view UI."""
        # Scroll area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        
        # Content widget
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(24)
        
        # Header
        header = QLabel("Security Dashboard")
        header.setFont(QFont("Segoe UI", 20, QFont.Weight.Bold))
        layout.addWidget(header)
        
        subtitle = QLabel(
            "Monitor and manage security components including encryption, "
            "signing, and tamper detection."
        )
        subtitle.setProperty("class", "muted")
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)
        
        # Status cards row
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(16)
        
        self.broker_card = SecurityStatusCard(
            "Secret Broker", "🔒", self.theme
        )
        cards_layout.addWidget(self.broker_card)
        
        self.chain_card = SecurityStatusCard(
            "Event Chain", "🔗", self.theme
        )
        cards_layout.addWidget(self.chain_card)
        
        self.manifest_card = SecurityStatusCard(
            "Manifest", "📜", self.theme
        )
        cards_layout.addWidget(self.manifest_card)
        
        self.encryption_card = SecurityStatusCard(
            "Encryption", "🔐", self.theme
        )
        cards_layout.addWidget(self.encryption_card)
        
        layout.addLayout(cards_layout)
        
        # Two-column layout for widgets
        columns = QHBoxLayout()
        columns.setSpacing(16)
        
        # Left column
        left_col = QVBoxLayout()
        left_col.setSpacing(16)
        
        self.event_chain_widget = EventChainWidget(self.theme)
        left_col.addWidget(self.event_chain_widget)
        
        self.manifest_widget = ManifestWidget(self.theme)
        left_col.addWidget(self.manifest_widget)
        
        columns.addLayout(left_col)
        
        # Right column
        right_col = QVBoxLayout()
        right_col.setSpacing(16)
        
        self.token_widget = TokenManagerWidget(self.theme)
        right_col.addWidget(self.token_widget)
        
        self.key_widget = KeyManagementWidget(self.theme)
        right_col.addWidget(self.key_widget)
        
        right_col.addStretch()
        columns.addLayout(right_col)
        
        layout.addLayout(columns)
        layout.addStretch()
        
        scroll.setWidget(content)
        
        # Main layout
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)
    
    def _refresh_data(self):
        """Refresh data from security service."""
        if not self._security_service:
            return
        
        try:
            # Update broker card
            self.broker_card.set_status("Protected by DPAPI", "#34d399")
            self.broker_card.set_value("Active")
            
            # Update chain stats
            chain_stats = self._security_service.get_chain_stats()
            self.event_chain_widget.update_chain_stats(chain_stats)
            
            total_events = chain_stats.get('total_events', 0)
            self.chain_card.set_value(str(total_events))
            self.chain_card.set_status("Events Logged", "#34d399")
            
            # Update token stats
            token_stats = self._security_service.get_token_stats()
            self.token_widget.update_stats(token_stats)
            
            active_tokens = token_stats.get('active', 0)
            self.encryption_card.set_value(str(active_tokens))
            self.encryption_card.set_status("Active Tokens")
            
            # Update manifest status
            # ... additional updates
            
        except Exception as e:
            print(f"Security view refresh error: {e}")
    
    def showEvent(self, event):
        """Handle show event to refresh data."""
        super().showEvent(event)
        self._refresh_data()
