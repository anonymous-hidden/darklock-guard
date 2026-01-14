"""
Darklock Setup Wizard - Professional UI
A sleek, modern installer with dark theme and purple accents.
"""

import customtkinter as ctk
from tkinter import messagebox
import threading
import sys
from typing import Callable, Optional

# Try to import local modules
try:
    from config import Config, load_privacy_policy
    from installer import Installer
except ImportError:
    # Fallback for testing
    Config = None
    Installer = None
    def load_privacy_policy():
        return "Privacy Policy\n\nThis installer respects your privacy."

# ============================================================================
# DARKLOCK THEME
# ============================================================================

class DarklockTheme:
    """Darklock color scheme and styling constants."""
    
    # Colors
    BG_DARK = "#0a0a0f"
    BG_SECONDARY = "#101018"
    BG_CARD = "#16161f"
    BG_CARD_HOVER = "#1e1e2a"
    BORDER = "#2a2a3a"
    BORDER_LIGHT = "#3a3a4a"
    
    TEXT_PRIMARY = "#ffffff"
    TEXT_SECONDARY = "#a0a0b0"
    TEXT_MUTED = "#606070"
    
    PURPLE = "#7c3aed"
    PURPLE_LIGHT = "#a78bfa"
    PURPLE_DARK = "#5b21b6"
    PURPLE_GLOW = "#9333ea"
    
    SUCCESS = "#22c55e"
    ERROR = "#ef4444"
    WARNING = "#f59e0b"
    
    # Fonts
    FONT_FAMILY = "Segoe UI"
    
    @classmethod
    def apply(cls):
        """Apply Darklock theme to customtkinter."""
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")


# Apply theme on import
DarklockTheme.apply()


# ============================================================================
# CUSTOM WIDGETS
# ============================================================================

class DarklockButton(ctk.CTkButton):
    """Styled button matching Darklock design."""
    
    def __init__(self, master, text: str, command: Callable, 
                 primary: bool = True, width: int = 140, **kwargs):
        
        if primary:
            super().__init__(
                master,
                text=text,
                command=command,
                width=width,
                height=42,
                corner_radius=8,
                fg_color=DarklockTheme.PURPLE,
                hover_color=DarklockTheme.PURPLE_DARK,
                text_color=DarklockTheme.TEXT_PRIMARY,
                font=(DarklockTheme.FONT_FAMILY, 13, "bold"),
                **kwargs
            )
        else:
            super().__init__(
                master,
                text=text,
                command=command,
                width=width,
                height=42,
                corner_radius=8,
                fg_color="transparent",
                hover_color=DarklockTheme.BG_CARD_HOVER,
                border_width=1,
                border_color=DarklockTheme.BORDER,
                text_color=DarklockTheme.TEXT_SECONDARY,
                font=(DarklockTheme.FONT_FAMILY, 13),
                **kwargs
            )


class DarklockCard(ctk.CTkFrame):
    """Card component with Darklock styling."""
    
    def __init__(self, master, **kwargs):
        super().__init__(
            master,
            fg_color=DarklockTheme.BG_CARD,
            corner_radius=12,
            border_width=1,
            border_color=DarklockTheme.BORDER,
            **kwargs
        )


class DarklockCheckbox(ctk.CTkCheckBox):
    """Checkbox with purple Darklock styling."""
    
    def __init__(self, master, text: str, variable: ctk.BooleanVar, **kwargs):
        super().__init__(
            master,
            text=text,
            variable=variable,
            fg_color=DarklockTheme.PURPLE,
            hover_color=DarklockTheme.PURPLE_DARK,
            checkmark_color=DarklockTheme.BG_DARK,
            text_color=DarklockTheme.TEXT_PRIMARY,
            border_color=DarklockTheme.BORDER_LIGHT,
            font=(DarklockTheme.FONT_FAMILY, 13),
            **kwargs
        )


# ============================================================================
# MAIN APPLICATION
# ============================================================================

class DarklockWizard(ctk.CTk):
    """Main Darklock Setup Wizard application."""
    
    def __init__(self):
        super().__init__()
        
        # Window setup
        self.title("Darklock")
        self.geometry("900x620")
        self.resizable(False, False)
        self.configure(fg_color=DarklockTheme.BG_DARK)
        
        # Center on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() - 900) // 2
        y = (self.winfo_screenheight() - 620) // 2
        self.geometry(f"+{x}+{y}")
        
        # Initialize config
        if Config:
            self.config = Config()
            self.config.load()
        else:
            self.config = None
        
        # State variables
        self.selected_components = {
            "developer": ctk.BooleanVar(value=True),
            "security": ctk.BooleanVar(value=True),
            "virtualization": ctk.BooleanVar(value=True),
            "folders": ctk.BooleanVar(value=True),
            "shortcuts": ctk.BooleanVar(value=False)
        }
        
        # Main container
        self.main_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.main_frame.pack(fill="both", expand=True)
        
        # Start with welcome screen
        self.show_welcome()
    
    def clear_screen(self):
        """Clear all widgets from main frame."""
        for widget in self.main_frame.winfo_children():
            widget.destroy()
    
    # ========================================================================
    # WELCOME SCREEN
    # ========================================================================
    
    def show_welcome(self):
        """Display the welcome/landing screen."""
        self.clear_screen()
        
        # Center container
        center = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        center.place(relx=0.5, rely=0.45, anchor="center")
        
        # Badge
        badge = ctk.CTkLabel(
            center,
            text="  ◆  Enterprise Security Platform  ",
            font=(DarklockTheme.FONT_FAMILY, 11),
            fg_color=DarklockTheme.BG_CARD,
            corner_radius=15,
            text_color=DarklockTheme.TEXT_SECONDARY
        )
        badge.pack(pady=(0, 30))
        
        # Main title
        title1 = ctk.CTkLabel(
            center,
            text="Defend Your Digital",
            font=(DarklockTheme.FONT_FAMILY, 42, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        )
        title1.pack()
        
        title2 = ctk.CTkLabel(
            center,
            text="Infrastructure",
            font=(DarklockTheme.FONT_FAMILY, 42, "bold"),
            text_color=DarklockTheme.PURPLE_LIGHT
        )
        title2.pack(pady=(0, 25))
        
        # Description
        desc = ctk.CTkLabel(
            center,
            text="Darklock provides comprehensive security solutions for Discord\n"
                 "servers, web applications, and digital infrastructure. Built for teams\n"
                 "that take security seriously.",
            font=(DarklockTheme.FONT_FAMILY, 14),
            text_color=DarklockTheme.TEXT_SECONDARY,
            justify="center"
        )
        desc.pack(pady=(0, 35))
        
        # Button
        start_btn = DarklockButton(
            center, 
            "Start Protecting Now  →", 
            self.show_privacy,
            primary=True,
            width=220
        )
        start_btn.pack()
    
    # ========================================================================
    # PRIVACY SCREEN
    # ========================================================================
    
    def show_privacy(self):
        """Display privacy policy screen."""
        self.clear_screen()
        
        # Header
        header = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        header.pack(fill="x", padx=60, pady=(50, 30))
        
        ctk.CTkLabel(
            header, text="Privacy Policy",
            font=(DarklockTheme.FONT_FAMILY, 36, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        ).pack(anchor="w")
        
        ctk.CTkLabel(
            header, text="Your privacy matters. Review our commitment to protecting your data.",
            font=(DarklockTheme.FONT_FAMILY, 15),
            text_color=DarklockTheme.TEXT_SECONDARY
        ).pack(anchor="w", pady=(8, 0))
        
        # Policy card
        card = DarklockCard(self.main_frame)
        card.pack(fill="both", expand=True, padx=60, pady=(0, 25))
        
        policy_text = ctk.CTkTextbox(
            card,
            font=(DarklockTheme.FONT_FAMILY, 14),
            fg_color="transparent",
            text_color=DarklockTheme.TEXT_PRIMARY,
            wrap="word",
            border_width=0
        )
        policy_text.pack(fill="both", expand=True, padx=30, pady=30)
        policy_text.insert("1.0", load_privacy_policy())
        policy_text.configure(state="disabled")
        
        # Consent
        consent_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        consent_frame.pack(fill="x", padx=60)
        
        consent_var = ctk.BooleanVar(value=False)
        
        def on_consent_change():
            if consent_var.get():
                next_btn.configure(
                    state="normal",
                    fg_color=DarklockTheme.PURPLE
                )
            else:
                next_btn.configure(
                    state="disabled",
                    fg_color=DarklockTheme.BG_CARD_HOVER
                )
        
        consent_check = DarklockCheckbox(
            consent_frame,
            "I have read and agree to the Privacy Policy",
            consent_var,
            command=on_consent_change
        )
        consent_check.configure(font=(DarklockTheme.FONT_FAMILY, 14, "bold"))
        consent_check.pack(anchor="w", pady=5)
        
        # Buttons
        btn_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        btn_frame.pack(fill="x", padx=60, pady=(20, 30))
        
        DarklockButton(btn_frame, "Back", self.show_welcome, primary=False).pack(side="left")
        
        next_btn = DarklockButton(
            btn_frame, "Continue  →", 
            self.show_components,
            width=150
        )
        next_btn.configure(state="disabled", fg_color=DarklockTheme.BG_CARD_HOVER)
        next_btn.pack(side="right")
    
    # ========================================================================
    # COMPONENTS SCREEN
    # ========================================================================
    
    def show_components(self, skip_privacy: bool = True):
        """Display component selection screen."""
        self.clear_screen()
        
        # Header
        header = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        header.pack(fill="x", padx=60, pady=(40, 25))
        
        ctk.CTkLabel(
            header, text="Select Components",
            font=(DarklockTheme.FONT_FAMILY, 28, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        ).pack(anchor="w")
        
        ctk.CTkLabel(
            header, text="Choose which security modules to deploy on your system",
            font=(DarklockTheme.FONT_FAMILY, 13),
            text_color=DarklockTheme.TEXT_SECONDARY
        ).pack(anchor="w", pady=(5, 0))
        
        # Scrollable component list
        scroll = ctk.CTkScrollableFrame(
            self.main_frame,
            fg_color="transparent",
            scrollbar_button_color=DarklockTheme.PURPLE,
            scrollbar_button_hover_color=DarklockTheme.PURPLE_DARK
        )
        scroll.pack(fill="both", expand=True, padx=55, pady=(0, 15))
        
        # Component cards
        components = [
            ("developer", "⚡", "Developer Essentials", 
             "Git • VS Code • Python 3.12 • Node.js • Docker Desktop"),
            ("security", "🔒", "Security & Network Tools", 
             "Wireshark • Nmap • Sysinternals Suite • PuTTY"),
            ("virtualization", "💻", "Virtualization & Linux", 
             "VirtualBox • WSL2 • Ubuntu (requires restart)"),
            ("folders", "📁", "Development Workspace", 
             "Organized folder structure at C:\\Dev"),
            ("shortcuts", "🔗", "Desktop Shortcuts", 
             "Quick-access icons on your desktop")
        ]
        
        for key, icon, title, desc in components:
            self._create_component_card(scroll, key, icon, title, desc)
        
        # Buttons
        btn_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        btn_frame.pack(fill="x", padx=60, pady=(10, 30))
        
        DarklockButton(btn_frame, "Back", self.show_privacy, primary=False).pack(side="left")
        DarklockButton(btn_frame, "Review  →", self.show_review, width=150).pack(side="right")
    
    def _create_component_card(self, parent, key: str, icon: str, title: str, desc: str):
        """Create a component selection card."""
        card = DarklockCard(parent)
        card.pack(fill="x", pady=6)
        
        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="x", padx=18, pady=14)
        
        # Checkbox with icon and title
        check = DarklockCheckbox(
            inner,
            f"  {icon}  {title}",
            self.selected_components[key]
        )
        check.configure(font=(DarklockTheme.FONT_FAMILY, 14, "bold"))
        check.pack(anchor="w")
        
        # Description
        ctk.CTkLabel(
            inner, text=desc,
            font=(DarklockTheme.FONT_FAMILY, 11),
            text_color=DarklockTheme.TEXT_MUTED
        ).pack(anchor="w", padx=32, pady=(4, 0))
    
    # ========================================================================
    # REVIEW SCREEN
    # ========================================================================
    
    def show_review(self):
        """Display installation review screen."""
        self.clear_screen()
        
        # Header
        header = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        header.pack(fill="x", padx=60, pady=(40, 25))
        
        ctk.CTkLabel(
            header, text="Ready to Deploy",
            font=(DarklockTheme.FONT_FAMILY, 28, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        ).pack(anchor="w")
        
        ctk.CTkLabel(
            header, text="Review your configuration before starting deployment",
            font=(DarklockTheme.FONT_FAMILY, 13),
            text_color=DarklockTheme.TEXT_SECONDARY
        ).pack(anchor="w", pady=(5, 0))
        
        # Review card
        card = DarklockCard(self.main_frame)
        card.pack(fill="both", expand=True, padx=60, pady=(0, 20))
        
        review_text = ctk.CTkTextbox(
            card,
            font=("Consolas", 11),
            fg_color="transparent",
            text_color=DarklockTheme.TEXT_SECONDARY,
            wrap="word"
        )
        review_text.pack(fill="both", expand=True, padx=20, pady=20)
        
        # Build review content
        content = self._build_review_content()
        review_text.insert("1.0", content)
        review_text.configure(state="disabled")
        
        # Buttons
        btn_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        btn_frame.pack(fill="x", padx=60, pady=(10, 30))
        
        DarklockButton(btn_frame, "Back", self.show_components, primary=False).pack(side="left")
        DarklockButton(btn_frame, "Deploy Now  →", self.show_installing, width=160).pack(side="right")
    
    def _build_review_content(self) -> str:
        """Build the review text content."""
        lines = []
        lines.append("═" * 55)
        lines.append("           DEPLOYMENT CONFIGURATION")
        lines.append("═" * 55)
        lines.append("")
        
        if self.selected_components["developer"].get():
            lines.append("⚡ DEVELOPER ESSENTIALS")
            lines.append("─" * 55)
            lines.append("   ✓ Git                    Version control")
            lines.append("   ✓ Visual Studio Code     Code editor")
            lines.append("   ✓ Python 3.12            Programming language")
            lines.append("   ✓ Node.js LTS            JavaScript runtime")
            lines.append("   ✓ Docker Desktop         Container platform")
            lines.append("")
        
        if self.selected_components["security"].get():
            lines.append("🔒 SECURITY & NETWORK TOOLS")
            lines.append("─" * 55)
            lines.append("   ✓ Wireshark              Network analyzer")
            lines.append("   ✓ Nmap                   Network scanner")
            lines.append("   ✓ Sysinternals Suite     System utilities")
            lines.append("   ✓ PuTTY                  SSH/Telnet client")
            lines.append("")
        
        if self.selected_components["virtualization"].get():
            lines.append("💻 VIRTUALIZATION & LINUX")
            lines.append("─" * 55)
            lines.append("   ✓ VirtualBox             Virtual machines")
            lines.append("   ✓ WSL2                   Linux subsystem")
            lines.append("   ✓ Ubuntu                 Linux distribution")
            lines.append("")
        
        if self.selected_components["folders"].get():
            lines.append("📁 WORKSPACE STRUCTURE")
            lines.append("─" * 55)
            lines.append("   C:\\Dev\\")
            lines.append("    ├── projects/")
            lines.append("    ├── bots/")
            lines.append("    ├── security/")
            lines.append("    ├── labs/")
            lines.append("    ├── scripts/")
            lines.append("    └── notes/")
            lines.append("")
        
        lines.append("═" * 55)
        lines.append("")
        lines.append("⚠️  Administrator privileges required")
        lines.append("⚠️  Some components require system restart")
        
        return "\n".join(lines)
    
    # ========================================================================
    # INSTALLING SCREEN
    # ========================================================================
    
    def show_installing(self):
        """Display installation progress screen."""
        self.clear_screen()
        
        # Center container
        center = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        center.pack(expand=True, fill="both", padx=60, pady=40)
        
        # Header
        ctk.CTkLabel(
            center, text="Deploying Security Suite",
            font=(DarklockTheme.FONT_FAMILY, 28, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        ).pack(pady=(0, 5))
        
        self.status_label = ctk.CTkLabel(
            center, text="Initializing...",
            font=(DarklockTheme.FONT_FAMILY, 13),
            text_color=DarklockTheme.PURPLE_LIGHT
        )
        self.status_label.pack(pady=(0, 25))
        
        # Progress bar
        self.progress = ctk.CTkProgressBar(
            center,
            width=600,
            height=6,
            mode="indeterminate",
            progress_color=DarklockTheme.PURPLE,
            fg_color=DarklockTheme.BG_CARD
        )
        self.progress.pack(pady=(0, 25))
        self.progress.start()
        
        # Log output
        log_card = DarklockCard(center)
        log_card.pack(fill="both", expand=True)
        
        self.log_text = ctk.CTkTextbox(
            log_card,
            font=("Consolas", 10),
            fg_color="transparent",
            text_color=DarklockTheme.TEXT_SECONDARY,
            wrap="word"
        )
        self.log_text.pack(fill="both", expand=True, padx=15, pady=15)
        
        # Start installation
        thread = threading.Thread(target=self._run_installation, daemon=True)
        thread.start()
    
    def _log(self, message: str):
        """Add message to log (thread-safe)."""
        def update():
            self.log_text.insert("end", message + "\n")
            self.log_text.see("end")
        self.after(0, update)
    
    def _set_status(self, text: str, color: str = None):
        """Update status label (thread-safe)."""
        def update():
            self.status_label.configure(text=text)
            if color:
                self.status_label.configure(text_color=color)
        self.after(0, update)
    
    def _run_installation(self):
        """Run installation in background thread."""
        try:
            if Installer and self.config:
                installer = Installer(log_callback=self._log)
                
                # Update config from selections
                self.config.set("install_developer_tools", self.selected_components["developer"].get())
                self.config.set("install_security_tools", self.selected_components["security"].get())
                self.config.set("install_virtualization", self.selected_components["virtualization"].get())
                self.config.set("create_dev_folders", self.selected_components["folders"].get())
                self.config.set("create_shortcuts", self.selected_components["shortcuts"].get())
                
                installer.run_full_installation(self.config)
            else:
                # Demo mode
                import time
                self._log("Starting deployment simulation...")
                time.sleep(1)
                self._log("Installing components...")
                time.sleep(2)
                self._log("Deployment complete!")
            
            self.after(0, lambda: self._installation_complete(False))
            
        except Exception as e:
            self._log(f"\nERROR: {str(e)}")
            self.after(0, lambda: self._installation_complete(True))
    
    def _installation_complete(self, error: bool):
        """Handle installation completion."""
        self.progress.stop()
        self.progress.configure(mode="determinate")
        self.progress.set(1.0)
        
        if error:
            self._set_status("Deployment encountered issues", DarklockTheme.ERROR)
        else:
            self._set_status("Deployment complete!", DarklockTheme.SUCCESS)
        
        # Add continue button
        btn = DarklockButton(
            self.main_frame,
            "Continue  →",
            self.show_complete,
            width=150
        )
        btn.pack(pady=20)
    
    # ========================================================================
    # COMPLETE SCREEN
    # ========================================================================
    
    def show_complete(self):
        """Display completion screen."""
        self.clear_screen()
        
        # Center container
        center = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        center.place(relx=0.5, rely=0.45, anchor="center")
        
        # Success badge
        badge = ctk.CTkLabel(
            center,
            text="  ✓  Deployment Successful  ",
            font=(DarklockTheme.FONT_FAMILY, 12, "bold"),
            fg_color=DarklockTheme.SUCCESS,
            corner_radius=15,
            text_color=DarklockTheme.BG_DARK
        )
        badge.pack(pady=(0, 30))
        
        # Title
        ctk.CTkLabel(
            center, text="Your Infrastructure",
            font=(DarklockTheme.FONT_FAMILY, 38, "bold"),
            text_color=DarklockTheme.TEXT_PRIMARY
        ).pack()
        
        ctk.CTkLabel(
            center, text="Is Protected",
            font=(DarklockTheme.FONT_FAMILY, 38, "bold"),
            text_color=DarklockTheme.PURPLE_LIGHT
        ).pack(pady=(0, 30))
        
        # Instructions
        ctk.CTkLabel(
            center,
            text="Complete these final steps to finish setup:\n\n"
                 "•  Restart your computer to finalize configuration\n"
                 "•  Launch Docker Desktop and complete initial setup\n"
                 "•  Open Ubuntu from Start Menu to initialize WSL\n"
                 "•  Configure Git with your name and email",
            font=(DarklockTheme.FONT_FAMILY, 13),
            text_color=DarklockTheme.TEXT_SECONDARY,
            justify="left"
        ).pack(pady=(0, 35))
        
        # Buttons
        btn_frame = ctk.CTkFrame(center, fg_color="transparent")
        btn_frame.pack()
        
        DarklockButton(btn_frame, "Finish", self.quit, primary=False).pack(side="left", padx=8)
        DarklockButton(btn_frame, "Restart Now  →", self._restart, width=160).pack(side="left", padx=8)
    
    def _restart(self):
        """Prompt and restart computer."""
        if messagebox.askyesno("Restart Computer", 
                              "Are you sure you want to restart now?"):
            import subprocess
            subprocess.run(["shutdown", "/r", "/t", "10", "/c", 
                          "Restarting to complete Darklock deployment..."])
            self.quit()


# ============================================================================
# ENTRY POINT
# ============================================================================

def main():
    """Main entry point."""
    app = DarklockWizard()
    app.mainloop()


if __name__ == "__main__":
    main()
