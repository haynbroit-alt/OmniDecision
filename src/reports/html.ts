import { Finding } from '../types/finding';

export interface ReportData {
  findings: Finding[];
  generatedAt: string;
  accountId?: string;
}

function eur(amount: number): string {
  return `${amount.toFixed(2)}€`;
}

function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function renderFindingCard(finding: Finding): string {
  const evidenceItems = finding.evidence.map(e => `<li>${e}</li>`).join('\n          ');
  return `
    <div class="finding">
      <div class="finding-header">
        <h2>${finding.title}</h2>
        <span class="risk risk-${finding.risk}">${finding.risk.toUpperCase()} RISK</span>
      </div>
      <div class="financial-impact">
        <p class="monthly-loss">Monthly loss: <strong>${eur(finding.financialImpact.monthlyLossEur)}</strong></p>
        <p>Annual loss: <strong>${eur(finding.financialImpact.annualLossEur)}</strong></p>
        <p>Confidence: <strong>${pct(finding.confidence)}</strong></p>
      </div>
      <div class="recommendation">
        <p>Recommended action: <strong>${finding.recommendedAction}</strong></p>
      </div>
      <div class="evidence">
        <h3>Evidence</h3>
        <ul>
          ${evidenceItems}
        </ul>
      </div>
    </div>`;
}

export function renderHTMLReport(data: ReportData): string {
  if (data.findings.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>OmniDecision Report</title></head>
<body>
  <h1>OmniDecision Report</h1>
  <p>No cost optimization opportunities found.</p>
  <p>Generated: ${data.generatedAt}</p>
</body>
</html>`;
  }

  const totalMonthlyLoss = data.findings.reduce(
    (sum, f) => sum + f.financialImpact.monthlyLossEur,
    0,
  );
  const totalAnnualLoss = totalMonthlyLoss * 12;
  const findingCards = data.findings.map(renderFindingCard).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OmniDecision Report</title>
  <style>
    body { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; }
    .summary { background: #fee; border: 2px solid #f00; padding: 1rem; margin-bottom: 2rem; border-radius: 4px; }
    .summary h2 { margin: 0 0 0.5rem; }
    .finding { border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; }
    .finding-header { display: flex; justify-content: space-between; align-items: center; }
    .monthly-loss { font-size: 1.25rem; color: #c00; }
    .risk { padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.8rem; font-weight: bold; }
    .risk-low { background: #efe; color: #080; }
    .risk-medium { background: #ffe; color: #880; }
    .risk-high { background: #fee; color: #c00; }
    footer { margin-top: 2rem; color: #888; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>OmniDecision — Cost Optimization Report</h1>
  <div class="summary">
    <h2>Total Monthly Loss: ${eur(totalMonthlyLoss)}</h2>
    <p>Annual loss: ${eur(totalAnnualLoss)}</p>
    <p>${data.findings.length} finding(s) detected</p>
  </div>
  ${findingCards}
  <footer>
    <p>Generated: ${data.generatedAt}</p>
    ${data.accountId ? `<p>Account: ${data.accountId}</p>` : ''}
  </footer>
</body>
</html>`;
}
