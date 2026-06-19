import { Finding } from '../types/finding';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFinding(f: Partial<Finding>): ValidationResult {
  const errors: string[] = [];

  if (!f.id || typeof f.id !== 'string') {
    errors.push('id must be a non-empty string');
  }

  if (!f.title || typeof f.title !== 'string') {
    errors.push('title must be a non-empty string');
  }

  if (!f.financialImpact) {
    errors.push('financialImpact is required');
  } else {
    if (typeof f.financialImpact.monthlyLossEur !== 'number' || f.financialImpact.monthlyLossEur <= 0) {
      errors.push('financialImpact.monthlyLossEur must be a positive number');
    }
    if (typeof f.financialImpact.annualLossEur !== 'number' || f.financialImpact.annualLossEur <= 0) {
      errors.push('financialImpact.annualLossEur must be a positive number');
    }
    if (
      typeof f.financialImpact.monthlyLossEur === 'number' &&
      typeof f.financialImpact.annualLossEur === 'number'
    ) {
      const expected = f.financialImpact.monthlyLossEur * 12;
      if (Math.abs(f.financialImpact.annualLossEur - expected) > 0.01) {
        errors.push('financialImpact.annualLossEur must equal monthlyLossEur × 12');
      }
    }
  }

  if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) {
    errors.push('confidence must be a number between 0 and 1');
  }

  if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
    errors.push('evidence must be a non-empty array');
  }

  if (!f.recommendedAction) {
    errors.push('recommendedAction is required');
  }

  return { valid: errors.length === 0, errors };
}
