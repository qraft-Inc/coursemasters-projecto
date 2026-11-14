import type { CellValue } from 'exceljs'
import Papa from 'papaparse'
import {
  SOURCE_SHEETS,
  type Deliverable,
  type ImportedDataset,
  type PaymentMilestone,
  type SourceRow,
  type SourceSheetName,
  type SourceValue,
  type WorkplanTask,
} from './types'

const HEADER_ROW = 4
const EXPECTED_HEADERS: Record<SourceSheetName, string[]> = {
  'Implementation Timeline': ['Week', 'Start date'],
  Dashboard: ['Project setting', 'Value'],
  'Master Workplan': ['Activity ID', 'Workstream'],
  'Deliverables and Approvals': ['ID', 'Deliverable'],
  'Risks and Dependencies': ['ID', 'Type'],
  'Decisions and Changes': ['ID', 'Type'],
  'Payment Milestones': ['Milestone', 'Target week'],
  'Team and Contacts': ['Organisation', 'Name'],
}

function cellToSourceValue(value: CellValue): SourceValue {
  if (value instanceof Date) return value.toISOString()
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  if ('result' in value) return cellToSourceValue(value.result)
  if ('text' in value) return value.text
  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  return null
}

function makeRows(headers: string[], rows: SourceValue[][]): SourceRow[] {
  return rows
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])))
    .filter((row) => Object.values(row).some((value) => value !== null && value !== ''))
}

function stringValue(value: SourceValue | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function numberValue(value: SourceValue | undefined): number {
  const parsed = Number(stringValue(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function percentValue(value: SourceValue | undefined): number {
  const raw = stringValue(value)
  const parsed = Number(raw.replace(/[%\s]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return raw.includes('%') || parsed > 1 ? parsed : parsed * 100
}

function rowsForSheet(
  workbookRows: Partial<Record<SourceSheetName, SourceRow[]>>,
  name: SourceSheetName,
): SourceRow[] {
  return workbookRows[name] ?? []
}

function mapTasks(rows: SourceRow[]): WorkplanTask[] {
  return rows.flatMap((row) => {
    const sourceId = stringValue(row['Activity ID'])
    if (!sourceId) return []
    return [{
      id: sourceId,
      sourceId,
      workstream: stringValue(row.Workstream),
      phase: stringValue(row.Phase),
      activity: stringValue(row.Activity),
      deliverable: stringValue(row.Deliverable),
      leadOrganisation: stringValue(row['Lead organisation']),
      owner: stringValue(row['Responsible person or team']),
      startWeek: stringValue(row['Start week']),
      finishWeek: stringValue(row['Finish week']),
      plannedStart: stringValue(row['Planned start']),
      plannedFinish: stringValue(row['Planned finish']),
      actualStart: stringValue(row['Actual start']),
      actualFinish: stringValue(row['Actual finish']),
      dependency: stringValue(row.Dependency),
      approvalRequired: stringValue(row['Approval required']),
      status: stringValue(row.Status),
      percentComplete: percentValue(row['Percent complete']),
      daysVariance: stringValue(row['Days variance']),
      nextAction: stringValue(row['Next action']),
      nextActionDue: stringValue(row['Next action due']),
      comments: stringValue(row.Comments),
    }]
  })
}

function mapDeliverables(rows: SourceRow[]): Deliverable[] {
  return rows.flatMap((row) => {
    const id = stringValue(row.ID)
    if (!id) return []
    return [{
      id,
      description: stringValue(row.Deliverable),
      milestone: stringValue(row.Milestone),
      owner: stringValue(row.Owner),
      reviewer: stringValue(row.Reviewer),
      plannedSubmission: stringValue(row['Planned submission']),
      actualSubmission: stringValue(row['Actual submission']),
      feedbackDue: stringValue(row['Feedback due']),
      feedbackReceived: stringValue(row['Feedback received']),
      revisionDue: stringValue(row['Revision due']),
      approvalStatus: stringValue(row['Approval status']),
      approvalDate: stringValue(row['Approval date']),
      evidence: stringValue(row['Evidence or link']),
      thumbnail: stringValue(row.Thumbnail),
    }]
  })
}

function mapMilestones(rows: SourceRow[]): PaymentMilestone[] {
  return rows.flatMap((row) => {
    const label = stringValue(row.Milestone)
    const id = label.match(/^M\d+/)?.[0]
    if (!id) return []
    return [{
      id,
      label,
      targetWeek: stringValue(row['Target week']),
      percentage: percentValue(row.Percentage),
      amount: numberValue(row['Amount UGX']),
      approvalRequirement: stringValue(row['Approval requirement']),
      plannedInvoiceDate: stringValue(row['Planned invoice date']),
      actualInvoiceDate: stringValue(row['Actual invoice date']),
      approvalDate: stringValue(row['Approval date']),
      paymentDueDate: stringValue(row['Payment due date']),
      amountReceived: numberValue(row['Amount received']),
      balance: numberValue(row.Balance),
      status: stringValue(row.Status),
    }]
  })
}

function buildDataset(
  rawSheets: Partial<Record<SourceSheetName, SourceRow[]>>,
  sourceFileName: string,
  importedAt = new Date().toISOString(),
): ImportedDataset {
  const tasks = mapTasks(rowsForSheet(rawSheets, 'Master Workplan'))
  const deliverables = mapDeliverables(rowsForSheet(rawSheets, 'Deliverables and Approvals'))
  const milestones = mapMilestones(rowsForSheet(rawSheets, 'Payment Milestones'))
  const risks = rowsForSheet(rawSheets, 'Risks and Dependencies').filter((row) => stringValue(row.ID))
  const decisions = rowsForSheet(rawSheets, 'Decisions and Changes').filter((row) => stringValue(row.ID))
  assertUnique(tasks, 'workplan activity', (task) => task.id)
  assertUnique(deliverables, 'deliverable', (item) => item.id)
  assertUnique(milestones, 'milestone', (item) => item.id)
  assertUnique(risks, 'risk or dependency', (item) => stringValue(item.ID))
  assertUnique(decisions, 'decision or change', (item) => stringValue(item.ID))
  return {
    importedAt,
    sourceFileName,
    rawSheets,
    tasks,
    deliverables,
    milestones,
    risks,
    decisions,
    team: rowsForSheet(rawSheets, 'Team and Contacts').filter((row) => stringValue(row.Name)),
    microLessons: [],
  }
}

function assertUnique<T>(records: T[], label: string, keyFor: (record: T) => string): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const record of records) {
    const key = keyFor(record)
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate ${label} IDs found: ${[...duplicates].join(', ')}`)
  }
}

export async function parseWorkbook(file: File): Promise<ImportedDataset> {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('Workbook exceeds the 25 MB import limit.')
  }
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const available = new Set(workbook.worksheets.map((sheet) => sheet.name))
  const missing = SOURCE_SHEETS.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(`Workbook is missing required sheets: ${missing.join(', ')}`)
  }

  const rawSheets: Partial<Record<SourceSheetName, SourceRow[]>> = {}
  for (const name of SOURCE_SHEETS) {
    const sheet = workbook.getWorksheet(name)
    if (!sheet) throw new Error(`Could not read the "${name}" worksheet.`)
    const headerRow = sheet.getRow(HEADER_ROW)
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => {
      const label = stringValue(cellToSourceValue(headerRow.getCell(index + 1).value))
      return label || `Column ${index + 1}`
    })
    const dataRows: SourceValue[][] = []
    for (let rowNumber = HEADER_ROW + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      dataRows.push(headers.map((_, index) => cellToSourceValue(row.getCell(index + 1).value)))
    }
    rawSheets[name] = makeRows(headers, dataRows)
  }

  const dataset = buildDataset(rawSheets, file.name)
  if (dataset.tasks.length === 0) {
    throw new Error('No master workplan activities were found in the workbook.')
  }
  return dataset
}

export function parseCsvSheet(
  csvText: string,
  sheetName: SourceSheetName,
  existing?: ImportedDataset | null,
  sourceFileName = `${sheetName}.csv`,
): ImportedDataset {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: false })
  const parseError = parsed.errors.find((error) => error.code !== 'UndetectableDelimiter')
  if (parseError) {
    throw new Error(`Could not parse CSV: ${parseError.message}`)
  }

  const expected = EXPECTED_HEADERS[sheetName]
  const headerIndex = parsed.data.findIndex((row) =>
    expected.every((header, index) => {
      const value = row[index]?.trim().replace(/^\uFEFF/, '')
      return index === 0 ? value === header || value?.endsWith(header) : value === header
    }),
  )
  if (headerIndex < 0) {
    throw new Error(`Could not find the expected ${expected.join(' / ')} header in ${sheetName}.`)
  }

  const headers = parsed.data[headerIndex].map((header, index) => {
    const value = header.trim().replace(/^\uFEFF/, '')
    return index === 0 && value.endsWith(expected[0]) ? expected[0] : value || `Column ${index + 1}`
  })
  const rows = makeRows(
    headers,
    parsed.data.slice(headerIndex + 1).map((row) => row.map((value) => value.trim())),
  )
  const rawSheets = { ...existing?.rawSheets, [sheetName]: rows }
  return buildDataset(rawSheets, sourceFileName)
}

export function expectedCsvHeaders(sheetName: SourceSheetName): string[] {
  return EXPECTED_HEADERS[sheetName]
}

