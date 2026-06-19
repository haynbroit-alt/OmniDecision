#!/usr/bin/env node

import { analyzeMultipleInstances } from '../analyzers/idle_ec2';
import { renderHTMLReport } from '../reports/html';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== 'scan') {
    console.log('Usage: omni scan [--demo]');
    process.exit(1);
  }

  const isDemo = process.argv.includes('--demo') || process.env.OMNIDECISION_DEMO === 'true';

  if (!isDemo) {
    console.error('No AWS connector configured. Use --demo flag or OMNIDECISION_DEMO=true.');
    process.exit(1);
  }

  const sampleInstances = [
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

  const findings = analyzeMultipleInstances(sampleInstances);
  const html = renderHTMLReport({ findings, generatedAt: new Date().toISOString(), accountId: 'demo' });

  const outputPath = path.join(process.cwd(), 'report.html');
  fs.writeFileSync(outputPath, html);

  console.log(`Findings detected: ${findings.length}`);
  console.log(`Report saved: ${outputPath}`);
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
