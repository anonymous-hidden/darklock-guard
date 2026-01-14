"""
Protected Files View for FileGuard
==================================
Displays all protected files and folders with management capabilities.
Users can view, modify protection settings, and remove protection.

Design Philosophy:
- Clear list of all protected items
- Easy access to per-item actions
- Visual indicators for protection mode
"""

from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame, QScrollArea, QListWidget, QListWidgetItem, QMenu,
    QMessageBox, QFileDialog, QComboBox, QDialog, QDialogButtonBox,
    QFormLayout, QLineEdit
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont, QAction

from config.settings_manager import SettingsManager
from service import ProtectionService
from ui.theme import ThemeManager
from core.policy import ProtectionMode


class FileListItem(QFrame):
    """
    A single protected file/folder item in the list.
    """
    
    action_requested = Signal(str, str)  # (path, action)
    
    def __init__(self, item_data, theme: ThemeManager, parent=None):
        super().__init__(parent)
        self.item_data = item_data
        self.theme = theme
        
        self.setProperty("class", "card")
        self.setMinimumHeight(70)
        
        self._setup_ui()
    
    def _setup_ui(self):
        """Set up the item UI."""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(16)
        
        # Icon
        icon = "📁" if self.item_data.item_type == 'folder' else "📄"
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 20))
        layout.addWidget(icon_label)
        
        # File info
        info_layout = QVBoxLayout()
        info_layout.setSpacing(2)
        
        # File name
        path = Path(self.item_data.path)
        name_label = QLabel(path.name)
        name_label.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        info_layout.addWidget(name_label)
        
        # Path (truncated)
        path_str = str(path.parent)
        if len(path_str) > 50:
            path_str = "..." + path_str[-47:]
        path_label = QLabel(path_str)
        path_label.setProperty("class", "muted")
        path_label.setFont(QFont("Segoe UI", 10))
        info_layout.addWidget(path_label)
        
        layout.addLayout(info_layout, 1)
        
        # Protection mode badge
        mode_colors = {
            'detect_only': ('#6b7280', 'Monitor'),
            'detect_alert': ('#f59e0b', 'Alert'),
            'detect_restore': ('#22c55e', 'Restore'),
            'sealed': ('#ef4444', 'Sealed'),
        }
        
        mode = self.item_data.protection_mode.value
        color, label = mode_colors.get(mode, ('#6b7280', 'Unknown'))
        
        mode_badge = QLabel(label)
        mode_badge.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        mode_badge.setStyleSheet(f"""
            QLabel {{
                background-color: {color};
                color: white;
                padding: 4px 12px;
                border-radius: 12px;
            }}
        """)
        layout.addWidget(mode_badge)
        
        # Lock indicator for sealed mode
        if self.item_data.is_locked:
            lock_label = QLabel("🔒")
            lock_label.setFont(QFont("Segoe UI Emoji", 14))
            layout.addWidget(lock_label)
        
        # Actions button
        actions_btn = QPushButton("⋮")
        actions_btn.setFixedSize(32, 32)
        actions_btn.setFont(QFont("Segoe UI", 14))
        actions_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        actions_btn.clicked.connect(self._show_actions_menu)
        layout.addWidget(actions_btn)
    
    def _show_actions_menu(self):
        """Show the actions context menu."""
        menu = QMenu(self)
        
        # View history
        history_action = QAction("View History", self)
        history_action.triggered.connect(
            lambda: self.action_requested.emit(self.item_data.path, 'history')
        )
        menu.addAction(history_action)
        
        # Change mode
        mode_menu = menu.addMenu("Change Mode")
        
        for mode in ProtectionMode:
            action = QAction(mode.description[:30], self)
            action.triggered.connect(
                lambda checked, m=mode: self.action_requested.emit(
                    self.item_data.path, f'mode:{m.value}'
                )
            )
            if mode.value == self.item_data.protection_mode.value:
                action.setCheckable(True)
                action.setChecked(True)
            mode_menu.addAction(action)
        
        menu.addSeparator()
        
        # Lock/Unlock (for seal mode)
        if self.item_data.protection_mode.value == 'sealed':
            if self.item_data.is_locked:
                unlock_action = QAction("🔓 Unlock", self)
                unlock_action.triggered.connect(
                    lambda: self.action_requested.emit(self.item_data.path, 'unlock')
                )
                menu.addAction(unlock_action)
            else:
                lock_action = QAction("🔒 Lock", self)
                lock_action.triggered.connect(
                    lambda: self.action_requested.emit(self.item_data.path, 'lock')
                )
                menu.addAction(lock_action)
        
        # Update baseline
        update_action = QAction("Update Baseline", self)
        update_action.triggered.connect(
            lambda: self.action_requested.emit(self.item_data.path, 'update')
        )
        menu.addAction(update_action)
        
        menu.addSeparator()
        
        # Remove protection
        remove_action = QAction("Remove Protection", self)
        remove_action.triggered.connect(
            lambda: self.action_requested.emit(self.item_data.path, 'remove')
        )
        menu.addAction(remove_action)
        
        # Show menu at button position
        sender = self.sender()
        menu.exec(sender.mapToGlobal(sender.rect().bottomLeft()))


class ProtectedFilesView(QWidget):
    """
    View displaying all protected files and folders.
    """
    
    file_selected = Signal(str)  # Emits file path
    
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
        
        self._setup_ui()
        self.refresh()
    
    def _setup_ui(self):
        """Set up the view UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(24)
        
        # Header
        header = QHBoxLayout()
        
        title = QLabel("Protected Files")
        title.setProperty("class", "title")
        title.setFont(QFont("Segoe UI", 24, QFont.Weight.Bold))
        header.addWidget(title)
        
        header.addStretch()
        
        # Add buttons
        add_file_btn = QPushButton("+ Add File")
        add_file_btn.setProperty("class", "primary")
        add_file_btn.clicked.connect(self._on_add_file)
        header.addWidget(add_file_btn)
        
        add_folder_btn = QPushButton("+ Add Folder")
        add_folder_btn.clicked.connect(self._on_add_folder)
        header.addWidget(add_folder_btn)
        
        layout.addLayout(header)
        
        # Filter bar
        filter_layout = QHBoxLayout()
        
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search files...")
        self.search_input.textChanged.connect(self._on_search)
        filter_layout.addWidget(self.search_input, 1)
        
        self.filter_combo = QComboBox()
        self.filter_combo.addItem("All Files", None)
        self.filter_combo.addItem("Files Only", "file")
        self.filter_combo.addItem("Folders Only", "folder")
        self.filter_combo.currentIndexChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.filter_combo)
        
        self.mode_filter = QComboBox()
        self.mode_filter.addItem("All Modes", None)
        for mode in ProtectionMode:
            self.mode_filter.addItem(mode.value.replace('_', ' ').title(), mode.value)
        self.mode_filter.currentIndexChanged.connect(self._on_filter_changed)
        filter_layout.addWidget(self.mode_filter)
        
        layout.addLayout(filter_layout)
        
        # File list
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
        self.empty_state = QFrame()
        empty_layout = QVBoxLayout(self.empty_state)
        empty_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        empty_icon = QLabel("📁")
        empty_icon.setFont(QFont("Segoe UI Emoji", 48))
        empty_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(empty_icon)
        
        empty_text = QLabel("No protected files yet")
        empty_text.setFont(QFont("Segoe UI", 16, QFont.Weight.DemiBold))
        empty_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(empty_text)
        
        empty_desc = QLabel("Click 'Add File' or 'Add Folder' to start protecting your files")
        empty_desc.setProperty("class", "muted")
        empty_desc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(empty_desc)
        
        layout.addWidget(self.empty_state)
        self.empty_state.hide()
    
    def refresh(self):
        """Refresh the file list."""
        self._load_items()
    
    def _load_items(self):
        """Load and display protected items."""
        # Clear existing items
        for i in reversed(range(self.list_layout.count() - 1)):  # Keep stretch
            item = self.list_layout.itemAt(i)
            if item.widget():
                item.widget().deleteLater()
        
        # Get items
        items = self.service.get_protected_items()
        
        # Apply filters
        search_text = self.search_input.text().lower()
        type_filter = self.filter_combo.currentData()
        mode_filter = self.mode_filter.currentData()
        
        filtered_items = []
        for item in items:
            # Search filter
            if search_text and search_text not in item.path.lower():
                continue
            
            # Type filter
            if type_filter and item.item_type != type_filter:
                continue
            
            # Mode filter
            if mode_filter and item.protection_mode.value != mode_filter:
                continue
            
            filtered_items.append(item)
        
        # Show empty state or items
        if not filtered_items:
            self.empty_state.show()
            self.list_container.hide()
        else:
            self.empty_state.hide()
            self.list_container.show()
            
            # Add items
            for item in filtered_items:
                widget = FileListItem(item, self.theme)
                widget.action_requested.connect(self._handle_item_action)
                self.list_layout.insertWidget(self.list_layout.count() - 1, widget)
    
    def _on_search(self, text: str):
        """Handle search text change."""
        self._load_items()
    
    def _on_filter_changed(self):
        """Handle filter change."""
        self._load_items()
    
    def _on_add_file(self):
        """Handle add file button."""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select File to Protect",
            "",
            "All Files (*.*)"
        )
        
        if file_path:
            self._show_protection_dialog(file_path, 'file')
    
    def _on_add_folder(self):
        """Handle add folder button."""
        folder_path = QFileDialog.getExistingDirectory(
            self,
            "Select Folder to Protect"
        )
        
        if folder_path:
            self._show_protection_dialog(folder_path, 'folder')
    
    def _show_protection_dialog(self, path: str, item_type: str):
        """Show dialog to configure protection settings."""
        dialog = QDialog(self)
        dialog.setWindowTitle("Protection Settings")
        dialog.setMinimumWidth(400)
        
        layout = QVBoxLayout(dialog)
        layout.setSpacing(16)
        
        # Path display
        path_label = QLabel(f"Protecting: {Path(path).name}")
        path_label.setFont(QFont("Segoe UI", 12, QFont.Weight.DemiBold))
        layout.addWidget(path_label)
        
        # Form
        form = QFormLayout()
        form.setSpacing(12)
        
        # Protection mode
        mode_combo = QComboBox()
        for mode in ProtectionMode:
            mode_combo.addItem(mode.description, mode)
        
        # Set default from settings
        default_mode = self.settings.get('security.default_protection_mode', 'detect_alert')
        for i in range(mode_combo.count()):
            if mode_combo.itemData(i).value == default_mode:
                mode_combo.setCurrentIndex(i)
                break
        
        form.addRow("Protection Mode:", mode_combo)
        
        layout.addLayout(form)
        
        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        
        if dialog.exec() == QDialog.DialogCode.Accepted:
            mode = mode_combo.currentData()
            
            if item_type == 'file':
                success = self.service.protect_file(path, mode)
            else:
                success = self.service.protect_folder(path, mode)
            
            if success:
                self.refresh()
            else:
                QMessageBox.warning(
                    self,
                    "Protection Failed",
                    f"Failed to protect {Path(path).name}. Please check the file is accessible."
                )
    
    def _handle_item_action(self, path: str, action: str):
        """Handle an action request from a file item."""
        if action == 'history':
            self.file_selected.emit(path)
        
        elif action.startswith('mode:'):
            new_mode = ProtectionMode(action.split(':')[1])
            if self.service.change_protection_mode(path, new_mode):
                self.refresh()
        
        elif action == 'unlock':
            item = self.service.baseline.get_protected_item_by_path(path)
            if item:
                self.service.baseline.update_protected_item(item.id, is_locked=False)
                self.refresh()
        
        elif action == 'lock':
            item = self.service.baseline.get_protected_item_by_path(path)
            if item:
                self.service.baseline.update_protected_item(item.id, is_locked=True)
                self.refresh()
        
        elif action == 'update':
            # Update baseline to current file state
            item = self.service.baseline.get_protected_item_by_path(path)
            if item:
                metadata = self.service.hasher.get_metadata(Path(path))
                if metadata:
                    self.service.baseline.update_protected_item(
                        item.id,
                        hash_value=metadata.hash,
                        size=metadata.size,
                        modified_time=metadata.modified_time,
                        permissions=metadata.permissions
                    )
                    # Update backup
                    self.service.restore.update_backup(Path(path))
                    self.refresh()
                    QMessageBox.information(
                        self,
                        "Baseline Updated",
                        f"The baseline for {Path(path).name} has been updated to the current state."
                    )
        
        elif action == 'remove':
            # Confirm removal
            if self.settings.get('security.require_confirmation_for_unprotect', True):
                reply = QMessageBox.question(
                    self,
                    "Remove Protection",
                    f"Are you sure you want to remove protection from {Path(path).name}?\n\n"
                    "The file will no longer be monitored.",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                )
                
                if reply != QMessageBox.StandardButton.Yes:
                    return
            
            # Ask about backups
            reply = QMessageBox.question(
                self,
                "Delete Backups?",
                "Do you want to delete the encrypted backups as well?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            
            delete_backups = reply == QMessageBox.StandardButton.Yes
            
            if self.service.unprotect(path, delete_backups):
                self.refresh()
