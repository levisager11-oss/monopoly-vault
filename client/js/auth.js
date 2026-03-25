document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in
    const token = localStorage.getItem('token');
    if (token) {
        window.location.href = 'lobby.html';
        return;
    }

    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const form = document.getElementById('auth-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMsg = document.getElementById('error-msg');
    const submitBtn = document.getElementById('submit-btn');

    let isLogin = true;

    tabLogin.addEventListener('click', () => {
        isLogin = true;
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        submitBtn.textContent = 'Login';
        errorMsg.textContent = '';
    });

    tabRegister.addEventListener('click', () => {
        isLogin = false;
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        submitBtn.textContent = 'Register';
        errorMsg.textContent = '';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value;
        const password = passwordInput.value;

        const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('username', data.username);
                window.location.href = 'lobby.html';
            } else {
                errorMsg.textContent = data.error;
            }
        } catch (err) {
            errorMsg.textContent = 'Server connection error.';
        }
    });
});