import { IEC2Connector } from '../types';
import { InstanceMetrics } from '../../analyzers/idle_ec2';

// Simplified on-demand pricing (eu-west-1, Linux)
const INSTANCE_HOURLY_COST_EUR: Record<string, number> = {
  't3.micro': 0.0104,
  't3.small': 0.0208,
  't3.medium': 0.0416,
  't3.large': 0.0832,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'm5.2xlarge': 0.384,
  'c5.large': 0.085,
  'c5.xlarge': 0.170,
  'r5.large': 0.126,
};

export class AWSEC2Connector implements IEC2Connector {
  private readonly region: string;
  private readonly lookbackDays: number;

  constructor(region = 'eu-west-1', lookbackDays = 14) {
    this.region = region;
    this.lookbackDays = lookbackDays;
  }

  getHourlyCost(instanceType: string): number {
    return INSTANCE_HOURLY_COST_EUR[instanceType] ?? 0;
  }

  // Real implementation requires AWS credentials and SDK calls.
  // Use integration tests (npm run test:integration) with a live sandbox account.
  async listInstances(): Promise<InstanceMetrics[]> {
    throw new Error(
      `AWS connector not yet implemented. ` +
      `Region: ${this.region}, lookback: ${this.lookbackDays} days. ` +
      `Implement using @aws-sdk/client-ec2 and @aws-sdk/client-cloudwatch.`
    );
  }
}
