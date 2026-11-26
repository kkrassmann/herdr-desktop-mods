export type StepStatus = 'done' | 'active' | 'todo'

export type TickerStep = { name: string; status: StepStatus; percent: number | null }

export type TickerData = {
  topic: string
  description: string
  steps: TickerStep[]
  total: number
  questions: string[]
  updatedAt: number
}

export type Explanation = {
  status: 'loading' | 'ready' | 'error'
  text: string
  recommendation: string | null
}

declare module 'claude-code' {
  interface PluginState {
    ticker: {
      data: TickerData | null
      isOpen: boolean
      openQuestions: string[]
      sentQuestions: string[]
      hideDone: boolean
      explanations: Record<string, Explanation>
    }
  }
}
