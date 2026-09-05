# CodePilot AI — Step 2

AI-powered software engineering platform.

## What's included
- React + TypeScript frontend from Step 1
- Express + TypeScript API
- PostgreSQL + Prisma data model
- Secure password hashing with bcrypt
- JWT authentication
- Register / login / current-user endpoints
- Protected repository endpoints
- Environment configuration

## Run
1. Install Node.js 20+ and PostgreSQL.
2. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` and `JWT_SECRET`.
	Install Ollama, run `ollama run qwen2.5-coder:1.5b`, and keep it running to enable the **Analyze with AI** action. The server uses Ollama at `http://127.0.0.1:11434` by default. Set `AI_PROVIDER=openai` to use an OpenAI-compatible provider instead.
3. Install dependencies: `npm install`
4. Generate Prisma client: `npm run db:generate`
5. Create database tables: `npm run db:migrate`
6. Start client + API: `npm run dev`

Frontend: http://localhost:5173
API: http://localhost:4000/api/health
