import { calculateROI, calculateAnnualLoss } from '../../src/roi';

describe('ROI Calculations', () => {
  describe('calculateAnnualLoss', () => {
    it('returns monthly × 12', () => {
      expect(calculateAnnualLoss(1240)).toBe(14880);
    });

    it('handles zero', () => {
      expect(calculateAnnualLoss(0)).toBe(0);
    });

    it('handles decimal values without drift', () => {
      expect(calculateAnnualLoss(100.5)).toBeCloseTo(1206, 1);
    });

    it('is symmetric: calculateAnnualLoss(monthly) / 12 === monthly', () => {
      const monthly = 731.25;
      expect(calculateAnnualLoss(monthly) / 12).toBeCloseTo(monthly, 10);
    });
  });

  describe('calculateROI', () => {
    it('monthlySavings equals the input', () => {
      expect(calculateROI(1240).monthlySavings).toBe(1240);
    });

    it('annualSavings equals monthlySavings × 12', () => {
      const roi = calculateROI(1240);
      expect(roi.annualSavings).toBe(roi.monthlySavings * 12);
    });

    it('annualSavings is 14880 for 1240/month', () => {
      expect(calculateROI(1240).annualSavings).toBe(14880);
    });

    it('paybackTime is "immediate" for any positive monthly loss', () => {
      expect(calculateROI(0.01).paybackTime).toBe('immediate');
      expect(calculateROI(10000).paybackTime).toBe('immediate');
    });

    it('paybackTime is "long-term" when monthly loss is zero', () => {
      expect(calculateROI(0).paybackTime).toBe('long-term');
    });
  });
});
