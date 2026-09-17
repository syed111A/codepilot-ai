import { config as loadEnv } from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  generateCodeFix,
  generateRepositoryTests,
  answerRepositoryQuestion,
  runCodeReview,
  runRepositoryReview,
  type RepositoryReviewFinding,
} from './ai/provider';

loadEnv({
  path: fileURLToPath(
    new URL('../.env', import.meta.url)
  ),
});

// --------------------------------------------------
// Prisma
// --------------------------------------------------

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

// --------------------------------------------------
// Express
// --------------------------------------------------

const app = express();

const PORT = Number(process.env.PORT || 4000);

const CLIENT_URL =
  process.env.CLIENT_URL || 'http://localhost:5173';

const GITHUB_CALLBACK_URL =
  process.env.GITHUB_CALLBACK_URL ||
  'http://localhost:4000/api/github/callback';

const JWT_SECRET =
  process.env.JWT_SECRET || 'development-secret-change-me';

function githubErrorRedirect(
  reason: string
) {
  const url = new URL(CLIENT_URL);
  url.searchParams.set('github', 'error');
  url.searchParams.set('reason', reason);
  return url.toString();
}

function githubSuccessRedirect() {
  const url = new URL(CLIENT_URL);
  url.searchParams.set('github', 'connected');
  return url.toString();
}

app.use(
  cors({
    origin: CLIENT_URL,
  })
);
app.use(express.json());

// --------------------------------------------------
// Validation Schemas
// --------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const repositorySchema = z.object({
  name: z.string().min(1),
  fullName: z.string().min(1),
  githubId: z.string().min(1),
  language: z.string().optional(),
});

const analyzeFileSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().min(1).max(500),
  content: z.string().min(1).max(200_000),
});

const fixFileSchema = analyzeFileSchema;

const analyzeRepositorySchema = z.object({
  repositoryId: z.string().min(1),
});

const generateTestsSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().min(1).max(500).optional(),
  functionName: z.string().min(1).max(200).optional(),
});

const assistantQuestionSchema = z.object({
  repositoryId: z.string().min(1),
  question: z.string().min(1).max(4_000),
});

const verifyRepositorySchema = z.object({
  files: z.array(z.string()).optional().default([]),
});

function parseGeneratedTests(response: string) {
  const cleaned = response
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { summary?: unknown; tests?: unknown };
    const tests = Array.isArray(parsed.tests)
      ? parsed.tests.flatMap((test) => {
        if (!test || typeof test !== 'object') return [];
        const item = test as Record<string, unknown>;
        if (Object.values(item).some((value) => typeof value !== 'string')) return [];
        if (!item.sourceFile || !item.testFile || !item.framework || !item.title || !item.rationale || !item.testCode) return [];
        return [{
          sourceFile: item.sourceFile,
          testFile: item.testFile,
          framework: item.framework,
          title: item.title,
          rationale: item.rationale,
          testCode: item.testCode,
        }];
      })
      : [];

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Test generation complete.',
      tests,
    };
  } catch {
    return { summary: 'The AI provider returned an unreadable test plan.', tests: [] };
  }
}

const updateFileSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
});

const createPullRequestSchema = z.object({
  repositoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  changes: z.array(z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(200_000),
  })).min(1),
});

function parseFixResponse(
  response: string,
  originalCode: string
) {
  const cleaned = response
    .trim()
    .replace(/^```(?:json|[a-zA-Z0-9#+.-]+)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      summary?: unknown;
      proposedCode?: unknown;
    };

    if (
      typeof parsed.summary === 'string' &&
      typeof parsed.proposedCode === 'string'
    ) {
      return parsed;
    }
  } catch {
    // Small local models sometimes ignore the JSON response format.
  }

  if (
    cleaned.startsWith('<!DOCTYPE') ||
    cleaned.startsWith('<html') ||
    cleaned.includes('\n')
  ) {
    return {
      summary: 'The model returned a complete replacement for review.',
      proposedCode: cleaned,
    };
  }

  return {
    summary: 'No safe code replacement was returned.',
    proposedCode: originalCode,
  };
}

// --------------------------------------------------
// JWT
// --------------------------------------------------

function signToken(userId: string) {
  return jwt.sign(
    {
      sub: userId,
    },
    JWT_SECRET,
    {
      expiresIn: '7d',
    }
  );
}

function signGithubState(userId: string) {
  return jwt.sign(
    {
      sub: userId,
      purpose: 'github-oauth',
    },
    JWT_SECRET,
    {
      expiresIn: '10m',
    }
  );
}

// --------------------------------------------------
// Authentication Middleware
// --------------------------------------------------

async function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required',
    });
  }

  try {
    const token = header.slice(7);

    const payload = jwt.verify(
      token,
      JWT_SECRET
    ) as jwt.JwtPayload;

    if (!payload.sub) {
      throw new Error('Invalid token');
    }

    (req as any).userId = payload.sub;

    return next();
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired token',
    });
  }
}

// --------------------------------------------------
// GitHub API Helper
// --------------------------------------------------

function githubHeaders(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

const ignoredPathParts = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);

const ignoredExtensions = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.class',
  '.dll',
  '.dmg',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.iso',
  '.jar',
  '.jpeg',
  '.jpg',
  '.lock',
  '.mp3',
  '.mp4',
  '.mov',
  '.o',
  '.obj',
  '.pdf',
  '.png',
  '.so',
  '.svg',
  '.tar',
  '.ttf',
  '.wav',
  '.webm',
  '.woff',
  '.woff2',
  '.zip',
]);

type IndexedRepositoryFile = {
  path: string;
  content: string;
  tokens: Set<string>;
  symbols: string[];
};

type RepositoryIndex = {
  branch: string;
  createdAt: number;
  files: IndexedRepositoryFile[];
};

const repositoryIndexes = new Map<string, RepositoryIndex>();

function tokenize(value: string) {
  return value.toLowerCase().match(/[a-z0-9_$-]{2,}/g) || [];
}

function extractSymbols(content: string) {
  return [...content.matchAll(/(?:function|class|interface|type|const|def|func)\s+([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]);
}

function scoreIndexedFile(file: IndexedRepositoryFile, query: string) {
  const queryTokens = tokenize(query);
  return queryTokens.reduce((score, token) => {
    const path = file.path.toLowerCase();
    const symbolMatch = file.symbols.some((symbol) => symbol.toLowerCase().includes(token));
    return score + (path.includes(token) ? 5 : 0) + (symbolMatch ? 4 : 0) + (file.tokens.has(token) ? 1 : 0);
  }, 0);
}

async function buildRepositoryIndex(
  repository: { id: string; fullName: string; defaultBranch: string },
  token: string,
  force = false
) {
  const cached = repositoryIndexes.get(repository.id);
  if (!force && cached?.branch === repository.defaultBranch) return cached;

  const parts = repository.fullName.split('/');
  if (parts.length !== 2) throw new Error('Invalid GitHub repository name');
  const [owner, repo] = parts;
  const headers = githubHeaders(token);
  const treeResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(repository.defaultBranch)}?recursive=1`,
    { headers }
  );
  if (!treeResponse.ok) throw new Error('Unable to retrieve repository files from GitHub');

  const treeData = await treeResponse.json() as { tree?: Array<{ type?: string; path?: string; sha?: string; size?: number }> };
  const candidates = (treeData.tree || [])
    .filter((item) => item.type === 'blob' && typeof item.path === 'string' && item.sha)
    .filter((item) => isAnalyzablePath(item.path!, item.size))
    .slice(0, 100);
  const files: IndexedRepositoryFile[] = [];

  for (const candidate of candidates) {
    const blobResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(candidate.sha!)}`,
      { headers }
    );
    if (!blobResponse.ok) continue;
    const blobData = await blobResponse.json() as { encoding?: string; content?: string };
    if (blobData.encoding !== 'base64' || typeof blobData.content !== 'string') continue;
    const content = Buffer.from(blobData.content.replace(/\s/g, ''), 'base64').toString('utf-8');
    if (content.includes('\u0000')) continue;
    files.push({
      path: candidate.path!,
      content,
      tokens: new Set(tokenize(`${candidate.path} ${content}`)),
      symbols: extractSymbols(content),
    });
  }

  const index = { branch: repository.defaultBranch, createdAt: Date.now(), files };
  repositoryIndexes.set(repository.id, index);
  return index;
}

function retrieveRepositoryContext(index: RepositoryIndex, question: string) {
  return index.files
    .map((file) => ({ file, score: scoreIndexedFile(file, question) }))
    .sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
    .slice(0, 8)
    .filter((item) => item.score > 0 || question.trim().length === 0)
    .map((item) => item.file);
}

function isAnalyzablePath(path: string, size: unknown) {
  const parts = path.toLowerCase().split('/');
  const extension = parts[parts.length - 1].includes('.')
    ? `.${parts[parts.length - 1].split('.').pop()}`
    : '';

  return !parts.some((part) => ignoredPathParts.has(part)) &&
    !ignoredExtensions.has(extension) &&
    (typeof size !== 'number' || size <= 80_000);
}

function parseRepositoryReview(
  response: string
): { summary: string; findings: RepositoryReviewFinding[] } {
  const cleaned = response
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      summary?: unknown;
      findings?: unknown;
    };
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.flatMap((finding) => {
        if (!finding || typeof finding !== 'object') return [];

        const item = finding as Record<string, unknown>;
        const severity = item.severity;
        if (
          typeof item.title !== 'string' ||
          typeof item.file !== 'string' ||
          typeof item.line !== 'string' ||
          typeof item.explanation !== 'string' ||
          typeof item.confidence !== 'number' ||
          item.confidence < 0 ||
          item.confidence > 1 ||
          typeof item.suggestedFix !== 'string' ||
          !['Critical', 'High', 'Medium', 'Low', 'Info'].includes(String(severity))
        ) {
          return [];
        }

        return [{
          severity: severity as RepositoryReviewFinding['severity'],
          title: item.title,
          file: item.file,
          line: item.line,
          explanation: item.explanation,
          confidence: item.confidence,
          suggestedFix: item.suggestedFix,
        }];
      })
      : [];

    return {
      summary: typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Repository review complete.',
      findings,
    };
  } catch {
    return {
      summary: 'The AI provider returned an unreadable repository review.',
      findings: [],
    };
  }
}

// --------------------------------------------------
// Health Check
// --------------------------------------------------

app.get('/', (_req, res) => {
  return res.json({
    service: 'CodePilot API',
    status: 'ok',
    health: '/api/health',
  });
});

app.get('/api/health', (_req, res) => {
  return res.json({
    status: 'ok',
    service: 'CodePilot API',
  });
});

// --------------------------------------------------
// Authentication Routes
// --------------------------------------------------

app.post('/api/auth/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid registration data',
        errors: parsed.error.flatten(),
      });
    }

    const {
      name,
      email,
      password,
    } = parsed.data;

    const normalizedEmail = email.toLowerCase();

    const existingUser =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (existingUser) {
      return res.status(409).json({
        message:
          'An account with this email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(
      password,
      12
    );

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
      },
    });

    const token = signToken(user.id);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);

    return res.status(500).json({
      message: 'Unable to register user',
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid login data',
      });
    }

    const normalizedEmail =
      parsed.data.email.toLowerCase();

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (
      !user ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    await prisma.$transaction([
      prisma.repository.deleteMany({
        where: {
          ownerId: user.id,
        },
      }),
      prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          githubAccessToken: null,
        },
      }),
    ]);

    const token = signToken(user.id);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      message: 'Unable to login',
    });
  }
});

// --------------------------------------------------
// Current User
// --------------------------------------------------

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user =
      await prisma.user.findUnique({
        where: {
          id: (req as any).userId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      });

    if (!user) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    return res.json({
      user,
    });
  } catch (error) {
    console.error('Get user error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve user',
    });
  }
});

// --------------------------------------------------
// GitHub OAuth - Login URL
// --------------------------------------------------

app.get('/api/github/login', auth, async (req, res) => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;

    if (!clientId) {
      return res.status(500).json({
        message: 'GitHub Client ID is not configured',
      });
    }

    const userId = (req as any).userId;

    // Ensure the old GitHub account identity and repository rows
    // are not carried into a new GitHub OAuth attempt.
    await prisma.$transaction([
      prisma.repository.deleteMany({
        where: {
          ownerId: userId,
        },
      }),
      prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          githubAccessToken: null,
        },
      }),
    ]);

    const state = signGithubState(userId);

    const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: GITHUB_CALLBACK_URL,
  scope: 'repo read:user user:email',
  state,
  prompt: 'select_account',
});

    const githubUrl =
      `https://github.com/login/oauth/authorize?${params.toString()}`;

    return res.json({
      url: githubUrl,
    });
  } catch (error) {
    console.error('GitHub login error:', error);

    return res.status(500).json({
      message: 'Unable to start GitHub login',
    });
  }
});

// --------------------------------------------------
// GitHub OAuth - Callback
// --------------------------------------------------

app.post(
  '/api/github/disconnect',
  auth,
  async (req, res) => {
    try {
      const userId =
        (req as any).userId;

      await prisma.$transaction([
        prisma.repository.deleteMany({
          where: {
            ownerId: userId,
          },
        }),
        prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            githubAccessToken: null,
          },
        }),
      ]);

      return res.json({
        message:
          'GitHub disconnected successfully',
      });
    } catch (error) {
      console.error(
        'GitHub disconnect error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to disconnect GitHub',
      });
    }
  }
);

app.get(
  '/api/github/callback',
  async (req, res) => {
    try {
      const code = String(
        req.query.code || ''
      );

      const state = String(
        req.query.state || ''
      );

      if (!code || !state) {
        return res.redirect(
          githubErrorRedirect('missing_code_or_state')
        );
      }

      const statePayload =
        jwt.verify(
          state,
          JWT_SECRET
        ) as jwt.JwtPayload;

      if (
        statePayload.purpose !==
          'github-oauth' ||
        !statePayload.sub
      ) {
        return res.redirect(
          githubErrorRedirect('invalid_oauth_state')
        );
      }

      const userId =
        String(statePayload.sub);

      const clientId =
        process.env.GITHUB_CLIENT_ID;

      const clientSecret =
        process.env.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.error(
          'GitHub OAuth credentials are missing'
        );

        return res.redirect(
          githubErrorRedirect('missing_oauth_credentials')
        );
      }

      // --------------------------------------------------
      // Exchange GitHub authorization code for token
      // --------------------------------------------------

      const tokenResponse =
        await fetch(
          'https://github.com/login/oauth/access_token',
          {
            method: 'POST',
            headers: {
              Accept:
                'application/json',
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              client_id: clientId,
              client_secret:
                clientSecret,
              code,
              redirect_uri:
                GITHUB_CALLBACK_URL,
            }),
          }
        );

      const tokenData =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {
        console.error(
          'GitHub token error:',
          tokenData
        );

        return res.redirect(
          githubErrorRedirect('token_exchange_failed')
        );
      }

      const githubToken =
        String(tokenData.access_token);

      // --------------------------------------------------
      // Store the new GitHub token for this CodePilot user.
      // --------------------------------------------------

      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          githubAccessToken: githubToken,
        },
      });

      // --------------------------------------------------
      // GitHub API headers for the fresh token
      // --------------------------------------------------

      const headers =
        githubHeaders(githubToken);

      // --------------------------------------------------
      // Verify the authenticated GitHub account from the
      // newly issued OAuth access token before importing.
      // --------------------------------------------------

      const githubUserResponse =
        await fetch(
          'https://api.github.com/user',
          {
            headers,
          }
        );

      if (!githubUserResponse.ok) {
        console.error(
          'Unable to retrieve GitHub user'
        );

        return res.redirect(
          githubErrorRedirect('github_user_request_failed')
        );
      }

      const githubUser =
        await githubUserResponse.json();

      if (
        !githubUser.login ||
        typeof githubUser.id !== 'number'
      ) {
        console.error(
          'GitHub account identity verification failed'
        );

        return res.redirect(
          githubErrorRedirect('github_identity_verification_failed')
        );
      }

      console.log(
        `GitHub connected: ${githubUser.login}`
      );

      // --------------------------------------------------
      // Remove repository records tied to the same local
      // CodePilot user so the previous GitHub account's
      // repository identity is not carried forward.
      // --------------------------------------------------

      await prisma.repository.deleteMany({
        where: {
          ownerId: userId,
        },
      });

      // --------------------------------------------------
      // Get GitHub repositories from the newly authenticated
      // GitHub account only.
      // --------------------------------------------------

      const repositoriesResponse =
        await fetch(
          'https://api.github.com/user/repos?per_page=100&sort=updated',
          {
            headers,
          }
        );

      if (!repositoriesResponse.ok) {
        console.error(
          'Unable to retrieve GitHub repositories'
        );

        return res.redirect(
          githubErrorRedirect('github_repositories_request_failed')
        );
      }

      const githubRepositories =
        await repositoriesResponse.json();

      // --------------------------------------------------
      // Import repositories
      // --------------------------------------------------

      let importedCount = 0;

      for (
        const repo of githubRepositories
      ) {
        if (
          repo.id === undefined ||
          !repo.name ||
          !repo.full_name
        ) {
          continue;
        }

        const githubId =
          String(repo.id);

        const language =
          repo.language
            ? String(repo.language)
            : null;

        const defaultBranch =
          repo.default_branch
            ? String(
                repo.default_branch
              )
            : 'main';

        await prisma.repository.upsert({
          where: {
            githubId_ownerId: {
              githubId,
              ownerId: userId,
            },
          },

          update: {
            name: String(
              repo.name
            ),

            fullName: String(
              repo.full_name
            ),

            language,

            defaultBranch,

            ownerId: userId,
          },

          create: {
            name: String(
              repo.name
            ),

            fullName: String(
              repo.full_name
            ),

            githubId,

            language,

            defaultBranch,

            ownerId: userId,
          },
        });

        importedCount++;
      }

      console.log(
        `Imported ${importedCount} GitHub repositories for user ${userId}`
      );

      return res.redirect(
        githubSuccessRedirect()
      );
    } catch (error) {
      console.error(
        'GitHub OAuth callback error:',
        error
      );

      return res.redirect(
        githubErrorRedirect('oauth_callback_failed')
      );
    }
  }
);

// --------------------------------------------------
// Repository Routes
// --------------------------------------------------

app.get(
  '/api/repositories',
  auth,
  async (req, res) => {
    try {
      const userId =
        (req as any).userId;

      const user =
        await prisma.user.findUnique({
          where: {
            id: userId,
          },
          select: {
            githubAccessToken: true,
          },
        });

      if (!user?.githubAccessToken) {
        return res.json({
          repositories: [],
        });
      }

      const repositories =
        await prisma.repository.findMany({
          where: {
            ownerId: userId,
          },

          orderBy: {
            updatedAt: 'desc',
          },
        });

      return res.json({
        repositories,
      });
    } catch (error) {
      console.error(
        'Repository fetch error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to retrieve repositories',
      });
    }
  }
);

app.post(
  '/api/repositories',
  auth,
  async (req, res) => {
    try {
      const parsed =
        repositorySchema.safeParse(
          req.body
        );

      if (!parsed.success) {
        return res.status(400).json({
          message:
            'Invalid repository data',

          errors:
            parsed.error.flatten(),
        });
      }

      const repository =
        await prisma.repository.create({
          data: {
            ...parsed.data,

            ownerId:
              (req as any).userId,
          },
        });

      return res.status(201).json({
        repository,
      });
    } catch (error) {
      console.error(
        'Repository creation error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to create repository',
      });
    }
  }
);

// --------------------------------------------------
// Code Explorer - Repository Tree
// --------------------------------------------------

app.get(
  '/api/github/repositories/:repositoryId/tree',
  auth,
  async (req, res) => {
    try {
      const userId =
        (req as any).userId;

      const repositoryId =
        String(req.params.repositoryId);

      // Verify repository ownership
      const repository =
        await prisma.repository.findFirst({
          where: {
            id: repositoryId,
            ownerId: userId,
          },
        });

      if (!repository) {
        return res.status(404).json({
          message:
            'Repository not found',
        });
      }

      // Get GitHub token
      const user =
        await prisma.user.findUnique({
          where: {
            id: userId,
          },
          select: {
            githubAccessToken: true,
          },
        });

      if (!user?.githubAccessToken) {
        return res.status(400).json({
          message:
            'GitHub is not connected. Please connect GitHub first.',
        });
      }

      const parts =
        repository.fullName.split('/');

      if (parts.length !== 2) {
        return res.status(400).json({
          message:
            'Invalid GitHub repository name',
        });
      }

      const owner = parts[0];
      const repo = parts[1];

      // --------------------------------------------------
      // Get complete Git tree
      // --------------------------------------------------

      const treeUrl =
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(repository.defaultBranch)}?recursive=1`;

      const githubToken =
        user.githubAccessToken;

      const githubResponse =
        await fetch(
          treeUrl,
          {
            headers:
              githubHeaders(
                githubToken
              ),
          }
        );

      if (!githubResponse.ok) {
        const errorText =
          await githubResponse.text();

        console.error(
          'GitHub tree error:',
          githubResponse.status,
          errorText
        );

        if (
          githubResponse.status === 401
        ) {
          return res.status(401).json({
            message:
              'GitHub authorization expired. Please reconnect GitHub.',
          });
        }

        if (
          githubResponse.status === 403
        ) {
          return res.status(403).json({
            message:
              'GitHub denied access to this repository.',
          });
        }

        return res.status(502).json({
          message:
            'Unable to retrieve repository tree from GitHub',
        });
      }

      const treeData =
        await githubResponse.json();

      const tree =
        Array.isArray(treeData.tree)
          ? treeData.tree
          : [];

      const files = tree
        .filter(
          (item: any) =>
            item.type === 'blob'
        )
        .map(
          (item: any) => ({
            path: String(item.path),
            type: 'file',
            sha: item.sha
              ? String(item.sha)
              : null,
            size:
              typeof item.size ===
              'number'
                ? item.size
                : null,
          })
        );

      const folders = tree
        .filter(
          (item: any) =>
            item.type === 'tree'
        )
        .map(
          (item: any) => ({
            path: String(item.path),
            type: 'folder',
            sha: item.sha
              ? String(item.sha)
              : null,
          })
        );

      return res.json({
        repository: {
          id: repository.id,
          name: repository.name,
          fullName:
            repository.fullName,
          defaultBranch:
            repository.defaultBranch,
        },
        folders,
        files,
      });
    } catch (error) {
      console.error(
        'Repository tree error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to retrieve repository tree',
      });
    }
  }
);

// --------------------------------------------------
// Code Explorer - File Content
// --------------------------------------------------

app.get(
  '/api/github/repositories/:repositoryId/file',
  auth,
  async (req, res) => {
    try {
      const userId =
        (req as any).userId;

      const repositoryId =
        String(req.params.repositoryId);

      const requestedPath =
        String(req.query.path || '');

      if (!requestedPath) {
        return res.status(400).json({
          message:
            'File path is required',
        });
      }

      // Basic path validation
      if (
        requestedPath.startsWith('/') ||
        requestedPath.includes('..')
      ) {
        return res.status(400).json({
          message:
            'Invalid file path',
        });
      }

      // Verify repository ownership
      const repository =
        await prisma.repository.findFirst({
          where: {
            id: repositoryId,
            ownerId: userId,
          },
        });

      if (!repository) {
        return res.status(404).json({
          message:
            'Repository not found',
        });
      }

      // Get GitHub token
      const user =
        await prisma.user.findUnique({
          where: {
            id: userId,
          },
          select: {
            githubAccessToken: true,
          },
        });

      if (!user?.githubAccessToken) {
        return res.status(400).json({
          message:
            'GitHub is not connected. Please connect GitHub first.',
        });
      }

      const parts =
        repository.fullName.split('/');

      if (parts.length !== 2) {
        return res.status(400).json({
          message:
            'Invalid GitHub repository name',
        });
      }

      const owner = parts[0];
      const repo = parts[1];

      // --------------------------------------------------
      // Get file from GitHub
      // --------------------------------------------------

      const encodedPath =
        requestedPath
          .split('/')
          .map(
            (segment) =>
              encodeURIComponent(segment)
          )
          .join('/');

      const fileUrl =
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(repository.defaultBranch)}`;

      const githubToken =
        user.githubAccessToken;

      const githubResponse =
        await fetch(
          fileUrl,
          {
            headers:
              githubHeaders(
                githubToken
              ),
          }
        );

      if (!githubResponse.ok) {
        const errorText =
          await githubResponse.text();

        console.error(
          'GitHub file error:',
          githubResponse.status,
          errorText
        );

        if (
          githubResponse.status === 401
        ) {
          return res.status(401).json({
            message:
              'GitHub authorization expired. Please reconnect GitHub.',
          });
        }

        if (
          githubResponse.status === 404
        ) {
          return res.status(404).json({
            message:
              'File not found on GitHub',
          });
        }

        return res.status(502).json({
          message:
            'Unable to retrieve file from GitHub',
        });
      }

      const fileData =
        await githubResponse.json();

      if (
        fileData.type !== 'file'
      ) {
        return res.status(400).json({
          message:
            'The selected path is not a file',
        });
      }

      // GitHub normally returns base64 content
      if (
        fileData.encoding !==
        'base64' ||
        typeof fileData.content !==
        'string'
      ) {
        return res.status(502).json({
          message:
            'GitHub returned an unsupported file format',
        });
      }

      const cleanBase64 =
        fileData.content.replace(
          /\s/g,
          ''
        );

      const content =
        Buffer.from(
          cleanBase64,
          'base64'
        ).toString('utf-8');

      return res.json({
        path: requestedPath,
        name:
          requestedPath.split('/').pop() ||
          requestedPath,
        content,
        size:
          typeof fileData.size ===
          'number'
            ? fileData.size
            : Buffer.byteLength(
                content,
                'utf-8'
              ),
        sha:
          fileData.sha
            ? String(fileData.sha)
            : null,
      });
    } catch (error) {
      console.error(
        'Repository file error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to retrieve repository file',
      });
    }
  }
);

app.put(
  '/api/github/repositories/:repositoryId/file',
  auth,
  async (req, res) => {
    try {
      const parsed = updateFileSchema.safeParse({
        ...req.body,
        repositoryId: req.params.repositoryId,
      });

      if (!parsed.success) {
        return res.status(400).json({
          message: 'A valid repository, file path, and file content are required',
        });
      }

      const userId = (req as any).userId;
      const repository = await prisma.repository.findFirst({
        where: {
          id: parsed.data.repositoryId,
          ownerId: userId,
        },
      });

      if (!repository) {
        return res.status(404).json({ message: 'Repository not found' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });

      if (!user?.githubAccessToken) {
        return res.status(400).json({
          message: 'GitHub is not connected. Please connect GitHub first.',
        });
      }

      const parts = repository.fullName.split('/');
      if (parts.length !== 2) {
        return res.status(400).json({ message: 'Invalid GitHub repository name' });
      }

      const [owner, repo] = parts;
      const encodedPath = parsed.data.path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const fileUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
      const headers = {
        ...githubHeaders(user.githubAccessToken),
        'Content-Type': 'application/json',
      };

      const currentResponse = await fetch(
        `${fileUrl}?ref=${encodeURIComponent(repository.defaultBranch)}`,
        { headers }
      );

      if (!currentResponse.ok) {
        return res.status(502).json({ message: 'Unable to retrieve the current GitHub file' });
      }

      const currentFile = await currentResponse.json();
      if (!currentFile.sha) {
        return res.status(502).json({ message: 'GitHub did not return a file revision' });
      }

      const updateResponse = await fetch(fileUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `Apply AI fix to ${parsed.data.path}`,
          content: Buffer.from(parsed.data.content, 'utf-8').toString('base64'),
          sha: String(currentFile.sha),
          branch: repository.defaultBranch,
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('GitHub file update error:', updateResponse.status, errorText);
        return res.status(updateResponse.status === 409 ? 409 : 502).json({
          message: updateResponse.status === 409
            ? 'The GitHub file changed since it was opened. Reload it and try again.'
            : 'Unable to update the file on GitHub',
        });
      }

      const updateData = await updateResponse.json();
      return res.json({
        path: parsed.data.path,
        commitSha: updateData.commit?.sha || null,
        contentSha: updateData.content?.sha || null,
      });
    } catch (error) {
      console.error('Repository file update error:', error);
      return res.status(500).json({ message: 'Unable to update repository file' });
    }
  }
);

app.post(
  '/api/github/repositories/:repositoryId/pull-request',
  auth,
  async (req, res) => {
    try {
      const parsed = createPullRequestSchema.safeParse({
        ...req.body,
        repositoryId: req.params.repositoryId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: 'A valid pull request title, body, and approved changes are required' });
      }

      const userId = (req as any).userId;
      const repository = await prisma.repository.findFirst({
        where: { id: parsed.data.repositoryId, ownerId: userId },
      });
      if (!repository) return res.status(404).json({ message: 'Repository not found' });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });
      if (!user?.githubAccessToken) {
        return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });
      }

      const parts = repository.fullName.split('/');
      if (parts.length !== 2) return res.status(400).json({ message: 'Invalid GitHub repository name' });
      const [owner, repo] = parts;
      const headers = { ...githubHeaders(user.githubAccessToken), 'Content-Type': 'application/json' };
      const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

      const branch = `codepilot/approved-fixes-${Date.now()}`;
      const refResponse = await fetch(`${apiBase}/git/ref/heads/${encodeURIComponent(repository.defaultBranch)}`, { headers });
      if (!refResponse.ok) return res.status(502).json({ message: 'Unable to read the default GitHub branch' });
      const refData = await refResponse.json() as { object?: { sha?: string } };
      if (!refData.object?.sha) return res.status(502).json({ message: 'GitHub did not return the default branch revision' });

      const branchResponse = await fetch(`${apiBase}/git/refs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: refData.object.sha }),
      });
      if (!branchResponse.ok) {
        const details = await branchResponse.text();
        console.error('GitHub branch creation error:', branchResponse.status, details);
        return res.status(502).json({ message: 'Unable to create a GitHub branch for the pull request' });
      }

      for (const change of parsed.data.changes) {
        const encodedPath = change.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const fileUrl = `${apiBase}/contents/${encodedPath}`;
        const currentResponse = await fetch(`${fileUrl}?ref=${encodeURIComponent(repository.defaultBranch)}`, { headers });
        if (!currentResponse.ok && currentResponse.status !== 404) {
          return res.status(502).json({ message: `Unable to read ${change.path} from the default branch` });
        }
        const currentFile = currentResponse.ok
          ? await currentResponse.json() as { sha?: string }
          : {};

        const updateResponse = await fetch(fileUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Apply approved CodePilot change to ${change.path}`,
            content: Buffer.from(change.content, 'utf-8').toString('base64'),
            ...(currentFile.sha ? { sha: currentFile.sha } : {}),
            branch,
          }),
        });
        if (!updateResponse.ok) {
          const details = await updateResponse.text();
          console.error('GitHub branch file update error:', updateResponse.status, details);
          return res.status(502).json({ message: `Unable to apply ${change.path} to the pull request branch` });
        }
      }

      const pullResponse = await fetch(`${apiBase}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: parsed.data.title,
          body: parsed.data.body,
          head: branch,
          base: repository.defaultBranch,
        }),
      });
      if (!pullResponse.ok) {
        const details = await pullResponse.text();
        console.error('GitHub pull request error:', pullResponse.status, details);
        return res.status(502).json({ message: 'Branch created, but GitHub could not create the pull request' });
      }

      const pull = await pullResponse.json() as { html_url?: string; number?: number; title?: string };
      return res.status(201).json({
        number: pull.number || null,
        title: pull.title || parsed.data.title,
        url: pull.html_url || null,
        branch,
        base: repository.defaultBranch,
      });
    } catch (error) {
      console.error('GitHub pull request creation error:', error);
      return res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to create pull request' });
    }
  }
);

// --------------------------------------------------
// AI Repository Analysis
// --------------------------------------------------

app.post(
  '/api/ai/analyze-repository',
  auth,
  async (req, res) => {
    try {
      const parsed = analyzeRepositorySchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'A valid repository is required',
        });
      }

      const userId = (req as any).userId;
      const repository = await prisma.repository.findFirst({
        where: {
          id: parsed.data.repositoryId,
          ownerId: userId,
        },
      });

      if (!repository) {
        return res.status(404).json({ message: 'Repository not found' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });

      if (!user?.githubAccessToken) {
        return res.status(400).json({
          message: 'GitHub is not connected. Please connect GitHub first.',
        });
      }

      const parts = repository.fullName.split('/');
      if (parts.length !== 2) {
        return res.status(400).json({ message: 'Invalid GitHub repository name' });
      }

      const [owner, repo] = parts;
      const headers = githubHeaders(user.githubAccessToken);
      const treeUrl =
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(repository.defaultBranch)}?recursive=1`;
      const treeResponse = await fetch(treeUrl, { headers });

      if (!treeResponse.ok) {
        return res.status(treeResponse.status === 401 ? 401 : 502).json({
          message: treeResponse.status === 401
            ? 'GitHub authorization expired. Please reconnect GitHub.'
            : 'Unable to retrieve the repository tree from GitHub',
        });
      }

      const treeData = await treeResponse.json() as {
        tree?: Array<{ type?: string; path?: string; sha?: string; size?: number }>;
      };
      const candidates = (treeData.tree || [])
        .filter((item) => item.type === 'blob' && typeof item.path === 'string' && item.sha)
        .filter((item) => isAnalyzablePath(item.path!, item.size))
        .sort((left, right) => {
          const priority = (path: string) => /(^|\/)(package\.json|README|tsconfig|vite\.config|\.env\.example)/i.test(path) ? 0 : 1;
          return priority(left.path!) - priority(right.path!) || left.path!.localeCompare(right.path!);
        })
        .slice(0, 40);

      const files: string[] = [];
      let contextBytes = 0;
      const maxContextBytes = 120_000;

      for (const candidate of candidates) {
        const blobUrl =
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(candidate.sha!)}`;
        const blobResponse = await fetch(blobUrl, { headers });
        if (!blobResponse.ok) continue;

        const blobData = await blobResponse.json() as {
          encoding?: string;
          content?: string;
        };
        if (blobData.encoding !== 'base64' || typeof blobData.content !== 'string') continue;

        const content = Buffer.from(blobData.content.replace(/\s/g, ''), 'base64').toString('utf-8');
        if (content.includes('\u0000')) continue;

        const section = `### FILE: ${candidate.path}\n${content}\n\n`;
        const sectionBytes = Buffer.byteLength(section, 'utf-8');
        if (contextBytes + sectionBytes > maxContextBytes) continue;

        files.push(section);
        contextBytes += sectionBytes;
      }

      if (files.length === 0) {
        return res.status(422).json({
          message: 'No supported source files were found to analyze',
        });
      }

      const result = await runRepositoryReview({
        repository: repository.fullName,
        path: 'repository',
        content: files.join(''),
      });
      const review = parseRepositoryReview(result.text);

      return res.json({
        repository: repository.fullName,
        model: result.model,
        filesAnalyzed: files.length,
        summary: review.summary,
        findings: review.findings,
      });
    } catch (error) {
      console.error('Repository analysis error:', error);
      return res.status(500).json({
        message: error instanceof Error
          ? error.message
          : 'Unable to analyze repository',
      });
    }
  }
);

app.post(
  '/api/ai/generate-tests',
  auth,
  async (req, res) => {
    try {
      const parsed = generateTestsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'A valid repository is required' });

      const repository = await prisma.repository.findFirst({
        where: { id: parsed.data.repositoryId, ownerId: (req as any).userId },
      });
      if (!repository) return res.status(404).json({ message: 'Repository not found' });

      const user = await prisma.user.findUnique({
        where: { id: (req as any).userId },
        select: { githubAccessToken: true },
      });
      if (!user?.githubAccessToken) return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });

      const index = await buildRepositoryIndex(repository, user.githubAccessToken);
      const query = [parsed.data.path, parsed.data.functionName, 'unit tests edge cases errors'].filter(Boolean).join(' ');
      const retrieved = parsed.data.path
        ? [] as IndexedRepositoryFile[]
        : retrieveRepositoryContext(index, query);
      if (parsed.data.path) {
        const selectedFile = index.files.find((file) => file.path === parsed.data.path);
        if (selectedFile) {
          retrieved.unshift(selectedFile);
        }

        if (!retrieved.some((file) => file.path === parsed.data.path)) {
          const parts = repository.fullName.split('/');
          if (parts.length !== 2) return res.status(400).json({ message: 'Invalid GitHub repository name' });
          const encodedPath = parsed.data.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
          const fileResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/contents/${encodedPath}?ref=${encodeURIComponent(repository.defaultBranch)}`,
            { headers: githubHeaders(user.githubAccessToken) }
          );
          if (fileResponse.ok) {
            const fileData = await fileResponse.json() as { encoding?: string; content?: string };
            if (fileData.encoding === 'base64' && typeof fileData.content === 'string') {
              const content = Buffer.from(fileData.content.replace(/\s/g, ''), 'base64').toString('utf-8');
              retrieved.unshift({
                path: parsed.data.path,
                content,
                tokens: new Set(tokenize(`${parsed.data.path} ${content}`)),
                symbols: extractSymbols(content),
              });
            }
          }
        }
      }
      const files = retrieved.map((file) => `### FILE: ${file.path}\n${file.content}\n\n`);

      if (files.length === 0) return res.status(422).json({ message: 'No supported source files were found to test' });
      const result = await generateRepositoryTests({
        repository: repository.fullName,
        content: [
          parsed.data.path ? `Target source file: ${parsed.data.path}` : 'Target source file: choose from the retrieved files',
          parsed.data.functionName ? `Target function: ${parsed.data.functionName}` : '',
          files.join(''),
        ].join('\n'),
      });
      const generated = parseGeneratedTests(result.text);
      return res.json({ repository: repository.fullName, model: result.model, filesAnalyzed: files.length, ...generated });
    } catch (error) {
      console.error('Test generation error:', error);
      return res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to generate repository tests' });
    }
  }
);

app.post(
  '/api/ai/assistant',
  auth,
  async (req, res) => {
    try {
      const parsed = assistantQuestionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'A repository and question are required' });

      const userId = (req as any).userId;
      const repository = await prisma.repository.findFirst({
        where: { id: parsed.data.repositoryId, ownerId: userId },
      });
      if (!repository) return res.status(404).json({ message: 'Repository not found' });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessToken: true },
      });
      if (!user?.githubAccessToken) return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });

      const index = await buildRepositoryIndex(repository, user.githubAccessToken);
      const retrieved = retrieveRepositoryContext(index, parsed.data.question);
      if (retrieved.length === 0) return res.status(422).json({ message: 'No relevant repository files were found for that question' });
      const context = retrieved.map((file) => `### FILE: ${file.path}\n${file.content}\n\n`).join('');
      const result = await answerRepositoryQuestion({
        repository: repository.fullName,
        question: parsed.data.question,
        content: context,
      });

      return res.json({ repository: repository.fullName, model: result.model, answer: result.text, sources: retrieved.map((file) => file.path) });
    } catch (error) {
      console.error('Repository assistant error:', error);
      return res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to answer repository question' });
    }
  }
);

app.post('/api/github/repositories/:repositoryId/verify', auth, async (req, res) => {
  try {
    const repositoryId = String(req.params.repositoryId);
    const parsed = verifyRepositorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'A valid verification file list is required' });
    }

    const userId = (req as any).userId;
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, ownerId: userId },
    });

    if (!repository) {
      return res.status(404).json({ message: 'Repository not found' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });
    }

    const parts = repository.fullName.split('/');
    if (parts.length !== 2) {
      return res.status(400).json({ message: 'Invalid GitHub repository name' });
    }

    const [owner, repo] = parts;
    const cloneRoot = join(tmpdir(), `codepilot-verify-${Date.now()}`);
    mkdirSync(cloneRoot, { recursive: true });

    const repoFolder = join(cloneRoot, repo);
    const cloneUrl = `https://x-access-token:${user.githubAccessToken}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
    const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', repository.defaultBranch, cloneUrl, repoFolder], {
      cwd: cloneRoot,
      encoding: 'utf8',
    });

    if (clone.status !== 0 || clone.error) {
      const output = `${clone.stdout || ''}\n${clone.stderr || ''}`;
      return res.status(502).json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: output || 'Unable to clone the repository for verification.',
        summary: 'Verification is unavailable because the repository could not be fetched from GitHub.',
        filesInvolved: parsed.data.files,
      });
    }

    const packagePath = join(repoFolder, 'package.json');
    if (!existsSync(packagePath)) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no package.json script or test configuration detected for this repository.',
        summary: 'Verification is unavailable because no package.json script or test framework is present.',
        filesInvolved: parsed.data.files,
      });
    }

    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const dependencies = {
      ...(packageManifest.dependencies || {}),
      ...(packageManifest.devDependencies || {}),
    };

    const frameworks = Object.keys(dependencies).filter((dep) => [
      'jest',
      'vitest',
      'mocha',
      'ava',
      'playwright',
      'cypress',
      'chai',
      'ts-jest',
    ].includes(dep));

    if (frameworks.length === 0) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no supported test framework detected in the repository package configuration.',
        summary: 'Verification is unavailable because no test framework is declared in the repository package.json.',
        filesInvolved: parsed.data.files,
      });
    }

    const scripts = packageManifest.scripts || {};
    const relevantKeys = Object.keys(scripts)
      .filter((name) => {
        const lower = name.toLowerCase();
        return (
          name === 'test' ||
          name.startsWith('test:') ||
          lower.includes('test') ||
          lower === 'verify' ||
          lower.startsWith('verify:') ||
          lower === 'check' ||
          lower.startsWith('check:') ||
          lower === 'lint' ||
          lower.startsWith('lint:') ||
          lower === 'build' ||
          lower.startsWith('build:') ||
          lower === 'ci' ||
          lower.startsWith('ci:')
        );
      })
      .sort();

    if (relevantKeys.length === 0) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: frameworks.join(', '),
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no runnable test or verification scripts were declared in the repository package.json.',
        summary: 'Verification is unavailable because the repository has a detected framework but no matching test or verification scripts.',
        filesInvolved: parsed.data.files,
      });
    }

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const outputs: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const script of relevantKeys) {
      const run = spawnSync(npmCommand, ['run', script], {
        cwd: repoFolder,
        encoding: 'utf8',
        env: process.env,
      });

      const text = `${run.stdout || ''}\n${run.stderr || ''}`;
      outputs.push(`${script}: ${text}`);

      if (run.status === 0) {
        passed++;
      } else {
        failed++;
      }
    }

    const status = failed === 0 ? 'passed' : 'failed';
    const summary = failed === 0
      ? `Verification passed for ${relevantKeys.length} existing repository script(s).`
      : `Verification failed for ${failed} script(s) while ${passed} succeeded.`;

    rmSync(repoFolder, { recursive: true, force: true });
    rmSync(cloneRoot, { recursive: true, force: true });

    return res.json({
      repository: repository.fullName,
      framework: frameworks.join(', '),
      status,
      testsExecuted: relevantKeys,
      passed,
      failed,
      errorOutput: outputs.join('\n---\n') || 'No error output.',
      summary,
      filesInvolved: parsed.data.files,
    });
  } catch (error) {
    console.error('Repository verification error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to verify repository' });
  }
});

app.post('/api/github/repositories/:repositoryId/verify', auth, async (req, res) => {
  try {
    const repositoryId = String(req.params.repositoryId);
    const parsed = verifyRepositorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'A valid verification file list is required' });
    }

    const userId = (req as any).userId;
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, ownerId: userId },
    });

    if (!repository) {
      return res.status(404).json({ message: 'Repository not found' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });
    }

    const parts = repository.fullName.split('/');
    if (parts.length !== 2) {
      return res.status(400).json({ message: 'Invalid GitHub repository name' });
    }

    const [owner, repo] = parts;
    const cloneRoot = join(tmpdir(), `codepilot-verify-${Date.now()}`);
    mkdirSync(cloneRoot, { recursive: true });

    const repoFolder = join(cloneRoot, repo);
    const cloneUrl = `https://x-access-token:${user.githubAccessToken}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
    const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', repository.defaultBranch, cloneUrl, repoFolder], {
      cwd: cloneRoot,
      encoding: 'utf8',
    });

    if (clone.status !== 0 || clone.error) {
      const output = `${clone.stdout || ''}\n${clone.stderr || ''}`;
      return res.status(502).json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: output || 'Unable to clone the repository for verification.',
        summary: 'Verification is unavailable because the repository could not be fetched from GitHub.',
        filesInvolved: parsed.data.files,
      });
    }

    const packagePath = join(repoFolder, 'package.json');
    if (!existsSync(packagePath)) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no package.json script or test configuration detected for this repository.',
        summary: 'Verification is unavailable because no package.json script or test framework is present.',
        filesInvolved: parsed.data.files,
      });
    }

    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const dependencies = {
      ...(packageManifest.dependencies || {}),
      ...(packageManifest.devDependencies || {}),
    };

    const frameworks = Object.keys(dependencies).filter((dep) => [
      'jest',
      'vitest',
      'mocha',
      'ava',
      'playwright',
      'cypress',
      'chai',
      'ts-jest',
    ].includes(dep));

    if (frameworks.length === 0) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: 'none',
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no supported test framework detected in the repository package configuration.',
        summary: 'Verification is unavailable because no test framework is declared in the repository package.json.',
        filesInvolved: parsed.data.files,
      });
    }

    const scripts = packageManifest.scripts || {};
    const relevantKeys = Object.keys(scripts)
      .filter((name) => {
        const lower = name.toLowerCase();
        return (
          name === 'test' ||
          name.startsWith('test:') ||
          lower.includes('test') ||
          lower === 'verify' ||
          lower.startsWith('verify:') ||
          lower === 'check' ||
          lower.startsWith('check:') ||
          lower === 'lint' ||
          lower.startsWith('lint:') ||
          lower === 'build' ||
          lower.startsWith('build:') ||
          lower === 'ci' ||
          lower.startsWith('ci:')
        );
      })
      .sort();

    if (relevantKeys.length === 0) {
      rmSync(repoFolder, { recursive: true, force: true });
      rmSync(cloneRoot, { recursive: true, force: true });
      return res.json({
        repository: repository.fullName,
        framework: frameworks.join(', '),
        status: 'unavailable',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: 'Verification unavailable: no runnable test or verification scripts were declared in the repository package.json.',
        summary: 'Verification is unavailable because the repository has a detected framework but no matching test or verification scripts.',
        filesInvolved: parsed.data.files,
      });
    }

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const outputs: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const script of relevantKeys) {
      const run = spawnSync(npmCommand, ['run', script], {
        cwd: repoFolder,
        encoding: 'utf8',
        env: process.env,
      });

      const text = `${run.stdout || ''}\n${run.stderr || ''}`;
      outputs.push(`${script}: ${text}`);

      if (run.status === 0) {
        passed++;
      } else {
        failed++;
      }
    }

    const status = failed === 0 ? 'passed' : 'failed';
    const summary = failed === 0
      ? `Verification passed for ${relevantKeys.length} existing repository script(s).`
      : `Verification failed for ${failed} script(s) while ${passed} succeeded.`;

    rmSync(repoFolder, { recursive: true, force: true });
    rmSync(cloneRoot, { recursive: true, force: true });

    return res.json({
      repository: repository.fullName,
      framework: frameworks.join(', '),
      status,
      testsExecuted: relevantKeys,
      passed,
      failed,
      errorOutput: outputs.join('\n---\n') || 'No error output.',
      summary,
      filesInvolved: parsed.data.files,
    });
  } catch (error) {
    console.error('Repository verification error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to verify repository' });
  }
});

app.post('/api/github/repositories/:repositoryId/index', auth, async (req, res) => {
  try {
    const repository = await prisma.repository.findFirst({ where: { id: String(req.params.repositoryId), ownerId: (req as any).userId } });
    if (!repository) return res.status(404).json({ message: 'Repository not found' });
    const user = await prisma.user.findUnique({ where: { id: (req as any).userId }, select: { githubAccessToken: true } });
    if (!user?.githubAccessToken) return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });
    const index = await buildRepositoryIndex(repository, user.githubAccessToken, true);
    return res.json({ repository: repository.fullName, filesIndexed: index.files.length, indexedAt: index.createdAt });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to index repository' });
  }
});

app.get('/api/github/repositories/:repositoryId/search', auth, async (req, res) => {
  try {
    const repository = await prisma.repository.findFirst({ where: { id: String(req.params.repositoryId), ownerId: (req as any).userId } });
    if (!repository) return res.status(404).json({ message: 'Repository not found' });
    const user = await prisma.user.findUnique({ where: { id: (req as any).userId }, select: { githubAccessToken: true } });
    if (!user?.githubAccessToken) return res.status(400).json({ message: 'GitHub is not connected. Please connect GitHub first.' });
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ message: 'A search query is required' });
    const index = await buildRepositoryIndex(repository, user.githubAccessToken);
    const results = index.files
      .map((file) => ({ path: file.path, symbols: file.symbols, score: scoreIndexedFile(file, query) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
    return res.json({ query, results, filesIndexed: index.files.length });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to search repository' });
  }
});

// --------------------------------------------------
// AI Code Analysis
// --------------------------------------------------

app.post(
  '/api/ai/analyze-file',
  auth,
  async (req, res) => {
    try {
      const parsed = analyzeFileSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'A valid repository, file path, and file content are required',
        });
      }

      const repository = await prisma.repository.findFirst({
        where: {
          id: parsed.data.repositoryId,
          ownerId: (req as any).userId,
        },
        select: {
          fullName: true,
        },
      });

      if (!repository) {
        return res.status(404).json({
          message: 'Repository not found',
        });
      }

      const result = await runCodeReview({
        repository: repository.fullName,
        path: parsed.data.path,
        content: parsed.data.content,
      });
      const analysis = result.text;

      if (!analysis) {
        return res.status(502).json({
          message: 'The AI provider returned an empty analysis',
        });
      }

      return res.json({
        path: parsed.data.path,
        model: result.model,
        analysis,
      });
    } catch (error) {
      console.error('AI file analysis error:', error);
      return res.status(500).json({
        message: error instanceof Error
          ? error.message
          : 'Unable to analyze this file',
      });
    }
  }
);

app.post(
  '/api/ai/fix-file',
  auth,
  async (req, res) => {
    try {
      const parsed = fixFileSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'A valid repository, file path, and file content are required',
        });
      }

      const repository = await prisma.repository.findFirst({
        where: {
          id: parsed.data.repositoryId,
          ownerId: (req as any).userId,
        },
        select: { fullName: true },
      });

      if (!repository) {
        return res.status(404).json({ message: 'Repository not found' });
      }

      const result = await generateCodeFix({
        repository: repository.fullName,
        path: parsed.data.path,
        content: parsed.data.content,
      });
      const parsedResult = parseFixResponse(
        result.text,
        parsed.data.content
      );

      return res.json({
        path: parsed.data.path,
        model: result.model,
        summary: parsedResult.summary,
        originalCode: parsed.data.content,
        proposedCode: parsedResult.proposedCode,
      });
    } catch (error) {
      console.error('AI file fix error:', error);
      return res.status(500).json({
        message: error instanceof Error ? error.message : 'Unable to generate a file fix',
      });
    }
  }
);

// --------------------------------------------------
// Global Error Handler
// --------------------------------------------------

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      'Unhandled server error:',
      err
    );

    return res.status(500).json({
      message:
        'Internal server error',
    });
  }
);

// --------------------------------------------------
// Start Server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `CodePilot API running at http://localhost:${PORT}`
  );
});