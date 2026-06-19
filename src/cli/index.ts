#!/usr/bin/env node

import { analyzeMultipleInstances, InstanceMetrics } from '../analyzers/idle_ec2';
import { renderHTMLReport } from '../reports/html';
import { AWSEC2Connector } from '../connectors/aws';
import { AWSMonitorAgent, formatMonitorTable } from '../agents/aws-monitor';
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

function requireAwsCredentials(): void {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error('Credentials manquantes. Définir AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.');
    process.exit(1);
  }
}

async function runScan(args: string[]): Promise<void> {
  const isDemo = args.includes('--demo') || process.env.OMNIDECISION_DEMO === 'true';
  const isVerbose = args.includes('--verbose') || args.includes('-v');

  let instanceMetrics: InstanceMetrics[];

  if (isDemo) {
    console.log('Mode démo...');
    instanceMetrics = DEMO_INSTANCES;
  } else {
    requireAwsCredentials();
    const region = process.env.AWS_REGION ?? 'eu-west-3';
    const lookbackDays = parseInt(process.env.OMNIDECISION_LOOKBACK_DAYS ?? '14', 10);
    console.log(`Scan AWS (${region}, ${lookbackDays}j de lookback)...`);
    const connector = new AWSEC2Connector(region, lookbackDays);
    instanceMetrics = await connector.listInstances();
    console.log(`Instances trouvées : ${instanceMetrics.length}`);
    if (isVerbose) {
      for (const m of instanceMetrics) {
        console.log(
          `  ${m.instanceId} (${m.instanceType}): ` +
          `CPU moy ${m.cpuAveragePercent}%, ` +
          `${m.daysObserved}j observés, ` +
          `spikes=${m.hasPeriodicSpikes}`
        );
      }
    }
  }

  const findings = analyzeMultipleInstances(instanceMetrics);
  const html = renderHTMLReport({ findings, generatedAt: new Date().toISOString() });

  const outputPath = path.join(process.cwd(), 'report.html');
  fs.writeFileSync(outputPath, html);

  console.log(`Findings : ${findings.length}`);
  if (findings.length === 0 && !isDemo) {
    console.log('→ Pas encore de findings. L\'instance a besoin de 4-5 jours de données CloudWatch.');
  }
  console.log(`Rapport : ${outputPath}`);
}

async function runMonitor(args: string[]): Promise<void> {
  requireAwsCredentials();
  const region = process.env.AWS_REGION ?? 'eu-west-3';
  const lookbackDays = parseInt(process.env.OMNIDECISION_LOOKBACK_DAYS ?? '14', 10);

  console.log(`Monitoring AWS (${region})...\n`);
  const agent = new AWSMonitorAgent(region, lookbackDays);
  const summary = await agent.scan();
  console.log(formatMonitorTable(summary));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'scan':
      await runScan(args.slice(1));
      break;
    case 'monitor':
      await runMonitor(args.slice(1));
      break;
    default:
      console.log('Usage:');
      console.log('  omni scan [--demo] [--verbose]   Génère un rapport de findings');
      console.log('  omni monitor                      Affiche l\'état complet du compte AWS');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
