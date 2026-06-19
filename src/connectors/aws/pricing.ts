// eu-west-3 (Paris), Linux, on-demand hourly rates in EUR
export const INSTANCE_HOURLY_COST_EUR: Record<string, number> = {
  't3.micro': 0.0116,
  't3.small': 0.0232,
  't3.medium': 0.0464,
  't3.large': 0.0928,
  'm5.large': 0.107,
  'm5.xlarge': 0.214,
  'm5.2xlarge': 0.428,
  'c5.large': 0.096,
  'c5.xlarge': 0.192,
  'r5.large': 0.140,
};

export function hourlyCostEur(instanceType: string): number {
  return INSTANCE_HOURLY_COST_EUR[instanceType] ?? 0;
}

export function monthlyCostEur(instanceType: string): number {
  return Math.round(hourlyCostEur(instanceType) * 24 * 30 * 100) / 100;
}
