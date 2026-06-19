import { ROI, PaybackTime } from '../types/finding';

export function calculateAnnualLoss(monthlyLossEur: number): number {
  return monthlyLossEur * 12;
}

export function calculateROI(monthlyLossEur: number): ROI {
  const annualSavings = calculateAnnualLoss(monthlyLossEur);

  const paybackTime: PaybackTime = monthlyLossEur > 0 ? 'immediate' : 'long-term';

  return {
    monthlySavings: monthlyLossEur,
    annualSavings,
    paybackTime,
  };
}
