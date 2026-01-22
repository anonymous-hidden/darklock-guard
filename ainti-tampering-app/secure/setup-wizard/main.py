"""
Secure Setup Wizard
Main entry point for the application.

A professional, privacy-respecting setup wizard for developers 
and security professionals. Cross-platform support for Windows and Linux.

Usage:
    python main.py

Requirements:
    - Windows 10/11 or Linux
    - Python 3.8+
    - Dependencies in requirements.txt
"""

import sys
import os
import platform
from pathlib import Path
import tkinter as tk
from tkinter import messagebox


def check_admin() -> bool:
    """Check if running with administrator/root privileges."""
    try:
        if platform.system() == 'Windows':
            import ctypes
            return ctypes.windll.shell32.IsUserAnAdmin()
        else:
            # Linux/Unix - check if running as root
            return os.geteuid() == 0
    except:
        return False


def show_admin_warning():
    """Show warning if not running as admin using a GUI dialog."""
    # Create a temporary root window (hidden)
    root = tk.Tk()
    root.withdraw()
    
    is_windows = platform.system() == 'Windows'
    priv_name = "Administrator" if is_windows else "root/sudo"
    run_cmd = "Right-click the .exe → Run as administrator" if is_windows else "Run with: sudo python main.py"
    
    message = (
        f"NOTICE: Not running as {priv_name}\n\n"
        "Some features require elevated privileges:\n"
    )
    
    if is_windows:
        message += (
            "  • WSL2 installation\n"
            "  • VirtualBox installation\n"
            "  • System folder creation in C:\\\n\n"
        )
    else:
        message += (
            "  • System package installation\n"
            "  • System-wide configurations\n"
            "  • /opt folder creation\n\n"
        )
    
    message += (
        "You can continue, but these features may be skipped.\n"
        f"To run with privileges: {run_cmd}\n\n"
        "Do you want to continue anyway?"
    )
    
    result = messagebox.askokcancel(f"{priv_name} Privileges", message)
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
