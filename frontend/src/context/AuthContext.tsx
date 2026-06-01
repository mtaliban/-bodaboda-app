import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
  User,
  LoginCredentials,
  AuthResponse,
  RegisterResponse,
  GoogleAuthPayload,
  AppleAuthPayload,
} from '../types';

type RegisterPayload = {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  role: 'RIDER' | 'DRIVER';
  driver_profile?: { license_number: string; vehicle_model: string; plate_number: string };
};

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthResponse>;
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  verifyEmail: (user_id: number, code: string) => Promise<void>;
  loginWithGoogle: (payload: GoogleAuthPayload) => Promise<void>;
  loginWithApple: (payload: AppleAuthPayload) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  const persistUser = (u: User) => {
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
  };

  const storeTokensAndUser = (data: AuthResponse) => {
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    persistUser(data.user);
  };

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get<User>('/auth/me');
      persistUser(data);
    } catch {
      // token may be invalid; interceptor handles redirect
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      refreshUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [navigate]);

  const login = async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>('/auth/login', credentials);
    storeTokensAndUser(data);
    return data;
  };

  const register = async (payload: RegisterPayload): Promise<RegisterResponse> => {
    const { data } = await api.post<RegisterResponse>('/auth/register', payload);
    return data;
  };

  const verifyEmail = async (user_id: number, code: string): Promise<void> => {
    const { data } = await api.post<AuthResponse>('/auth/verify-email', { user_id, code });
    storeTokensAndUser(data);
  };

  const loginWithGoogle = async (payload: GoogleAuthPayload): Promise<void> => {
    const { data } = await api.post<AuthResponse>('/auth/google', payload);
    storeTokensAndUser(data);
  };

  const loginWithApple = async (payload: AppleAuthPayload): Promise<void> => {
    const { data } = await api.post<AuthResponse>('/auth/apple', payload);
    storeTokensAndUser(data);
  };

  const logout = () => {
    const refreshToken = localStorage.getItem('refresh_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setUser(null);
    if (refreshToken) {
      fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8001'}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        verifyEmail,
        loginWithGoogle,
        loginWithApple,
        logout,
        refreshUser,
        setUser: persistUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
