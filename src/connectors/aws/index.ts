import { IEC2Connector } from '../types';
import { InstanceMetrics } from '../../analyzers/idle_ec2';
import { EC2Client, DescribeInstancesCommand, Instance } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand, Datapoint } from '@aws-sdk/client-cloudwatch';
import { hourlyCostEur } from './pricing';

export class AWSEC2Connector implements IEC2Connector {
  private readonly ec2: EC2Client;
  private readonly cloudwatch: CloudWatchClient;
  readonly region: string;
  readonly lookbackDays: number;

  constructor(region = 'eu-west-3', lookbackDays = 14) {
    this.region = region;
    this.lookbackDays = lookbackDays;
    // AWS SDK reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from env automatically
    this.ec2 = new EC2Client({ region });
    this.cloudwatch = new CloudWatchClient({ region });
  }

  getHourlyCost(instanceType: string): number {
    return hourlyCostEur(instanceType);
  }

  async listInstances(): Promise<InstanceMetrics[]> {
    const ec2Response = await this.ec2.send(new DescribeInstancesCommand({
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }],
    }));

    const instances: Instance[] = (ec2Response.Reservations ?? [])
      .flatMap(r => r.Instances ?? []);

    if (instances.length === 0) return [];

    const now = new Date();
    const lookbackStart = new Date(now.getTime() - this.lookbackDays * 24 * 60 * 60 * 1000);

    const results: InstanceMetrics[] = [];

    for (const instance of instances) {
      if (!instance.InstanceId || !instance.InstanceType) continue;

      // Use actual instance uptime to determine observation window
      const launchTime = instance.LaunchTime ?? lookbackStart;
      const instanceAgeMs = now.getTime() - launchTime.getTime();
      const instanceAgeDays = instanceAgeMs / (1000 * 60 * 60 * 24);
      const daysObserved = Math.round(Math.min(instanceAgeDays, this.lookbackDays) * 100) / 100;

      const cwResponse = await this.cloudwatch.send(new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
        StartTime: launchTime > lookbackStart ? launchTime : lookbackStart,
        EndTime: now,
        Period: 3600, // 1-hour granularity
        Statistics: ['Average', 'Maximum'],
      }));

      const datapoints: Datapoint[] = cwResponse.Datapoints ?? [];

      if (datapoints.length === 0) continue;

      const cpuAverages = datapoints.map(d => d.Average ?? 0);
      const cpuMaxima = datapoints.map(d => d.Maximum ?? 0);
      const cpuAveragePercent = Math.round(
        (cpuAverages.reduce((a, b) => a + b, 0) / cpuAverages.length) * 100
      ) / 100;
      const cpuMaxPercent = Math.max(...cpuMaxima);

      // Periodic spike detection: max is 10x average and above 20% (batch workload signal)
      const hasPeriodicSpikes = cpuMaxPercent > cpuAveragePercent * 10 && cpuMaxPercent > 20;

      results.push({
        instanceId: instance.InstanceId,
        instanceType: instance.InstanceType,
        region: this.region,
        cpuAveragePercent,
        networkBytesTotal: 0,
        daysObserved,
        hourlyCostEur: hourlyCostEur(instance.InstanceType),
        hasPeriodicSpikes,
      });
    }

    return results;
  }
}
