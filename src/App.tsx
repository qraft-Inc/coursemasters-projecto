import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Clock3,
  ExternalLink,
  GanttChartSquare,
  Link2,
  FileCheck2,
  FileSpreadsheet,
  Flag,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Menu,
  MessageSquareText,
  MonitorCog,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react'
import {
  SOURCE_SHEETS,
  type ImportedDataset,
  type MicroLesson,
  type WorkplanTask,
} from './lib/types'
import { fetchGoogleSheetDataset, GOOGLE_SHEET_URL, REFRESH_INTERVAL_MS } from './lib/google-sheets'
import { buildTimeline, daysOverdue, isOverdue, ownerWorkload, parseSheetDate, splitOwners, summarizeTasks } from './lib/analytics'
import anischolarLogo from './assets/anischolar-logo.png'
import qraftLogo from './assets/qraft-academy-logo.png'
import './App.css'

type ViewKey = 'overview' | 'workplan' | 'timeline' | 'production' | 'reviews' | 'lms' | 'import'
const VIEW_KEYS: ViewKey[] = ['overview', 'workplan', 'timeline', 'production', 'reviews', 'lms', 'import']

function viewFromHash(): ViewKey {
  const key = window.location.hash.replace(/^#\/?/, '') as ViewKey
  return VIEW_KEYS.includes(key) ? key : 'overview'
}
type ReviewStatusFilter = 'all' | 'pending' | 'in-review' | 'approved'

const navigation: { id: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'workplan', label: 'Master workplan', icon: ListChecks },
  { id: 'timeline', label: 'Timeline', icon: GanttChartSquare },
  { id: 'production', label: 'Course production', icon: Workflow },
  { id: 'reviews', label: 'Review center', icon: FileCheck2 },
  { id: 'lms', label: 'LMS development', icon: MonitorCog },
]

const modules = [
  { code: 'M0', title: 'Course Orientation and Learning Journey', kind: 'Orientation' },
  { code: 'M1', title: 'Personal Development', kind: 'Core module' },
  { code: 'M2', title: 'Interpersonal Effectiveness', kind: 'Core module' },
  { code: 'M3', title: 'Professionalism', kind: 'Core module' },
  { code: 'M4', title: 'Digital Ethos', kind: 'Core module' },
  { code: 'M5', title: 'Entrepreneurship Mindset', kind: 'Core module' },
  { code: 'M6', title: 'Basic Employment and Labour Laws', kind: 'Core module' },
  { code: 'MZ', title: 'Course Conclusion, Capstone and Next Steps', kind: 'Closing' },
]

const coreModuleCodes = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
const productionStages = [
  'Instructional design',
  'Script drafting',
  'Script review',
  'Script approval',
  'Storyboarding',
  'Storyboard approval',
  'Voice-over recording',
  'Audio editing',
  'Illustration and animation',
  'Video production',
  'Transcript and accessibility review',
  'H5P and assessment authoring',
  'Internal QA',
  'Moodle staging integration',
  'Client review',
  'Final acceptance',
]

const EMPTY_TASKS: WorkplanTask[] = []

const workbookHints: Record<(typeof SOURCE_SHEETS)[number], string> = {
  'Implementation Timeline': 'Baseline weeks, activities and milestone timing',
  Dashboard: 'Project settings and source-calculated summaries',
  'Master Workplan': 'Activities, dates, owners, status and completion',
  'Deliverables and Approvals': 'Submission, feedback and approval records',
  'Risks and Dependencies': 'Risk, issue and dependency register',
  'Decisions and Changes': 'Open decisions and requested changes',
  'Payment Milestones': 'Contract gates, amounts and payment status',
  'Team and Contacts': 'Project team, roles and decision authority',
}

function createLessonPlaceholders(): MicroLesson[] {
  return Array.from({ length: 36 }, (_, index) => ({
    id: `CORE-${String(index + 1).padStart(2, '0')}`,
    sequence: index + 1,
    moduleCode: null,
    title: 'Title Pending Verification',
    titleVerified: false,
    stage: productionStages[0],
    status: 'Not started',
  }))
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const date = parseSheetDate(value)
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : value
}

function dateTimeLabel(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
}

function progressFor(tasks: WorkplanTask[]): number | null {
  if (tasks.length === 0) return null
  return Math.round(tasks.reduce((total, task) => total + task.percentComplete, 0) / tasks.length)
}

function reviewStatusBucket(status: string): ReviewStatusFilter | 'other' {
  const normalized = status.trim().toLowerCase()
  if (/not approved|rejected|returned/.test(normalized)) return 'other'
  if (/approved|accepted/.test(normalized)) return 'approved'
  if (/not submitted|not started|pending submission|awaiting submission/.test(normalized)) return 'pending'
  if (/submitted|review/.test(normalized)) return 'in-review'
  if (/pending|awaiting/.test(normalized)) return 'pending'
  return 'other'
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** Card thumbnails are limited to HTTPS Cloudinary images, matching the site's image security policy. */
function safeThumbnailUrl(value: string): string | null {
  const href = safeExternalUrl(value)
  if (!href) return null
  const url = new URL(href)
  return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' ? href : null
}

function App() {
  const [activeView, setActiveViewState] = useState<ViewKey>(viewFromHash)
  const [shareNotice, setShareNotice] = useState('')
  const [dataset, setDataset] = useState<ImportedDataset | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [streamFilter, setStreamFilter] = useState('All workstreams')
  const [ownerFilter, setOwnerFilter] = useState('All owners')
  const [reviewSearch, setReviewSearch] = useState('')
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>('all')
  const [reviewMilestoneFilter, setReviewMilestoneFilter] = useState('All milestones')
  const [lessonFilter, setLessonFilter] = useState('All modules')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const refreshInFlight = useRef(false)
  const activeRequest = useRef<AbortController | null>(null)

  const refreshFromSheet = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    const controller = new AbortController()
    activeRequest.current = controller
    setIsRefreshing(true)
    try {
      const incoming = await fetchGoogleSheetDataset(fetch, controller.signal)
      setDataset((current) => ({
        ...incoming,
        microLessons: current?.microLessons ?? createLessonPlaceholders(),
      }))
      setLastRefreshed(new Date().toISOString())
      setRefreshError('')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setRefreshError(error instanceof Error ? error.message : 'Could not refresh the Google Sheet.')
      }
    } finally {
      if (activeRequest.current === controller) {
        refreshInFlight.current = false
        activeRequest.current = null
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshFromSheet(), 0)
    const interval = window.setInterval(() => void refreshFromSheet(), REFRESH_INTERVAL_MS)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      activeRequest.current?.abort()
      activeRequest.current = null
      refreshInFlight.current = false
    }
  }, [refreshFromSheet])

  useEffect(() => {
    const onHashChange = () => setActiveViewState(viewFromHash())
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
    }
  }, [])

  const setActiveView = useCallback((view: ViewKey) => {
    setActiveViewState(view)
    if (viewFromHash() !== view) window.history.pushState(null, '', `#${view}`)
    window.scrollTo({ top: 0 })
  }, [])

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareNotice('Link copied')
    } catch {
      setShareNotice('Copy failed')
    }
    window.setTimeout(() => setShareNotice(''), 2000)
  }

  const tasks = dataset?.tasks ?? EMPTY_TASKS
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchesQuery =
        !query ||
        [task.id, task.activity, task.owner, task.deliverable]
          .some((value) => value.toLowerCase().includes(query))
      const matchesStatus = statusFilter === 'All statuses' || task.status === statusFilter
      const matchesStream = streamFilter === 'All workstreams' || task.workstream === streamFilter
      const matchesOwner = ownerFilter === 'All owners' || splitOwners(task.owner).includes(ownerFilter)
      return matchesQuery && matchesStatus && matchesStream && matchesOwner
    })
  }, [ownerFilter, search, statusFilter, streamFilter, tasks])

  const filtersActive = Boolean(search.trim()) || statusFilter !== 'All statuses' || streamFilter !== 'All workstreams' || ownerFilter !== 'All owners'
  function resetFilters() {
    setSearch('')
    setStatusFilter('All statuses')
    setStreamFilter('All workstreams')
    setOwnerFilter('All owners')
  }

  const streamOptions = [...new Set(tasks.map((task) => task.workstream).filter(Boolean))]
  const ownerOptions = [...new Set(tasks.flatMap((task) => splitOwners(task.owner)))].sort()
  const progress = progressFor(tasks)
  const summary = summarizeTasks(tasks)
  const viewTitle = navigation.find((item) => item.id === activeView)?.label ?? 'Overview'

  function renderOverview() {
    const metrics = [
      { label: 'Workplan activities', value: dataset ? String(tasks.length) : '—', detail: dataset ? 'Live sheet records' : 'Waiting for Google Sheets', icon: ListChecks },
      { label: 'Core micro-lessons', value: '36', detail: 'Titles pending verification', icon: BookOpenCheck },
      { label: 'Payment milestones', value: dataset ? String(dataset.milestones.length) : '—', detail: dataset ? 'Live sheet gates' : 'Waiting for Google Sheets', icon: Flag },
      { label: 'Project duration', value: '12 weeks', detail: 'Proposed baseline', icon: CalendarDays },
    ]

    return (
      <>
        <section className="welcome-panel">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="status-dot" /> ANI SCHOLAR · WORK READINESS COURSE</div>
            <h1>Project delivery,<br />with a clearer view.</h1>
            <p>One workspace for course production, LMS development, reviews and delivery milestones.</p>
            <div className="welcome-meta">
              <span><CalendarDays size={15} /> 2 Nov 2026 – 24 Jan 2027 <i>proposed</i></span>
              <span><Users size={15} /> AniScholar Career Hub Ltd</span>
            </div>
            <div className="partner-strip">
              <div><small>DELIVERED BY</small><span className="logo-chip"><img src={qraftLogo} alt="Qraft Academy | CourseMasters" /></span></div>
              <div><small>FOR</small><span className="logo-chip"><img src={anischolarLogo} alt="AniScholar Career Hub" /></span></div>
            </div>
            <button className="button button-light" onClick={() => setActiveView('workplan')} type="button">
              Open master workplan <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="welcome-mark" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="mark-core"><Gauge size={38} strokeWidth={1.5} /></div>
            <div className="mark-chip chip-one"><CircleCheck size={15} /> Plan</div>
            <div className="mark-chip chip-two"><Workflow size={15} /> Produce</div>
            <div className="mark-chip chip-three"><ShieldCheck size={15} /> Approve</div>
          </div>
        </section>

        <div className="section-heading metric-heading">
          <div><h2>Project at a glance</h2><p>Project records refresh directly from the live Google Sheet.</p></div>
          <span className={`reference-tag ${refreshError ? 'reference-error' : ''}`}><CircleDot size={13} /> {refreshError ? 'Sheet connection issue' : dataset ? 'Live Google Sheet' : 'Connecting to sheet'}</span>
        </div>
        <div className="metrics-grid">
          {metrics.map((metric, index) => {
            const Icon = metric.icon
            return (
              <article className={`metric-card metric-${index + 1}`} key={metric.label}>
                <div className="metric-top"><span className="metric-icon"><Icon size={17} /></span><span className="metric-reference">{dataset ? 'LIVE' : 'WAITING'}</span></div>
                <strong>{metric.value}</strong>
                <span className="metric-label">{metric.label}</span>
                <span className="metric-detail">{metric.detail}</span>
              </article>
            )
          })}
        </div>

        <div className="overview-grid">
          <section className="panel progress-panel">
            <div className="panel-heading">
              <div><h2>Workplan progress</h2><p>Equal-weight average of activity completion</p></div>
              <button className="icon-button" aria-label="View master workplan" onClick={() => setActiveView('workplan')} type="button"><ArrowUpRight size={17} /></button>
            </div>
            <div className="progress-summary">
              <div className="progress-ring" style={{ '--progress': `${progress ?? 0}%` } as React.CSSProperties}>
                <div><strong>{progress === null ? '—' : `${progress}%`}</strong><span>{progress === null ? 'Awaiting sheet' : 'of activities'}</span></div>
              </div>
              <div className="progress-breakdown">
                <div><span className="legend"><i className="legend-complete" /> Completed</span><strong>{summary.completed}</strong></div>
                <div><span className="legend"><i className="legend-active" /> In progress</span><strong>{summary.inProgress}</strong></div>
                <div><span className="legend"><i className="legend-delayed" /> Delayed / blocked</span><strong>{summary.blocked}</strong></div>
                <div><span className="legend"><i className="legend-pending" /> Past planned finish</span><strong>{summary.overdue}</strong></div>
              </div>
            </div>
            <div className="progress-note"><LockKeyhole size={14} /> No completion is inferred from elapsed time.</div>
          </section>

          <section className="panel workspaces-panel">
            <div className="panel-heading">
              <div><h2>Primary workspaces</h2><p>Focused on AniScholar's first delivery phase</p></div>
              <span className="soft-count">05</span>
            </div>
            <div className="workspace-list">
              {[
                { id: 'workplan' as const, label: 'Master workplan', note: `${dataset ? tasks.length : '—'} live source activities`, icon: ListChecks, tone: 'violet' },
                { id: 'production' as const, label: 'Course production', note: 'Modules & micro-lessons', icon: BookOpenCheck, tone: 'blue' },
                { id: 'reviews' as const, label: 'Review center', note: `${dataset?.deliverables.length ?? '—'} deliverables`, icon: FileCheck2, tone: 'orange' },
                { id: 'lms' as const, label: 'LMS development', note: 'Moodle technical track', icon: MonitorCog, tone: 'green' },
                { id: 'import' as const, label: 'Google Sheet connection', note: dataset ? 'Read-only live source' : 'Connecting to source', icon: FileSpreadsheet, tone: 'slate' },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <button className="workspace-row" key={item.id} onClick={() => setActiveView(item.id)} type="button">
                    <span className={`workspace-icon ${item.tone}`}><Icon size={17} /></span>
                    <span className="workspace-text"><strong>{item.label}</strong><small>{item.note}</small></span>
                    <ArrowUpRight size={16} className="workspace-arrow" />
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <section className="panel snapshot-panel">
          <div className="panel-heading">
            <div><h2>Workstream snapshot</h2><p>Activity-level status from the live workplan</p></div>
            <button className="text-button" onClick={() => setActiveView('workplan')} type="button">View workplan <ArrowUpRight size={15} /></button>
          </div>
          {tasks.length === 0 ? (
            <EmptyState title="Waiting for live sheet data" text="Workstream owners, dates and progress will appear when the Google Sheet connection succeeds." />
          ) : (
            <div className="stream-grid">
              {streamOptions.map((stream) => {
                const streamTasks = tasks.filter((task) => task.workstream === stream)
                const streamProgress = progressFor(streamTasks)
                return (
                  <button className="stream-card" key={stream} onClick={() => { setStreamFilter(stream); setActiveView('workplan') }} type="button">
                    <span>{stream}</span><strong>{streamProgress}%</strong>
                    <div className="tiny-track"><i style={{ width: `${streamProgress}%` }} /></div>
                    <small>{streamTasks.length} activities · {summarizeTasks(streamTasks).completed} completed</small>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <div className="overview-grid bottom-grid">
          <section className="panel panel-compact">
            <div className="panel-heading"><div><h2>Upcoming milestones</h2><p>Payment gates from the source register</p></div><Flag size={17} className="heading-icon" /></div>
            {dataset?.milestones.length ? (
              <div className="milestone-list">
                {dataset.milestones.map((milestone) => (
                  <div className="milestone-row" key={milestone.id}>
                    <span className="milestone-id">{milestone.id}</span>
                    <span className="milestone-name"><strong>{milestone.label.replace(/^M\d+\s*/, '')}</strong><small>Week {milestone.targetWeek || '—'} · {milestone.approvalRequirement || 'No requirement recorded'}</small></span>
                    <strong className="milestone-amount">UGX {milestone.amount.toLocaleString('en-UG')}</strong>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="Milestones not available" text="Payment gates will appear when the live Google Sheet connection succeeds." />}
          </section>
          <section className="panel panel-compact">
            <div className="panel-heading"><div><h2>Needs attention</h2><p>Based only on current sheet records</p></div><AlertCircle size={17} className="heading-icon warning" /></div>
            {dataset ? (
              <div className="attention-list">
                <div><span className="attention-dot red-dot" /><span><strong>{summary.overdue}</strong> activities past planned finish and not complete</span><button onClick={() => setActiveView('timeline')} type="button">Timeline</button></div>
                <div><span className="attention-dot orange-dot" /><span><strong>{dataset.deliverables.filter((item) => /pending|review/i.test(item.approvalStatus)).length}</strong> deliverables with review status recorded</span><button onClick={() => setActiveView('reviews')} type="button">Open</button></div>
                <div><span className="attention-dot red-dot" /><span><strong>{dataset.risks.filter((item) => /high|critical/i.test(String(item.Rating ?? ''))).length}</strong> high / critical source risks</span><button onClick={() => setActiveView('import')} type="button">Review</button></div>
                <div><span className="attention-dot blue-dot" /><span><strong>{dataset.decisions.length}</strong> decisions in source register</span><button onClick={() => setActiveView('import')} type="button">View</button></div>
              </div>
            ) : <EmptyState title="No live alerts yet" text="Recorded approvals, risks and decisions will appear when the Google Sheet connects." />}
          </section>
        </div>
      </>
    )
  }

  function renderWorkplan() {
    return (
      <>
        <section className="page-intro">
          <div><span className="eyebrow dark-eyebrow">PROJECT DELIVERY</span><h1>Master workplan</h1><p>Track activities, dates, ownership and progress across the AniScholar delivery plan.</p></div>
          <button className="button button-primary" disabled={isRefreshing} onClick={() => void refreshFromSheet()} type="button"><RefreshCw size={16} /> {isRefreshing ? 'Refreshing…' : 'Refresh from sheet'}</button>
        </section>
        <KpiStrip tasks={filteredTasks} scoped={filtersActive} />
        <section className="panel table-panel">
          <div className="table-toolbar">
            <div className="table-title"><div><h2>Activities</h2><p>{tasks.length} live source activities · read-only view</p></div></div>
            <div className="table-controls">
              <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activities" /></label>
              <select aria-label="Filter by workstream" value={streamFilter} onChange={(event) => setStreamFilter(event.target.value)}>
                <option>All workstreams</option>{streamOptions.map((stream) => <option key={stream}>{stream}</option>)}
              </select>
              <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option>All statuses</option>{[...new Set(tasks.map((task) => task.status).filter(Boolean))].map((status) => <option key={status}>{status}</option>)}
              </select>
              <select aria-label="Filter by owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option>All owners</option>{ownerOptions.map((owner) => <option key={owner}>{owner}</option>)}
              </select>
              {filtersActive && <button className="text-button" onClick={resetFilters} type="button"><X size={14} /> Reset</button>}
            </div>
          </div>
          {filteredTasks.length === 0 ? (
            <EmptyState title={tasks.length ? 'No matching activities' : 'No workplan records yet'} text={tasks.length ? 'Adjust your search or filters to see activities.' : 'Workplan rows will load here when the Google Sheet connection succeeds.'} />
          ) : (
            <div className="table-scroll">
              <table className="workplan-table">
                <thead><tr><th>Activity</th><th>Owner</th><th>Planned dates</th><th>Status</th><th>Complete</th></tr></thead>
                <tbody>
                  {filteredTasks.map((task) => (
                    <tr key={task.id}>
                      <td><div className="activity-cell"><span className="activity-id">{task.id}</span><strong>{task.activity}</strong><small>{task.workstream}{task.phase ? ` · ${task.phase}` : ''}</small>{task.dependency && <small className="dependency-line"><ArrowDownRight size={12} /> Depends on {task.dependency}</small>}</div></td>
                      <td><div className="owner-cell"><span className="avatar">{(task.owner || task.leadOrganisation || '?').slice(0, 1).toUpperCase()}</span><span><strong>{task.owner || 'Unassigned'}</strong><small>{task.leadOrganisation}</small></span></div></td>
                      <td><div className="date-cell"><span>{dateLabel(task.plannedStart)}</span><small>to {dateLabel(task.plannedFinish)}</small></div></td>
                      <td><span className={`status-text ${statusTone(task.status)}`}>{task.status || 'Not recorded'}</span>{isOverdue(task) && <small className="overdue-flag">{daysOverdue(task)}d past finish</small>}</td>
                      <td><div className="percent-cell"><span>{task.percentComplete}%</span><div className="tiny-track"><i style={{ width: `${Math.min(task.percentComplete, 100)}%` }} /></div></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {tasks.length > 0 && (
          <section className="panel table-panel">
            <div className="panel-heading"><div><h2>Owner workload</h2><p>Shared activities count for each named owner · select a row to filter</p></div><Users size={17} className="heading-icon" /></div>
            <div className="table-scroll">
              <table className="workplan-table workload-table">
                <thead><tr><th>Owner</th><th>Activities</th><th>Open</th><th>In progress</th><th>Past finish</th><th>Avg. complete</th></tr></thead>
                <tbody>
                  {ownerWorkload(filteredTasks).map((row) => (
                    <tr className={ownerFilter === row.owner ? 'row-selected' : ''} key={row.owner}>
                      <td><button className="owner-cell owner-filter-button" aria-pressed={ownerFilter === row.owner} onClick={() => setOwnerFilter(ownerFilter === row.owner ? 'All owners' : row.owner)} type="button"><span className="avatar">{row.owner.slice(0, 1).toUpperCase()}</span><strong>{row.owner}</strong></button></td>
                      <td>{row.total}</td>
                      <td>{row.total - row.completed}</td>
                      <td>{row.inProgress}</td>
                      <td>{row.overdue ? <span className="status-text tone-red">{row.overdue}</span> : 0}</td>
                      <td><div className="percent-cell"><span>{row.averageProgress}%</span><div className="tiny-track"><i style={{ width: `${row.averageProgress}%` }} /></div></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <div className="source-note"><LockKeyhole size={15} /> This is a read-only live view. Update the Google Sheet to change source records; ProjectOS does not save edits.</div>
      </>
    )
  }

  function renderTimeline() {
    const layout = buildTimeline(filteredTasks)
    const groups = [...new Set(layout?.bars.map((bar) => bar.task.workstream || 'Unassigned') ?? [])]
    return (
      <>
        <section className="page-intro">
          <div><span className="eyebrow dark-eyebrow">SCHEDULE</span><h1>Timeline</h1><p>Planned start and finish dates from the live workplan, grouped by workstream.</p></div>
          <button className="button button-primary" disabled={isRefreshing} onClick={() => void refreshFromSheet()} type="button"><RefreshCw size={16} className={isRefreshing ? 'spin-icon' : ''} /> {isRefreshing ? 'Refreshing…' : 'Refresh from sheet'}</button>
        </section>
        <KpiStrip tasks={filteredTasks} scoped={filtersActive} />
        <section className="panel table-panel">
          <div className="table-toolbar">
            <div className="table-title"><div><h2>Gantt view</h2><p>{layout ? `${dateLabel(layout.start.toISOString())} – ${dateLabel(new Date(layout.finish.getTime() - 86_400_000).toISOString())}` : 'No dated activities'}</p></div></div>
            <div className="table-controls">
              <select aria-label="Filter by workstream" value={streamFilter} onChange={(event) => setStreamFilter(event.target.value)}>
                <option>All workstreams</option>{streamOptions.map((stream) => <option key={stream}>{stream}</option>)}
              </select>
              <select aria-label="Filter by owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option>All owners</option>{ownerOptions.map((owner) => <option key={owner}>{owner}</option>)}
              </select>
              {filtersActive && <button className="text-button" onClick={resetFilters} type="button"><X size={14} /> Reset</button>}
            </div>
          </div>
          {!layout ? (
            <EmptyState title={tasks.length ? 'No dated activities match' : 'No workplan records yet'} text={tasks.length ? 'Adjust filters, or add planned dates in the source sheet.' : 'The timeline will draw when the Google Sheet connection succeeds.'} />
          ) : (
            <div className="gantt-scroll">
              <div className="gantt">
                <div className="gantt-header">
                  <div className="gantt-label-col">Activity</div>
                  <div className="gantt-track">
                    {layout.weeks.map((week) => <span className="gantt-week" key={week.label} style={{ left: `${week.left}%` }}>{week.label}</span>)}
                  </div>
                </div>
                {groups.map((group) => (
                  <div className="gantt-group" key={group}>
                    <div className="gantt-group-label">{group}</div>
                    {layout.bars.filter((bar) => (bar.task.workstream || 'Unassigned') === group).map((bar) => (
                      <div className="gantt-row" key={bar.task.id}>
                        <div className="gantt-label-col"><span className="activity-id">{bar.task.id}</span><span className="gantt-activity" title={bar.task.activity}>{bar.task.activity}</span></div>
                        <div className="gantt-track">
                          {layout.weeks.map((week) => <i className="gantt-gridline" key={week.label} style={{ left: `${week.left}%` }} />)}
                          {layout.todayLeft !== null && <i className="gantt-today" style={{ left: `${layout.todayLeft}%` }} />}
                          <div
                            className={`gantt-bar ${statusTone(bar.task.status)} ${bar.overdue ? 'gantt-bar-overdue' : ''}`}
                            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                            title={`${bar.task.id} · ${bar.task.activity}\n${dateLabel(bar.task.plannedStart)} – ${dateLabel(bar.task.plannedFinish)}\n${bar.task.status || 'No status'} · ${bar.task.percentComplete}%${bar.overdue ? ' · past planned finish' : ''}\nOwner: ${bar.task.owner || 'Unassigned'}`}
                          >
                            <span className="gantt-fill" style={{ width: `${Math.min(bar.task.percentComplete, 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {layout && (
            <div className="gantt-legend">
              {layout.todayLeft !== null && <span><i className="gantt-legend-today" /> Today</span>}
              <span><i className="gantt-legend-fill" /> Percent complete</span>
              <span><i className="gantt-legend-overdue" /> Past planned finish, not complete</span>
              {layout.undated.length > 0 && <span>{layout.undated.length} activities have no planned dates and are not shown</span>}
            </div>
          )}
        </section>
        <div className="source-note"><LockKeyhole size={15} /> Bars use planned dates only. Progress shading comes from the sheet's percent-complete column.</div>
      </>
    )
  }

  function renderProduction() {
    return (
      <>
        <section className="page-intro">
          <div><span className="eyebrow dark-eyebrow">COURSE WORKSPACE</span><h1>Course production</h1><p>Modules and micro-lessons move through a clear production and review pipeline.</p></div>
          <span className="reference-tag"><BookOpenCheck size={14} /> Curriculum titles pending verification</span>
        </section>
        <section className="panel modules-panel">
          <div className="panel-heading"><div><h2>Course structure</h2><p>Module structure from the approved project brief</p></div><span className="soft-count">08</span></div>
          <div className="module-grid">
            {modules.map((module, index) => (
              <article className={`module-card ${index === 0 || index === 7 ? 'module-edge' : ''}`} key={module.code}>
                <div className="module-top"><span className="module-code">{module.code}</span><span className="module-kind">{module.kind}</span></div>
                <h3>{module.title}</h3>
                <div className="module-bottom"><span><CircleDot size={13} /> {module.kind === 'Core module' ? 'Lesson titles pending verification' : 'Structure defined'}</span><span className="module-arrow"><ArrowUpRight size={15} /></span></div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel pipeline-panel">
          <div className="panel-heading"><div><h2>Micro-lesson pipeline</h2><p>Read-only placeholders until shared application storage is configured</p></div><span className="reference-tag">36 core lessons in scope</span></div>
          <div className="pipeline-stages">
            {productionStages.map((stage, index) => (
              <div className="pipeline-stage" key={stage}><span className="stage-number">{String(index + 1).padStart(2, '0')}</span><span>{stage}</span>{index < productionStages.length - 1 && <i />}</div>
            ))}
          </div>
          {!dataset?.microLessons.length ? (
            <div className="empty-banner"><BookOpenCheck size={19} /><div><strong>Connecting the live sheet</strong><span>36 numbered placeholders will appear after the first successful sheet refresh; no lesson titles or module assignments are assumed.</span></div></div>
          ) : (
            <div className="lesson-list-panel">
              <div className="lesson-toolbar"><div><strong>Core micro-lessons</strong><small>{dataset.microLessons.length} generated placeholders · not stored in the Google Sheet</small></div><select aria-label="Filter micro-lessons by module" value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)}><option>All modules</option><option>Unassigned</option>{coreModuleCodes.map((code) => <option key={code}>{code}</option>)}</select></div>
              <div className="lesson-table-scroll"><table className="lesson-table"><thead><tr><th>Sequence</th><th>Title</th><th>Module</th><th>Production stage</th><th>Status</th><th>Title check</th></tr></thead><tbody>
                {dataset.microLessons.filter((lesson) => lessonFilter === 'All modules' || (lessonFilter === 'Unassigned' ? !lesson.moduleCode : lesson.moduleCode === lessonFilter)).map((lesson) => (
                  <tr key={lesson.id}>
                    <td><span className="lesson-code">{lesson.id}</span></td>
                    <td><span className={lesson.titleVerified ? 'lesson-title verified' : 'lesson-title'}>{lesson.title}</span></td>
                    <td>{lesson.moduleCode ?? 'Unassigned'}</td>
                    <td>{lesson.stage}</td>
                    <td>{lesson.status}</td>
                    <td>{lesson.titleVerified ? 'Verified' : 'Pending'}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </div>
          )}
        </section>
      </>
    )
  }

  function renderReviews() {
    const deliverables = dataset?.deliverables ?? []
    const milestones = [...new Set(deliverables.map((item) => item.milestone).filter(Boolean))]
    const reviewCounts = {
      all: deliverables.length,
      pending: deliverables.filter((item) => reviewStatusBucket(item.approvalStatus) === 'pending').length,
      'in-review': deliverables.filter((item) => reviewStatusBucket(item.approvalStatus) === 'in-review').length,
      approved: deliverables.filter((item) => reviewStatusBucket(item.approvalStatus) === 'approved').length,
    }
    const visibleDeliverables = deliverables.filter((item) => {
      const query = reviewSearch.trim().toLowerCase()
      const matchesSearch = !query ||
        [item.id, item.description, item.owner, item.reviewer, item.milestone]
          .some((value) => value.toLowerCase().includes(query))
      const matchesStatus = reviewStatusFilter === 'all' ||
        reviewStatusBucket(item.approvalStatus) === reviewStatusFilter
      const matchesMilestone = reviewMilestoneFilter === 'All milestones' ||
        item.milestone === reviewMilestoneFilter
      return matchesSearch && matchesStatus && matchesMilestone
    })

    return (
      <>
        <section className="page-intro">
          <div><span className="eyebrow dark-eyebrow">CLIENT REVIEW</span><h1>Review center</h1><p>Browse live deliverables by submission status and contractual milestone.</p></div>
          <button className="button button-primary" disabled={isRefreshing} onClick={() => void refreshFromSheet()} type="button"><RefreshCw size={16} className={isRefreshing ? 'spin-icon' : ''} /> {isRefreshing ? 'Refreshing…' : 'Refresh reviews'}</button>
        </section>
        <section className="review-summary-grid">
          <article className="review-summary-card"><span>Total deliverables</span><strong>{reviewCounts.all}</strong><small>Live source register</small></article>
          <article className="review-summary-card review-summary-pending"><span>Awaiting submission</span><strong>{reviewCounts.pending}</strong><small>Not yet submitted</small></article>
          <article className="review-summary-card review-summary-review"><span>Submitted / in review</span><strong>{reviewCounts['in-review']}</strong><small>Review status in source</small></article>
          <article className="review-summary-card review-summary-approved"><span>Approved</span><strong>{reviewCounts.approved}</strong><small>Approval recorded</small></article>
        </section>
        <section className="panel review-toolbar">
          <div className="review-controls">
            <label className="search-field"><Search size={16} /><input aria-label="Search deliverables" value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} placeholder="Search title, owner or reviewer" /></label>
            <select aria-label="Filter by milestone" value={reviewMilestoneFilter} onChange={(event) => setReviewMilestoneFilter(event.target.value)}>
              <option>All milestones</option>{milestones.map((milestone) => <option key={milestone}>{milestone}</option>)}
            </select>
          </div>
          <div className="review-filter-list" aria-label="Filter by review status">
            {([
              ['all', 'All items'],
              ['pending', 'Awaiting submission'],
              ['in-review', 'Submitted / in review'],
              ['approved', 'Approved'],
            ] as const).map(([filter, label]) => (
              <button
                aria-pressed={reviewStatusFilter === filter}
                className={`review-filter-chip ${reviewStatusFilter === filter ? 'active' : ''}`}
                key={filter}
                onClick={() => setReviewStatusFilter(filter)}
                type="button"
              >
                {label}<span>{reviewCounts[filter]}</span>
              </button>
            ))}
          </div>
          <div className="review-result-count">{visibleDeliverables.length} of {deliverables.length} deliverables</div>
        </section>
        {visibleDeliverables.length === 0 ? (
          <section className="panel review-empty">
            <EmptyState
              title={deliverables.length ? 'No matching deliverables' : 'No review records available'}
              text={deliverables.length ? 'Try another search or filter.' : 'Live deliverables will appear after the Google Sheet connects.'}
            />
          </section>
        ) : (
          <section className="review-grid" aria-label="Deliverables for review">
            {visibleDeliverables.map((item, index) => {
              const evidenceUrl = safeExternalUrl(item.evidence)
              const thumbnailUrl = safeThumbnailUrl(item.thumbnail)
              return (
                <article className="review-card" key={item.id}>
                  {thumbnailUrl ? (
                    <div className="review-cover review-cover-image">
                      <img src={thumbnailUrl} alt="" loading="lazy" />
                      <span className="review-cover-kicker">DELIVERABLE · {item.milestone || 'UNSCHEDULED'}</span>
                    </div>
                  ) : (
                  <div className={`review-cover review-cover-${index % 4}`} aria-hidden="true">
                    <span className="review-cover-kicker">DELIVERABLE · {item.milestone || 'UNSCHEDULED'}</span>
                    <FileCheck2 size={37} strokeWidth={1.4} />
                    <strong>{item.id}</strong>
                    <span className="review-cover-caption">SUBMISSION & APPROVAL</span>
                  </div>
                  )}
                  <div className="review-card-body">
                    <div className="review-card-heading">
                      <span className="activity-id">{item.id}</span>
                      <span className={`approval-pill ${statusTone(item.approvalStatus)}`}>{item.approvalStatus || 'Not recorded'}</span>
                    </div>
                    <h2>{item.description}</h2>
                    <div className="review-card-dates">
                      <span>Planned: <strong>{dateLabel(item.plannedSubmission)}</strong></span>
                      {item.actualSubmission && <span>Submitted: <strong>{dateLabel(item.actualSubmission)}</strong></span>}
                      {item.approvalDate && <span>Approved: <strong>{dateLabel(item.approvalDate)}</strong></span>}
                    </div>
                    <div className="review-assignees">
                      <div><small>OWNER</small><strong>{item.owner || 'Not assigned'}</strong></div>
                      <div><small>REVIEWER</small><strong>{item.reviewer || 'Not recorded'}</strong></div>
                    </div>
                    <div className="review-card-actions">
                      {evidenceUrl
                        ? <a className="button button-small" href={evidenceUrl} rel="noreferrer" target="_blank">Open evidence <ExternalLink size={13} /></a>
                        : <button className="button button-small" disabled title="No valid evidence URL is recorded in the source sheet" type="button">No evidence linked</button>}
                      <a className="review-source-link" href={GOOGLE_SHEET_URL} rel="noreferrer" target="_blank">Open source <ExternalLink size={12} /></a>
                    </div>
                  </div>
                </article>
              )
            })}
          </section>
        )}
        <div className="source-note"><LockKeyhole size={15} /> This is a read-only review queue from the live sheet. Feedback and approval actions need shared storage and authenticated reviewer permissions.</div>
      </>
    )
  }

  function renderLms() {
    const lmsTasks = tasks.filter((task) => /lms|moodle/i.test(`${task.workstream} ${task.activity}`))
    return (
      <>
        <section className="page-intro"><div><span className="eyebrow dark-eyebrow">TECHNICAL DELIVERY</span><h1>LMS development</h1><p>Keep Moodle architecture, configuration, integration and testing visible alongside course production.</p></div><span className="workspace-icon green"><MonitorCog size={17} /> Moodle</span></section>
        <div className="lms-overview">
          {[
            { title: 'Discovery & architecture', icon: Search, description: 'Requirements, hosting and technical decisions' },
            { title: 'Build & configuration', icon: MonitorCog, description: 'Course setup, access and integrations' },
            { title: 'Quality & UAT', icon: ShieldCheck, description: 'Test cases, defects and acceptance evidence' },
            { title: 'Handover', icon: Users, description: 'Administrator training and final documentation' },
          ].map((item) => { const Icon = item.icon; return <article className="lms-step" key={item.title}><span><Icon size={18} /></span><strong>{item.title}</strong><small>{item.description}</small><div className="step-status"><i /> From the workplan</div></article> })}
        </div>
        <section className="panel table-panel lms-task-panel"><div className="panel-heading"><div><h2>LMS-related activities</h2><p>Derived from the live workplan—not a separate source of task data</p></div><span className="soft-count">{lmsTasks.length}</span></div>{lmsTasks.length ? <div className="compact-task-list">{lmsTasks.map((task) => <div key={task.id}><span className="activity-id">{task.id}</span><strong>{task.activity}</strong><span className={`status-text ${statusTone(task.status)}`}>{task.status}</span><span>{dateLabel(task.plannedFinish)}</span></div>)}</div> : <EmptyState title="No LMS activities found" text="No matching Moodle activities were returned by the live sheet." />}</section>
      </>
    )
  }

  function renderImport() {
    return (
      <>
        <section className="page-intro"><div><span className="eyebrow dark-eyebrow">LIVE SOURCE</span><h1>Google Sheet connection</h1><p>ProjectOS reads the shared AniScholar sheet directly. No workbook downloads or re-uploads are needed.</p></div><FileSpreadsheet size={22} className="page-icon" /></section>
        <section className="import-layout">
          <div className="panel import-panel">
            <div className="import-symbol"><FileSpreadsheet size={23} /></div>
            <h2>Read-only live connection</h2>
            <p>All eight tabs refresh automatically every minute. Sheet changes appear in the dashboard and are not written back by ProjectOS.</p>
            <div className="import-actions">
              <button className="button button-primary" disabled={isRefreshing} onClick={() => void refreshFromSheet()} type="button">
                <RefreshCw size={16} className={isRefreshing ? 'spin-icon' : ''} />{isRefreshing ? 'Refreshing?' : 'Refresh from Google Sheets'}
              </button>
              <a className="button button-outline" href={GOOGLE_SHEET_URL} rel="noreferrer" target="_blank"><ExternalLink size={16} /> Open source sheet</a>
            </div>
            <div className="source-file"><Clock3 size={15} /><span>Last successful refresh: <strong>{lastRefreshed ? dateTimeLabel(lastRefreshed) : 'Not connected yet'}</strong></span></div>
            {refreshError && <div className="notice error-notice"><AlertCircle size={16} />{refreshError}</div>}
            <div className="import-assurance"><ShieldCheck size={16} /><span>ProjectOS does not store sheet data in this browser and does not change the source sheet. Workplan and lesson editing are disabled until shared application storage is configured.</span></div>
            <div className="reconciliation-caution"><LockKeyhole size={15} /> This direct connection reads the sheet without Google sign-in. Anyone who can access a deployed ProjectOS page may be able to read these source records; restrict app access appropriately.</div>
          </div>
          <div className="panel import-summary">
            <div className="panel-heading"><div><h2>Live sheet summary</h2><p>{dataset ? `Updated ${dateTimeLabel(lastRefreshed)}` : isRefreshing ? 'Connecting to Google Sheets?' : 'Waiting for a successful connection'}</p></div><Clock3 size={17} className="heading-icon" /></div>
            <div className="summary-counts">
              <div><span>Workplan activities</span><strong>{dataset?.tasks.length ?? '?'}</strong></div>
              <div><span>Deliverables</span><strong>{dataset?.deliverables.length ?? '?'}</strong></div>
              <div><span>Milestones</span><strong>{dataset?.milestones.length ?? '?'}</strong></div>
              <div><span>Risks / issues</span><strong>{dataset?.risks.length ?? '?'}</strong></div>
              <div><span>Decisions</span><strong>{dataset?.decisions.length ?? '?'}</strong></div>
              <div><span>Team entries</span><strong>{dataset?.team.length ?? '?'}</strong></div>
            </div>
          </div>
        </section>
        <section className="panel source-tabs-panel">
          <div className="panel-heading"><div><h2>Source tabs</h2><p>Each tab is fetched directly from Google Sheets on refresh.</p></div><span className="soft-count">{dataset ? Object.keys(dataset.rawSheets).length : 0}/08</span></div>
          <div className="source-tabs-grid">{SOURCE_SHEETS.map((sheet) => {
            const count = dataset?.rawSheets[sheet]?.length
            return <div className={`source-tab ${count !== undefined ? 'source-tab-ready' : ''}`} key={sheet}><span className="tab-check"><CircleDot size={14} /></span><span><strong>{sheet}</strong><small>{count === undefined ? workbookHints[sheet] : `${count} live source rows`}</small></span>{count !== undefined && <span className="tab-count">{count}</span>}</div>
          })}</div>
        </section>
        <div className="source-note"><LockKeyhole size={15} /> The app keeps the current sheet snapshot in memory only. It is discarded when this page closes.</div>
      </>
    )
  }

  function renderActiveView() {
    switch (activeView) {
      case 'workplan': return renderWorkplan()
      case 'timeline': return renderTimeline()
      case 'production': return renderProduction()
      case 'reviews': return renderReviews()
      case 'lms': return renderLms()
      case 'import': return renderImport()
      default: return renderOverview()
    }
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} type="button" />}
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><span className="logo-chip brand-logo"><img src={qraftLogo} alt="Qraft Academy" /></span><div><strong>CourseMasters</strong><small>PROJECTOS</small></div><button className="mobile-close" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} type="button"><X size={18} /></button></div>
        <div className="workspace-switcher client-workspace"><span className="logo-chip client-logo"><img src={anischolarLogo} alt="AniScholar Career Hub" /></span><div className="client-workspace-meta"><div><small>CLIENT WORKSPACE</small><strong>AniScholar WRC</strong></div><ChevronDown size={16} /></div></div>
        <div className="sidebar-label">PROJECT</div>
        <nav className="main-nav" aria-label="Primary navigation">
          {navigation.map((item) => { const Icon = item.icon; return <button aria-current={activeView === item.id ? 'page' : undefined} className={activeView === item.id ? 'nav-item active' : 'nav-item'} key={item.id} onClick={() => { setActiveView(item.id); setMobileMenuOpen(false) }} type="button"><Icon size={18} /><span>{item.label}</span>{item.id === 'workplan' && dataset && <span className="nav-count">{tasks.length}</span>}</button> })}
        </nav>
        <div className="sidebar-section"><div className="sidebar-label">DELIVERY TOOLS</div><button className={`nav-item ${activeView === 'import' ? 'active' : ''}`} onClick={() => { setActiveView('import'); setMobileMenuOpen(false) }} type="button"><FileSpreadsheet size={18} /><span>Google Sheet connection</span></button><button className="nav-item disabled-nav" title="Available as the project workspace expands" type="button"><MessageSquareText size={18} /><span>Reports</span></button></div>
        <div className="sidebar-spacer" />
        <div className={`local-mode ${refreshError ? 'connection-offline' : dataset ? 'connection-online' : ''}`}><span><LockKeyhole size={15} /></span><div><strong>Read-only source</strong><small>Google Sheets</small></div><i /></div>
        <div className="sidebar-profile"><div className="profile-avatar">PM</div><div><strong>Project manager</strong><small>Read-only view</small></div><ChevronDown size={15} /></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)} type="button"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Projects</span><i>/</i><strong>{viewTitle}</strong></div>
          <div className="topbar-right"><span className={`connection-status ${refreshError ? 'connection-offline' : dataset ? 'connection-online' : ''}`}><i />{isRefreshing ? 'Refreshing sheet' : refreshError ? 'Sheet unavailable' : dataset ? 'Google Sheets live' : 'Connecting'}</span><button className="import-shortcut" onClick={() => void copyShareLink()} title="Copy a link to this view" type="button"><Link2 size={15} /> {shareNotice || 'Share'}</button><button className="import-shortcut" disabled={isRefreshing} onClick={() => void refreshFromSheet()} type="button"><RefreshCw size={15} /> Refresh sheet</button><div className="top-avatar">PM</div></div>
        </header>
        <div className="content-area">
          {refreshError && <div className="global-error"><AlertCircle size={17} />{refreshError}</div>}
          {renderActiveView()}
          <footer className="app-footer"><span>CourseMasters ProjectOS</span><span>From course design to delivery.</span><span>{lastRefreshed ? `Last sheet refresh · ${dateTimeLabel(lastRefreshed)}` : 'AniScholar project workspace · Connecting to Google Sheets'}</span></footer>
        </div>
      </main>
    </div>
  )
}

function statusTone(value: string): string {
  const status = value.toLowerCase()
  if (/complete|approved/.test(status)) return 'tone-green'
  if (/progress|review|submitted/.test(status)) return 'tone-blue'
  if (/delayed|blocked|reject/.test(status)) return 'tone-red'
  if (/awaiting|pending|hold/.test(status)) return 'tone-orange'
  return 'tone-slate'
}

function KpiStrip({ tasks, scoped }: { tasks: WorkplanTask[]; scoped: boolean }) {
  const summary = summarizeTasks(tasks)
  const items = [
    { label: scoped ? 'Filtered activities' : 'Activities', value: summary.total, tone: '' },
    { label: 'Completed', value: summary.completed, tone: 'kpi-green' },
    { label: 'In progress', value: summary.inProgress, tone: 'kpi-blue' },
    { label: 'Delayed / blocked', value: summary.blocked, tone: 'kpi-red' },
    { label: 'Past planned finish', value: summary.overdue, tone: 'kpi-orange' },
    { label: 'Avg. complete', value: summary.averageProgress === null ? '—' : `${summary.averageProgress}%`, tone: '' },
  ]
  return (
    <section className="kpi-strip" aria-label="Activity summary">
      {items.map((item) => <article className="kpi-card" key={item.label}><span>{item.label}</span><strong className={item.tone}>{item.value}</strong></article>)}
    </section>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><CircleDot size={18} /></span><strong>{title}</strong><p>{text}</p></div>
}

export default App
