// DarkLock Website - Professional Edition
// ============================================

// Invite bot function - redirects to Discord OAuth
function inviteBot() {
    window.location.href = '/invite';
}

// Invite bot function
function inviteBot() {
    // Defer to backend /invite which uses configured env vars
    window.location.href = '/invite';
}

// Smooth scrolling for anchor links
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for hash links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#') return;
            
            e.preventDefault();
            const targetId = href.substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                const offsetTop = targetElement.offsetTop - 80;
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Mobile menu toggle
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            this.classList.toggle('active');
        });
        
        // Close menu when clicking a link
        navMenu.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                navToggle.classList.remove('active');
            });
        });
    }

    // Navbar background on scroll
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        window.addEventListener('scroll', function() {
            if (window.scrollY > 50) {
                navbar.style.background = 'rgba(10, 14, 23, 0.95)';
                navbar.style.borderBottomColor = 'rgba(148, 163, 184, 0.15)';
            } else {
                navbar.style.background = 'rgba(10, 14, 23, 0.8)';
                navbar.style.borderBottomColor = 'rgba(148, 163, 184, 0.1)';
            }
        });
    }

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const fadeInObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                fadeInObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Apply fade-in animation to cards
    document.querySelectorAll('.feature-card, .pricing-card, .security-feature, .trust-item').forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        fadeInObserver.observe(el);
    });

    // Animate chart bars on load
    document.querySelectorAll('.chart-bar').forEach((bar, index) => {
        bar.style.setProperty('--i', index);
    });
});

// Form validation helper
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Initialize extras when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Attach metadata to Stripe pricing table if present
    const pricingTable = document.querySelector('stripe-pricing-table');
    if (pricingTable) {
        const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId') || null;
        const userId = window.CURRENT_USER_ID || localStorage.getItem('currentUserId') || null;
        
        pricingTable.addEventListener('checkout', function(event) {
            event.detail.metadata = {
                guild_id: guildId || '',
                user_id: userId || ''
            };
        });
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        inviteBot,
        validateEmail
    };
}
