import { formatMonitorTable, MonitorSummary, InstanceStatus } from '../../src/agents/aws-monitor';

function makeStatus(overrides: Partial<InstanceStatus> = {}): InstanceStatus {
  return {
    instanceId: 'i-0abc123',
    instanceType: 't3.micro',
    state: 'running',
    region: 'eu-west-3',
    launchTime: new Date('2026-06-15T10:00:00Z'),
    ageDays: 4.5,
    hourlyCostEur: 0.0116,
    monthlyCostEur: 8.35,
    cpuAvgPercent: 0.21,
    cpuMaxPercent: 0.85,
    networkInMB: 0.5,
    networkOutMB: 0.2,
    datapointCount: 4,
    confidence: 0.3,
    hasPeriodicSpikes: false,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    region: 'eu-west-3',
    scannedAt: '2026-06-19T19:00:00Z',
    instances: [makeStatus()],
    totalMonthlyCostEur: 8.35,
    findingsReady: 0,
    findingsBuilding: 1,
    ...overrides,
  };
}

describe('formatMonitorTable', () => {
  describe('header and structure', () => {
    it('includes the region', () => {
      expect(formatMonitorTable(makeSummary())).toContain('eu-west-3');
    });

    it('includes the scan timestamp', () => {
      expect(formatMonitorTable(makeSummary())).toContain('2026-06-19T19:00:00Z');
    });

    it('includes the instance id', () => {
      expect(formatMonitorTable(makeSummary())).toContain('i-0abc123');
    });
  });

  describe('empty account', () => {
    it('shows a "no instances" message when list is empty', () => {
      const output = formatMonitorTable(makeSummary({
        instances: [],
        totalMonthlyCostEur: 0,
        findingsReady: 0,
        findingsBuilding: 0,
      }));
      expect(output).toContain('Aucune instance');
    });
  });

  describe('instance state display', () => {
    it('shows CPU metrics for running instances', () => {
      const output = formatMonitorTable(makeSummary());
      expect(output).toContain('0.21%');
    });

    it('shows dashes for CPU on stopped instances', () => {
      const output = formatMonitorTable(makeSummary({
        instances: [makeStatus({ state: 'stopped', cpuAvgPercent: 0 })],
      }));
      // CPU column should show '—' for stopped instances
      const lines = output.split('\n');
      const instanceLine = lines.find(l => l.includes('i-0abc123')) ?? '';
      expect(instanceLine).toContain('—');
    });

    it('labels a high-confidence instance as finding-ready', () => {
      const output = formatMonitorTable(makeSummary({
        instances: [makeStatus({ confidence: 0.90 })],
        findingsReady: 1,
      }));
      expect(output).toContain('Finding prêt');
    });

    it('labels a mid-confidence instance as in-progress', () => {
      const output = formatMonitorTable(makeSummary({
        instances: [makeStatus({ confidence: 0.50 })],
      }));
      expect(output).toContain('En cours');
    });

    it('labels a stopped instance correctly', () => {
      const output = formatMonitorTable(makeSummary({
        instances: [makeStatus({ state: 'stopped', confidence: 0 })],
      }));
      expect(output).toContain('arrêtée');
    });
  });

  describe('financial summary', () => {
    it('shows total monthly cost in the footer', () => {
      const output = formatMonitorTable(makeSummary({ totalMonthlyCostEur: 42.50 }));
      expect(output).toContain('42.5');
    });

    it('shows findings-ready count in footer', () => {
      const output = formatMonitorTable(makeSummary({ findingsReady: 3 }));
      expect(output).toContain('Findings prêts: 3');
    });

    it('shows building count in footer', () => {
      const output = formatMonitorTable(makeSummary({ findingsBuilding: 2 }));
      expect(output).toContain('En construction: 2');
    });
  });

  describe('multiple instances', () => {
    it('renders all instances', () => {
      const summary = makeSummary({
        instances: [
          makeStatus({ instanceId: 'i-aaa', instanceType: 't3.micro' }),
          makeStatus({ instanceId: 'i-bbb', instanceType: 'm5.large' }),
          makeStatus({ instanceId: 'i-ccc', instanceType: 'c5.large', state: 'stopped' }),
        ],
        totalMonthlyCostEur: 100,
      });
      const output = formatMonitorTable(summary);
      expect(output).toContain('i-aaa');
      expect(output).toContain('i-bbb');
      expect(output).toContain('i-ccc');
    });
  });

  describe('AWSMonitorAgent live guard', () => {
    it('throws without AWS credentials — prevents accidental live calls in CI', async () => {
      const { AWSMonitorAgent } = await import('../../src/agents/aws-monitor');
      const agent = new AWSMonitorAgent('eu-west-3', 14);
      await expect(agent.scan()).rejects.toThrow();
    });
  });
});
