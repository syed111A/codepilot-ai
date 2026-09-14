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
  createRepositoryPullRequest,
  analyzeRepository,
  generateRepositoryTests,
  askRepositoryAssistant,
  indexRepository,
  searchRepository,
  analyzeRepositoryFile,
  proposeRepositoryFileFix,
  verifyRepository,
  type Repository,
  type RepositoryAnalysisFinding,
  type GeneratedTestCase,
  type RepositoryTreeItem,
  type VerificationResult,
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
  const [accountMenuOpen, setAccountMenuOpen] =
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
                  (label === 'Code Analysis' || label === 'Security' || label === 'Tests' || label === 'Pull Requests' || label === 'AI Assistant' || !selectedRepository)
                    ? 'nav-item active'
                    : 'nav-item'
                }
                onClick={() => {
                  if (label === 'AI Assistant' && !selectedRepository && repositories[0]) {
                    setSelectedRepository(repositories[0]);
                  } else if (label !== 'Code Analysis' && label !== 'Security' && label !== 'Tests' && label !== 'Pull Requests' && label !== 'AI Assistant') {
                    setSelectedRepository(null);
                  }

                  setActive(label);
                  setMobile(false);
                }}
              >
                <Icon size={18} />

                <span>{label}</span>

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

            <div style={{ position: 'relative' }}>
              <button
                className="icon-btn"
                onClick={() =>
                  setAccountMenuOpen(
                    !accountMenuOpen
                  )
                }
                title="Account"
                aria-label="Open account menu"
              >
                <UserCircle2 size={22} />
              </button>

              {accountMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 8px)',
                    width: '240px',
                    background:
                      '#111827',
                    border:
                      '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '12px',
                    boxShadow:
                      '0 14px 40px rgba(0,0,0,0.35)',
                    padding: '14px',
                    zIndex: 100,
                    color: '#e5e7eb',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      paddingBottom: '12px',
                      borderBottom:
                        '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="avatar">
                      {user.name
                        .split(' ')
                        .map((x) => x[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>

                    <div>
                      <strong style={{ display: 'block' }}>
                        {user.name}
                      </strong>
                      <small style={{ color: '#9ca3af' }}>
                        {user.email}
                      </small>
                    </div>
                  </div>

                  <button
                    className="logout-menu-button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      handleLogout();
                    }}
                    style={{
                      width: '100%',
                      marginTop: '12px',
                      background:
                        'transparent',
                      color: '#fff',
                      border:
                        '1px solid rgba(255,255,255,0.14)',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {selectedRepository ? (
          <RepositoryWorkspace
            repository={
              selectedRepository
            }
            showAnalysis={active === 'Code Analysis'}
            showSecurity={active === 'Security'}
            showTests={active === 'Tests'}
            showPullRequests={active === 'Pull Requests'}
            showAssistant={active === 'AI Assistant'}
            onOpenCodeExplorer={() => setActive('Repository Workspace')}
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
          note={
            repositories.length
              ? `${repositories.length} connected`
              : 'No GitHub repositories'
          }
          icon={
            <Code2 />
          }
        />

        <Metric
          title="GitHub status"
          value={
            repositories.length
              ? 'Synced'
              : 'Not connected'
          }
          note={
            repositories.length
              ? 'Repository data ready'
              : 'Connect a repo'
          }
          icon={
            <GitBranch />
          }
        />

        <Metric
          title="Security scan"
          value={
            repositories.length
              ? 'Ready'
              : 'Not ready'
          }
          note={
            repositories.length
              ? 'Scan available'
              : 'No repository selected'
          }
          icon={
            <ShieldCheck />
          }
          danger={
            repositories.length === 0
          }
        />

        <Metric
          title="Tests"
          value={
            repositories.length
              ? 'Ready'
              : 'No repo'
          }
          note={
            repositories.length
              ? 'Generate available'
              : 'Connect GitHub first'
          }
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
            action={repositories.length ? 'Open assistant' : undefined}
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
            {repositories.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  color: '#687284',
                  fontSize: '10px',
                  textAlign: 'center',
                }}
              >
                No repository analyses yet. Connect a GitHub repository to start.
              </div>
            ) : (
              <>
                <Analysis
                  title="Repository imported"
                  repo={repositories[0].fullName}
                  time="just now"
                  status={`${repositories.length} repo${repositories.length === 1 ? '' : 's'}`}
                />

                <Analysis
                  title="Repository ready for analysis"
                  repo={repositories[0].fullName}
                  time="ready"
                  status="Queued"
                />
              </>
            )}
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
              detail={`${repositories.length} repository${repositories.length === 1 ? '' : 'ies'}`}
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

function CodeAnalysisView({
  repository,
  analysis,
  loading,
  error,
  securityOnly = false,
  onAnalyze,
  onOpenFile,
  onProposeFix,
}: {
  repository: Repository;
  analysis: {
    model: string;
    filesAnalyzed: number;
    summary: string;
    findings: RepositoryAnalysisFinding[];
  } | null;
  loading: boolean;
  error: string | null;
  securityOnly?: boolean;
  onAnalyze: () => void;
  onOpenFile: (path: string) => void;
  onProposeFix: (finding: RepositoryAnalysisFinding) => void;
}) {
  const [severityFilter, setSeverityFilter] = useState('All');
  const severities = ['All', 'Critical', 'High', 'Medium', 'Low', 'Info'];
  const findings = analysis?.findings
    .filter((finding) => !securityOnly || isSecurityFinding(finding))
    .filter((finding) => severityFilter === 'All' || finding.severity === severityFilter) || [];

  return (
    <section className="content">
      <div className="hero">
        <div>
          <div className="eyebrow">
            <span className="pulse"></span>
            {securityOnly ? 'SECURITY' : 'CODE ANALYSIS'}
          </div>
          <h1>{repository.name} {securityOnly ? 'security issues' : 'findings'}</h1>
          <p>{securityOnly ? 'Review security-related findings from Analyze repository.' : 'Review the latest findings from Analyze repository.'}</p>
        </div>

        <button className="primary" onClick={onAnalyze} disabled={loading}>
          {loading ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}
          {loading ? 'Analyzing repository...' : 'Analyze repository'}
        </button>
      </div>

      {error && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div style={{ padding: '20px', color: '#ef7777', fontSize: '13px' }}>{error}</div>
        </section>
      )}

      {!analysis && !loading && !error && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div style={{ padding: '32px', textAlign: 'center', color: '#8f9aaa' }}>
            Run Analyze repository to load findings for {repository.fullName}.
          </div>
        </section>
      )}

      {analysis && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <PanelTitle
            title={securityOnly ? 'Security findings' : 'Repository findings'}
            action={`${analysis.filesAnalyzed} files · ${analysis.model}`}
          />
          <div style={{ padding: '20px' }}>
            <p style={{ margin: '0 0 18px', color: '#b7bfce', lineHeight: 1.6 }}>
              {analysis.summary}
            </p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {severities.map((severity) => (
                <button
                  type="button"
                  key={severity}
                  onClick={() => setSeverityFilter(severity)}
                  style={{
                    border: severityFilter === severity ? '1px solid #8b7cff' : '1px solid #293141',
                    background: severityFilter === severity ? 'rgba(139,124,255,0.16)' : '#11161e',
                    color: severityFilter === severity ? '#c8c1ff' : '#8f9aaa',
                    borderRadius: '6px',
                    padding: '7px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  {severity}
                </button>
              ))}
            </div>

            {findings.length === 0 ? (
              <div style={{ color: '#8f9aaa', fontSize: '13px' }}>
                No findings match this severity filter.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {findings.map((finding, index) => (
                  <article
                    key={`${finding.file}-${finding.line}-${index}`}
                    onClick={() => onOpenFile(finding.file)}
                    style={{
                      padding: '14px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                      <strong>{finding.title}</strong>
                      <span style={{ color: finding.severity === 'Critical' || finding.severity === 'High' ? '#ef7777' : '#aeb8c7', fontSize: '11px' }}>
                        {finding.severity}
                      </span>
                    </div>
                    <div style={{ color: '#8f9aaa', fontSize: '11px', marginTop: '6px' }}>
                      {finding.file}{finding.line ? `:${finding.line}` : ''}
                    </div>
                    <p style={{ color: '#b7bfce', fontSize: '12px', lineHeight: 1.55, margin: '10px 0 6px' }}>
                      {finding.explanation}
                    </p>
                    <div style={{ color: '#8f9aaa', fontSize: '11px', marginBottom: '6px' }}>
                      Confidence: {Math.round(finding.confidence * 100)}%
                    </div>
                    <div style={{ color: '#8f9aaa', fontSize: '12px', lineHeight: 1.5 }}>
                      Recommendation: {finding.suggestedFix}
                    </div>
                    <button type="button" className="primary" onClick={(event) => { event.stopPropagation(); onProposeFix(finding); }} style={{ marginTop: '14px' }}>
                      <Sparkles size={14} />
                      Propose fix
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function isSecurityFinding(finding: RepositoryAnalysisFinding) {
  return /security|vulnerab|secret|token|password|credential|auth|permission|access|injection|xss|csrf|encrypt|expos|attack|malicious|unsafe/i.test(
    `${finding.title} ${finding.explanation} ${finding.suggestedFix} ${finding.file}`
  );
}

function TestsView({
  repository,
  generatedTests,
  sourceFiles,
  loading,
  error,
  onGenerate,
  onOpenFile,
  onApproveTest,
}: {
  repository: Repository;
  generatedTests: {
    model: string;
    filesAnalyzed: number;
    summary: string;
    tests: GeneratedTestCase[];
  } | null;
  sourceFiles: RepositoryTreeItem[];
  loading: boolean;
  error: string | null;
  onGenerate: (path: string, functionName: string) => void;
  onOpenFile: (path: string) => void;
  onApproveTest: (test: GeneratedTestCase) => void;
}) {
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [functionName, setFunctionName] = useState('');

  return (
    <section className="content">
      <div className="hero">
        <div>
          <div className="eyebrow"><span className="pulse"></span>TESTS</div>
          <h1>{repository.name} test coverage</h1>
          <p>Find missing coverage and review tests generated from real source files.</p>
        </div>
        <button className="primary" onClick={() => onGenerate(selectedPath, functionName)} disabled={loading || !selectedPath}>
          {loading ? <Loader2 size={17} className="spin" /> : <TestTube2 size={17} />}
          {loading ? 'Generating tests...' : 'Generate tests'}
        </button>
      </div>

      {error && <section className="panel" style={{ marginTop: '24px' }}><div style={{ padding: '20px', color: '#ef7777', fontSize: '13px' }}>{error}</div></section>}

      <section className="panel" style={{ marginTop: '24px' }}>
        <PanelTitle title="Test target" action="Repository source" />
        <div style={{ padding: '20px', display: 'grid', gap: '12px' }}>
          <select value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)} style={{ padding: '10px', background: '#11161e', color: '#d8dce5', border: '1px solid #293141', borderRadius: '6px' }}>
            <option value="">Select a source file</option>
            {sourceFiles.filter((item) => item.type === 'file' && !/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(item.path)).map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
          </select>
          <input value={functionName} onChange={(event) => setFunctionName(event.target.value)} placeholder="Optional function or method name" style={{ padding: '10px', background: '#11161e', color: '#d8dce5', border: '1px solid #293141', borderRadius: '6px' }} />
          <span style={{ color: '#8f9aaa', fontSize: '11px' }}>Tests are generated only from the selected file and related retrieved repository context.</span>
        </div>
      </section>

      {!generatedTests && !loading && !error && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div style={{ padding: '32px', textAlign: 'center', color: '#8f9aaa' }}>
            Generate tests to inspect missing or insufficient coverage in {repository.fullName}.
          </div>
        </section>
      )}

      {generatedTests && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <PanelTitle title="Generated tests" action={`${generatedTests.filesAnalyzed} files · ${generatedTests.model}`} />
          <div style={{ padding: '20px' }}>
            <p style={{ margin: '0 0 18px', color: '#b7bfce', lineHeight: 1.6 }}>{generatedTests.summary}</p>
            {generatedTests.tests.length === 0 ? (
              <div style={{ color: '#8f9aaa', fontSize: '13px' }}>No meaningful missing tests were identified.</div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {generatedTests.tests.map((test, index) => (
                  <article key={`${test.testFile}-${index}`} style={{ padding: '14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <strong>{test.title}</strong>
                      <span style={{ color: '#8f9aaa', fontSize: '11px' }}>{test.framework}</span>
                    </div>
                    <div style={{ color: '#8f9aaa', fontSize: '11px', marginTop: '7px' }}>Source: {test.sourceFile}</div>
                    <div style={{ color: '#8f9aaa', fontSize: '11px', marginTop: '4px' }}>Suggested test file: {test.testFile}</div>
                    <p style={{ color: '#b7bfce', fontSize: '12px', lineHeight: 1.55, margin: '10px 0' }}>{test.rationale}</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" onClick={() => onOpenFile(test.sourceFile)}>Open source file</button>
                      <button type="button" className="primary" onClick={() => setExpandedTest(expandedTest === index ? null : index)}>
                        <FileCode2 size={14} /> {expandedTest === index ? 'Hide generated test' : 'Review generated test'}
                      </button>
                      <button type="button" onClick={() => onApproveTest(test)}>Approve test</button>
                    </div>
                    {expandedTest === index && (
                      <pre style={{ margin: '14px 0 0', padding: '14px', maxHeight: '360px', overflow: 'auto', background: '#0a0d12', color: '#b7bfce', font: '11px/1.55 Consolas, monospace', whiteSpace: 'pre-wrap' }}><code>{test.testCode}</code></pre>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function AssistantView({
  repository,
  onAsk,
  answer,
  sources,
  onIndex,
  indexedFiles,
  loading,
  error,
}: {
  repository: Repository;
  onAsk: (question: string) => void;
  answer: { model: string; text: string } | null;
  sources: string[];
  onIndex: () => void;
  indexedFiles: number | null;
  loading: boolean;
  error: string | null;
}) {
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');

  function ask(value = question) {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setAskedQuestion(trimmed);
    onAsk(trimmed);
  }

  return (
    <section className="content">
      <div className="hero">
        <div>
          <div className="eyebrow"><span className="pulse"></span>AI ENGINEERING ASSISTANT</div>
          <h1>Ask about {repository.name}</h1>
          <p>Answers are grounded in the files retrieved from {repository.fullName}.</p>
        </div>
      </div>
      <section className="panel" style={{ marginTop: '24px' }}>
        <PanelTitle title="Repository assistant" action="Ollama · Qwen2.5-Coder 1.5B" />
        <div className="ai-body" style={{ padding: '28px', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: '#8f9aaa', fontSize: '11px' }}>
            <span>{indexedFiles === null ? 'Repository index will be built on first question.' : `${indexedFiles} files indexed`}</span>
            <button type="button" onClick={onIndex} disabled={loading}>Refresh index</button>
          </div>
          <div className="suggestions">
            {['Explain the authentication flow', 'Where are the main API endpoints?', 'What dependencies does this repository use?', 'Which files are most important?'].map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); ask(suggestion); }}>
                {suggestion}
              </button>
            ))}
          </div>
          {askedQuestion && <div style={{ color: '#8f9aaa', fontSize: '12px' }}>Question: {askedQuestion}</div>}
          {error && <div style={{ color: '#ef7777', fontSize: '13px' }}>{error}</div>}
          {answer && <>
            <pre style={{ margin: 0, padding: '18px', background: '#0a0d12', color: '#b7bfce', whiteSpace: 'pre-wrap', font: '12px/1.65 Inter, sans-serif' }}>{answer.text}</pre>
            <div style={{ color: '#8f9aaa', fontSize: '11px' }}>Retrieved sources: {sources.join(', ')}</div>
          </>}
          <form className="ask" onSubmit={(event) => { event.preventDefault(); ask(); }}>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this repository..." disabled={loading} />
            <button type="submit" disabled={loading || !question.trim()}>{loading ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}</button>
          </form>
        </div>
      </section>
    </section>
  );
}

type PullRequestChange = {
  path: string;
  original: string;
  approved: string;
};

type PullRequestDraft = {
  title: string;
  summary: string;
  changes: PullRequestChange[];
};

function PullRequestsView({
  repository,
  draft,
  analysis,
  generatedTests,
  loading,
  error,
  onPrepare,
  onOpenFile,
  onCreate,
  createdPullRequest,
  creating,
}: {
  repository: Repository;
  draft: PullRequestDraft | null;
  analysis: { findings: RepositoryAnalysisFinding[] } | null;
  generatedTests: { tests: GeneratedTestCase[] } | null;
  loading: boolean;
  error: string | null;
  onPrepare: () => void;
  onOpenFile: (path: string) => void;
  onCreate: () => void;
  createdPullRequest: { url: string | null; number: number | null; branch: string } | null;
  creating: boolean;
}) {
  return (
    <section className="content">
      <div className="hero">
        <div>
          <div className="eyebrow"><span className="pulse"></span>PULL REQUESTS</div>
          <h1>{repository.name} change review</h1>
          <p>Review approved CodePilot changes before creating a pull request.</p>
        </div>
        <button className="primary" onClick={onPrepare} disabled={loading}>
          {loading ? <Loader2 size={17} className="spin" /> : <GitPullRequest size={17} />}
          {loading ? 'Preparing review...' : 'Prepare PR review'}
        </button>
      </div>

      {error && <section className="panel" style={{ marginTop: '24px' }}><div style={{ padding: '20px', color: '#ef7777', fontSize: '13px' }}>{error}</div></section>}

      {!draft && !loading && !error && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div style={{ padding: '32px', textAlign: 'center', color: '#8f9aaa' }}>
            Approve a CodePilot fix, then prepare a PR review from those GitHub-backed changes.
          </div>
        </section>
      )}

      {draft && (
        <div style={{ display: 'grid', gap: '24px', marginTop: '24px' }}>
          <section className="panel">
            <PanelTitle title={draft.title} action="Review only" />
            <div style={{ padding: '20px', display: 'grid', gap: '18px' }}>
              <InfoRow label="Repository" value={repository.fullName} />
              <div>
                <div style={{ color: '#687284', fontSize: '11px', marginBottom: '7px' }}>Summary of changes</div>
                <p style={{ margin: 0, color: '#b7bfce', fontSize: '13px', lineHeight: 1.6 }}>{draft.summary}</p>
              </div>
              <div>
                <div style={{ color: '#687284', fontSize: '11px', marginBottom: '7px' }}>Why these changes were made</div>
                <p style={{ margin: 0, color: '#b7bfce', fontSize: '13px', lineHeight: 1.6 }}>
                  These files were explicitly approved through the existing CodePilot fix workflow and are ready for human review before a pull request is created.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
              <span style={{ color: '#8f9aaa', fontSize: '12px' }}>Explicit approval is required before GitHub is changed.</span>
              <button type="button" className="primary" onClick={onCreate} disabled={creating}>
                {creating ? 'Creating pull request...' : 'Create Pull Request'}
              </button>
            </div>
          </section>

          <section className="panel">
            <PanelTitle title="Affected files and diff" action={`${draft.changes.length} files`} />
            <div style={{ padding: '20px', display: 'grid', gap: '16px' }}>
              {draft.changes.map((change) => (
                <div key={change.path}>
                  <button type="button" onClick={() => onOpenFile(change.path)} style={{ border: 0, background: 'transparent', color: '#b7afff', cursor: 'pointer', padding: 0, fontSize: '12px' }}>
                    {change.path}
                  </button>
                  <div className="diff-grid" style={{ marginTop: '8px' }}>
                    <div className="diff-panel">
                      <div className="diff-panel-label old">CURRENT GITHUB CODE</div>
                      <pre className="diff-code"><code>{change.original}</code></pre>
                    </div>
                    <div className="diff-panel">
                      <div className="diff-panel-label new">APPROVED CODE</div>
                      <pre className="diff-code"><code>{change.approved}</code></pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <PanelTitle title="Analysis, security, and tests" />
            <div style={{ padding: '20px', display: 'grid', gap: '16px' }}>
              <div>
                <strong style={{ fontSize: '12px' }}>Analysis findings</strong>
                <p style={{ color: '#8f9aaa', fontSize: '12px' }}>
                  {analysis?.findings.length ? `${analysis.findings.length} findings from the latest repository analysis.` : 'No repository analysis findings are loaded.'}
                </p>
                {analysis?.findings.map((finding) => <div key={`${finding.file}-${finding.line}-${finding.title}`} style={{ color: '#b7bfce', fontSize: '12px', marginTop: '6px' }}>{finding.severity}: {finding.title} ({finding.file}{finding.line ? `:${finding.line}` : ''})</div>)}
              </div>
              <div>
                <strong style={{ fontSize: '12px' }}>Test results</strong>
                <p style={{ color: '#8f9aaa', fontSize: '12px' }}>
                  {generatedTests?.tests.length ? `${generatedTests.tests.length} generated test cases are available for review.` : 'No generated test results are loaded.'}
                </p>
              </div>
              <div style={{ color: '#8f9aaa', fontSize: '12px' }}>
                GitHub PR creation is not implemented yet. This review does not create or modify a pull request.
              </div>
            </div>
          </section>
        </div>
      )}

      {createdPullRequest && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div style={{ padding: '20px', color: '#65e6a7', fontSize: '13px' }}>
            Pull request created on branch <strong>{createdPullRequest.branch}</strong>.
            {createdPullRequest.url && (
              <> <a href={createdPullRequest.url} target="_blank" rel="noreferrer" style={{ color: '#b7afff' }}>Open pull request</a></>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function RepositoryWorkspace({
  repository,
  showAnalysis,
  showSecurity,
  showTests,
  showPullRequests,
  showAssistant,
  onOpenCodeExplorer,
  onBack,
}: {
  repository: Repository;
  showAnalysis: boolean;
  showSecurity: boolean;
  showTests: boolean;
  showPullRequests: boolean;
  showAssistant: boolean;
  onOpenCodeExplorer: () => void;
  onBack: () => void;
}) {
  const [tree, setTree] = useState<RepositoryTreeItem[]>([]);
  const [selectedFile, setSelectedFile] =
    useState<string | null>(null);

  const [fileContent, setFileContent] =
    useState<string>('');

  const [approvedFiles, setApprovedFiles] =
    useState<Record<string, string>>({});

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

  const [repositoryAnalysis, setRepositoryAnalysis] =
    useState<{
      model: string;
      filesAnalyzed: number;
      summary: string;
      findings: RepositoryAnalysisFinding[];
    } | null>(null);

  const [repositoryAnalysisLoading, setRepositoryAnalysisLoading] =
    useState(false);

  const [repositoryAnalysisError, setRepositoryAnalysisError] =
    useState<string | null>(null);

  const [generatedTests, setGeneratedTests] = useState<{
    model: string;
    filesAnalyzed: number;
    summary: string;
    tests: GeneratedTestCase[];
  } | null>(null);
  const [testsLoading, setTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [assistantAnswer, setAssistantAnswer] = useState<{ model: string; text: string } | null>(null);
  const [assistantSources, setAssistantSources] = useState<string[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<number | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [pullRequestDraft, setPullRequestDraft] = useState<PullRequestDraft | null>(null);
  const [pullRequestLoading, setPullRequestLoading] = useState(false);
  const [pullRequestError, setPullRequestError] = useState<string | null>(null);
  const [createdPullRequest, setCreatedPullRequest] = useState<{
    url: string | null;
    number: number | null;
    branch: string;
  } | null>(null);

  const [fixProposal, setFixProposal] =
    useState<{ summary: string; originalCode: string; proposedCode: string; model: string } | null>(null);

  const [fixLoading, setFixLoading] =
    useState(false);

  const [fixError, setFixError] =
    useState<string | null>(null);

  const [verification, setVerification] =
    useState<VerificationResult | null>(null);

  const [verificationLoading, setVerificationLoading] =
    useState(false);

  const [verificationError, setVerificationError] =
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

      const approvedContent = approvedFiles[path] ?? localStorage.getItem(
        `codepilot-approved:${repository.id}:${path}`
      );

      if (approvedContent && approvedFiles[path] !== approvedContent) {
        setApprovedFiles((previous) => ({
          ...previous,
          [path]: approvedContent,
        }));
      }

      setFileContent(approvedContent ?? result.content);
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
      setAnalysis(null);
      setAnalysisError(null);
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

  async function proposeFindingFix(
    finding: RepositoryAnalysisFinding
  ) {
    try {
      setSelectedFile(finding.file);
      setFileLoading(true);
      setFixLoading(true);
      setFixError(null);
      setAnalysis(null);
      setAnalysisError(null);

      const result = await getRepositoryFile(
        repository.id,
        finding.file
      );
      const approvedContent = approvedFiles[finding.file] ?? localStorage.getItem(
        `codepilot-approved:${repository.id}:${finding.file}`
      );
      const content = approvedContent ?? result.content;

      setFileContent(content);
      setApprovedFiles((previous) => approvedContent
        ? { ...previous, [finding.file]: approvedContent }
        : previous);

      const proposal = await proposeRepositoryFileFix(
        repository.id,
        finding.file,
        content
      );
      setFixProposal(proposal);
    } catch (err) {
      console.error('Could not generate finding fix:', err);
      setFixError(err instanceof Error ? err.message : 'Unable to generate file fix');
    } finally {
      setFileLoading(false);
      setFixLoading(false);
    }
  }

  function rejectFix() {
    if (fixProposal) {
      setFileContent(fixProposal.originalCode);
    }

    setFixProposal(null);
    setFixError(null);
    setAnalysis(null);
    setAnalysisError(null);
  }

  async function approveFix() {
    if (!fixProposal) return;

    if (!selectedFile) return;

    try {
      setFixLoading(true);
      setFixError(null);

      const approvedContent = fixProposal.proposedCode;
      setFileContent(approvedContent);
      setApprovedFiles((previous) => ({
        ...previous,
        [selectedFile]: approvedContent,
      }));
      localStorage.setItem(
        `codepilot-approved:${repository.id}:${selectedFile}`,
        approvedContent
      );
      localStorage.setItem(
        `codepilot-approved-original:${repository.id}:${selectedFile}`,
        fixProposal.originalCode
      );

      setFixProposal(null);
      setAnalysis(null);
      setAnalysisError(null);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : 'Unable to update the file on GitHub');
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

  async function runVerification(files: string[] = []) {
    try {
      setVerificationLoading(true);
      setVerificationError(null);
      const result = await verifyRepository(repository.id, files);
      setVerification(result);
    } catch (err) {
      console.error('Could not verify repository:', err);
      setVerificationError(err instanceof Error ? err.message : 'Unable to run verification');
      setVerification({
        repository: repository.fullName,
        framework: 'none',
        status: 'error',
        testsExecuted: [],
        passed: 0,
        failed: 0,
        errorOutput: err instanceof Error ? err.message : 'Unable to run verification',
        summary: 'Verification could not be run for this repository.',
        filesInvolved: files,
      });
    } finally {
      setVerificationLoading(false);
    }
  }

  async function analyzeRepositoryWorkspace() {
    try {
      setRepositoryAnalysisLoading(true);
      setRepositoryAnalysisError(null);

      const result = await analyzeRepository(repository.id);
      setRepositoryAnalysis(result);
    } catch (err) {
      console.error('Could not analyze repository:', err);
      setRepositoryAnalysisError(
        err instanceof Error
          ? err.message
          : 'Unable to analyze repository'
      );
    } finally {
      setRepositoryAnalysisLoading(false);
    }
  }

  async function generateTests(path: string, functionName: string) {
    try {
      setTestsLoading(true);
      setTestsError(null);
      const result = await generateRepositoryTests(repository.id, path || undefined, functionName || undefined);
      setGeneratedTests(result);
    } catch (err) {
      console.error('Could not generate repository tests:', err);
      setTestsError(err instanceof Error ? err.message : 'Unable to generate repository tests');
    } finally {
      setTestsLoading(false);
    }
  }

  function approveGeneratedTest(test: GeneratedTestCase) {
    const key = `codepilot-approved:${repository.id}:${test.testFile}`;
    const originalKey = `codepilot-approved-original:${repository.id}:${test.testFile}`;

    setApprovedFiles((previous) => ({
      ...previous,
      [test.testFile]: test.testCode,
    }));

    localStorage.setItem(key, test.testCode);
    localStorage.setItem(originalKey, '');

    if (test.sourceFile) {
      setSelectedFile(test.sourceFile);
    }

    setTestsError(`Approved ${test.testFile}. Open Pull Requests to review and create a branch-backed PR.`);
  }

  async function askAssistant(question: string) {
    try {
      setAssistantLoading(true);
      setAssistantError(null);
      const result = await askRepositoryAssistant(repository.id, question);
      setAssistantAnswer({ model: result.model, text: result.answer });
      setAssistantSources(result.sources);
    } catch (err) {
      console.error('Could not answer repository question:', err);
      setAssistantError(err instanceof Error ? err.message : 'Unable to answer repository question');
    } finally {
      setAssistantLoading(false);
    }
  }

  async function refreshRepositoryIndex() {
    try {
      setAssistantLoading(true);
      setAssistantError(null);
      const result = await indexRepository(repository.id);
      setIndexedFiles(result.filesIndexed);
      setAssistantSources([]);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : 'Unable to index repository');
    } finally {
      setAssistantLoading(false);
    }
  }

  async function preparePullRequest() {
    try {
      setPullRequestLoading(true);
      setPullRequestError(null);
      setCreatedPullRequest(null);

      const prefix = `codepilot-approved:${repository.id}:`;
      const approvedPaths = Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
      const changes: PullRequestChange[] = [];

      for (const path of approvedPaths) {
        const approved = localStorage.getItem(`${prefix}${path}`);
        if (approved === null) continue;
        const original = localStorage.getItem(`codepilot-approved-original:${repository.id}:${path}`);
        if (original !== null && original !== approved) {
          changes.push({ path, original, approved });
        }
      }

      if (changes.length === 0) {
        setPullRequestDraft(null);
        setPullRequestError('No approved code changes are available for this repository yet.');
        return;
      }

      setPullRequestDraft({
        title: `Apply CodePilot fixes to ${repository.name}`,
        summary: `${changes.length} approved file${changes.length === 1 ? '' : 's'} differ from the current GitHub branch.`,
        changes,
      });
    } catch (err) {
      setPullRequestError(err instanceof Error ? err.message : 'Unable to prepare pull request review');
    } finally {
      setPullRequestLoading(false);
    }
  }

  async function createPullRequest() {
    if (!pullRequestDraft) return;

    try {
      setPullRequestLoading(true);
      setPullRequestError(null);
      const result = await createRepositoryPullRequest(
        repository.id,
        pullRequestDraft.title,
        [
          pullRequestDraft.summary,
          '',
          'Approved files:',
          ...pullRequestDraft.changes.map((change) => `- ${change.path}`),
          '',
          'Analysis/security findings:',
          ...(repositoryAnalysis?.findings || []).map((finding) => `- ${finding.severity}: ${finding.title} (${finding.file}${finding.line ? `:${finding.line}` : ''})`),
          '',
          'Test results:',
          generatedTests?.tests.length
            ? `- ${generatedTests.tests.length} generated test cases available for review`
            : '- No generated test results loaded',
        ].join('\n'),
        pullRequestDraft.changes.map((change) => ({
          path: change.path,
          content: change.approved,
        }))
      );
      setCreatedPullRequest(result);
    } catch (err) {
      setPullRequestError(err instanceof Error ? err.message : 'Unable to create pull request');
    } finally {
      setPullRequestLoading(false);
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

  if (showAnalysis || showSecurity) {
    return (
      <CodeAnalysisView
        repository={repository}
        analysis={repositoryAnalysis}
        loading={repositoryAnalysisLoading}
        error={repositoryAnalysisError}
        securityOnly={showSecurity}
        onAnalyze={analyzeRepositoryWorkspace}
        onOpenFile={(path) => { onOpenCodeExplorer(); void openFile(path); }}
        onProposeFix={(finding) => { onOpenCodeExplorer(); void proposeFindingFix(finding); }}
      />
    );
  }

  if (showTests) {
    return (
      <TestsView
        repository={repository}
        generatedTests={generatedTests}
        sourceFiles={sortedTree}
        loading={testsLoading}
        error={testsError}
        onGenerate={generateTests}
        onOpenFile={(path) => { onOpenCodeExplorer(); void openFile(path); }}
        onApproveTest={approveGeneratedTest}
      />
    );
  }

  if (showPullRequests) {
    return (
      <PullRequestsView
        repository={repository}
        draft={pullRequestDraft}
        analysis={repositoryAnalysis}
        generatedTests={generatedTests}
        loading={pullRequestLoading}
        error={pullRequestError}
        onPrepare={preparePullRequest}
        onOpenFile={(path) => { onOpenCodeExplorer(); void openFile(path); }}
        onCreate={createPullRequest}
        createdPullRequest={createdPullRequest}
        creating={pullRequestLoading}
      />
    );
  }

  if (showAssistant) {
    return (
      <AssistantView
        repository={repository}
        onAsk={askAssistant}
        answer={assistantAnswer}
        sources={assistantSources}
        onIndex={refreshRepositoryIndex}
        indexedFiles={indexedFiles}
        loading={assistantLoading}
        error={assistantError}
      />
    );
  }

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

        <button
          className="primary"
          onClick={analyzeRepositoryWorkspace}
          disabled={repositoryAnalysisLoading}
        >
          {repositoryAnalysisLoading ? (
            <Loader2 size={17} className="spin" />
          ) : (
            <Sparkles size={17} />
          )}

          {repositoryAnalysisLoading
            ? 'Analyzing repository...'
            : 'Analyze repository'}
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

      {(repositoryAnalysisError || repositoryAnalysis) && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <PanelTitle
            title="Repository analysis"
            action={repositoryAnalysis
              ? `${repositoryAnalysis.filesAnalyzed} files · ${repositoryAnalysis.model}`
              : 'Error'}
          />

          <div style={{ padding: '20px' }}>
            {repositoryAnalysisError ? (
              <div style={{ color: '#ef4444', fontSize: '13px' }}>
                {repositoryAnalysisError}
              </div>
            ) : repositoryAnalysis ? (
              <>
                <p style={{ margin: '0 0 18px', color: '#b7bfce', lineHeight: 1.6 }}>
                  {repositoryAnalysis.summary}
                </p>

                {repositoryAnalysis.findings.length === 0 ? (
                  <div style={{ color: '#8f9aaa', fontSize: '13px' }}>
                    No actionable findings were returned for the analyzed files.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {repositoryAnalysis.findings.map((finding, index) => (
                      <article
                        key={`${finding.file}-${finding.line}-${index}`}
                        style={{
                          padding: '14px',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '8px',
                          background: 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                          <strong>{finding.title}</strong>
                          <span style={{ color: finding.severity === 'Critical' || finding.severity === 'High' ? '#ef7777' : '#aeb8c7', fontSize: '11px' }}>
                            {finding.severity}
                          </span>
                        </div>
                        <div style={{ color: '#8f9aaa', fontSize: '11px', marginTop: '6px' }}>
                          {finding.file}:{finding.line}
                        </div>
                        <div style={{ color: '#8f9aaa', fontSize: '11px', marginTop: '6px' }}>
                          Confidence: {Math.round(finding.confidence * 100)}%
                        </div>
                        <p style={{ color: '#b7bfce', fontSize: '12px', lineHeight: 1.55, margin: '10px 0 6px' }}>
                          {finding.explanation}
                        </p>
                        <div style={{ color: '#8f9aaa', fontSize: '12px', lineHeight: 1.5 }}>
                          Suggested fix: {finding.suggestedFix}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                          <button type="button" onClick={() => openFile(finding.file)}>
                            View code
                          </button>
                          <button type="button" className="primary" onClick={() => proposeFindingFix(finding)}>
                            <Sparkles size={14} />
                            Propose fix
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </section>
      )}

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
            className={fixProposal ? 'code-explorer-layout reviewing' : 'code-explorer-layout'}
            style={{
              display: 'grid',
              gridTemplateColumns: fixProposal ? '1fr' : 'minmax(250px, 35%) 1fr',
              minHeight: '500px',
            }}
          >
            {/* File tree */}

            <div
              className="file-tree"
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
              className="file-viewer"
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

                    <button
                      type="button"
                      className="primary"
                      onClick={() => runVerification([selectedFile])}
                      disabled={fileLoading || analysisLoading || fixLoading || verificationLoading || !fileContent}
                      style={{ padding: '8px 11px', fontSize: '11px', flexShrink: 0 }}
                    >
                      {verificationLoading ? <Loader2 size={14} className="spin" /> : <TestTube2 size={14} />}
                      {verificationLoading ? 'Verifying...' : 'Verify'}
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
                          <button type="button" onClick={rejectFix}>Reject</button>
                          <button type="button" className="primary" onClick={approveFix} disabled={fixLoading}>
                            {fixLoading ? 'Saving to GitHub...' : 'Approve Fix'}
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