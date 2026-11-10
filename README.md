AI-assisted code review and repository workspace for GitHub. Connect a repository, inspect its files, run an AI review, and approve proposed fixes before they are committed.

> Early-stage project: the authenticated repository workspace is available while additional dashboard areas are still evolving.

## Features

- JWT authentication with bcrypt password hashing
- GitHub OAuth and repository browsing
- In-browser file editing through the GitHub Contents API
- AI reviews with severity, impact, and recommendations
- Diff-based AI fix proposals with explicit approval
- Local Ollama support or OpenAI-compatible providers
- Express, Prisma, PostgreSQL, React, and Vite

## Setup

### Requirements

Node.js 20+, npm, PostgreSQL, a GitHub OAuth App, and either Ollama or an OpenAI-compatible AI provider.

### Install and configure

```bash
npm install
npm --prefix server install
cp server/.env.example server/.env
```

Create a PostgreSQL database, then set these values in `server/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:password@localhost:5432/codepilot"
JWT_SECRET="use-a-long-random-secret"
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
GITHUB_CALLBACK_URL="http://localhost:4000/api/github/callback"
```

Configure the GitHub OAuth App with:

- Homepage: `http://localhost:5173`
- Callback: `http://localhost:4000/api/github/callback`

Generate the database client, apply migrations, and start the app:

```bash
npm run db:generate
npm run db:migrate
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API health check is available at [http://localhost:4000/api/health](http://localhost:4000/api/health).

## AI providers

Ollama is the default. Install it and keep a coding model running:

```bash
ollama run qwen2.5-coder:1.5b
```

For an OpenAI-compatible provider, set:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY="your-provider-key"
AI_API_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4o-mini"
```

Useful optional settings include `PORT`, `CLIENT_URL`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL`. See `server/.env.example` for defaults.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and API together |
| `npm run build` | Build the frontend |
| `npm --prefix server run build` | Type-check the API |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Apply database migrations |

## Security

Keep `server/.env` and all provider credentials private. Use HTTPS and a strong `JWT_SECRET` in production. GitHub tokens stay server-side, and AI-generated changes are never committed without user approval.

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).




<img width="1920" height="1080" alt="Screenshot (8)" src="https://github.com/user-attachments/assets/54e12f77-9233-46cc-ace6-1cd5d95f4d45" />
<img width="1920" height="1080" alt="Screenshot (9)" src="https://github.com/user-attachments/assets/18ae2cff-9139-4aa9-af0a-8dd1091cdd4f" />
<img width="1920" height="1080" alt="Screenshot (10)" src="https://github.com/user-attachments/assets/832a2548-be88-4936-99e7-72e3b316c593" />

