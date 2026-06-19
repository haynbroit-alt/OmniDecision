import {
  analyzeIdleEC2,
  analyzeMultipleInstances,
  calculateConfidence,
  InstanceMetrics,
} from '../../src/analyzers/idle_ec2';

function makeMetrics(overrides: Partial<InstanceMetrics> = {}): InstanceMetrics {
  return {
    instanceId: 'i-0abc123def',
    instanceType: 'm5.large',
    region: 'eu-west-1',
    cpuAveragePercent: 0.8,
    networkBytesTotal: 0,
    daysObserved: 14,
    hourlyCostEur: 0.096,
    hasPeriodicSpikes: false,
    ...overrides,
  };
}

describe('IdleEC2Analyzer', () => {
  describe('happy path', () => {
    it('generates a finding for a clearly idle instance', () => {
      expect(analyzeIdleEC2(makeMetrics())).not.toBeNull();
    });

    it('finding references the correct resource id', () => {
      const finding = analyzeIdleEC2(makeMetrics({ instanceId: 'i-targeted' }));
      expect(finding?.resource.id).toBe('i-targeted');
    });

    it('recommended action is terminate', () => {
      expect(analyzeIdleEC2(makeMetrics())?.recommendedAction).toBe('terminate');
    });

    it('risk level is low', () => {
      expect(analyzeIdleEC2(makeMetrics())?.risk).toBe('low');
    });

    it('finding id is stable and derived from instanceId', () => {
      const finding = analyzeIdleEC2(makeMetrics({ instanceId: 'i-stable' }));
      expect(finding?.id).toBe('finding_i-stable_idle');
    });
  });

  describe('CPU threshold boundary conditions', () => {
    it('generates a finding at CPU 1.99% (just below threshold)', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 1.99 }))).not.toBeNull();
    });

    it('returns null at CPU exactly 2.0% (at threshold)', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 2.0 }))).toBeNull();
    });

    it('returns null at CPU 2.1% (above threshold)', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 2.1 }))).toBeNull();
    });

    it('returns null at CPU 80% (clearly active)', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 80 }))).toBeNull();
    });
  });

  describe('periodic workload protection (false positive prevention)', () => {
    it('returns null for an instance with periodic spikes, regardless of average CPU', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 0.5, hasPeriodicSpikes: true }))).toBeNull();
    });

    it('never terminates periodic workloads even at 0% average CPU', () => {
      expect(analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 0, hasPeriodicSpikes: true }))).toBeNull();
    });
  });

  describe('confidence degradation', () => {
    it('returns full confidence (0.93) at 14 days of data', () => {
      expect(calculateConfidence(makeMetrics({ daysObserved: 14 }))).toBe(0.93);
    });

    it('caps at 0.93 even with more than 14 days of data', () => {
      expect(calculateConfidence(makeMetrics({ daysObserved: 30 }))).toBe(0.93);
    });

    it('returns reduced confidence at 7 days (~0.46)', () => {
      const conf = calculateConfidence(makeMetrics({ daysObserved: 7 }));
      expect(conf).toBeCloseTo(0.46, 1);
    });

    it('returns low confidence at 3 days', () => {
      const conf = calculateConfidence(makeMetrics({ daysObserved: 3 }));
      expect(conf).toBeLessThan(0.3);
    });

    it('returns 0 when periodic spikes are detected', () => {
      expect(calculateConfidence(makeMetrics({ hasPeriodicSpikes: true }))).toBe(0);
    });

    it('suppresses the finding entirely when confidence is below 0.30 (insufficient data)', () => {
      expect(analyzeIdleEC2(makeMetrics({ daysObserved: 3 }))).toBeNull();
    });

    it('confidence correlates positively with days observed', () => {
      const low = calculateConfidence(makeMetrics({ daysObserved: 5 }));
      const high = calculateConfidence(makeMetrics({ daysObserved: 10 }));
      expect(high).toBeGreaterThan(low);
    });
  });

  describe('financial calculations', () => {
    it('monthly loss equals hourly cost × 24 × 30 (rounded to cents)', () => {
      const finding = analyzeIdleEC2(makeMetrics({ hourlyCostEur: 0.096 }));
      const expected = Math.round(0.096 * 24 * 30 * 100) / 100;
      expect(finding?.financialImpact.monthlyLossEur).toBe(expected);
    });

    it('annual loss equals monthly loss × 12', () => {
      const finding = analyzeIdleEC2(makeMetrics());
      const { monthlyLossEur, annualLossEur } = finding!.financialImpact;
      expect(annualLossEur).toBeCloseTo(monthlyLossEur * 12, 2);
    });

    it('ROI monthlySavings matches financial impact monthly loss', () => {
      const finding = analyzeIdleEC2(makeMetrics());
      expect(finding?.roi.monthlySavings).toBe(finding?.financialImpact.monthlyLossEur);
    });
  });

  describe('evidence quality', () => {
    it('includes the observed CPU percentage', () => {
      const finding = analyzeIdleEC2(makeMetrics({ cpuAveragePercent: 0.7 }));
      expect(finding?.evidence.some(e => e.includes('0.7%'))).toBe(true);
    });

    it('includes the observation period in days', () => {
      const finding = analyzeIdleEC2(makeMetrics({ daysObserved: 14 }));
      expect(finding?.evidence.some(e => e.includes('14 days'))).toBe(true);
    });

    it('evidence array is never empty on a generated finding', () => {
      const finding = analyzeIdleEC2(makeMetrics());
      expect(finding?.evidence.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeMultipleInstances', () => {
    it('returns an empty array for an empty input', () => {
      expect(analyzeMultipleInstances([])).toEqual([]);
    });

    it('filters out active instances', () => {
      const instances = [
        makeMetrics({ instanceId: 'i-idle', cpuAveragePercent: 0.5 }),
        makeMetrics({ instanceId: 'i-active', cpuAveragePercent: 70 }),
      ];
      const findings = analyzeMultipleInstances(instances);
      expect(findings).toHaveLength(1);
      expect(findings[0].resource.id).toBe('i-idle');
    });

    it('returns findings for all qualifying instances', () => {
      const instances = [
        makeMetrics({ instanceId: 'i-001', cpuAveragePercent: 0.5 }),
        makeMetrics({ instanceId: 'i-002', cpuAveragePercent: 1.0 }),
        makeMetrics({ instanceId: 'i-003', cpuAveragePercent: 0.2 }),
      ];
      expect(analyzeMultipleInstances(instances)).toHaveLength(3);
    });

    it('excludes instances with periodic spikes from results', () => {
      const instances = [
        makeMetrics({ instanceId: 'i-ok', hasPeriodicSpikes: false }),
        makeMetrics({ instanceId: 'i-batch', hasPeriodicSpikes: true }),
      ];
      const findings = analyzeMultipleInstances(instances);
      expect(findings).toHaveLength(1);
      expect(findings[0].resource.id).toBe('i-ok');
    });
  });
});
