import { FormEvent, useState } from 'react';
import { LogIn, UserPlus, Sparkles } from 'lucide-react';
import { saveAuth } from '../lib/auth';
import './auth.css';

type Props = { onAuthenticated: (user: any) => void };

export default function Auth({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { name, email, password };

      const response = await fetch(`http://localhost:4000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Authentication API returned an unexpected response (HTTP ${response.status})`);
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Authentication failed');

      saveAuth(data.token, data.user);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark"><Sparkles size={19} /></div>
          <span>CodePilot <b>AI</b></span>
        </div>

        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="auth-subtitle">
          {mode === 'login'
            ? 'Sign in to your AI engineering workspace.'
            : 'Start using CodePilot AI for your projects.'}
        </p>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Name
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name" minLength={2} required />
            </label>
          )}

          <label>
            Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 8 characters" minLength={mode === 'register' ? 8 : 1} required />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" disabled={loading}>
            {mode === 'login' ? <LogIn size={17} /> : <UserPlus size={17} />}
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button className="auth-switch" onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}>
          {mode === 'login'
            ? "Don't have an account? Create one"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
