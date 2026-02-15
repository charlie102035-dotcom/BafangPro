import type { AuthSessionPayload, AuthStore } from '../types';

export type { AuthStore } from '../types';
export type AuthUser = AuthSessionPayload['user'];

type AuthResponse = AuthSessionPayload;

type UsersResponse = {
  users: AuthStore[];
};

type LoginInput = {
  storeId?: string;
  userId?: string;
  work_mode?: string;
  work_target?: string;
};

export class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : '請求失敗';
    const code = typeof payload?.code === 'string' ? payload.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
};

export const authApi = {
  listUsers: () => request<UsersResponse>('/api/auth/users'),
  me: () => request<AuthResponse>('/api/auth/me'),
  login: (input: LoginInput) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () =>
    request<void>('/api/auth/logout', {
      method: 'POST',
    }),
};
