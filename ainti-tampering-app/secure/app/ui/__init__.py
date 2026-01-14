# FileGuard UI Module
from .theme import ThemeManager
from .sidebar import Sidebar
from .main_window import MainWindow
from .dashboard_view import DashboardView
from .protected_files_view import ProtectedFilesView
from .activity_view import ActivityView
from .status_view import StatusView
from .settings_view import SettingsView
from .profile_view import ProfileView
from .onboarding import OnboardingDialog, should_show_onboarding

__all__ = [
    'ThemeManager',
    'Sidebar',
    'MainWindow',
    'DashboardView',
    'ProtectedFilesView',
    'ActivityView',
    'StatusView',
    'SettingsView',
    'ProfileView',
    'OnboardingDialog',
    'should_show_onboarding',
]
