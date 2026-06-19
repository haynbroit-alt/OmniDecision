import { validateFinding } from '../../src/findings/validator';
import { Finding } from '../../src/types/finding';

function makeFinding(overrides: Partial<Finding> = {}): Partial<Finding> {
  return {
    id: 'finding_001',
    title: 'Idle EC2 Instance (m5.large) - eu-west-1',
    resource: { type: 'ec2', id: 'i-0abc123', region: 'eu-west-1', instanceType: 'm5.large' },
    financialImpact: { monthlyLossEur: 1240, annualLossEur: 14880 },
    confidence: 0.93,
    recommendedAction: 'terminate',
    risk: 'low',
    evidence: ['CPU < 2% over 14 days', 'No network activity'],
    roi: { monthlySavings: 1240, annualSavings: 14880, paybackTime: 'immediate' },
    generatedAt: '2026-06-18T10:00:00Z',
    ...overrides,
  };
}

describe('Finding Schema Validation', () => {
  describe('valid findings', () => {
    it('accepts a complete, valid finding', () => {
      const result = validateFinding(makeFinding());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('id', () => {
    it('rejects a missing id', () => {
      const result = validateFinding(makeFinding({ id: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id must be a non-empty string');
    });

    it('rejects an empty string id', () => {
      const result = validateFinding(makeFinding({ id: '' }));
      expect(result.valid).toBe(false);
    });
  });

  describe('financialImpact', () => {
    it('rejects negative monthlyLossEur', () => {
      const result = validateFinding(makeFinding({
        financialImpact: { monthlyLossEur: -100, annualLossEur: -1200 },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('monthlyLossEur'))).toBe(true);
    });

    it('rejects zero monthlyLossEur', () => {
      const result = validateFinding(makeFinding({
        financialImpact: { monthlyLossEur: 0, annualLossEur: 0 },
      }));
      expect(result.valid).toBe(false);
    });

    it('rejects annualLossEur inconsistent with monthlyLossEur × 12', () => {
      const result = validateFinding(makeFinding({
        financialImpact: { monthlyLossEur: 1240, annualLossEur: 9999 },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('annualLossEur'))).toBe(true);
    });

    it('accepts annualLossEur within floating-point tolerance of monthly × 12', () => {
      const result = validateFinding(makeFinding({
        financialImpact: { monthlyLossEur: 100.33, annualLossEur: 1203.96 },
      }));
      expect(result.valid).toBe(true);
    });

    it('rejects missing financialImpact', () => {
      const result = validateFinding(makeFinding({ financialImpact: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('financialImpact is required');
    });
  });

  describe('confidence', () => {
    it('rejects confidence above 1', () => {
      const result = validateFinding(makeFinding({ confidence: 1.01 }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
    });

    it('rejects confidence below 0', () => {
      const result = validateFinding(makeFinding({ confidence: -0.01 }));
      expect(result.valid).toBe(false);
    });

    it('accepts boundary value 0', () => {
      expect(validateFinding(makeFinding({
        confidence: 0,
        financialImpact: { monthlyLossEur: 100, annualLossEur: 1200 },
      })).valid).toBe(true);
    });

    it('accepts boundary value 1', () => {
      expect(validateFinding(makeFinding({ confidence: 1 })).valid).toBe(true);
    });
  });

  describe('evidence', () => {
    it('rejects an empty evidence array', () => {
      const result = validateFinding(makeFinding({ evidence: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('evidence'))).toBe(true);
    });

    it('rejects missing evidence', () => {
      const result = validateFinding(makeFinding({ evidence: undefined }));
      expect(result.valid).toBe(false);
    });

    it('accepts a single evidence item', () => {
      const result = validateFinding(makeFinding({ evidence: ['One piece of evidence'] }));
      expect(result.valid).toBe(true);
    });
  });

  describe('recommendedAction', () => {
    it('rejects missing recommendedAction', () => {
      const result = validateFinding(makeFinding({ recommendedAction: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('recommendedAction is required');
    });
  });

  describe('multiple errors', () => {
    it('reports all errors at once rather than stopping at the first', () => {
      const result = validateFinding({});
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
