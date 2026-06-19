import { AWSEC2Connector } from '../../src/connectors/aws';
import { monthlyCostEur } from '../../src/connectors/aws/pricing';

describe('monthlyCostEur', () => {
  it('returns hourly × 24 × 30 for t3.micro', () => {
    expect(monthlyCostEur('t3.micro')).toBeCloseTo(0.0116 * 24 * 30, 2);
  });

  it('returns hourly × 24 × 30 for m5.large', () => {
    expect(monthlyCostEur('m5.large')).toBeCloseTo(0.107 * 24 * 30, 1);
  });

  it('returns 0 for unknown instance type', () => {
    expect(monthlyCostEur('x99.unknown')).toBe(0);
  });
});

describe('AWSEC2Connector', () => {
  describe('getHourlyCost', () => {
    const connector = new AWSEC2Connector();

    it('returns the correct cost for m5.large', () => {
      expect(connector.getHourlyCost('m5.large')).toBe(0.107);
    });

    it('returns the correct cost for t3.micro', () => {
      expect(connector.getHourlyCost('t3.micro')).toBe(0.0116);
    });

    it('returns 0 for an unknown instance type rather than throwing', () => {
      expect(connector.getHourlyCost('x99.unknown')).toBe(0);
    });

    it('m5.xlarge costs twice as much as m5.large', () => {
      const large = connector.getHourlyCost('m5.large');
      const xlarge = connector.getHourlyCost('m5.xlarge');
      expect(xlarge).toBeCloseTo(large * 2, 1);
    });
  });

  describe('listInstances (unit guard)', () => {
    it('throws without real AWS credentials — preventing accidental live calls in CI', async () => {
      const connector = new AWSEC2Connector();
      await expect(connector.listInstances()).rejects.toThrow();
    });
  });
});
