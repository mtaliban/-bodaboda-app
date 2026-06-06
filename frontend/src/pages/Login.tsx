import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import Alert from '../components/Alert';
import axios, { AxiosError } from 'axios';
import { trackClick } from '../metrics';

function extractApiError(err: unknown): string {
  const error = err as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join(', ');
  return error.response?.data?.message ?? 'Login failed. Check your credentials.';
}

export default function Login() {
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();

  const justRegistered = (location.state as { registered?: boolean } | null)?.registered;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    trackClick('login_submit');
    try {
      await login({ email_or_phone: emailOrPhone, password });
      navigate('/dashboard', { replace: true });
    } catch (regularErr) {
      try {
        const { data } = await axios.post('/admin-api/admin/login', { username: emailOrPhone, password });
        localStorage.setItem('admin_token', data.access_token);
        navigate('/admin', { replace: true });
      } catch {
        setError(extractApiError(regularErr));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-wrap">🏍️</div>
          <h1 className="auth-title">{t('auth.login.title')}</h1>
          <p className="auth-sub">{t('auth.login.subtitle')}</p>
        </div>

        {justRegistered && (
          <Alert type="success" message={t('auth.login.successMsg')} />
        )}
        {error && <Alert type="error" message={error} />}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email_or_phone">{t('auth.login.emailOrPhone')}</label>
            <input
              id="email_or_phone"
              type="text"
              placeholder={t('auth.login.emailPlaceholder')}
              value={emailOrPhone}
              onChange={(e) => setEmailOrPhone(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label htmlFor="password">{t('auth.login.password')}</label>
              <Link to="/forgot-password" className="auth-link" style={{ fontSize: '0.8rem' }}>
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
            <input
              id="password"
              type="password"
              placeholder={t('auth.login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary btn-block"
            style={{ marginTop: '0.25rem', padding: '0.85rem' }}
          >
            {isLoading ? (
              <>
                <span className="btn-spinner" />
                {t('auth.login.submitting')}
              </>
            ) : (
              t('auth.login.submit')
            )}
          </button>
        </form>

        <p className="auth-footer-text">
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="auth-link">{t('auth.login.createFree')}</Link>
        </p>
      </div>
    </div>
  );
}
