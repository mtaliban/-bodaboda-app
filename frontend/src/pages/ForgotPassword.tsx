import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import api from '../api/axios';
import Alert from '../components/Alert';
import type {
  ForgotPasswordPayload,
  VerifyResetCodePayload,
  VerifyResetCodeResponse,
  ResetPasswordPayload,
} from '../types';

type Step = 1 | 2 | 3 | 'done';

function extractError(err: unknown): string {
  const e = err as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = e.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join(', ');
  return e.response?.data?.message ?? 'Something went wrong. Please try again.';
}

export default function ForgotPassword() {
  const navigate = useNavigate();

  // shared
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // step 1
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [sentMsg, setSentMsg] = useState('');

  // step 2
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [resetToken, setResetToken] = useState('');

  // step 3
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // ── Step 1 — request reset code ──────────────────────────────────────
  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload: ForgotPasswordPayload = { email_or_phone: emailOrPhone, method: 'email' };
      const { data } = await api.post<{ message: string }>('/auth/forgot-password', payload);
      setSentMsg(data.message);
      setStep(2);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2 — verify 6-digit code ─────────────────────────────────────
  function handleCodeInput(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) codeRefs.current[index + 1]?.focus();
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      codeRefs.current[5]?.focus();
    }
    e.preventDefault();
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const fullCode = code.join('');
    if (fullCode.length < 6) { setError('Please enter the full 6-digit code.'); return; }
    setError('');
    setLoading(true);
    try {
      const payload: VerifyResetCodePayload = { email_or_phone: emailOrPhone, code: fullCode };
      const { data } = await api.post<VerifyResetCodeResponse>('/auth/verify-reset-code', payload);
      setResetToken(data.reset_token);
      setStep(3);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setCode(['', '', '', '', '', '']);
    codeRefs.current[0]?.focus();
    setLoading(true);
    try {
      const payload: ForgotPasswordPayload = { email_or_phone: emailOrPhone, method: 'email' };
      const { data } = await api.post<{ message: string }>('/auth/forgot-password', payload);
      setSentMsg(data.message);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3 — set new password ─────────────────────────────────────────
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      const payload: ResetPasswordPayload = { reset_token: resetToken, new_password: newPassword };
      await api.post('/auth/reset-password', payload);
      setStep('done');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="auth-page">
      <div className="auth-card">

        {/* ── Step 1 — request code ── */}
        {step === 1 && (
          <>
            <div className="auth-header">
              <div className="auth-logo-wrap">🔑</div>
              <h1 className="auth-title">Forgot Password?</h1>
              <p className="auth-sub">Enter your email or phone and choose how to receive a reset code.</p>
            </div>

            {error && <Alert type="error" message={error} />}

            <form onSubmit={handleRequestCode} className="auth-form">
              <div className="form-group">
                <label htmlFor="eop">Email or Phone Number</label>
                <input
                  id="eop"
                  type="text"
                  placeholder="john@example.com or +254700000000"
                  value={emailOrPhone}
                  onChange={(e) => setEmailOrPhone(e.target.value)}
                  required
                  autoComplete="username"
                />
                <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.35rem' }}>
                  The reset code will be sent to your registered email address.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
                style={{ marginTop: '0.25rem', padding: '0.85rem' }}
              >
                {loading ? <><span className="btn-spinner" /> Sending…</> : 'Send Reset Code'}
              </button>
            </form>

            <p className="auth-footer-text">
              Remember your password?{' '}
              <Link to="/login" className="auth-link">Log in</Link>
            </p>
          </>
        )}

        {/* ── Step 2 — enter OTP code ── */}
        {step === 2 && (
          <>
            <div className="auth-header">
              <div className="auth-logo-wrap">📨</div>
              <h1 className="auth-title">Enter Reset Code</h1>
              {sentMsg && <p className="auth-sub">{sentMsg}</p>}
            </div>

            {error && <Alert type="error" message={error} />}

            <form onSubmit={handleVerifyCode} className="auth-form">
              <div className="form-group">
                <label>6-digit verification code</label>
                <div className="otp-input-row" onPaste={handleCodePaste}>
                  {code.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { codeRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeInput(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      className="otp-box"
                      autoFocus={i === 0}
                      autoComplete="off"
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || code.join('').length < 6}
                className="btn btn-primary btn-block"
                style={{ padding: '0.85rem' }}
              >
                {loading ? <><span className="btn-spinner" /> Verifying…</> : 'Verify Code'}
              </button>
            </form>

            <div className="otp-resend-row">
              <span className="otp-resend-label">Didn't receive it?</span>
              <button
                type="button"
                className="otp-resend-btn"
                onClick={handleResend}
                disabled={loading}
              >
                Resend code
              </button>
            </div>

            <p className="auth-footer-text" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="auth-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
                onClick={() => { setStep(1); setError(''); setCode(['', '', '', '', '', '']); }}
              >
                ← Change email / phone
              </button>
            </p>
          </>
        )}

        {/* ── Step 3 — set new password ── */}
        {step === 3 && (
          <>
            <div className="auth-header">
              <div className="auth-logo-wrap">🔒</div>
              <h1 className="auth-title">Set New Password</h1>
              <p className="auth-sub">Choose a strong password you haven't used before.</p>
            </div>

            {error && <Alert type="error" message={error} />}

            <form onSubmit={handleResetPassword} className="auth-form">
              <div className="form-group">
                <label htmlFor="new_pass">New Password</label>
                <div className="pass-input-wrap">
                  <input
                    id="new_pass"
                    type={showPass ? 'text' : 'password'}
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="pass-toggle"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="confirm_pass">Confirm New Password</label>
                <input
                  id="confirm_pass"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {newPassword.length > 0 && (
                <div className="pass-strength-wrap">
                  <div className={`pass-strength-bar strength-${getStrength(newPassword)}`}>
                    <div className="pass-strength-fill" />
                  </div>
                  <span className={`pass-strength-label strength-${getStrength(newPassword)}`}>
                    {getStrengthLabel(newPassword)}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
                style={{ marginTop: '0.5rem', padding: '0.85rem' }}
              >
                {loading ? <><span className="btn-spinner" /> Saving…</> : 'Save New Password'}
              </button>
            </form>
          </>
        )}

        {/* ── Done ── */}
        {step === 'done' && (
          <div className="reset-done">
            <div className="auth-logo-wrap" style={{ fontSize: '2.5rem' }}>✅</div>
            <h1 className="auth-title" style={{ marginTop: '1rem' }}>Password Reset!</h1>
            <p className="auth-sub">
              Your password has been updated. You can now log in with your new password.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: '1.5rem', padding: '0.85rem' }}
              onClick={() => navigate('/login')}
            >
              Go to Login
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// password strength helpers
function getStrength(pass: string): 'weak' | 'fair' | 'strong' {
  let score = 0;
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  if (score <= 1) return 'weak';
  if (score === 2) return 'fair';
  return 'strong';
}

function getStrengthLabel(pass: string): string {
  const s = getStrength(pass);
  return s === 'weak' ? 'Weak password' : s === 'fair' ? 'Fair password' : 'Strong password';
}
