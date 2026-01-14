"""
Secure Setup Wizard
Main entry point for the application.

A professional, privacy-respecting Windows setup wizard for developers 
and security professionals.

Usage:
    python main.py

Requirements:
    - Windows 10/11
    - Python 3.8+
    - Dependencies in requirements.txt
"""

import sys
import ctypes
from pathlib import Path
import tkinter as tk
from tkinter import messagebox


def check_admin() -> bool:
    """Check if running with administrator privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def show_admin_warning():
    """Show warning if not running as admin using a GUI dialog."""
    # Create a temporary root window (hidden)
    root = tk.Tk()
    root.withdraw()
    
    message = (
        "NOTICE: Not running as Administrator\n\n"
        "Some features require administrator privileges:\n"
        "  • WSL2 installation\n"
        "  • VirtualBox installation\n"
        "  • System folder creation in C:\\\n\n"
        "You can continue, but these features may be skipped.\n"
        "To run as admin: Right-click the .exe → Run as administrator\n\n"
        "Do you want to continue anyway?"
    )
    
    result = messagebox.askokcancel("Administrator Privileges", message)
    root.destroy()
    
    if not result:
        sys.exit(0)


def main():
    """Main entry point."""
    # Check for admin privileges
    is_admin = check_admin()
    if not is_admin:
        show_admin_warning()
    
    # Check if dependencies are installed
    try:
        import customtkinter
    except ImportError:
        # Show error in GUI
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "Missing Dependencies",
            "ERROR: Required dependencies not installed.\n\n"
            "If running from source, please run:\n"
            "pip install -r requirements.txt"
        )
        root.destroy()
        sys.exit(1)
    
    # Launch the wizard UI
    try:
        from wizard_ui import main as wizard_main
        wizard_main()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        # Show error in GUI
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "Unhandled Exception",
            f"ERROR: {str(e)}\n\n"
            "Please report this issue if it persists."
        )
        root.destroy()
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
