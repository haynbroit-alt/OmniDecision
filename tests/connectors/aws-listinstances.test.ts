// Mocked unit tests for AWSEC2Connector.listInstances()
// These bypass real AWS credentials by mocking the SDK clients.

const mockEc2Send = jest.fn();
const mockCwSend = jest.fn();

jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: jest.fn(() => ({ send: mockEc2Send })),
  DescribeInstancesCommand: jest.fn(input => input),
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: mockCwSend })),
  GetMetricStatisticsCommand: jest.fn(input => input),
  Datapoint: {},
}));

import { AWSEC2Connector } from '../../src/connectors/aws';

const LAUNCH_14_DAYS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

function makeEc2Response(instances: object[]) {
  return { Reservations: [{ Instances: instances }] };
}

function makeCwResponse(datapoints: object[]) {
  return { Datapoints: datapoints };
}

describe('AWSEC2Connector.listInstances() (mocked)', () => {
  let connector: AWSEC2Connector;

  beforeEach(() => {
    jest.clearAllMocks();
    connector = new AWSEC2Connector('eu-west-3', 14);
  });

  it('returns empty array when no running instances', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([]));
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('returns empty array when reservations is undefined', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: undefined });
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('skips instances missing InstanceId or InstanceType', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-abc', InstanceType: undefined, LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
      { InstanceId: undefined, InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('skips instances with no CloudWatch datapoints', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-abc', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([]));
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('returns correct metrics for a normal running instance', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-abc', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([
      { Average: 0.5, Maximum: 1.0 },
      { Average: 1.5, Maximum: 2.0 },
    ]));
    const [instance] = await connector.listInstances();
    expect(instance.instanceId).toBe('i-abc');
    expect(instance.instanceType).toBe('t3.micro');
    expect(instance.cpuAveragePercent).toBe(1); // (0.5 + 1.5) / 2
    expect(instance.hasPeriodicSpikes).toBe(false);
    expect(instance.hourlyCostEur).toBe(0.0116);
  });

  it('caps daysObserved at lookbackDays for old instances', async () => {
    const oldLaunch = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-old', InstanceType: 't3.micro', LaunchTime: oldLaunch, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([{ Average: 0.2, Maximum: 0.5 }]));
    const [instance] = await connector.listInstances();
    expect(instance.daysObserved).toBe(14);
  });

  it('uses LaunchTime as observation start for new instances', async () => {
    const newLaunch = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-new', InstanceType: 't3.micro', LaunchTime: newLaunch, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([{ Average: 0.1, Maximum: 0.3 }]));
    const [instance] = await connector.listInstances();
    expect(instance.daysObserved).toBeCloseTo(2, 0);
  });

  it('uses lookbackStart when instance has no LaunchTime', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-notime', InstanceType: 'm5.large', LaunchTime: undefined, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([{ Average: 0.3, Maximum: 0.8 }]));
    const [instance] = await connector.listInstances();
    expect(instance.daysObserved).toBeCloseTo(14, 0);
  });

  it('detects periodic spikes when max > 10× average and max > 20', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-spiky', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([
      { Average: 1.0, Maximum: 50.0 },
    ]));
    const [instance] = await connector.listInstances();
    expect(instance.hasPeriodicSpikes).toBe(true);
  });

  it('does not flag spikes when max ≤ 10× average', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-steady', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([
      { Average: 5.0, Maximum: 40.0 },
    ]));
    const [instance] = await connector.listInstances();
    expect(instance.hasPeriodicSpikes).toBe(false);
  });

  it('does not flag spikes when max > 10× average but max ≤ 20', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-low', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([
      { Average: 1.0, Maximum: 15.0 }, // max > 10× avg but max ≤ 20
    ]));
    const [instance] = await connector.listInstances();
    expect(instance.hasPeriodicSpikes).toBe(false);
  });

  it('handles a reservation with undefined Instances (r.Instances ?? [] branch)', async () => {
    mockEc2Send.mockResolvedValueOnce({ Reservations: [{ Instances: undefined }] });
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('handles undefined Datapoints in CloudWatch response', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-abc', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce({ Datapoints: undefined });
    const result = await connector.listInstances();
    expect(result).toEqual([]);
  });

  it('defaults Average and Maximum to 0 when undefined in datapoints', async () => {
    mockEc2Send.mockResolvedValueOnce(makeEc2Response([
      { InstanceId: 'i-nulldata', InstanceType: 't3.micro', LaunchTime: LAUNCH_14_DAYS_AGO, State: { Name: 'running' } },
    ]));
    mockCwSend.mockResolvedValueOnce(makeCwResponse([{ Average: undefined, Maximum: undefined }]));
    const [instance] = await connector.listInstances();
    expect(instance.cpuAveragePercent).toBe(0);
    expect(instance.hasPeriodicSpikes).toBe(false);
  });
});
