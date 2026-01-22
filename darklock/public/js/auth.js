/**
 * Darklock Platform - Authentication JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
    // Get form elements
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const errorMessage = document.getElementById('errorMessage');
    const submitBtn = document.getElementById('submitBtn');
    const twoFactorSection = document.getElementById('twoFactorSection');
    
    // Password visibility toggle
    document.querySelectorAll('.password-toggle').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const input = this.parentElement.querySelector('input');
            const type = input.getAttribute('type');
            
            input.setAttribute('type', type === 'password' ? 'text' : 'password');
            this.classList.toggle('active');
        });
    });
    
    // Password strength checker (signup only)
    const passwordInput = document.getElementById('password');
    const strengthFill = document.getElementById('strengthFill');
    const strengthText = document.getElementById('strengthText');
    
    if (passwordInput && strengthFill) {
        passwordInput.addEventListener('input', function() {
            const password = this.value;
            const strength = checkPasswordStrength(password);
            
            strengthFill.className = 'strength-fill ' + strength.class;
            strengthText.textContent = strength.text;
        });
    }
    
    // Login form handler
    if (loginForm) {
        let requires2FA = false;
        
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const totpCode = document.getElementById('totpCode')?.value;
            
            if (!username || !password) {
                showError('Please fill in all required fields');
                return;
            }
            
            if (requires2FA && !totpCode) {
                showError('Please enter your two-factor authentication code');
                return;
            }
            
            setLoading(true);
            hideError();
            
            try {
                const response = await fetch('/platform/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password, totpCode }),
                    credentials: 'include'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = data.redirect || '/platform/dashboard';
                } else if (data.requires2FA) {
                    requires2FA = true;
                    twoFactorSection.classList.remove('hidden');
                    document.getElementById('totpCode').focus();
                    setLoading(false);
                } else {
                    showError(data.error || 'Login failed');
                    setLoading(false);
                }
            } catch (err) {
                console.error('Login error:', err);
                showError('Connection error. Please try again.');
                setLoading(false);
            }
        });
    }
    
    // Signup form handler
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            // Client-side validation
            if (!username || !email || !password || !confirmPassword) {
                showError('Please fill in all fields');
                return;
            }
            
            if (password !== confirmPassword) {
                showError('Passwords do not match');
                return;
            }
            
            const strength = checkPasswordStrength(password);
            if (strength.score < 2) {
                showError('Please choose a stronger password');
                return;
            }
            
            setLoading(true);
            hideError();
            
            try {
                const response = await fetch('/platform/auth/signup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, email, password, confirmPassword }),
                    credentials: 'include'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = data.redirect || '/platform/dashboard';
                } else {
                    showError(data.error || 'Signup failed');
                    setLoading(false);
                }
            } catch (err) {
                console.error('Signup error:', err);
                showError('Connection error. Please try again.');
                setLoading(false);
            }
        });
    }
    
    // Helper functions
    function showError(message) {
        if (errorMessage) {
            errorMessage.textContent = message;
            errorMessage.classList.remove('hidden');
        }
    }
    
    function hideError() {
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
    
    function setLoading(loading) {
        if (submitBtn) {
            submitBtn.disabled = loading;
            submitBtn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
            submitBtn.querySelector('.btn-loader')?.classList.toggle('hidden', !loading);
        }
    }
    
    function checkPasswordStrength(password) {
        let score = 0;
        
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        
        if (score <= 2) return { score, class: 'weak', text: 'Weak' };
        if (score <= 3) return { score, class: 'fair', text: 'Fair' };
        if (score <= 4) return { score, class: 'good', text: 'Good' };
        return { score, class: 'strong', text: 'Strong' };
    }
    
    // TOTP input formatting
    const totpInput = document.getElementById('totpCode');
    if (totpInput) {
        totpInput.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').slice(0, 6);
        });
    }
});
