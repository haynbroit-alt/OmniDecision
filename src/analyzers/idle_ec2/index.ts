import { Finding } from '../../types/finding';
import { calculateROI } from '../../roi';

export interface InstanceMetrics {
  instanceId: string;
  instanceType: string;
  region: string;
  cpuAveragePercent: number;
  networkBytesTotal: number;
  daysObserved: number;
  hourlyCostEur: number;
  hasPeriodicSpikes: boolean;
}

const CPU_IDLE_THRESHOLD_PERCENT = 2.0;
const FULL_CONFIDENCE_DAYS = 14;
const BASE_CONFIDENCE = 0.93;
const MIN_CONFIDENCE_THRESHOLD = 0.3;

export function calculateConfidence(metrics: InstanceMetrics): number {
  if (metrics.hasPeriodicSpikes) return 0;
  const dataRatio = Math.min(metrics.daysObserved / FULL_CONFIDENCE_DAYS, 1);
  return Math.round(BASE_CONFIDENCE * dataRatio * 100) / 100;
}

export function analyzeIdleEC2(metrics: InstanceMetrics): Finding | null {
  if (metrics.cpuAveragePercent >= CPU_IDLE_THRESHOLD_PERCENT) return null;
  if (metrics.hasPeriodicSpikes) return null;

  const confidence = calculateConfidence(metrics);
  if (confidence < MIN_CONFIDENCE_THRESHOLD) return null;

  const monthlyLossEur = Math.round(metrics.hourlyCostEur * 24 * 30 * 100) / 100;
  const roi = calculateROI(monthlyLossEur);

  return {
    id: `finding_${metrics.instanceId}_idle`,
    title: `Idle EC2 Instance (${metrics.instanceType}) - ${metrics.region}`,
    resource: {
      type: 'ec2',
      id: metrics.instanceId,
      region: metrics.region,
      instanceType: metrics.instanceType,
    },
    financialImpact: {
      monthlyLossEur,
      annualLossEur: roi.annualSavings,
    },
    confidence,
    recommendedAction: 'terminate',
    risk: 'low',
    evidence: [
      `CPU average: ${metrics.cpuAveragePercent}% over ${metrics.daysObserved} days (threshold: ${CPU_IDLE_THRESHOLD_PERCENT}%)`,
      `Network traffic: ${metrics.networkBytesTotal} bytes total`,
      `No periodic workload spikes detected`,
    ],
    roi,
    generatedAt: new Date().toISOString(),
  };
}

export function analyzeMultipleInstances(instances: InstanceMetrics[]): Finding[] {
  return instances
    .map(analyzeIdleEC2)
    .filter((f): f is Finding => f !== null);
}
