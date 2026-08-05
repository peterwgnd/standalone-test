<script>
    import { auth, functions } from '$lib/firebase/firebase-config';
    import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
    import { httpsCallable } from 'firebase/functions';
    import { goto } from '$app/navigation';
    import { authStore } from '$lib/stores/authStore';
    
    let loginError = $state('');
    let loading = $state(false);

    const handleLogin = async () => {
        loading = true;
        loginError = '';
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            
            // Proactively try to initialize the user as an admin if they are the deployer
            try {
                const initAdmin = httpsCallable(functions, 'initAdmin');
                await initAdmin();
            } catch (e) {
                // If it fails, they just aren't the designated admin, which is perfectly fine.
                // We'll let the token claims check below handle whether they should be rejected.
            }
            
            // The Cloud Function takes a second to apply the Custom Claim on new signups.
            // Poll to wait for it so we don't prematurely reject the user.
            let tokenResult = await result.user.getIdTokenResult(true);
            let attempts = 0;
            let delay = 1000;
            while (!tokenResult.claims.admin && attempts < 5) {
                await new Promise(resolve => setTimeout(resolve, delay));
                tokenResult = await result.user.getIdTokenResult(true);
                delay = Math.min(delay * 2, 5000);
                attempts++;
            }

            if (tokenResult.claims.admin) {
                // Sync the store so the layout route guard lets us through
                authStore._set({ user: result.user, isAdmin: true, loading: false });
                goto('/dashboard');
            } else {
                loginError = 'You do not have admin permissions.';
                loading = false;
            }
        } catch (error) {
            console.error('Login failed:', error);
            loginError = 'Authentication failed. Please verify your permissions and try again.';
            loading = false;
        }
    };
</script>

<svelte:head>
    <title>Login | Sensemaking with Jigsaw</title>
</svelte:head>

<div class="login-wrapper">
    <div class="login-header">
        <h1>Protected Access</h1>
        <p>This project is restricted to authorized users.</p>
    </div>

    <div class="login-card">
        {#if loginError}
            <div class="error-message">{loginError}</div>
        {/if}

        <button 
            class="google-btn" 
            onclick={handleLogin} 
            disabled={loading}
        >
            <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
    </div>
</div>

<style>
    .login-wrapper {
        max-width: 400px;
        margin: 6rem auto;
        text-align: center;
        font-family: var(--font-heading);
    }
    
    .login-header {
        margin-bottom: 2rem;
    }
    
    .login-header h1 {
        font-size: 2.5rem;
        background: linear-gradient(135deg, #4285f4, #34a853);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin: 0;
    }
    
    .login-header p {
        margin-top: 0.5rem;
        color: #666;
        font-size: 1.1rem;
    }
    
    .login-card {
        padding: 3rem;
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 0, 0, 0.05);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
        border-radius: 20px;
    }
    
    .error-message {
        color: #ff416c;
        font-size: 0.9rem;
        background: #fff0f3;
        padding: 0.75rem;
        border-radius: 8px;
        border: 1px solid #ffccd5;
        margin-bottom: 1.5rem;
    }
    
    .google-btn {
        width: 100%;
        justify-content: center;
        padding: 0.75rem;
        font-size: 1rem;
        background: #fff;
        color: #333;
        border: 1px solid #dadce0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
    }
    
    .google-btn:hover:not(:disabled) {
        background: #f8f9fa;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        transform: translateY(-1px);
    }
    
    .google-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }
</style>
