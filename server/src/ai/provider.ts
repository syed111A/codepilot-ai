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

const systemPrompt = [
  'You are CodePilot, a senior code reviewer.',
  'Analyze source code for bugs, security vulnerabilities, performance problems, code-quality issues, and improvements.',
  'Do not claim a problem exists when the code does not support it.',
].join(' ');

function getProviderConfig() {
  const provider = process.env.AI_PROVIDER || 'ollama';
  const model = provider === 'ollama'
    ? (process.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b')
    : (process.env.AI_MODEL || 'gpt-4o-mini');

  return { provider, model };
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

  throw new Error(`Unsupported AI provider: ${provider}`);
}
