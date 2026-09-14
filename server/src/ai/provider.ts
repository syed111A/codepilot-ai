import OpenAI from 'openai';

type ProviderInput = {
  repository: string;
  path: string;
  content: string;
};

type ProviderResult = {
  model: string;
  text: string;
};

export type RepositoryReviewFinding = {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  title: string;
  file: string;
  line: string;
  explanation: string;
  confidence: number;
  suggestedFix: string;
};

export type GeneratedTestCase = {
  sourceFile: string;
  testFile: string;
  framework: string;
  title: string;
  rationale: string;
  testCode: string;
};

const systemPrompt = [
  'You are CodePilot, a senior code reviewer.',
  'Analyze source code for bugs, security vulnerabilities, performance problems, code-quality issues, and improvements.',
  'Do not claim a problem exists when the code does not support it.',
].join(' ');

function getProviderConfig() {
  const provider = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
  if (provider === 'google') {
    return { provider, model: process.env.GOOGLE_MODEL || process.env.AI_MODEL || 'gemini-3.6-flash' };
  }

  if (provider === 'openai') {
    return { provider, model: process.env.AI_MODEL || 'gpt-4o-mini' };
  }

  return { provider: 'ollama', model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b' };
}

function formatUserPrompt(input: ProviderInput) {
  return [
    `Repository: ${input.repository}`,
    `File: ${input.path}`,
    '',
    '```',
    input.content,
    '```',
  ].join('\n');
}

export async function runCodeReview(input: ProviderInput): Promise<ProviderResult> {
  return runProviderRequest(
    input,
    [
      systemPrompt,
      'Return a concise Markdown report with these headings: Summary, Findings, Suggested Improvements.',
      'For each finding include severity (Critical, High, Medium, Low, or Info), the relevant line or symbol, why it matters, and a practical recommendation.',
    ].join(' '),
    formatUserPrompt(input),
    false
  );
}

export async function generateCodeFix(input: ProviderInput): Promise<ProviderResult> {
  return runProviderRequest(
    input,
    [
      systemPrompt,
      'Produce a corrected version only when a concrete improvement is justified.',
      'Return valid JSON only with exactly these string fields: summary and proposedCode.',
      'The proposedCode must contain the complete file, preserve the original language and formatting where practical, and contain no Markdown fences.',
      'If no fix is needed, proposedCode must equal the original file and summary must say that no safe change was identified.',
    ].join(' '),
    formatUserPrompt(input),
    true
  );
}

export async function runRepositoryReview(
  input: ProviderInput
): Promise<ProviderResult> {
  return runProviderRequest(
    input,
    [
      systemPrompt,
      'Review the complete repository context, considering relationships between files, configuration, dependencies, data flow, and architecture.',
      'Return valid JSON only with exactly these fields: summary (string) and findings (array).',
      'Each finding must contain exactly these fields: severity (Critical, High, Medium, Low, or Info), title (string), file (string), line (string), explanation (string), confidence (number from 0 to 1), and suggestedFix (string).',
      'Only report evidence-based findings. Use an empty findings array when no actionable issue is identified.',
    ].join(' '),
    input.content,
    true
  );
}

export async function generateRepositoryTests(
  input: { repository: string; content: string }
): Promise<ProviderResult> {
  return runProviderRequest(
    { repository: input.repository, path: 'repository', content: input.content },
    [
      'You identify missing or insufficient unit tests from real repository source files.',
      'Return valid JSON only with exactly these fields: summary (string) and tests (array).',
      'Each test must contain sourceFile, testFile, framework, title, rationale, and testCode as strings.',
      'Generate practical tests only for behavior supported by the supplied source. Prefer the repository language and existing test conventions.',
      'Include normal unit cases, meaningful edge cases, and error or exception cases when the source behavior supports them.',
      'When a target source file or function is provided, generate tests for that target first and do not invent a function that is absent from the context.',
      'Use an empty tests array when no meaningful test can be generated.',
    ].join(' '),
    input.content,
    true
  );
}

export async function answerRepositoryQuestion(
  input: { repository: string; question: string; content: string }
): Promise<ProviderResult> {
  return runProviderRequest(
    { repository: input.repository, path: 'repository', content: input.content },
    [
      'You are CodePilot, an AI engineering assistant answering questions about a repository.',
      'Use only the repository context supplied by the user. Never invent files, symbols, dependencies, or behavior.',
      'If the context is insufficient, say exactly what is missing and do not guess.',
      'Answer clearly and practically. Reference relevant file paths and symbols from the context when available.',
    ].join(' '),
    `Repository question: ${input.question}\n\nRepository context:\n${input.content}`,
    false
  );
}

async function runProviderRequest(
  input: ProviderInput,
  system: string,
  user: string,
  jsonFormat: boolean
): Promise<ProviderResult> {
  const { provider, model } = getProviderConfig();

  if (provider === 'ollama') {
    const response = await fetch(
      `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(jsonFormat ? { format: 'json' } : {}),
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      }
    );
    const data = await response.json() as {
      message?: { content?: string };
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || 'Ollama could not process the file');
    }

    return { model, text: data.message?.content || '' };
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI is not configured. Add OPENAI_API_KEY to server/.env.');
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_API_URL,
    });
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    return {
      model,
      text: completion.choices[0]?.message?.content || '',
    };
  }

  if (provider === 'google') {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.AI_API_KEY;

    if (!apiKey) {
      throw new Error('Google Gemini is not configured. Add GOOGLE_API_KEY to server/.env.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${system}\n\n${user}` }] },
          ],
          generationConfig: {
            temperature: 0.2,
            ...(jsonFormat ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      }
    );

    const data = await response.json() as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; 
    };

    if (!response.ok) {
      throw new Error(data.error?.message || 'Google Gemini could not process the request');
    }

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
    return { model, text };
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}
