/**
 * Darklock Platform - Homepage JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
    // Mobile Navigation Toggle
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
            navToggle.classList.toggle('active');
        });
    }
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // Close mobile nav if open
                if (navLinks) {
                    navLinks.classList.remove('open');
                    navToggle?.classList.remove('active');
                }
            }
        });
    });
    
    // Navbar background on scroll
    const nav = document.querySelector('.nav');
    if (nav) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        });
    }
    
    // Animate elements on scroll
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Observe feature cards and app cards
    document.querySelectorAll('.feature-card, .app-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
    
    // Add visible state styles
    const style = document.createElement('style');
    style.textContent = `
        .feature-card.visible,
        .app-card.visible {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);
});

/**
 * Launch Darklock Guard desktop app (requires authentication)
 */
async function launchDarklockGuard(event) {
    event.preventDefault();
    
    const button = event.currentTarget;
    const originalText = button.innerHTML;
    
    // Show loading state
    button.disabled = true;
    button.innerHTML = `
        <span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span>
        Launching...
    `;
    
    // Add spin animation if not exists
    if (!document.getElementById('launch-spinner-style')) {
        const spinStyle = document.createElement('style');
        spinStyle.id = 'launch-spinner-style';
        spinStyle.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(spinStyle);
    }
    
    try {
        const response = await fetch('/platform/launch/darklock-guard', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 401) {
                // Not authenticated, redirect to login
                window.location.href = '/platform/auth/login?redirect=' + encodeURIComponent(window.location.pathname);
                return;
            }
            throw new Error(data.error || 'Failed to launch application');
        }
        
        // Success - show message
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; display: inline-block; vertical-align: middle;">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Launched Successfully
        `;
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText;
        }, 3000);
        
    } catch (err) {
        console.error('Failed to launch Darklock Guard:', err);
        
        // Show error
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; display: inline-block; vertical-align: middle;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Launch Failed
        `;
        
        // Show alert with error
        alert('Failed to launch Darklock Guard: ' + err.message);
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText;
        }, 3000);
    }
}
