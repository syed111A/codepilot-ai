const TOKEN_KEY = 'codepilot_token';
const USER_KEY = 'codepilot_user';

export type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const value = localStorage.getItem(USER_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as User; } catch { return null; }
}

export function saveAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function getMe(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;

  const response = await fetch('http://localhost:4000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    logout();
    return null;
  }

  const data = await response.json();
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}
