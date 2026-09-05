const API_URL = 'http://localhost:4000/api';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('codepilot_token');

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  let data: { message?: string } & T;

  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(rawBody) as { message?: string } & T;
    } catch {
      throw new Error(`API returned invalid JSON (HTTP ${response.status})`);
    }
  } else {
    throw new Error(
      response.status === 404
        ? `API route not found: ${endpoint}`
        : `API returned an unexpected response (HTTP ${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong');
  }

  return data;
}

export type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export type Repository = {
  id: string;
  name: string;
  fullName: string;
  githubId: string;
  language?: string | null;
  updatedAt: string;
};

export async function register(
  name: string,
  email: string,
  password: string
) {
  const data = await request<{
    token: string;
    user: User;
  }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      password,
    }),
  });

  localStorage.setItem('codepilot_token', data.token);

  return data;
}

export async function login(
  email: string,
  password: string
) {
  const data = await request<{
    token: string;
    user: User;
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
    }),
  });

  localStorage.setItem('codepilot_token', data.token);

  return data;
}

export async function getCurrentUser() {
  return request<{ user: User }>('/auth/me');
}

export async function getRepositories() {
  return request<{ repositories: Repository[] }>('/repositories');
}

export async function createRepository(repository: {
  name: string;
  fullName: string;
  githubId: string;
  language?: string;
}) {
  return request<{ repository: Repository }>('/repositories', {
    method: 'POST',
    body: JSON.stringify(repository),
  });
}

export function logout() {
  localStorage.removeItem('codepilot_token');
}
export type RepositoryTreeItem = {
  path: string;
  type: 'file' | 'folder';
  sha: string | null;
  size?: number | null;
};

export async function getRepositoryTree(repositoryId: string) {
  return request<{
    repository: {
      id: string;
      name: string;
      fullName: string;
      defaultBranch: string;
    };
    folders: RepositoryTreeItem[];
    files: RepositoryTreeItem[];
  }>(`/github/repositories/${repositoryId}/tree`);
}

export async function getRepositoryFile(
  repositoryId: string,
  path: string
) {
  return request<{
    path: string;
    name: string;
    content: string;
    size: number;
    sha: string | null;
  }>(
    `/github/repositories/${repositoryId}/file?path=${encodeURIComponent(path)}`
  );
}

export async function updateRepositoryFile(
  repositoryId: string,
  path: string,
  content: string
) {
  return request<{
    path: string;
    commitSha: string | null;
    contentSha: string | null;
  }>(`/github/repositories/${repositoryId}/file`, {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function analyzeRepositoryFile(
  repositoryId: string,
  path: string,
  content: string
) {
  return request<{
    path: string;
    model: string;
    analysis: string;
  }>('/ai/analyze-file', {
    method: 'POST',
    body: JSON.stringify({
      repositoryId,
      path,
      content,
    }),
  });
}

export async function proposeRepositoryFileFix(
  repositoryId: string,
  path: string,
  content: string
) {
  return request<{
    path: string;
    model: string;
    summary: string;
    originalCode: string;
    proposedCode: string;
  }>('/ai/fix-file', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, path, content }),
  });
}