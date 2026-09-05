import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  Loader2,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube2,
  UserCircle2,
  X,
} from 'lucide-react';

import {
  getRepositories,
  getRepositoryTree,
  getRepositoryFile,
  analyzeRepositoryFile,
  proposeRepositoryFileFix,
  type Repository,
  type RepositoryTreeItem,
} from './lib/api';

import Auth from './components/Auth';

import {
  getMe,
  logout,
  type User,
} from './lib/auth';
const nav = [
  ['Dashboard', LayoutDashboard],
  ['Repositories', Code2],
  ['AI Assistant', Bot],
  ['Code Analysis', Activity],
  ['Security', ShieldCheck],
  ['Tests', TestTube2],
  ['Pull Requests', GitPullRequest],
  ['Settings', Settings],
] as const;

export default function App() {
  const [active, setActive] = useState('Dashboard');
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(true);

  const [user, setUser] = useState<User | null>(null);

  const [repositories, setRepositories] =
    useState<Repository[]>([]);

  const [selectedRepository, setSelectedRepository] =
    useState<Repository | null>(null);

  const [loading, setLoading] = useState(true);
  const [githubConnecting, setGithubConnecting] =
    useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    const githubStatus =
      params.get('github');

    if (githubStatus === 'connected') {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );

      loadRepositories();
      return;
    }

    if (githubStatus === 'error') {
      const reason =
        params.get('reason');

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );

      alert(
        reason
          ? `GitHub connection failed (${reason}). Check the API terminal for details.`
          : 'GitHub connection failed. Please try again.'
      );
    }
  }, []);

  async function loadUser() {
    try {
      const currentUser = await getMe();

      if (!currentUser) {
        setLoading(false);
        return;
      }

      setUser(currentUser);

      await loadRepositories();
    } catch (error) {
      console.error(
        'Could not load user:',
        error
      );

      logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadRepositories() {
    try {
      const repoResult =
        await getRepositories();

      setRepositories(
        repoResult.repositories
      );
    } catch (error) {
      console.error(
        'Could not load repositories:',
        error
      );

      setRepositories([]);
    }
  }

  async function handleAuthenticated(
    authenticatedUser: User
  ) {
    setUser(authenticatedUser);

    await loadRepositories();
  }

  function handleLogout() {
    logout();

    setUser(null);
    setRepositories([]);
    setSelectedRepository(null);
    setActive('Dashboard');
  }

  async function connectGitHub() {
    const token =
      localStorage.getItem(
        'codepilot_token'
      );

    if (!token) {
      setUser(null);
      return;
    }

    try {
      setGithubConnecting(true);

      const response = await fetch(
        'http://localhost:4000/api/github/login',
        {
          method: 'GET',
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.url
      ) {
        throw new Error(
          data.message ||
          'Unable to start GitHub connection'
        );
      }

      window.location.href =
        data.url;
    } catch (error) {
      console.error(
        'GitHub connection error:',
        error
      );

      setGithubConnecting(false);

      alert(
        error instanceof Error
          ? error.message
          : 'Unable to connect GitHub'
      );
    }
  }

  function openRepository(
    repository: Repository
  ) {
    setSelectedRepository(
      repository
    );

    setActive(
      'Repository Workspace'
    );

    setMobile(false);
  }

  function backToDashboard() {
    setSelectedRepository(null);
    setActive('Dashboard');
  }

  if (loading) {
    return (
      <div
        className={
          dark
            ? 'app'
            : 'app light'
        }
      >
        <div
          style={{
            width: '100%',
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            fontSize: '14px',
          }}
        >
          Loading CodePilot...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Auth
        onAuthenticated={
          handleAuthenticated
        }
      />
    );
  }

  return (
    <div
      className={
        dark
          ? 'app'
          : 'app light'
      }
    >
      <aside
        className={
          mobile
            ? 'sidebar open'
            : 'sidebar'
        }
      >
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={17} />
          </div>

          <span>
            CodePilot <b>AI</b>
          </span>

          <button
            className="close"
            onClick={() =>
              setMobile(false)
            }
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace">
          <div className="workspace-icon">
            SP
          </div>

          <div>
            <strong>
              Software Projects
            </strong>

            <small>
              Personal workspace
            </small>
          </div>

          <ChevronDown size={15} />
        </div>

        <nav>
          {nav.map(
            ([label, Icon]) => (
              <button
                key={label}
                className={
                  active === label &&
                  !selectedRepository
                    ? 'nav-item active'
                    : 'nav-item'
                }
                onClick={() => {
                  setSelectedRepository(
                    null
                  );

                  setActive(label);
                  setMobile(false);
                }}
              >
                <Icon size={18} />

                <span>{label}</span>

                {label ===
                  'Security' && (
                  <em>4</em>
                )}
              </button>
            )
          )}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item">
            <Settings size={18} />

            <span>
              Preferences
            </span>
          </button>

          <button
            className="user"
            onClick={handleLogout}
            style={{
              width: '100%',
              background:
                'transparent',
              border: 0,
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            title="Logout"
          >
            <div className="avatar">
              {user.name
                .split(' ')
                .map(
                  (x) => x[0]
                )
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>

            <div>
              <strong>
                {user.name}
              </strong>

              <small>
                Developer · Logout
              </small>
            </div>

            <ChevronDown
              size={15}
            />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu"
            onClick={() =>
              setMobile(true)
            }
          >
            <Menu />
          </button>

          <div className="crumb">
            <span>
              Workspace
            </span>

            <b>/</b>

            <strong>
              {active}
            </strong>
          </div>

          <div className="top-actions">
            <button className="search">
              <Search size={17} />

              <span>
                Search
              </span>

              <kbd>
                ⌘ K
              </kbd>
            </button>

            <button
              className="icon-btn"
              onClick={() =>
                setDark(!dark)
              }
            >
              {dark ? (
                <Moon size={18} />
              ) : (
                <Sparkles size={18} />
              )}
            </button>

            <button className="icon-btn">
              <Activity size={18} />
            </button>

            <UserCircle2
              size={22}
            />
          </div>
        </header>

        {selectedRepository ? (
          <RepositoryWorkspace
            repository={
              selectedRepository
            }
            onBack={
              backToDashboard
            }
          />
        ) : (
          <Dashboard
            user={user}
            repositories={
              repositories
            }
            githubConnecting={
              githubConnecting
            }
            connectGitHub={
              connectGitHub
            }
            openRepository={
              openRepository
            }
          />
        )}
      </main>
    </div>
  );
}
function Metric({
  title,
  value,
  note,
  icon,
  danger = false,
}: {
  title: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  danger?: boolean;
}) 
{
  return (
    <div className="metric-card">
      <div
        className="metric-icon"
        style={{
          color: danger ? '#ef4444' : undefined,
        }} 
      >
        {icon}
      </div>

      <div>
        <div className="metric-label">
          {title}
        </div>

        <div className="metric-value">
          {value}
        </div>

        <div
          style={{
            fontSize: '10px',
            color: danger
              ? '#ef4444'
              : '#687284',
            marginTop: '4px',
          }}
        >
          {note}
        </div>
      </div>
    </div>
  );
}
function PanelTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: string;
}) {
  return (
    <div className="panel-title">
      <div>
        <div className="panel-title-main">{title}</div>

        {subtitle && (
          <div className="panel-title-subtitle">
            {subtitle}
          </div>
        )}
      </div>

      {action && (
        <button className="panel-action">
          {action}
        </button>
      )}
    </div>
  );
}
function Analysis({
  title,
  repo,
  time,
  status,
  warn = false,
}: {
  title: string;
  repo: string;
  time: string;
  status: string;
  warn?: boolean;
}) {
  return (
    <div className="analysis-row">
      <div className="analysis-icon">
        {warn ? (
          <AlertTriangle size={16} />
        ) : (
          <CheckCircle2 size={16} />
        )}
      </div>

      <div className="analysis-content">
        <div className="analysis-title">{title}</div>

        <div className="analysis-meta">
          <span>{repo}</span>
          <span>•</span>
          <span>{time}</span>
        </div>
      </div>

      <div
        className="analysis-status"
        style={{
          color: warn ? '#ef4444' : '#22c55e',
        }}
      >
        {status}
      </div>
    </div>
  );
}

function ActivityRow({
  text,
  detail,
  time,
}: {
  text: string;
  detail: string;
  time: string;
}) {
  return (
    <div className="activity-row">
      <div>
        <strong>{text}</strong>
        <span>{detail}</span>
      </div>

      <span>{time}</span>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span style={{ color: '#687284', fontSize: '12px' }}>
        {label}
      </span>

      <strong
        style={{
          fontSize: '12px',
          fontWeight: 500,
          textAlign: 'right',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function Dashboard({
  user,
  repositories,
  githubConnecting,
  connectGitHub,
  openRepository,
}: {
  user: User;
  repositories: Repository[];
  githubConnecting: boolean;
  connectGitHub: () => void;
  openRepository: (
    repository: Repository
  ) => void;
}) {
  return (
    <section className="content">
      <div className="hero">
        <div>
          <div className="eyebrow">
            <span className="pulse"></span>

            AI ENGINEERING
            WORKSPACE
          </div>

          <h1>
            Good evening,{' '}
            {user.name.split(
              ' '
            )[0]}
            .
          </h1>

          <p>
            Understand your
            codebase, find
            problems faster,
            and ship with
            confidence.
          </p>
        </div>

        <button
          className="primary"
          onClick={
            connectGitHub
          }
          disabled={
            githubConnecting
          }
          style={{
            opacity:
              githubConnecting
                ? 0.7
                : 1,
            cursor:
              githubConnecting
                ? 'wait'
                : 'pointer',
          }}
        >
          <GitBranch
            size={17}
          />

          {githubConnecting
            ? 'Connecting GitHub...'
            : 'Connect repository'}
        </button>
      </div>

      <div className="metrics">
        <Metric
          title="Repositories"
          value={String(
            repositories.length
          )}
          note={`${repositories.length} connected`}
          icon={
            <Code2 />
          }
        />

        <Metric
          title="Code health"
          value="94%"
          note="↑ 6% this week"
          icon={
            <CheckCircle2 />
          }
        />

        <Metric
          title="Security issues"
          value="4"
          note="1 critical"
          icon={
            <AlertTriangle />
          }
          danger
        />

        <Metric
          title="Test coverage"
          value="78%"
          note="↑ 12% this month"
          icon={
            <TestTube2 />
          }
        />
      </div>

      <div className="grid">
        <section className="panel repositories">
          <PanelTitle
            title="Recent repositories"
            action="View all"
          />

          <div className="repo-list">
            {repositories.length ===
            0 ? (
              <div
                style={{
                  padding:
                    '25px',
                  textAlign:
                    'center',
                  color:
                    '#687284',
                  fontSize:
                    '10px',
                }}
              >
                No repositories
                connected
                yet.
              </div>
            ) : (
              repositories.map(
                (repo) => (
                  <button
                    className="repo"
                    key={
                      repo.id
                    }
                    onClick={() =>
                      openRepository(
                        repo
                      )
                    }
                    style={{
                      width:
                        '100%',
                      textAlign:
                        'left',
                      cursor:
                        'pointer',
                    }}
                  >
                    <div className="repo-icon">
                      <Code2
                        size={
                          18
                        }
                      />
                    </div>

                    <div className="repo-main">
                      <strong>
                        {
                          repo.name
                        }
                      </strong>

                      <span>
                        {repo.language ||
                          'Unknown'}{' '}
                        ·{' '}
                        {
                          repo.fullName
                        }
                      </span>
                    </div>

                    <div className="health">
                      <span>
                        —
                      </span>

                      <div>
                        <i
                          style={{
                            width:
                              '0%',
                          }}
                        />
                      </div>
                    </div>

                    <span
                      className="dots"
                      style={{
                        display:
                          'grid',
                        placeItems:
                          'center',
                      }}
                    >
                      →
                    </span>
                  </button>
                )
              )
            )}
          </div>
        </section>

        <section className="panel ai">
          <PanelTitle
            title="AI assistant"
            action="Open assistant"
          />

          <div className="ai-body">
            <div className="ai-orb">
              <Bot
                size={23}
              />
            </div>

            <h3>
              Ask anything
              about your
              code
            </h3>

            <p>
              CodePilot can
              explain
              architecture,
              trace bugs,
              generate tests,
              and find
              relevant files
              across your
              repositories.
            </p>

            <div className="suggestions">
              <button>
                Explain
                authentication
                flow
              </button>

              <button>
                Find security
                risks
              </button>

              <button>
                Generate tests
              </button>
            </div>

            <div className="ask">
              <input
                placeholder="Ask about your codebase..."
              />

              <button>
                <Sparkles
                  size={17}
                />
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid lower">
        <section className="panel">
          <PanelTitle
            title="Recent AI analyses"
            action="View history"
          />

          <div className="analysis">
            <Analysis
              title="Authentication flow analysis"
              repo="lifeline-api"
              time="12 min ago"
              status="Completed"
            />

            <Analysis
              title="Security vulnerability scan"
              repo="portfolio-web"
              time="Yesterday"
              status="4 findings"
              warn
            />

            <Analysis
              title="Test generation"
              repo="ai-agent-lab"
              time="Yesterday"
              status="32 tests"
            />
          </div>
        </section>

        <section className="panel">
          <PanelTitle
            title="Activity"
            action="View all"
          />

          <div className="timeline">
            <ActivityRow
              text="Dashboard loaded"
              detail={
                user.email
              }
              time="now"
            />

            <ActivityRow
              text="Repositories loaded"
              detail={`${repositories.length} repositories`}
              time="now"
            />

            <ActivityRow
              text="Authentication successful"
              detail="CodePilot API"
              time="now"
            />
          </div>
        </section>
      </div>
    </section>
  );
}

function RepositoryWorkspace({
  repository,
  onBack,
}: {
  repository: Repository;
  onBack: () => void;
}) {
  const [tree, setTree] = useState<RepositoryTreeItem[]>([]);
  const [selectedFile, setSelectedFile] =
    useState<string | null>(null);

  const [fileContent, setFileContent] =
    useState<string>('');

  const [treeLoading, setTreeLoading] =
    useState(true);

  const [fileLoading, setFileLoading] =
    useState(false);

  const [analysis, setAnalysis] =
    useState<string | null>(null);

  const [analysisLoading, setAnalysisLoading] =
    useState(false);

  const [analysisError, setAnalysisError] =
    useState<string | null>(null);

  const [fixProposal, setFixProposal] =
    useState<{ summary: string; originalCode: string; proposedCode: string; model: string } | null>(null);

  const [fixLoading, setFixLoading] =
    useState(false);

  const [fixError, setFixError] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [expandedFolders, setExpandedFolders] =
    useState<Set<string>>(new Set());

  useEffect(() => {
    loadTree();
  }, [repository.id]);

  async function loadTree() {
    try {
      setTreeLoading(true);
      setError(null);

      const result =
        await getRepositoryTree(
          repository.id
        );

      const folders =
        result.folders.map((item) => ({
          ...item,
          type: 'folder' as const,
        }));

      const files =
        result.files.map((item) => ({
          ...item,
          type: 'file' as const,
        }));

      setTree([
        ...folders,
        ...files,
      ]);
    } catch (err) {
      console.error(
        'Could not load repository tree:',
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load repository files'
      );
    } finally {
      setTreeLoading(false);
    }
  }

  async function openFile(path: string) {
    try {
      setSelectedFile(path);
      setFileContent('');
      setAnalysis(null);
      setAnalysisError(null);
      setFixProposal(null);
      setFixError(null);
      setFileLoading(true);
      setError(null);

      const result =
        await getRepositoryFile(
          repository.id,
          path
        );

      setFileContent(
        result.content
      );
    } catch (err) {
      console.error(
        'Could not load file:',
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load file'
      );
    } finally {
      setFileLoading(false);
    }
  }

  async function proposeFix() {
    if (!selectedFile || !fileContent) return;

    try {
      setFixLoading(true);
      setFixError(null);
      const result = await proposeRepositoryFileFix(
        repository.id,
        selectedFile,
        fileContent
      );
      setFixProposal(result);
    } catch (err) {
      console.error('Could not generate file fix:', err);
      setFixError(err instanceof Error ? err.message : 'Unable to generate file fix');
    } finally {
      setFixLoading(false);
    }
  }

  function diffLines(original: string, proposed: string) {
    const originalLines = original.split('\n');
    const proposedLines = proposed.split('\n');
    const rows: Array<{ oldText: string; newText: string; changed: boolean }> = [];
    let index = 0;

    while (index < originalLines.length || index < proposedLines.length) {
      if (originalLines[index] === proposedLines[index]) {
        rows.push({ oldText: originalLines[index] || '', newText: proposedLines[index] || '', changed: false });
        index++;
      } else {
        rows.push({
          oldText: originalLines[index] || '',
          newText: proposedLines[index] || '',
          changed: true,
        });
        index++;
      }
    }

    return rows;
  }

  async function analyzeFile() {
    if (!selectedFile || !fileContent) {
      return;
    }

    try {
      setAnalysisLoading(true);
      setAnalysisError(null);

      const result = await analyzeRepositoryFile(
        repository.id,
        selectedFile,
        fileContent
      );

      setAnalysis(result.analysis);
    } catch (err) {
      console.error('Could not analyze file:', err);
      setAnalysisError(
        err instanceof Error
          ? err.message
          : 'Unable to analyze file'
      );
    } finally {
      setAnalysisLoading(false);
    }
  }

  function toggleFolder(
    path: string
  ) {
    setExpandedFolders(
      (previous) => {
        const next =
          new Set(previous);

        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }

        return next;
      }
    );
  }

  function isVisible(
    path: string
  ) {
    const parts =
      path.split('/');

    if (parts.length === 1) {
      return true;
    }

    let current = '';

    for (
      let i = 0;
      i < parts.length - 1;
      i++
    ) {
      current = current
        ? `${current}/${parts[i]}`
        : parts[i];

      if (
        !expandedFolders.has(
          current
        )
      ) {
        return false;
      }
    }

    return true;
  }

  function getIndent(
    path: string
  ) {
    return Math.max(
      0,
      path.split('/').length - 1
    );
  }

  const entriesByParent = new Map<
    string,
    RepositoryTreeItem[]
  >();

  for (const item of tree) {
    const separator = item.path.lastIndexOf('/');
    const parent = separator === -1
      ? ''
      : item.path.slice(0, separator);
    const children = entriesByParent.get(parent) || [];

    children.push(item);
    entriesByParent.set(parent, children);
  }

  function flattenTree(
    parent: string,
    result: RepositoryTreeItem[]
  ) {
    const children = entriesByParent.get(parent) || [];

    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }

      return a.path.localeCompare(b.path);
    });

    for (const child of children) {
      result.push(child);

      if (child.type === 'folder') {
        flattenTree(child.path, result);
      }
    }
  }

  const sortedTree: RepositoryTreeItem[] = [];
  flattenTree('', sortedTree);

  return (
    <section className="content">
      <button
        className="nav-item"
        onClick={onBack}
        style={{
          width: 'fit-content',
          marginBottom: '20px',
        }}
      >
        <ArrowLeft size={18} />

        <span>
          Back to Dashboard
        </span>
      </button>

      <div className="hero">
        <div>
          <div className="eyebrow">
            <span className="pulse"></span>

            REPOSITORY WORKSPACE
          </div>

          <h1>
            {repository.name}
          </h1>

          <p>
            {repository.fullName}
          </p>
        </div>

        <button className="primary">
          <Sparkles size={17} />

          Analyze repository
        </button>
      </div>

      <div className="metrics">
        <Metric
          title="Language"
          value={
            repository.language ||
            'Unknown'
          }
          note="GitHub detected"
          icon={<Code2 />}
        />

        <Metric
          title="Repository"
          value="Connected"
          note="GitHub"
          icon={<CheckCircle2 />}
        />

        <Metric
          title="Security"
          value="Ready"
          note="Scan available"
          icon={<ShieldCheck />}
        />

        <Metric
          title="AI Analysis"
          value="Ready"
          note="Start analysis"
          icon={<Bot />}
        />
      </div>

      <div className="grid">
        <section className="panel">
          <PanelTitle
            title="Repository information"
            action="GitHub →"
          />

          <div
            style={{
              padding: '20px',
              display: 'grid',
              gap: '16px',
            }}
          >
            <InfoRow
              label="Repository"
              value={
                repository.fullName
              }
            />

            <InfoRow
              label="Language"
              value={
                repository.language ||
                'Unknown'
              }
            />

            <InfoRow
              label="GitHub ID"
              value={
                repository.githubId
              }
            />

            <InfoRow
              label="Repository ID"
              value={
                repository.id
              }
            />
          </div>
        </section>

        <section className="panel ai">
          <PanelTitle
            title="AI assistant"
            action="Open assistant"
          />

          <div className="ai-body">
            <div className="ai-orb">
              <Bot size={23} />
            </div>

            <h3>
              Ask about this
              repository
            </h3>

            <p>
              Once the repository
              is indexed, CodePilot
              will be able to answer
              questions about its
              files, architecture,
              bugs, security and
              tests.
            </p>

            <div className="suggestions">
              <button>
                Explain this
                repository
              </button>

              <button>
                Find security
                risks
              </button>

              <button>
                Find bugs
              </button>
            </div>

            <div className="ask">
              <input
                placeholder="Ask about this repository..."
              />

              <button>
                <Sparkles
                  size={17}
                />
              </button>
            </div>
          </div>
        </section>
      </div>

      <section
        className="panel"
        style={{
          marginTop: '24px',
        }}
      >
        <PanelTitle
          title="Code Explorer"
          action={
            treeLoading
              ? 'Loading...'
              : `${tree.length} items`
          }
        />

        {error && (
          <div
            style={{
              margin: '20px',
              padding: '14px',
              borderRadius: '8px',
              background:
                'rgba(239,68,68,0.08)',
              border:
                '1px solid rgba(239,68,68,0.2)',
              color: '#ef4444',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        {treeLoading ? (
          <div
            style={{
              minHeight: '240px',
              display: 'grid',
              placeItems: 'center',
              color: '#687284',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <Loader2
                size={18}
                className="spin"
              />

              Loading repository
              files...
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'minmax(250px, 35%) 1fr',
              minHeight: '500px',
            }}
          >
            {/* File tree */}

            <div
              style={{
                borderRight:
                  '1px solid rgba(255,255,255,0.06)',
                padding:
                  '10px 0',
                overflow:
                  'auto',
              }}
            >
              {sortedTree.length ===
              0 ? (
                <div
                  style={{
                    padding:
                      '30px 20px',
                    textAlign:
                      'center',
                    color:
                      '#687284',
                    fontSize:
                      '12px',
                  }}
                >
                  No files found.
                </div>
              ) : (
                sortedTree.map(
                  (item) => {
                    if (
                      !isVisible(
                        item.path
                      )
                    ) {
                      return null;
                    }

                    const name =
                      item.path
                        .split(
                          '/'
                        )
                        .pop() ||
                      item.path;

                    const expanded =
                      expandedFolders.has(
                        item.path
                      );

                    const selected =
                      selectedFile ===
                      item.path;

                    return (
                      <button
                        key={
                          item.path
                        }
                        type="button"
                        aria-expanded={
                          item.type === 'folder'
                            ? expanded
                            : undefined
                        }
                        onClick={() => {
                          if (
                            item.type ===
                            'folder'
                          ) {
                            toggleFolder(
                              item.path
                            );
                          } else {
                            openFile(
                              item.path
                            );
                          }
                        }}
                        style={{
                          width:
                            '100%',
                          display:
                            'flex',
                          alignItems:
                            'center',
                          gap: '7px',
                          padding:
                            `7px 12px 7px ${
                              12 +
                              getIndent(
                                item.path
                              ) *
                                18
                            }px`,
                          background:
                            selected
                              ? 'rgba(99,102,241,0.12)'
                              : 'transparent',
                          border: 0,
                          color:
                            'inherit',
                          cursor:
                            'pointer',
                          textAlign:
                            'left',
                          fontSize:
                            '12px',
                        }}
                      >
                        {item.type ===
                        'folder' ? (
                          expanded ? (
                            <FolderOpen
                              size={15}
                            />
                          ) : (
                            <Folder
                              size={15}
                            />
                          )
                        ) : (
                          <FileCode2
                            size={15}
                          />
                        )}

                        <span
                          style={{
                            overflow:
                              'hidden',
                            textOverflow:
                              'ellipsis',
                            whiteSpace:
                              'nowrap',
                          }}
                        >
                          {name}
                        </span>
                      </button>
                    );
                  }
                )
              )}
            </div>

            {/* File viewer */}

            <div
              style={{
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow:
                  'hidden',
              }}
            >
              {!selectedFile ? (
                <div
                  style={{
                    minHeight:
                      '500px',
                    display:
                      'grid',
                    placeItems:
                      'center',
                    padding:
                      '30px',
                    textAlign:
                      'center',
                    color:
                      '#687284',
                  }}
                >
                  <div>
                    <FileCode2
                      size={40}
                      style={{
                        opacity:
                          0.4,
                        marginBottom:
                          '12px',
                      }}
                    />

                    <h3
                      style={{
                        color:
                          'inherit',
                      }}
                    >
                      Select a file
                    </h3>

                    <p>
                      Choose a file
                      from the
                      repository
                      tree to view
                      its source
                      code.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      padding:
                        '12px 16px',
                      borderBottom:
                        '1px solid rgba(255,255,255,0.06)',
                      fontSize:
                        '12px',
                      display:
                        'flex',
                      alignItems:
                        'center',
                      gap: '8px',
                    }}
                  >
                    <FileCode2
                      size={15}
                    />

                    <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedFile}
                    </strong>

                    <button
                      type="button"
                      className="primary"
                      onClick={analyzeFile}
                      disabled={fileLoading || analysisLoading || !fileContent}
                      style={{ padding: '8px 11px', fontSize: '11px', flexShrink: 0 }}
                    >
                      {analysisLoading ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <BrainCircuit size={14} />
                      )}
                      {analysisLoading ? 'Analyzing...' : 'Analyze with AI'}
                    </button>

                    <button
                      type="button"
                      className="primary"
                      onClick={proposeFix}
                      disabled={fileLoading || analysisLoading || fixLoading || !fileContent}
                      style={{ padding: '8px 11px', fontSize: '11px', flexShrink: 0 }}
                    >
                      {fixLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                      {fixLoading ? 'Preparing fix...' : 'Propose fix'}
                    </button>
                  </div>

                  {fixProposal ? (
                    <div className="fix-review file-review-replacement">
                      <div className="fix-review-header">
                        <div className="fix-review-title">
                          <Sparkles size={16} />
                          <strong>Review proposed fix</strong>
                          <span>({fixProposal.model})</span>
                        </div>
                      </div>

                      {(analysisError || analysis) && (
                        <div className="review-analysis">
                          <div className="fix-review-title">
                            <BrainCircuit size={15} />
                            <strong>AI analysis</strong>
                          </div>
                          {analysisError ? (
                            <div className="fix-error">{analysisError}</div>
                          ) : (
                            <p>{analysis}</p>
                          )}
                        </div>
                      )}

                      <p className="fix-summary">{fixProposal.summary}</p>
                      <div className="diff-grid">
                        <div className="diff-panel">
                          <div className="diff-panel-label old">OLD CODE</div>
                          <pre className="diff-code">{diffLines(fixProposal.originalCode, fixProposal.proposedCode).map((line, index) => (
                            <code className={line.changed ? 'diff-line changed-old' : 'diff-line'} key={`old-${index}`}>
                              {line.oldText || ' '}
                            </code>
                          ))}</pre>
                        </div>
                        <div className="diff-panel">
                          <div className="diff-panel-label new">NEW CODE</div>
                          <pre className="diff-code">{diffLines(fixProposal.originalCode, fixProposal.proposedCode).map((line, index) => (
                            <code className={line.changed ? 'diff-line changed-new' : 'diff-line'} key={`new-${index}`}>
                              {line.newText || ' '}
                            </code>
                          ))}</pre>
                        </div>
                      </div>

                      <div className="fix-review-footer">
                        <span>GitHub is not changed until you approve the fix.</span>
                        <div>
                          <button type="button" onClick={() => { setFixProposal(null); setFixError(null); }}>Reject</button>
                          <button type="button" className="primary" onClick={() => setFileContent(fixProposal.proposedCode)}>
                            Approve Fix
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : fileLoading ? (
                    <div
                      style={{
                        minHeight:
                          '450px',
                        display:
                          'grid',
                        placeItems:
                          'center',
                        color:
                          '#687284',
                      }}
                    >
                      <div
                        style={{
                          display:
                            'flex',
                          alignItems:
                            'center',
                          gap: '10px',
                        }}
                      >
                        <Loader2
                          size={18}
                          className="spin"
                        />

                        Loading file...
                      </div>
                    </div>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        padding:
                          '18px',
                        minHeight:
                          '450px',
                        overflow:
                          'auto',
                        fontSize:
                          '12px',
                        lineHeight:
                          1.65,
                        fontFamily:
                          'Consolas, "Courier New", monospace',
                        whiteSpace:
                          'pre',
                      }}
                    >
                      <code>
                        {fileContent}
                      </code>
                    </pre>
                  )}

                  {(analysisError || analysis) && (
                    <div
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        padding: '18px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <BrainCircuit size={16} />
                        <strong>AI analysis</strong>
                      </div>

                      {analysisError ? (
                        <div style={{ color: '#ef4444', fontSize: '12px' }}>
                          {analysisError}
                        </div>
                      ) : (
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '12px', lineHeight: 1.6 }}>
                          {analysis}
                        </pre>
                      )}
                    </div>
                  )}

                  {fixError && (
                    <div className="fix-review">
                      <div className="fix-review-header">
                        <div className="fix-review-title">
                          <Sparkles size={16} />
                          <strong>Proposed fix</strong>
                        </div>
                      </div>

                      {fixError ? (
                        <div className="fix-error">{fixError}</div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}