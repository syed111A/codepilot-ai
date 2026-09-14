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

export async function disconnectGitHub() {
  return request<{ message: string }>('/github/disconnect', {
    method: 'POST',
  });
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

export async function createRepositoryPullRequest(
  repositoryId: string,
  title: string,
  body: string,
  changes: Array<{ path: string; content: string }>
) {
  return request<{
    number: number | null;
    title: string;
    url: string | null;
    branch: string;
    base: string;
  }>(`/github/repositories/${repositoryId}/pull-request`, {
    method: 'POST',
    body: JSON.stringify({ title, body, changes }),
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

export type RepositoryAnalysisFinding = {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  title: string;
  file: string;
  line: string;
  explanation: string;
  confidence: number;
  suggestedFix: string;
};

export async function analyzeRepository(repositoryId: string) {
  return request<{
    repository: string;
    model: string;
    filesAnalyzed: number;
    summary: string;
    findings: RepositoryAnalysisFinding[];
  }>('/ai/analyze-repository', {
    method: 'POST',
    body: JSON.stringify({ repositoryId }),
  });
}

export type GeneratedTestCase = {
  sourceFile: string;
  testFile: string;
  framework: string;
  title: string;
  rationale: string;
  testCode: string;
};

export async function generateRepositoryTests(
  repositoryId: string,
  path?: string,
  functionName?: string
) {
  return request<{
    repository: string;
    model: string;
    filesAnalyzed: number;
    summary: string;
    tests: GeneratedTestCase[];
  }>('/ai/generate-tests', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, path, functionName }),
  });
}

export async function askRepositoryAssistant(repositoryId: string, question: string) {
  return request<{
    repository: string;
    model: string;
    answer: string;
    sources: string[];
  }>('/ai/assistant', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, question }),
  });
}

export async function indexRepository(repositoryId: string) {
  return request<{ repository: string; filesIndexed: number; indexedAt: number }>(
    `/github/repositories/${repositoryId}/index`,
    { method: 'POST' }
  );
}

export async function searchRepository(repositoryId: string, query: string) {
  return request<{
    query: string;
    filesIndexed: number;
    results: Array<{ path: string; symbols: string[]; score: number }>;
  }>(`/github/repositories/${repositoryId}/search?q=${encodeURIComponent(query)}`);
}

export type VerificationStatus = 'passed' | 'failed' | 'unavailable' | 'error';

export type VerificationResult = {
  repository: string;
  framework: string;
  status: VerificationStatus;
  testsExecuted: string[];
  passed: number;
  failed: number;
  errorOutput: string;
  summary: string;
  filesInvolved: string[];
};

export async function verifyRepository(repositoryId: string, files: string[] = []) {
  return request<VerificationResult>(`/github/repositories/${repositoryId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ files }),
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