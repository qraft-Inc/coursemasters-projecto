import {
  SOURCE_SHEETS,
  type ImportedDataset,
  type SourceChangeDecision,
  type SourceDifference,
  type SourceRow,
  type SourceSheetName,
} from './types'

type Decisions = Record<string, SourceChangeDecision>

const KEY_FIELDS: Record<SourceSheetName, string[]> = {
  'Implementation Timeline': ['Week', 'Activity ID', 'ID'],
  Dashboard: ['Project setting'],
  'Master Workplan': ['Activity ID'],
  'Deliverables and Approvals': ['ID'],
  'Risks and Dependencies': ['ID'],
  'Decisions and Changes': ['ID'],
  'Payment Milestones': ['Milestone'],
  'Team and Contacts': ['Organisation', 'Name', 'Project role'],
}

const TASK_FIELD_MAP: Partial<Record<string, keyof ImportedDataset['tasks'][number]>> = {
  Workstream: 'workstream',
  Phase: 'phase',
  Activity: 'activity',
  Deliverable: 'deliverable',
  'Lead organisation': 'leadOrganisation',
  'Responsible person or team': 'owner',
  'Start week': 'startWeek',
  'Finish week': 'finishWeek',
  'Planned start': 'plannedStart',
  'Planned finish': 'plannedFinish',
  'Actual start': 'actualStart',
  'Actual finish': 'actualFinish',
  Dependency: 'dependency',
  'Approval required': 'approvalRequired',
  Status: 'status',
  'Percent complete': 'percentComplete',
  'Days variance': 'daysVariance',
  'Next action': 'nextAction',
  'Next action due': 'nextActionDue',
  Comments: 'comments',
}

const DELIVERABLE_FIELD_MAP: Partial<Record<string, keyof ImportedDataset['deliverables'][number]>> = {
  Deliverable: 'description',
  Milestone: 'milestone',
  Owner: 'owner',
  Reviewer: 'reviewer',
  'Planned submission': 'plannedSubmission',
  'Actual submission': 'actualSubmission',
  'Feedback due': 'feedbackDue',
  'Feedback received': 'feedbackReceived',
  'Revision due': 'revisionDue',
  'Approval status': 'approvalStatus',
  'Approval date': 'approvalDate',
  'Evidence or link': 'evidence',
  Thumbnail: 'thumbnail',
}

const MILESTONE_FIELD_MAP: Partial<Record<string, keyof ImportedDataset['milestones'][number]>> = {
  Milestone: 'label',
  'Target week': 'targetWeek',
  Percentage: 'percentage',
  'Amount UGX': 'amount',
  'Approval requirement': 'approvalRequirement',
  'Planned invoice date': 'plannedInvoiceDate',
  'Actual invoice date': 'actualInvoiceDate',
  'Approval date': 'approvalDate',
  'Payment due date': 'paymentDueDate',
  'Amount received': 'amountReceived',
  Balance: 'balance',
  Status: 'status',
}

export function sourceRowKey(sheetName: SourceSheetName, row: SourceRow, index: number): string {
  if (sheetName === 'Payment Milestones') {
    const label = String(row.Milestone ?? '').trim()
    return (label.match(/^M\d+/)?.[0] ?? label) || `row-${index + 1}`
  }
  const values = KEY_FIELDS[sheetName].map((field) => String(row[field] ?? '').trim())
  const key = values.join('|')
  return key.replace(/\|+$/, '') || `row-${index + 1}`
}

function rowMap(sheetName: SourceSheetName, rows: SourceRow[]): Map<string, SourceRow> {
  const mapped = new Map<string, SourceRow>()
  rows.forEach((row, index) => {
    const key = sourceRowKey(sheetName, row, index)
    if (mapped.has(key)) throw new Error(`Duplicate source key "${key}" in ${sheetName}.`)
    mapped.set(key, row)
  })
  return mapped
}

export function compareSourceImports(
  current: ImportedDataset,
  incoming: ImportedDataset,
): SourceDifference[] {
  const differences: SourceDifference[] = []
  for (const sheetName of SOURCE_SHEETS) {
    const previousRows = rowMap(sheetName, current.rawSheets[sheetName] ?? [])
    const incomingRows = rowMap(sheetName, incoming.rawSheets[sheetName] ?? [])
    const keys = new Set([...previousRows.keys(), ...incomingRows.keys()])
    for (const rowKey of keys) {
      const previous = previousRows.get(rowKey) ?? null
      const next = incomingRows.get(rowKey) ?? null
      if (previous && next) {
        const fields = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
        const changedFields = fields.filter((field) => (previous[field] ?? null) !== (next[field] ?? null))
        if (changedFields.length === 0) continue
        differences.push({
          id: `${sheetName}::${rowKey}`,
          sheetName,
          rowKey,
          changeType: 'changed',
          changedFields,
          previous,
          incoming: next,
        })
      } else {
        differences.push({
          id: `${sheetName}::${rowKey}`,
          sheetName,
          rowKey,
          changeType: previous ? 'removed' : 'added',
          changedFields: Object.keys(previous ?? next ?? {}),
          previous,
          incoming: next,
        })
      }
    }
  }
  return differences
}

function mergeChangedFields<T extends object>(
  current: T,
  incoming: T,
  changedFields: string[],
  fieldMap: Partial<Record<string, keyof T>>,
): T {
  const updated = { ...current }
  for (const sourceField of changedFields) {
    const field = fieldMap[sourceField]
    if (field) Object.assign(updated, { [field]: incoming[field] })
  }
  return updated
}

function mergeSourceRowFields(
  current: SourceRow,
  incoming: SourceRow,
  difference: SourceDifference,
): SourceRow {
  const updated = { ...current }
  for (const field of difference.changedFields) updated[field] = incoming[field] ?? null
  return updated
}

function reconcileRecords<T>(
  existing: T[],
  incoming: T[],
  differences: SourceDifference[],
  decisions: Decisions,
  keyFor: (record: T, index: number) => string,
  mergeChanged: (current: T, incoming: T, difference: SourceDifference) => T,
): T[] {
  const result = [...existing]
  for (const difference of differences) {
    if (decisions[difference.id] !== 'apply' || difference.changeType === 'removed') continue
    const newRecord = incoming.find((item, index) => keyFor(item, index) === difference.rowKey)
    if (!newRecord) continue
    const index = result.findIndex((item, rowIndex) => keyFor(item, rowIndex) === difference.rowKey)
    if (index >= 0 && difference.changeType === 'changed') {
      result[index] = mergeChanged(result[index], newRecord, difference)
    } else if (index >= 0) {
      result[index] = newRecord
    } else {
      result.push(newRecord)
    }
  }
  return result
}

function resolveRawSheet(
  sheetName: SourceSheetName,
  previous: SourceRow[],
  incoming: SourceRow[],
  differences: SourceDifference[],
  decisions: Decisions,
): SourceRow[] {
  const previousRows = rowMap(sheetName, previous)
  const incomingRows = rowMap(sheetName, incoming)
  const sheetDifferences = new Map(
    differences.filter((item) => item.sheetName === sheetName).map((item) => [item.rowKey, item]),
  )
  const result: SourceRow[] = []

  for (const [rowKey, incomingRow] of incomingRows) {
    const difference = sheetDifferences.get(rowKey)
    if (difference && decisions[difference.id] === 'keep') {
      const oldRow = previousRows.get(rowKey)
      if (oldRow) result.push(oldRow)
      continue
    }
    result.push(incomingRow)
  }

  for (const [rowKey, oldRow] of previousRows) {
    const difference = sheetDifferences.get(rowKey)
    if (difference?.changeType === 'removed' && decisions[difference.id] === 'keep') {
      result.push(oldRow)
    }
  }
  return result
}

export function applySourceReconciliation(
  current: ImportedDataset,
  incoming: ImportedDataset,
  differences: SourceDifference[],
  decisions: Decisions,
): ImportedDataset {
  const unresolved = differences.filter((difference) => !decisions[difference.id])
  if (unresolved.length > 0) {
    throw new Error(`Resolve all ${unresolved.length} source changes before applying reconciliation.`)
  }

  const rawSheets: ImportedDataset['rawSheets'] = {}
  for (const sheetName of SOURCE_SHEETS) {
    rawSheets[sheetName] = resolveRawSheet(
      sheetName,
      current.rawSheets[sheetName] ?? [],
      incoming.rawSheets[sheetName] ?? [],
      differences,
      decisions,
    )
  }

  const changesFor = (sheetName: SourceSheetName) =>
    differences.filter((difference) => difference.sheetName === sheetName)
  const mergeTask = (currentTask: ImportedDataset['tasks'][number], incomingTask: ImportedDataset['tasks'][number], difference: SourceDifference) =>
    mergeChangedFields(currentTask, incomingTask, difference.changedFields, TASK_FIELD_MAP)
  const mergeDeliverable = (currentItem: ImportedDataset['deliverables'][number], incomingItem: ImportedDataset['deliverables'][number], difference: SourceDifference) =>
    mergeChangedFields(currentItem, incomingItem, difference.changedFields, DELIVERABLE_FIELD_MAP)
  const mergeMilestone = (currentItem: ImportedDataset['milestones'][number], incomingItem: ImportedDataset['milestones'][number], difference: SourceDifference) =>
    mergeChangedFields(currentItem, incomingItem, difference.changedFields, MILESTONE_FIELD_MAP)
  const mergeRaw = (currentRow: SourceRow, incomingRow: SourceRow, difference: SourceDifference) =>
    mergeSourceRowFields(currentRow, incomingRow, difference)

  return {
    ...incoming,
    rawSheets,
    tasks: reconcileRecords(current.tasks, incoming.tasks, changesFor('Master Workplan'), decisions, (item) => item.id, mergeTask),
    deliverables: reconcileRecords(current.deliverables, incoming.deliverables, changesFor('Deliverables and Approvals'), decisions, (item) => item.id, mergeDeliverable),
    milestones: reconcileRecords(current.milestones, incoming.milestones, changesFor('Payment Milestones'), decisions, (item) => item.id, mergeMilestone),
    risks: reconcileRecords(current.risks, incoming.risks, changesFor('Risks and Dependencies'), decisions, (item, index) => sourceRowKey('Risks and Dependencies', item, index), mergeRaw),
    decisions: reconcileRecords(current.decisions, incoming.decisions, changesFor('Decisions and Changes'), decisions, (item, index) => sourceRowKey('Decisions and Changes', item, index), mergeRaw),
    team: reconcileRecords(current.team, incoming.team, changesFor('Team and Contacts'), decisions, (item, index) => sourceRowKey('Team and Contacts', item, index), mergeRaw),
    microLessons: current.microLessons,
  }
}
