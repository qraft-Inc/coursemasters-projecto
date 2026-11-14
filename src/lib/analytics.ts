import type { WorkplanTask } from './types'

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const DAY_MS = 86_400_000

/**
 * Parses sheet dates such as "02-Nov-2026", "2 Nov 2026" or ISO "2026-11-02" into a UTC-midnight Date.
 * Returns null for blank or unrecognised values rather than guessing.
 */
export function parseSheetDate(value: string): Date | null {
  const text = value.trim()
  if (!text) return null

  const named = text.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month === undefined) return null
    return validUtc(Number(named[3]), month, Number(named[1]))
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)
  if (iso) return validUtc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))

  return null
}

function validUtc(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : null
}

/** Today's calendar date as UTC midnight, so it compares cleanly with parsed sheet dates. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

export const isCompleted = (task: WorkplanTask) => /complete/i.test(task.status) || task.percentComplete >= 100
export const isInProgress = (task: WorkplanTask) => !isCompleted(task) && /progress/i.test(task.status)
export const isBlocked = (task: WorkplanTask) => !isCompleted(task) && /delayed|blocked|hold/i.test(task.status)

/** A task is overdue when its planned finish date has passed and the sheet does not record it as complete. */
export function isOverdue(task: WorkplanTask, today: Date = todayUtc()): boolean {
  if (isCompleted(task)) return false
  const finish = parseSheetDate(task.plannedFinish)
  return finish !== null && finish.getTime() < today.getTime()
}

/** Days past the planned finish; 0 when not overdue. */
export function daysOverdue(task: WorkplanTask, today: Date = todayUtc()): number {
  if (!isOverdue(task, today)) return 0
  const finish = parseSheetDate(task.plannedFinish)!
  return Math.round((today.getTime() - finish.getTime()) / DAY_MS)
}

export interface TaskSummary {
  total: number
  completed: number
  inProgress: number
  blocked: number
  overdue: number
  averageProgress: number | null
}

export function summarizeTasks(tasks: WorkplanTask[], today: Date = todayUtc()): TaskSummary {
  return {
    total: tasks.length,
    completed: tasks.filter(isCompleted).length,
    inProgress: tasks.filter(isInProgress).length,
    blocked: tasks.filter(isBlocked).length,
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
    averageProgress: tasks.length
      ? Math.round(tasks.reduce((sum, task) => sum + task.percentComplete, 0) / tasks.length)
      : null,
  }
}

/** Splits a "Responsible person or team" cell such as "Joseph Luswabi / Andrew Tugume" into individual owners. */
export function splitOwners(value: string): string[] {
  const owners = value.split(/\s*(?:\/|;|,|&|\band\b)\s*/i).map((owner) => owner.trim()).filter(Boolean)
  return owners.length ? owners : ['Unassigned']
}

export interface OwnerWorkload extends TaskSummary {
  owner: string
}

/** Workload per owner. A task shared by two owners counts towards both. Sorted by open work, heaviest first. */
export function ownerWorkload(tasks: WorkplanTask[], today: Date = todayUtc()): OwnerWorkload[] {
  const byOwner = new Map<string, WorkplanTask[]>()
  for (const task of tasks) {
    for (const owner of splitOwners(task.owner)) {
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), task])
    }
  }
  return [...byOwner.entries()]
    .map(([owner, ownerTasks]) => ({ owner, ...summarizeTasks(ownerTasks, today) }))
    .sort((a, b) => (b.total - b.completed) - (a.total - a.completed) || b.overdue - a.overdue || a.owner.localeCompare(b.owner))
}

export interface TimelineBar {
  task: WorkplanTask
  start: Date
  finish: Date
  /** Offset and width as percentages of the full timeline range. */
  left: number
  width: number
  overdue: boolean
}

export interface TimelineLayout {
  start: Date
  finish: Date
  bars: TimelineBar[]
  /** Tasks without parseable planned dates; shown separately rather than placed on a guessed date. */
  undated: WorkplanTask[]
  weeks: { label: string; left: number }[]
  todayLeft: number | null
}

export function buildTimeline(tasks: WorkplanTask[], today: Date = todayUtc()): TimelineLayout | null {
  const dated: { task: WorkplanTask; start: Date; finish: Date }[] = []
  const undated: WorkplanTask[] = []
  for (const task of tasks) {
    const start = parseSheetDate(task.plannedStart)
    const finish = parseSheetDate(task.plannedFinish) ?? start
    if (start && finish) dated.push({ task, start, finish: finish < start ? start : finish })
    else undated.push(task)
  }
  if (!dated.length) return null

  const rangeStart = new Date(Math.min(...dated.map((item) => item.start.getTime())))
  // The finish date is inclusive, so the range runs to the end of the last day.
  const rangeEnd = new Date(Math.max(...dated.map((item) => item.finish.getTime())) + DAY_MS)
  const span = rangeEnd.getTime() - rangeStart.getTime()
  const pct = (time: number) => ((time - rangeStart.getTime()) / span) * 100

  const weeks: TimelineLayout['weeks'] = []
  for (let time = rangeStart.getTime(), week = 1; time < rangeEnd.getTime(); time += 7 * DAY_MS, week += 1) {
    weeks.push({ label: `W${week}`, left: pct(time) })
  }

  const todayTime = today.getTime()
  return {
    start: rangeStart,
    finish: rangeEnd,
    bars: dated.map(({ task, start, finish }) => ({
      task,
      start,
      finish,
      left: pct(start.getTime()),
      width: Math.max(pct(finish.getTime() + DAY_MS) - pct(start.getTime()), 0.8),
      overdue: isOverdue(task, today),
    })),
    undated,
    weeks,
    todayLeft: todayTime >= rangeStart.getTime() && todayTime < rangeEnd.getTime() ? pct(todayTime) : null,
  }
}
