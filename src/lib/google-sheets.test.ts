import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGoogleSheetDataset } from './google-sheets'
import { SOURCE_SHEETS, type SourceSheetName } from './types'

const csvBySheet: Record<SourceSheetName, string> = {
  'Implementation Timeline': '"Timeline baseline Week","Start date"\n"Week 1","02-Nov-2026"\n',
  Dashboard: '"Project summary Project setting","Value"\n"Project name","AniScholar"\n',
  'Master Workplan': '"Weekly update Activity ID","Workstream","Status","Percent complete"\n"PM1","Project Management","In progress","40%"\n',
  'Deliverables and Approvals': '"Deliverable register ID","Deliverable"\n"D1","Inception report"\n',
  'Risks and Dependencies': '"Risk register ID","Type"\n"R1","Risk"\n',
  'Decisions and Changes': '"Decision register ID","Type"\n"DEC1","Decision"\n',
  'Payment Milestones': '"Payment schedule Milestone","Target week","Amount UGX"\n"M1","Week 2","UGX 5,000,000"\n',
  'Team and Contacts': '"Project team Organisation","Name"\n"Qraft Academy","Project lead"\n',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live Google Sheets import', () => {
  it('fetches all tabs and builds the expected source dataset', async () => {
    const fetchMock = vi.fn(async (input: URL) => {
      const sheetName = input.searchParams.get('sheet') as SourceSheetName
      return new Response(csvBySheet[sheetName], {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGoogleSheetDataset()

    expect(fetchMock).toHaveBeenCalledTimes(SOURCE_SHEETS.length)
    expect(result.rawSheets).toHaveProperty('Team and Contacts')
    expect(result.tasks).toMatchObject([
      { id: 'PM1', status: 'In progress', percentComplete: 40 },
    ])
    expect(result.deliverables).toHaveLength(1)
    expect(result.milestones).toMatchObject([{ id: 'M1', targetWeek: 'Week 2', amount: 5_000_000 }])
    expect(result.sourceFileName).toBe('AniScholar Google Sheet')
  })

  it('surfaces access pages instead of treating them as empty sheet data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html>Sign in</html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )))

    await expect(fetchGoogleSheetDataset()).rejects.toThrow(/did not return CSV data/)
  })
})
