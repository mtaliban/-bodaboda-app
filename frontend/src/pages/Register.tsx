import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Alert from '../components/Alert';
import { Role } from '../types';
import { AxiosError } from 'axios';
import { trackClick } from '../metrics';

interface FormState {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  confirm_password: string;
  license_number: string;
  vehicle_model: string;
  plate_number: string;
}

const initialForm: FormState = {
  full_name: '',
  phone: '',
  email: '',
  password: '',
  confirm_password: '',
  license_number: '',
  vehicle_model: '',
  plate_number: '',
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

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    trackClick('register_submit');
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    try {
      if (role === 'DRIVER') {
        await register({
          full_name: form.full_name,
          phone: form.phone,
          email: form.email,
          password: form.password,
          role: 'DRIVER',
          driver_profile: {
            license_number: form.license_number,
            vehicle_model: form.vehicle_model,
            plate_number: form.plate_number,
          },
        });
      } else {
        await register({
          full_name: form.full_name,
          phone: form.phone,
          email: form.email,
          password: form.password,
          role: 'RIDER',
        });
      }
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '3rem' }}>
      <div className="auth-card wide">
        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo-wrap">🏍️</div>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Join BodaBoda — fast motorcycle rides across the city</p>
        </div>

        {/* Role selection cards */}
        <div className="role-cards">
          <button
            type="button"
            className={`role-card${role === 'RIDER' ? ' rider-selected' : ''}`}
            onClick={() => setRole('RIDER')}
          >
            <span className="role-card-icon">🧑‍💼</span>
            <span className="role-card-title">I'm a Rider</span>
            <span className="role-card-desc">I want to book motorcycle rides</span>
          </button>
          <button
            type="button"
            className={`role-card${role === 'DRIVER' ? ' driver-selected' : ''}`}
            onClick={() => setRole('DRIVER')}
          >
            <span className="role-card-icon">🏍️</span>
            <span className="role-card-title">I'm a Driver</span>
            <span className="role-card-desc">I want to earn by driving</span>
          </button>
        </div>

        {error && <Alert type="error" message={error} />}

        <form onSubmit={handleSubmit} className="auth-form">
          {/* Account details */}
          <div className="form-section-divider">
            <span className="form-section-label">Account Details</span>
          </div>

          <div className="form-group">
            <label htmlFor="full_name">Full Name</label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              placeholder="John Kamau"
              value={form.full_name}
              onChange={handleChange}
              required
              autoComplete="name"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                placeholder="+254700000000"
                value={form.phone}
                onChange={handleChange}
                required
                autoComplete="tel"
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="john@example.com"
                value={form.email}
                onChange={handleChange}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="Min. 6 characters"
                value={form.password}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm_password">Confirm Password</label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                placeholder="Repeat password"
                value={form.confirm_password}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
            </div>
          </div>

          {/* Driver-only fields */}
          {role === 'DRIVER' && (
            <div className="driver-fields">
              <div className="form-section-divider">
                <span className="form-section-label driver-label">🏍️ Driver Vehicle Details</span>
              </div>

              <div className="form-group">
                <label htmlFor="license_number">Driving License Number</label>
                <input
                  id="license_number"
                  name="license_number"
                  type="text"
                  placeholder="DL-12345678"
                  value={form.license_number}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="vehicle_model">Motorcycle Model</label>
                  <input
                    id="vehicle_model"
                    name="vehicle_model"
                    type="text"
                    placeholder="Bajaj Boxer 150"
                    value={form.vehicle_model}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="plate_number">Plate Number</label>
                  <input
                    id="plate_number"
                    name="plate_number"
                    type="text"
                    placeholder="KCA 123A"
                    value={form.plate_number}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`btn btn-block${role === 'DRIVER' ? ' btn-navy' : ' btn-primary'}`}
            style={{ padding: '0.875rem', marginTop: '0.5rem' }}
          >
            {isLoading ? (
              <>
                <span className="btn-spinner" />
                Creating account…
              </>
            ) : (
              `Create ${role === 'RIDER' ? 'Rider' : 'Driver'} Account`
            )}
          </button>
        </form>

        <p className="auth-footer-text">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">Login here</Link>
        </p>
      </div>
    </div>
  );
}
