import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { SOURCE_SHEETS, type SourceSheetName } from './types'
import { parseCsvSheet, parseWorkbook } from './workbook-import'

const headers: Record<SourceSheetName, string[]> = {
  'Implementation Timeline': ['Week', 'Start date'],
  Dashboard: ['Project setting', 'Value'],
  'Master Workplan': [
    'Activity ID', 'Workstream', 'Phase', 'Activity', 'Deliverable', 'Lead organisation',
    'Responsible person or team', 'Start week', 'Finish week', 'Planned start', 'Planned finish',
    'Actual start', 'Actual finish', 'Dependency', 'Approval required', 'Status',
    'Percent complete', 'Days variance', 'Next action', 'Next action due', 'Comments',
  ],
  'Deliverables and Approvals': ['ID', 'Deliverable'],
  'Risks and Dependencies': ['ID', 'Type'],
  'Decisions and Changes': ['ID', 'Type'],
  'Payment Milestones': ['Milestone', 'Target week'],
  'Team and Contacts': ['Organisation', 'Name'],
}

async function workbookFile(): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  for (const name of SOURCE_SHEETS) {
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(['Source sheet'])
    sheet.addRow(['Source note'])
    sheet.addRow([])
    sheet.addRow(headers[name])
    if (name === 'Master Workplan') {
      sheet.addRow([
        'PM1', 'Project Management', 'Inception', 'Confirm governance', 'Approved inception decisions',
        'Both Parties', 'Project leads', 1, 1, '02-Nov-2026', '08-Nov-2026', '', '', 'Signed agreement',
        'Yes', 'Completed', '100%', 0, '', '', '',
      ])
    }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([new Uint8Array(buffer)], 'aniscolar.xlsx')
}

describe('workbook import', () => {
  it('imports all required tabs and preserves source status, percentage and activity ID', async () => {
    const result = await parseWorkbook(await workbookFile())

    expect(Object.keys(result.rawSheets)).toHaveLength(8)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({
      id: 'PM1',
      status: 'Completed',
      percentComplete: 100,
      plannedStart: '02-Nov-2026',
    })
  })

  it('imports CSV headers after the workbook title rows and rejects duplicate IDs', () => {
    const csv = [
      '"Master Workplan"',
      '"Update status weekly"',
      '',
      '"Activity ID","Workstream","Phase","Activity","Status","Percent complete"',
      '"C1","Course","Discovery","Review curriculum","In progress","60%"',
    ].join('\n')
    const imported = parseCsvSheet(csv, 'Master Workplan')

    expect(imported.tasks).toHaveLength(1)
    expect(imported.tasks[0]).toMatchObject({
      id: 'C1',
      status: 'In progress',
      percentComplete: 60,
    })

    const duplicateCsv = `${csv}\n"C1","Course","Discovery","Duplicate activity","Completed","100%"`
    expect(() => parseCsvSheet(duplicateCsv, 'Master Workplan')).toThrow(/Duplicate workplan activity IDs found: C1/)
  })

  it('requires all eight source tabs for a workbook import', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Master Workplan')
    const buffer = await workbook.xlsx.writeBuffer()
    const file = new File([new Uint8Array(buffer)], 'incomplete.xlsx')

    await expect(parseWorkbook(file)).rejects.toThrow(/missing required sheets/)
  })
})

describe('deliverable thumbnails', () => {
  it('reads the optional Thumbnail column and defaults to blank', () => {
    const csv = [
      '"ID","Deliverable","Evidence or link","Thumbnail"',
      '"D13","Voice-over script","https://docs.google.com/presentation/d/x","https://res.cloudinary.com/demo/image/upload/a.jpg"',
      '"D14","No cover","",""',
    ].join('\n')
    const dataset = parseCsvSheet(csv, 'Deliverables and Approvals')
    expect(dataset.deliverables.map((item) => item.thumbnail)).toEqual([
      'https://res.cloudinary.com/demo/image/upload/a.jpg',
      '',
    ])
  })
})
