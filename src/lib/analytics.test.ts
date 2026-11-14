import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  daysOverdue,
  isOverdue,
  ownerWorkload,
  parseSheetDate,
  splitOwners,
  summarizeTasks,
} from './analytics'
import type { WorkplanTask } from './types'

function task(overrides: Partial<WorkplanTask>): WorkplanTask {
  return {
    id: 'T1', sourceId: 'T1', workstream: 'Course', phase: '', activity: 'Activity', deliverable: '',
    leadOrganisation: '', owner: '', startWeek: '', finishWeek: '', plannedStart: '', plannedFinish: '',
    actualStart: '', actualFinish: '', dependency: '', approvalRequired: '', status: 'Not started',
    percentComplete: 0, daysVariance: '', nextAction: '', nextActionDue: '', comments: '',
    ...overrides,
  }
}

const today = new Date(Date.UTC(2026, 10, 14))

describe('parseSheetDate', () => {
  it('parses the sheet format and ISO dates as UTC midnight', () => {
    expect(parseSheetDate('02-Nov-2026')?.toISOString()).toBe('2026-11-02T00:00:00.000Z')
    expect(parseSheetDate('2 November 2026')?.toISOString()).toBe('2026-11-02T00:00:00.000Z')
    expect(parseSheetDate('2027-01-24')?.toISOString()).toBe('2027-01-24T00:00:00.000Z')
  })

  it('rejects blank, unknown and impossible dates', () => {
    expect(parseSheetDate('')).toBeNull()
    expect(parseSheetDate('TBC')).toBeNull()
    expect(parseSheetDate('31-Feb-2026')).toBeNull()
    expect(parseSheetDate('02-Xyz-2026')).toBeNull()
  })
})

describe('overdue detection', () => {
  it('flags incomplete tasks whose planned finish has passed', () => {
    const late = task({ plannedFinish: '08-Nov-2026', status: 'Not started' })
    expect(isOverdue(late, today)).toBe(true)
    expect(daysOverdue(late, today)).toBe(6)
  })

  it('ignores completed, future and undated tasks', () => {
    expect(isOverdue(task({ plannedFinish: '08-Nov-2026', status: 'Completed', percentComplete: 100 }), today)).toBe(false)
    expect(isOverdue(task({ plannedFinish: '14-Nov-2026' }), today)).toBe(false)
    expect(isOverdue(task({ plannedFinish: '' }), today)).toBe(false)
  })
})

describe('summarizeTasks', () => {
  it('counts statuses and averages progress', () => {
    const summary = summarizeTasks([
      task({ status: 'Completed', percentComplete: 100 }),
      task({ status: 'In progress', percentComplete: 60, plannedFinish: '08-Nov-2026' }),
      task({ status: 'Blocked', percentComplete: 20 }),
    ], today)
    expect(summary).toEqual({ total: 3, completed: 1, inProgress: 1, blocked: 1, overdue: 1, averageProgress: 60 })
  })

  it('returns null progress for no tasks', () => {
    expect(summarizeTasks([], today).averageProgress).toBeNull()
  })
})

describe('owner workload', () => {
  it('splits shared owners and counts the task for each', () => {
    expect(splitOwners('Joseph Luswabi / Andrew Tugume')).toEqual(['Joseph Luswabi', 'Andrew Tugume'])
    expect(splitOwners('')).toEqual(['Unassigned'])
    const rows = ownerWorkload([
      task({ owner: 'A / B' }),
      task({ owner: 'A', status: 'Completed', percentComplete: 100 }),
    ], today)
    expect(rows.map((row) => [row.owner, row.total, row.completed])).toEqual([['A', 2, 1], ['B', 1, 0]])
  })
})

describe('buildTimeline', () => {
  it('lays out bars across the dated range and marks today', () => {
    const layout = buildTimeline([
      task({ id: 'A', plannedStart: '02-Nov-2026', plannedFinish: '08-Nov-2026' }),
      task({ id: 'B', plannedStart: '09-Nov-2026', plannedFinish: '15-Nov-2026' }),
      task({ id: 'C' }),
    ], today)!
    expect(layout.bars).toHaveLength(2)
    expect(layout.undated.map((item) => item.id)).toEqual(['C'])
    expect(layout.bars[0].left).toBe(0)
    expect(layout.bars[0].width).toBeCloseTo(50)
    expect(layout.bars[1].left).toBeCloseTo(50)
    expect(layout.bars[0].overdue).toBe(true)
    expect(layout.weeks.map((week) => week.label)).toEqual(['W1', 'W2'])
    expect(layout.todayLeft).toBeCloseTo((12 / 14) * 100)
  })

  it('returns null when nothing is dated', () => {
    expect(buildTimeline([task({})], today)).toBeNull()
  })
})
