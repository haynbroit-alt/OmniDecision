import { EC2Client, DescribeInstancesCommand, Instance as EC2Instance } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { calculateConfidence } from '../../analyzers/idle_ec2';
import { hourlyCostEur, monthlyCostEur } from '../../connectors/aws/pricing';

export interface InstanceStatus {
  instanceId: string;
  instanceType: string;
  state: string;
  region: string;
  launchTime: Date | null;
  ageDays: number;
  hourlyCostEur: number;
  monthlyCostEur: number;
  cpuAvgPercent: number;
  cpuMaxPercent: number;
  networkInMB: number;
  networkOutMB: number;
  datapointCount: number;
  confidence: number;
  hasPeriodicSpikes: boolean;
}

export interface MonitorSummary {
  region: string;
  scannedAt: string;
  instances: InstanceStatus[];
  totalMonthlyCostEur: number;
  findingsReady: number;
  findingsBuilding: number;
}

export class AWSMonitorAgent {
  private readonly cloudwatch: CloudWatchClient;
  readonly region: string;
  readonly lookbackDays: number;

  constructor(region = 'eu-west-3', lookbackDays = 14) {
    this.region = region;
    this.lookbackDays = lookbackDays;
    this.cloudwatch = new CloudWatchClient({ region });
  }

  async scan(): Promise<MonitorSummary> {
    const ec2Client = new EC2Client({ region: this.region });
    const ec2Response = await ec2Client.send(new DescribeInstancesCommand({
      Filters: [{
        Name: 'instance-state-name',
        Values: ['running', 'stopped', 'stopping', 'pending'],
      }],
    }));

    const instances: EC2Instance[] = (ec2Response.Reservations ?? [])
      .flatMap(r => r.Instances ?? []);

    const now = new Date();
    const lookbackStart = new Date(now.getTime() - this.lookbackDays * 24 * 60 * 60 * 1000);
    const statuses: InstanceStatus[] = [];

    for (const instance of instances) {
      if (!instance.InstanceId || !instance.InstanceType) continue;

      const state = instance.State?.Name ?? 'unknown';
      const launchTime = instance.LaunchTime ?? null;
      const ageDays = launchTime
        ? (now.getTime() - launchTime.getTime()) / (1000 * 60 * 60 * 24)
        : 0;

      let cpuAvgPercent = 0;
      let cpuMaxPercent = 0;
      let networkInMB = 0;
      let networkOutMB = 0;
      let datapointCount = 0;
      let hasPeriodicSpikes = false;

      if (state === 'running') {
        const queryStart = launchTime && launchTime > lookbackStart ? launchTime : lookbackStart;

        const [cpuRes, netInRes, netOutRes] = await Promise.all([
          this.cloudwatch.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/EC2',
            MetricName: 'CPUUtilization',
            Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
            StartTime: queryStart,
            EndTime: now,
            Period: 3600,
            Statistics: ['Average', 'Maximum'],
          })),
          this.cloudwatch.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/EC2',
            MetricName: 'NetworkIn',
            Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
            StartTime: queryStart,
            EndTime: now,
            Period: this.lookbackDays * 24 * 3600,
            Statistics: ['Sum'],
          })),
          this.cloudwatch.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/EC2',
            MetricName: 'NetworkOut',
            Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
            StartTime: queryStart,
            EndTime: now,
            Period: this.lookbackDays * 24 * 3600,
            Statistics: ['Sum'],
          })),
        ]);

        const cpuPoints = cpuRes.Datapoints ?? [];
        datapointCount = cpuPoints.length;

        if (cpuPoints.length > 0) {
          const avgs = cpuPoints.map(d => d.Average ?? 0);
          const maxes = cpuPoints.map(d => d.Maximum ?? 0);
          cpuAvgPercent = Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length * 100) / 100;
          cpuMaxPercent = Math.round(Math.max(...maxes) * 100) / 100;
          hasPeriodicSpikes = cpuMaxPercent > cpuAvgPercent * 10 && cpuMaxPercent > 20;
        }

        networkInMB = Math.round((netInRes.Datapoints?.[0]?.Sum ?? 0) / 1024 / 1024 * 100) / 100;
        networkOutMB = Math.round((netOutRes.Datapoints?.[0]?.Sum ?? 0) / 1024 / 1024 * 100) / 100;
      }

      const daysObserved = Math.min(ageDays, this.lookbackDays);
      const confidence = state === 'running'
        ? calculateConfidence({
            instanceId: instance.InstanceId,
            instanceType: instance.InstanceType,
            region: this.region,
            cpuAveragePercent: cpuAvgPercent,
            networkBytesTotal: (networkInMB + networkOutMB) * 1024 * 1024,
            daysObserved,
            hourlyCostEur: hourlyCostEur(instance.InstanceType),
            hasPeriodicSpikes,
          })
        : 0;

      statuses.push({
        instanceId: instance.InstanceId,
        instanceType: instance.InstanceType,
        state,
        region: this.region,
        launchTime,
        ageDays: Math.round(ageDays * 100) / 100,
        hourlyCostEur: hourlyCostEur(instance.InstanceType),
        monthlyCostEur: monthlyCostEur(instance.InstanceType),
        cpuAvgPercent,
        cpuMaxPercent,
        networkInMB,
        networkOutMB,
        datapointCount,
        confidence,
        hasPeriodicSpikes,
      });
    }

    const totalMonthlyCostEur = Math.round(
      statuses.reduce((sum, s) => sum + s.monthlyCostEur, 0) * 100
    ) / 100;

    return {
      region: this.region,
      scannedAt: now.toISOString(),
      instances: statuses,
      totalMonthlyCostEur,
      findingsReady: statuses.filter(s => s.confidence >= 0.7).length,
      findingsBuilding: statuses.filter(s => s.confidence >= 0.3 && s.confidence < 0.7).length,
    };
  }
}

function pad(str: string, len: number): string {
  return str.substring(0, len).padEnd(len);
}

export function formatMonitorTable(summary: MonitorSummary): string {
  const lines: string[] = [];

  lines.push(`OmniDecision — AWS Monitor`);
  lines.push(`Region: ${summary.region}  |  Scanned: ${summary.scannedAt}`);
  lines.push('─'.repeat(100));

  if (summary.instances.length === 0) {
    lines.push('Aucune instance trouvée.');
    return lines.join('\n');
  }

  lines.push(
    pad('Instance', 22) +
    pad('Type', 12) +
    pad('État', 10) +
    pad('Âge', 8) +
    pad('CPU moy', 9) +
    pad('CPU max', 9) +
    pad('Réseau ↓/↑ MB', 15) +
    pad('€/mois', 8) +
    pad('Confiance', 10) +
    'Statut'
  );
  lines.push('─'.repeat(100));

  for (const s of summary.instances) {
    const age = s.ageDays >= 1
      ? `${Math.floor(s.ageDays)}j`
      : `${Math.round(s.ageDays * 24)}h`;

    const cpu = s.state === 'running' ? `${s.cpuAvgPercent}%` : '—';
    const cpuMax = s.state === 'running' ? `${s.cpuMaxPercent}%` : '—';
    const net = s.state === 'running' ? `${s.networkInMB}/${s.networkOutMB}` : '—';
    const confPct = s.state === 'running' ? `${Math.round(s.confidence * 100)}%` : '—';

    let status = '';
    if (s.state !== 'running') status = '⏸ arrêtée';
    else if (s.confidence >= 0.7) status = '🔥 Finding prêt';
    else if (s.confidence >= 0.3) status = '⏳ En cours';
    else if (s.datapointCount === 0) status = '⌛ Pas de données';
    else status = `⌛ ${Math.round(s.confidence * 100)}% (besoin de ${Math.ceil((0.3 / 0.93) * 14 - s.ageDays)}j+)`;

    lines.push(
      pad(s.instanceId, 22) +
      pad(s.instanceType, 12) +
      pad(s.state, 10) +
      pad(age, 8) +
      pad(cpu, 9) +
      pad(cpuMax, 9) +
      pad(net, 15) +
      pad(`€${s.monthlyCostEur}`, 8) +
      pad(confPct, 10) +
      status
    );
  }

  lines.push('─'.repeat(100));
  lines.push(
    `Instances: ${summary.instances.length}  |  ` +
    `Coût mensuel total: €${summary.totalMonthlyCostEur}  |  ` +
    `Findings prêts: ${summary.findingsReady}  |  ` +
    `En construction: ${summary.findingsBuilding}`
  );

  return lines.join('\n');
}
