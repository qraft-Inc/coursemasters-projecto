import { SOURCE_SHEETS, type ImportedDataset, type SourceSheetName } from './types'
import { parseCsvSheet } from './workbook-import'

const SHEET_ID = '1jodhzJhTFvFY_H-SqpjOZiUpgKDU74uvEZJ0PgzNvy8'
const REFRESH_INTERVAL_MS = 60_000

export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
export { REFRESH_INTERVAL_MS }

export async function fetchGoogleSheetDataset(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ImportedDataset> {
  const csvSheets = await Promise.all(
    SOURCE_SHEETS.map(async (sheetName) => ({
      sheetName,
      csv: await fetchSheetCsv(sheetName, fetcher, signal),
    })),
  )

  let dataset: ImportedDataset | null = null
  for (const { sheetName, csv } of csvSheets) {
    dataset = parseCsvSheet(csv, sheetName, dataset, 'AniScholar Google Sheet')
  }
  if (!dataset || dataset.tasks.length === 0) {
    throw new Error('The live Google Sheet returned no master workplan activities.')
  }
  return { ...dataset, importedAt: new Date().toISOString() }
}

async function fetchSheetCsv(
  sheetName: SourceSheetName,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`)
  url.searchParams.set('tqx', 'out:csv')
  url.searchParams.set('sheet', sheetName)
  url.searchParams.set('_', String(Date.now()))

  let response: Response
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(
      `Could not connect to the Google Sheet tab "${sheetName}". Check the connection and sheet sharing settings.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(
      `Google Sheets returned HTTP ${response.status} for "${sheetName}". The sheet must allow viewer access to anyone with its link.`,
    )
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('csv')) {
    throw new Error(
      `Google Sheets did not return CSV data for "${sheetName}". Check that the sheet is viewable without signing in.`,
    )
  }
  return response.text()
}
