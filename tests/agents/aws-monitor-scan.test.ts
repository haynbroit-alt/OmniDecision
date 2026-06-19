// Mocked unit tests for AWSMonitorAgent.scan()
// These bypass real AWS credentials by mocking the SDK clients.

const mockEc2Send = jest.fn();
const mockCwSend = jest.fn();

jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: jest.fn(() => ({ send: mockEc2Send })),
  DescribeInstancesCommand: jest.fn(input => input),
  Instance: {},
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: mockCwSend })),
  GetMetricStatisticsCommand: jest.fn(input => input),
}));

import { AWSMonitorAgent } from '../../src/agents/aws-monitor';

const LAUNCH_14_DAYS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

function makeEc2Response(instances: object[]) {
  return { Reservations: [{ Instances: instances }] };
}

function makeCpuResponse(datapoints: { Average: number; Maximum: number }[]) {
  return { Datapoints: datapoints };
}

function makeNetResponse(sum: number) {
  return { Datapoints: [{ Sum: sum }] };
}

describe('AWSMonitorAgent.scan() (mocked)', () => {
  let agent: AWSMonitorAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new AWSMonitorAgent('eu-west-3', 14);
  });

  it('returns a MonitorSummary with correct region and scannedAt', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([]));
    const summary = await agent.scan();
    expect(summary.region).toBe('eu-west-3');
    expect(summary.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty instances and zero cost for an empty account', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([]));
    const summary = await agent.scan();
    expect(summary.instances).toHaveLength(0);
    expect(summary.totalMonthlyCostEur).toBe(0);
    expect(summary.findingsReady).toBe(0);
    expect(summary.findingsBuilding).toBe(0);
  });

  it('handles undefined Reservations gracefully', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: undefined });
    const summary = await agent.scan();
    expect(summary.instances).toHaveLength(0);
  });

  it('skips instances missing InstanceId or InstanceType', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: undefined, InstanceType: 't3.micro', State: { Name: 'running' } },
      { InstanceId: 'i-abc', InstanceType: undefined, State: { Name: 'running' } },
    ]));
    const summary = await agent.scan();
    expect(summary.instances).toHaveLength(0);
  });

  it('processes a running instance with CPU and network metrics', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-run',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    // Promise.all order: cpu, netIn, netOut
    mockCwSend
      .mockResolvedValueOnce(makeCpuResponse([{ Average: 0.5, Maximum: 1.2 }]))
      .mockResolvedValueOnce(makeNetResponse(512 * 1024)) // 0.5 MB in
      .mockResolvedValueOnce(makeNetResponse(256 * 1024)); // 0.25 MB out

    const summary = await agent.scan();
    const [inst] = summary.instances;
    expect(inst.instanceId).toBe('i-run');
    expect(inst.state).toBe('running');
    expect(inst.cpuAvgPercent).toBe(0.5);
    expect(inst.cpuMaxPercent).toBe(1.2);
    expect(inst.networkInMB).toBe(0.5);
    expect(inst.networkOutMB).toBe(0.25);
    expect(inst.datapointCount).toBe(1);
    expect(inst.hourlyCostEur).toBe(0.0116);
    expect(inst.monthlyCostEur).toBeGreaterThan(0);
  });

  it('does NOT query CloudWatch for stopped instances', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-stop',
      InstanceType: 't3.micro',
      State: { Name: 'stopped' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));

    const summary = await agent.scan();
    expect(mockCwSend).not.toHaveBeenCalled();
    const [inst] = summary.instances;
    expect(inst.state).toBe('stopped');
    expect(inst.cpuAvgPercent).toBe(0);
    expect(inst.confidence).toBe(0);
  });

  it('sets ageDays=0 when LaunchTime is null', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-notime',
      InstanceType: 't3.micro',
      State: { Name: 'stopped' },
      LaunchTime: undefined,
    }]));
    const summary = await agent.scan();
    expect(summary.instances[0].ageDays).toBe(0);
  });

  it('classifies high-confidence instances as findingsReady', async () => {
    const OLD = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000); // 13 days
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-high',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: OLD,
    }]));
    mockCwSend
      .mockResolvedValueOnce(makeCpuResponse([{ Average: 0.2, Maximum: 0.5 }]))
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    expect(summary.findingsReady).toBe(1);
    expect(summary.findingsBuilding).toBe(0);
  });

  it('classifies mid-confidence instances as findingsBuilding', async () => {
    const HALF = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-mid',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: HALF,
    }]));
    mockCwSend
      .mockResolvedValueOnce(makeCpuResponse([{ Average: 0.2, Maximum: 0.5 }]))
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    expect(summary.findingsBuilding).toBe(1);
    expect(summary.findingsReady).toBe(0);
  });

  it('detects periodic spikes and zeroes confidence', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-spiky',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    mockCwSend
      .mockResolvedValueOnce(makeCpuResponse([{ Average: 1.0, Maximum: 50.0 }]))
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    expect(summary.instances[0].hasPeriodicSpikes).toBe(true);
    expect(summary.instances[0].confidence).toBe(0);
  });

  it('totals monthly cost across all instances', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-a', InstanceType: 't3.micro', State: { Name: 'stopped' }, LaunchTime: LAUNCH_14_DAYS_AGO },
      { InstanceId: 'i-b', InstanceType: 't3.micro', State: { Name: 'stopped' }, LaunchTime: LAUNCH_14_DAYS_AGO },
    ]));
    const summary = await agent.scan();
    // t3.micro = €8.35/month, so 2 × 8.35 = 16.70
    expect(summary.totalMonthlyCostEur).toBeCloseTo(16.70, 1);
  });

  it('uses LaunchTime as query start when newer than lookback window', async () => {
    const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-new',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: RECENT,
    }]));
    mockCwSend
      .mockResolvedValueOnce(makeCpuResponse([{ Average: 0.1, Maximum: 0.2 }]))
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    expect(summary.instances[0].ageDays).toBeCloseTo(2, 0);
  });

  it('handles empty CPU datapoints for a running instance', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-nodata',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    mockCwSend
      .mockResolvedValueOnce({ Datapoints: [] })
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    const inst = summary.instances[0];
    expect(inst.cpuAvgPercent).toBe(0);
    expect(inst.cpuMaxPercent).toBe(0);
    expect(inst.datapointCount).toBe(0);
  });

  it('uses default region and lookbackDays when constructed with no arguments', async () => {
    const defaultAgent = new AWSMonitorAgent();
    expect(defaultAgent.region).toBe('eu-west-3');
    expect(defaultAgent.lookbackDays).toBe(14);
  });

  it('handles reservation with undefined Instances (r.Instances ?? [] branch)', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [{ Instances: undefined }] });
    const summary = await agent.scan();
    expect(summary.instances).toHaveLength(0);
  });

  it('falls back to "unknown" state when instance has no State field', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-nostate',
      InstanceType: 't3.micro',
      State: undefined,
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    const summary = await agent.scan();
    expect(summary.instances[0].state).toBe('unknown');
  });

  it('handles undefined Datapoints in CPU response (cpuRes.Datapoints ?? [] branch)', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-undefineddp',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    mockCwSend
      .mockResolvedValueOnce({ Datapoints: undefined })
      .mockResolvedValueOnce({ Datapoints: undefined })
      .mockResolvedValueOnce({ Datapoints: undefined });

    const summary = await agent.scan();
    const inst = summary.instances[0];
    expect(inst.datapointCount).toBe(0);
    expect(inst.networkInMB).toBe(0);
    expect(inst.networkOutMB).toBe(0);
  });

  it('defaults Average and Maximum to 0 when undefined in CPU datapoints', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([{
      InstanceId: 'i-nullavg',
      InstanceType: 't3.micro',
      State: { Name: 'running' },
      LaunchTime: LAUNCH_14_DAYS_AGO,
    }]));
    mockCwSend
      .mockResolvedValueOnce({ Datapoints: [{ Average: undefined, Maximum: undefined }] })
      .mockResolvedValueOnce(makeNetResponse(0))
      .mockResolvedValueOnce(makeNetResponse(0));

    const summary = await agent.scan();
    const inst = summary.instances[0];
    expect(inst.cpuAvgPercent).toBe(0);
    expect(inst.cpuMaxPercent).toBe(0);
  });
});
