import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import Alert from '../components/Alert';
import { Role } from '../types';
import { AxiosError } from 'axios';
import { trackClick } from '../metrics';
import api from '../api/axios';

interface FormState {
  full_name: string; phone: string; email: string;
  password: string; confirm_password: string;
  license_number: string; vehicle_model: string; plate_number: string;
}

const initialForm: FormState = {
  full_name: '', phone: '', email: '', password: '', confirm_password: '',
  license_number: '', vehicle_model: '', plate_number: '',
};

function extractApiError(err: unknown): string {
  const error = err as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join(', ');
  if (typeof detail === 'string') return detail;
  return error.response?.data?.message ?? 'Registration failed. Please try again.';
}

export default function Register() {
  const [searchParams] = useSearchParams();
  const initialRole = (searchParams.get('role') as Role) ?? 'RIDER';

  const [role, setRole] = useState<Role>(initialRole);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [userId, setUserId] = useState<number | null>(null);
  const [sentMsg, setSentMsg] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  const { register, verifyEmail } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    trackClick('register_submit');
    if (form.password !== form.confirm_password) { setError(t('auth.register.passwordMismatch')); return; }
    if (form.password.length < 6) { setError(t('auth.register.passwordTooShort')); return; }
    setIsLoading(true);
    try {
      let result;
      if (role === 'DRIVER') {
        result = await register({
          full_name: form.full_name, phone: form.phone, email: form.email, password: form.password, role: 'DRIVER',
          driver_profile: { license_number: form.license_number, vehicle_model: form.vehicle_model, plate_number: form.plate_number },
        });
      } else {
        result = await register({ full_name: form.full_name, phone: form.phone, email: form.email, password: form.password, role: 'RIDER' });
      }
      setUserId(result.user_id);
      setSentMsg(result.message);
      setStep(2);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const doVerify = async (fullCode: string) => {
    if (fullCode.length < 6 || !userId || isLoading) return;
    setError(''); setIsLoading(true);
    trackClick('register_verify_email');
    try {
      await verifyEmail(userId, fullCode);
      navigate('/login', { state: { registered: true }, replace: true });
    } catch (err) {
      setError(extractApiError(err));
      setCode(['', '', '', '', '', '']);
      setTimeout(() => codeRefs.current[0]?.focus(), 0);
    } finally {
      setIsLoading(false);
    }
  };

  function handleCodeInput(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) codeRefs.current[index + 1]?.focus();
    else if (value && index === 5) doVerify(next.join(''));
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[index] && index > 0) codeRefs.current[index - 1]?.focus();
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) { setCode(pasted.split('')); codeRefs.current[5]?.focus(); doVerify(pasted); }
    e.preventDefault();
  }

  const handleResend = async () => {
    if (!userId) return;
    setError(''); setCode(['', '', '', '', '', '']); codeRefs.current[0]?.focus(); setIsLoading(true);
    try {
      const { data } = await api.post<{ message: string }>('/auth/resend-verification', { user_id: userId });
      setSentMsg(data.message);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2 — OTP
  if (step === 2) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo-wrap">📧</div>
            <h1 className="auth-title">{t('auth.verify.title')}</h1>
            <p className="auth-sub">{sentMsg || `${t('auth.verify.subtitle')} ${form.email}`}</p>
          </div>
          {error && <Alert type="error" message={error} />}
          <form onSubmit={(e) => e.preventDefault()} className="auth-form">
            <div className="form-group">
              <label>{t('auth.verify.enterCode')}</label>
              <div className="otp-input-row" onPaste={handleCodePaste}>
                {code.map((digit, i) => (
                  <input key={i} ref={(el) => { codeRefs.current[i] = el; }}
                    type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={(e) => handleCodeInput(i, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(i, e)}
                    className="otp-box" autoFocus={i === 0} autoComplete="off" disabled={isLoading} />
                ))}
              </div>
              {isLoading && (
                <p style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                  <span className="btn-spinner" style={{ marginRight: '0.4rem' }} /> {t('auth.verify.verifying')}
                </p>
              )}
            </div>
          </form>
          <div className="otp-resend-row">
            <span className="otp-resend-label">{t('auth.verify.didntReceive')}</span>
            <button type="button" className="otp-resend-btn" onClick={handleResend} disabled={isLoading}>
              {t('auth.verify.resend')}
            </button>
          </div>
          <p className="auth-footer-text" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="auth-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
              onClick={() => { setStep(1); setError(''); setCode(['', '', '', '', '', '']); }}>
              {t('auth.verify.backToReg')}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // Step 1 — Registration form
  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '3rem' }}>
      <div className="auth-card wide">
        <div className="auth-header">
          <div className="auth-logo-wrap">🏍️</div>
          <h1 className="auth-title">{t('auth.register.title')}</h1>
          <p className="auth-sub">{t('auth.register.subtitle')}</p>
        </div>

        <div className="role-cards">
          <button type="button" className={`role-card${role === 'RIDER' ? ' rider-selected' : ''}`} onClick={() => setRole('RIDER')}>
            <span className="role-card-icon">🧑‍💼</span>
            <span className="role-card-title">{t('auth.register.imRider')}</span>
            <span className="role-card-desc">{t('auth.register.riderDesc')}</span>
          </button>
          <button type="button" className={`role-card${role === 'DRIVER' ? ' driver-selected' : ''}`} onClick={() => setRole('DRIVER')}>
            <span className="role-card-icon">🏍️</span>
            <span className="role-card-title">{t('auth.register.imDriver')}</span>
            <span className="role-card-desc">{t('auth.register.driverDesc')}</span>
          </button>
        </div>

        {error && <Alert type="error" message={error} />}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-section-divider">
            <span className="form-section-label">{t('auth.register.accountDetails')}</span>
          </div>

          <div className="form-group">
            <label htmlFor="full_name">{t('auth.register.fullName')}</label>
            <input id="full_name" name="full_name" type="text" placeholder="John Kamau"
              value={form.full_name} onChange={handleChange} required autoComplete="name" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="phone">{t('auth.register.phone')}</label>
              <input id="phone" name="phone" type="tel" placeholder="+254700000000"
                value={form.phone} onChange={handleChange} required autoComplete="tel" />
            </div>
            <div className="form-group">
              <label htmlFor="email">{t('auth.register.email')}</label>
              <input id="email" name="email" type="email" placeholder="john@example.com"
                value={form.email} onChange={handleChange} required autoComplete="email" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">{t('auth.register.password')}</label>
              <input id="password" name="password" type="password"
                placeholder={t('auth.register.passwordPlaceholder')}
                value={form.password} onChange={handleChange} required autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label htmlFor="confirm_password">{t('auth.register.confirmPassword')}</label>
              <input id="confirm_password" name="confirm_password" type="password"
                placeholder={t('auth.register.repeatPassword')}
                value={form.confirm_password} onChange={handleChange} required autoComplete="new-password" />
            </div>
          </div>

          {role === 'DRIVER' && (
            <div className="driver-fields">
              <div className="form-section-divider">
                <span className="form-section-label driver-label">{t('auth.register.driverDetails')}</span>
              </div>
              <div className="form-group">
                <label htmlFor="license_number">{t('auth.register.licenseNumber')}</label>
                <input id="license_number" name="license_number" type="text" placeholder="DL-12345678"
                  value={form.license_number} onChange={handleChange} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="vehicle_model">{t('auth.register.vehicleModel')}</label>
                  <input id="vehicle_model" name="vehicle_model" type="text" placeholder="Bajaj Boxer 150"
                    value={form.vehicle_model} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label htmlFor="plate_number">{t('auth.register.plateNumber')}</label>
                  <input id="plate_number" name="plate_number" type="text" placeholder="KCA 123A"
                    value={form.plate_number} onChange={handleChange} required />
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={isLoading}
            className={`btn btn-block${role === 'DRIVER' ? ' btn-navy' : ' btn-primary'}`}
            style={{ padding: '0.875rem', marginTop: '0.5rem' }}>
            {isLoading ? (
              <><span className="btn-spinner" />{t('auth.register.creating')}</>
            ) : (
              role === 'RIDER' ? t('auth.register.createRider') : t('auth.register.createDriver')
            )}
          </button>
        </form>

        <p className="auth-footer-text">
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="auth-link">{t('auth.register.loginHere')}</Link>
        </p>
      </div>
    </div>
  );
}
