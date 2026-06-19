#!/usr/bin/env node

import { analyzeMultipleInstances, InstanceMetrics } from '../analyzers/idle_ec2';
import { renderHTMLReport } from '../reports/html';
import { AWSEC2Connector } from '../connectors/aws';
import * as fs from 'fs';
import * as path from 'path';

const DEMO_INSTANCES: InstanceMetrics[] = [
  {
    instanceId: 'i-demo001',
    instanceType: 'm5.large',
    region: 'eu-west-1',
    cpuAveragePercent: 0.8,
    networkBytesTotal: 0,
    daysObserved: 14,
    hourlyCostEur: 0.096,
    hasPeriodicSpikes: false,
  },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const isDemo = args.includes('--demo') || process.env.OMNIDECISION_DEMO === 'true';
  const isVerbose = args.includes('--verbose') || args.includes('-v');

  if (command !== 'scan') {
    console.log('Usage: omni scan [--demo] [--verbose]');
    process.exit(1);
  }

  let instanceMetrics: InstanceMetrics[];

  if (isDemo) {
    console.log('Running in demo mode...');
    instanceMetrics = DEMO_INSTANCES;
  } else if (process.env.AWS_ACCESS_KEY_ID) {
    const region = process.env.AWS_REGION ?? 'eu-west-3';
    const lookbackDays = parseInt(process.env.OMNIDECISION_LOOKBACK_DAYS ?? '14', 10);
    console.log(`Scanning AWS (${region}, ${lookbackDays}d lookback)...`);
    const connector = new AWSEC2Connector(region, lookbackDays);
    instanceMetrics = await connector.listInstances();
    console.log(`Instances found: ${instanceMetrics.length}`);
    if (isVerbose) {
      for (const m of instanceMetrics) {
        console.log(
          `  ${m.instanceId} (${m.instanceType}): ` +
          `CPU avg ${m.cpuAveragePercent}%, ` +
          `${m.daysObserved} days observed, ` +
          `spikes=${m.hasPeriodicSpikes}`
        );
      }
    }
  } else {
    console.error('No credentials. Use --demo or set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.');
    process.exit(1);
  }

  const findings = analyzeMultipleInstances(instanceMetrics);
  const html = renderHTMLReport({ findings, generatedAt: new Date().toISOString() });

  const outputPath = path.join(process.cwd(), 'report.html');
  fs.writeFileSync(outputPath, html);

  console.log(`Findings: ${findings.length}`);
  if (findings.length === 0 && !isDemo) {
    console.log('→ No findings yet. Instance may need more time to accumulate CloudWatch data.');
    console.log('  Confidence threshold requires ~4-5 days of idle data.');
  }
  console.log(`Report: ${outputPath}`);
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
