import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';

interface UpdateAccountPayload {
  full_name?: string;
  phone?: string;
  email?: string;
  profile_image_url?: string;
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

export default function EditAccount() {
  const { user: ctxUser, setUser } = useAuth();
  const [form, setForm] = useState<UpdateAccountPayload>({
    full_name: ctxUser?.full_name ?? '',
    phone: ctxUser?.phone ?? '',
    email: ctxUser?.email ?? '',
    profile_image_url: ctxUser?.profile_image_url ?? '',
  });
  const [isLoading, setIsLoading] = useState(!ctxUser);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<User>('/auth/me')
      .then(({ data }) => {
        setForm({
          full_name: data.full_name ?? '',
          phone: data.phone ?? '',
          email: data.email ?? '',
          profile_image_url: data.profile_image_url ?? '',
        });
      })
      .catch(() => setError('Failed to load account info.'))
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
      const payload: UpdateAccountPayload = {};
      if (form.full_name)         payload.full_name         = form.full_name;
      if (form.phone)             payload.phone             = form.phone;
      if (form.email)             payload.email             = form.email;
      if (form.profile_image_url) payload.profile_image_url = form.profile_image_url;

      const { data } = await api.put<User>('/auth/me', payload);
      setUser(data);
      setSuccess('Account updated successfully!');
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
        <p>Loading account info…</p>
      </div>
    );
  }

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        {/* Header */}
        <div className="edit-card-head">
          <Link to="/profile" className="edit-back">← Back to Profile</Link>
          <h1 className="edit-title">Edit Account</h1>
          <p className="edit-sub">Update your name, phone, email, or profile picture.</p>
        </div>

        {/* Body */}
        <div className="edit-card-body">
          {success && <Alert type="success" message={success} />}
          {error   && <Alert type="error"   message={error}   />}

          <form onSubmit={handleSubmit} className="edit-form">
            <div className="form-group">
              <label htmlFor="full_name">Full Name</label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                value={form.full_name}
                onChange={handleChange}
                placeholder="Your full name"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+254700000000"
                />
              </div>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profile_image_url">Profile Image URL</label>
              <input
                id="profile_image_url"
                name="profile_image_url"
                type="url"
                value={form.profile_image_url ?? ''}
                onChange={handleChange}
                placeholder="https://example.com/photo.jpg"
              />
            </div>

            <div className="edit-actions">
              <Link to="/profile" className="btn btn-ghost">Cancel</Link>
              <button type="submit" disabled={isSaving} className="btn btn-primary">
                {isSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
