export const SOURCE_SHEETS = [
  'Implementation Timeline',
  'Dashboard',
  'Master Workplan',
  'Deliverables and Approvals',
  'Risks and Dependencies',
  'Decisions and Changes',
  'Payment Milestones',
  'Team and Contacts',
] as const

export type SourceSheetName = (typeof SOURCE_SHEETS)[number]
export type SourceValue = string | number | boolean | null
export type SourceRow = Record<string, SourceValue>

export interface WorkplanTask {
  id: string
  sourceId: string
  workstream: string
  phase: string
  activity: string
  deliverable: string
  leadOrganisation: string
  owner: string
  startWeek: string
  finishWeek: string
  plannedStart: string
  plannedFinish: string
  actualStart: string
  actualFinish: string
  dependency: string
  approvalRequired: string
  status: string
  percentComplete: number
  daysVariance: string
  nextAction: string
  nextActionDue: string
  comments: string
}

export interface Deliverable {
  id: string
  description: string
  milestone: string
  owner: string
  reviewer: string
  plannedSubmission: string
  actualSubmission: string
  feedbackDue: string
  feedbackReceived: string
  revisionDue: string
  approvalStatus: string
  approvalDate: string
  evidence: string
  /** Optional cover image URL from the sheet's "Thumbnail" column. */
  thumbnail: string
}

export interface PaymentMilestone {
  id: string
  label: string
  targetWeek: string
  percentage: number
  amount: number
  approvalRequirement: string
  plannedInvoiceDate: string
  actualInvoiceDate: string
  approvalDate: string
  paymentDueDate: string
  amountReceived: number
  balance: number
  status: string
}

export interface MicroLesson {
  id: string
  sequence: number
  moduleCode: string | null
  title: string
  titleVerified: boolean
  stage: string
  status: string
}

export interface ImportedDataset {
  importedAt: string
  sourceFileName: string
  rawSheets: Partial<Record<SourceSheetName, SourceRow[]>>
  tasks: WorkplanTask[]
  deliverables: Deliverable[]
  milestones: PaymentMilestone[]
  risks: SourceRow[]
  decisions: SourceRow[]
  team: SourceRow[]
  microLessons: MicroLesson[]
}

export type SourceChangeType = 'added' | 'changed' | 'removed'
export type SourceChangeDecision = 'apply' | 'keep'

export interface SourceDifference {
  id: string
  sheetName: SourceSheetName
  rowKey: string
  changeType: SourceChangeType
  changedFields: string[]
  previous: SourceRow | null
  incoming: SourceRow | null
}
