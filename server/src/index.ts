import { config as loadEnv } from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  generateCodeFix,
  runCodeReview,
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

const updateFileSchema = z.object({
  repositoryId: z.string().min(1),
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
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

// --------------------------------------------------
// Health Check
// --------------------------------------------------

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

    const state = signGithubState(userId);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: GITHUB_CALLBACK_URL,
      scope: 'repo read:user user:email',
      state,
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
      // Store GitHub token
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
      // GitHub API headers
      // --------------------------------------------------

      const headers =
        githubHeaders(githubToken);

      // --------------------------------------------------
      // Get GitHub user
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

      console.log(
        `GitHub connected: ${githubUser.login}`
      );

      // --------------------------------------------------
      // Get GitHub repositories
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
      const repositories =
        await prisma.repository.findMany({
          where: {
            ownerId:
              (req as any).userId,
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