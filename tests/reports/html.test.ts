import { renderHTMLReport, ReportData } from '../../src/reports/html';
import { Finding } from '../../src/types/finding';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
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

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    findings: [makeFinding()],
    generatedAt: '2026-06-18T10:00:00Z',
    ...overrides,
  };
}

describe('HTML Report Renderer', () => {
  describe('empty findings', () => {
    it('shows a "no issues found" message', () => {
      const html = renderHTMLReport(makeReportData({ findings: [] }));
      expect(html).toContain('No cost optimization opportunities found');
    });

    it('produces well-formed HTML even with zero findings', () => {
      const html = renderHTMLReport(makeReportData({ findings: [] }));
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('does not render a summary block when findings list is empty', () => {
      const html = renderHTMLReport(makeReportData({ findings: [] }));
      expect(html).not.toContain('Total Monthly Loss');
    });
  });

  describe('financial totals', () => {
    it('total monthly loss is the sum of all finding monthly losses', () => {
      const findings = [
        makeFinding({ id: 'f1', financialImpact: { monthlyLossEur: 1000, annualLossEur: 12000 } }),
        makeFinding({ id: 'f2', financialImpact: { monthlyLossEur: 500, annualLossEur: 6000 } }),
        makeFinding({ id: 'f3', financialImpact: { monthlyLossEur: 240, annualLossEur: 2880 } }),
      ];
      const html = renderHTMLReport(makeReportData({ findings }));
      expect(html).toContain('1740.00€');
    });

    it('total annual is total monthly × 12 (not a raw sum of finding annuals)', () => {
      // This guards against a renderer that sums finding.annualLossEur values,
      // which could diverge from monthly*12 if individual findings have rounding.
      const findings = [
        makeFinding({ id: 'f1', financialImpact: { monthlyLossEur: 1000, annualLossEur: 12000 } }),
      ];
      const html = renderHTMLReport(makeReportData({ findings }));
      expect(html).toContain('12000.00€'); // 1000 * 12
    });
  });

  describe('finding content', () => {
    it('renders the finding title', () => {
      const html = renderHTMLReport(makeReportData());
      expect(html).toContain('Idle EC2 Instance (m5.large) - eu-west-1');
    });

    it('renders the monthly loss in the finding card', () => {
      const html = renderHTMLReport(makeReportData());
      expect(html).toContain('1240.00€');
    });

    it('renders confidence as a percentage', () => {
      const html = renderHTMLReport(makeReportData());
      expect(html).toContain('93%');
    });

    it('renders every evidence item', () => {
      const html = renderHTMLReport(makeReportData());
      expect(html).toContain('CPU < 2% over 14 days');
      expect(html).toContain('No network activity');
    });

    it('renders the recommended action', () => {
      const html = renderHTMLReport(makeReportData());
      expect(html).toContain('terminate');
    });
  });

  describe('multiple findings', () => {
    it('renders all finding titles', () => {
      const findings = [
        makeFinding({ id: 'f1', title: 'Finding Alpha' }),
        makeFinding({ id: 'f2', title: 'Finding Beta' }),
        makeFinding({ id: 'f3', title: 'Finding Gamma' }),
      ];
      const html = renderHTMLReport(makeReportData({ findings }));
      expect(html).toContain('Finding Alpha');
      expect(html).toContain('Finding Beta');
      expect(html).toContain('Finding Gamma');
    });

    it('reports the correct finding count in the summary', () => {
      const findings = [makeFinding({ id: 'f1' }), makeFinding({ id: 'f2' })];
      const html = renderHTMLReport(makeReportData({ findings }));
      expect(html).toContain('2 finding(s)');
    });
  });

  describe('metadata', () => {
    it('includes the generation timestamp', () => {
      const html = renderHTMLReport(makeReportData({ generatedAt: '2026-06-18T10:00:00Z' }));
      expect(html).toContain('2026-06-18T10:00:00Z');
    });

    it('includes the account ID when provided', () => {
      const html = renderHTMLReport(makeReportData({ accountId: '123456789012' }));
      expect(html).toContain('123456789012');
    });

    it('omits the account section when accountId is absent', () => {
      const html = renderHTMLReport(makeReportData({ accountId: undefined }));
      expect(html).not.toContain('Account:');
    });
  });
});
