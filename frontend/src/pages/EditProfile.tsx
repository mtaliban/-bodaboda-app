import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';

interface UpdateDriverProfilePayload {
  license_number?: string;
  vehicle_model?: string;
  plate_number?: string;
}
import Alert from '../components/Alert';
import { AxiosError } from 'axios';

function extractApiError(err: unknown): string {
  const error = err as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join(', ');
  return error.response?.data?.message ?? 'Update failed. Please try again.';
}

export default function EditProfile() {
  const { user: ctxUser, setUser } = useAuth();
  const isDriver = ctxUser?.role === 'DRIVER';

  const [user, setLocalUser] = useState<User | null>(ctxUser);
  const [form, setForm] = useState<UpdateDriverProfilePayload>({
    license_number: '',
    vehicle_model: '',
    plate_number: '',
  });
  const [isLoading, setIsLoading] = useState(!ctxUser);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<User>('/auth/me')
      .then(({ data }) => {
        setLocalUser(data);
        if (data.driver_profile) {
          setForm({
            license_number: data.driver_profile.license_number ?? '',
            vehicle_model:  data.driver_profile.vehicle_model  ?? '',
            plate_number:   data.driver_profile.plate_number   ?? '',
          });
        }
      })
      .catch(() => setError('Failed to load profile info.'))
      .finally(() => setIsLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const { data } = await api.put<User>('/auth/me/profile', form);
      setUser(data);
      setLocalUser(data);
      setSuccess('Driver profile updated successfully!');
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading profile…</p>
      </div>
    );
  }

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        {/* Header */}
        <div className="edit-card-head">
          <Link to="/profile" className="edit-back">← Back to Profile</Link>
          <h1 className="edit-title">
            {isDriver ? 'Edit Driver Profile' : 'Rider Profile'}
          </h1>
          <p className="edit-sub">
            {isDriver
              ? 'Update your vehicle and license information.'
              : 'Your rider profile stats are managed automatically.'}
          </p>
        </div>

        {/* Body */}
        <div className="edit-card-body">
          {success && <Alert type="success" message={success} />}
          {error   && <Alert type="error"   message={error}   />}

          {!isDriver ? (
            /* Rider — read-only */
            <div className="readonly-profile-card">
              <div className="readonly-title">Rider Profile (Read-only)</div>
              {user?.rider_profile ? (
                <>
                  <div className="info-row">
                    <span className="info-label">Profile ID</span>
                    <span className="info-value mono">{user.rider_profile.id}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Rating</span>
                    <span className="info-value">
                      {user.rider_profile.rating != null
                        ? `${user.rider_profile.rating.toFixed(1)} ★`
                        : 'No ratings yet'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Total Trips</span>
                    <span className="info-value">{user.rider_profile.total_trips}</span>
                  </div>
                </>
              ) : (
                <p className="info-empty">No rider profile found.</p>
              )}
              <div className="readonly-note">
                ℹ️ Rider profile stats (rating, trips) are updated automatically based on your rides.
              </div>
            </div>
          ) : (
            /* Driver — editable */
            <form onSubmit={handleSubmit} className="edit-form">
              <div className="form-section-divider">
                <span className="form-section-label driver-label">🏍️ Vehicle Details</span>
              </div>

              <div className="form-group">
                <label htmlFor="license_number">Driving License Number</label>
                <input
                  id="license_number"
                  name="license_number"
                  type="text"
                  value={form.license_number}
                  onChange={handleChange}
                  placeholder="DL-12345678"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="vehicle_model">Motorcycle Model</label>
                  <input
                    id="vehicle_model"
                    name="vehicle_model"
                    type="text"
                    value={form.vehicle_model}
                    onChange={handleChange}
                    placeholder="Bajaj Boxer 150"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="plate_number">Plate Number</label>
                  <input
                    id="plate_number"
                    name="plate_number"
                    type="text"
                    value={form.plate_number}
                    onChange={handleChange}
                    placeholder="KCA 123A"
                  />
                </div>
              </div>

              <div className="edit-actions">
                <Link to="/profile" className="btn btn-ghost">Cancel</Link>
                <button type="submit" disabled={isSaving} className="btn btn-navy">
                  {isSaving ? 'Saving…' : 'Save Driver Profile'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
