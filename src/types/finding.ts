export type FindingAction = 'terminate' | 'stop' | 'downsize' | 'review';
export type RiskLevel = 'low' | 'medium' | 'high';
export type PaybackTime = 'immediate' | 'short-term' | 'long-term';

export interface FinancialImpact {
  monthlyLossEur: number;
  annualLossEur: number;
}

export interface ROI {
  monthlySavings: number;
  annualSavings: number;
  paybackTime: PaybackTime;
}

export interface Resource {
  type: string;
  id: string;
  region: string;
  instanceType?: string;
}

export interface Finding {
  id: string;
  title: string;
  resource: Resource;
  financialImpact: FinancialImpact;
  confidence: number;
  recommendedAction: FindingAction;
  risk: RiskLevel;
  evidence: string[];
  roi: ROI;
  generatedAt: string;
}
