import { describe, expect, it } from 'vitest'
import { applySourceReconciliation, compareSourceImports } from './reconciliation'
import type { ImportedDataset, WorkplanTask } from './types'

function task(status: string): WorkplanTask {
  return {
    id: 'PM1',
    sourceId: 'PM1',
    workstream: 'Project Management',
    phase: 'Inception',
    activity: 'Confirm governance',
    deliverable: 'Approved inception decisions',
    leadOrganisation: 'Both Parties',
    owner: 'Project leads',
    startWeek: '1',
    finishWeek: '1',
    plannedStart: '02-Nov-2026',
    plannedFinish: '08-Nov-2026',
    actualStart: '',
    actualFinish: '',
    dependency: '',
    approvalRequired: 'Yes',
    status,
    percentComplete: status === 'Completed' ? 100 : 0,
    daysVariance: '0',
    nextAction: '',
    nextActionDue: '',
    comments: '',
  }
}

function dataset(status: string, includeTask = true): ImportedDataset {
  const sourceRow = { 'Activity ID': 'PM1', Status: status }
  return {
    importedAt: '2026-11-14T00:00:00.000Z',
    sourceFileName: 'workplan.xlsx',
    rawSheets: { 'Master Workplan': includeTask ? [sourceRow] : [] },
    tasks: includeTask ? [task(status)] : [],
    deliverables: [],
    milestones: [],
    risks: [],
    decisions: [],
    team: [],
    microLessons: [],
  }
}

describe('source workbook reconciliation', () => {
  it('previews changed fields and applies only explicitly accepted source values', () => {
    const current = dataset('In progress')
    const incoming = dataset('Completed')
    const differences = compareSourceImports(current, incoming)

    expect(differences).toHaveLength(1)
    expect(differences[0].changedFields).toContain('Status')
    const kept = applySourceReconciliation(current, incoming, differences, {
      [differences[0].id]: 'keep',
    })
    expect(kept.tasks[0].status).toBe('In progress')
    expect(kept.rawSheets['Master Workplan']?.[0].Status).toBe('In progress')
    const applied = applySourceReconciliation(current, incoming, differences, {
      [differences[0].id]: 'apply',
    })
    expect(applied.tasks[0].status).toBe('Completed')
    expect(applied.tasks[0].percentComplete).toBe(0)
  })

  it('keeps app records when a source row is removed, unless the removal is acknowledged', () => {
    const current = dataset('In progress')
    const incoming = dataset('', false)
    const differences = compareSourceImports(current, incoming)
    const removed = differences.find((difference) => difference.changeType === 'removed')

    expect(removed).toBeDefined()
    if (!removed) throw new Error('Expected the source row to be marked removed.')
    const result = applySourceReconciliation(current, incoming, differences, {
      [removed.id]: 'apply',
    })
    expect(result.tasks).toHaveLength(1)
    expect(result.rawSheets['Master Workplan']).toHaveLength(0)
  })

  it('adds a new source row only when it is accepted', () => {
    const current = dataset('', false)
    const incoming = dataset('Completed')
    const differences = compareSourceImports(current, incoming)

    expect(differences).toHaveLength(1)
    expect(differences[0].changeType).toBe('added')
    const result = applySourceReconciliation(current, incoming, differences, {
      [differences[0].id]: 'apply',
    })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe('PM1')
  })

  it('does not apply an unresolved source change', () => {
    const current = dataset('In progress')
    const incoming = dataset('Completed')
    const differences = compareSourceImports(current, incoming)

    expect(() => applySourceReconciliation(current, incoming, differences, {})).toThrow(/Resolve all 1 source changes/)
  })

  it('distinguishes team contacts that share a placeholder name but have different roles', () => {
    const current = dataset('In progress')
    current.rawSheets['Team and Contacts'] = [
      { Organisation: 'Qraft Academy', Name: 'To be confirmed', 'Project role': 'LMS Technical Lead' },
      { Organisation: 'Qraft Academy', Name: 'To be confirmed', 'Project role': 'Course Author' },
    ]
    const incoming = { ...current, rawSheets: { ...current.rawSheets } }

    expect(compareSourceImports(current, incoming)).toHaveLength(0)
  })
})
