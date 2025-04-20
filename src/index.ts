import { CostExplorer } from '@aws-sdk/client-cost-explorer';
import { startOfMonth, endOfMonth, format, subDays } from 'date-fns';
import { Octokit } from '@octokit/rest';

interface CostByService {
  serviceName: string;
  amount: number;
  unit: string;
  previousAmount?: number;
  changePercentage?: number;
}

interface CostResult {
  costs: CostByService[];
  total: number;
  previousTotal: number;
  totalChangePercentage: number;
  startDate: string;
  endDate: string;
  categories: {
    [key: string]: {
      current: number;
      previous: number;
      changePercentage: number;
    };
  };
}

async function getCostsByService(): Promise<CostResult> {
  const costExplorer = new CostExplorer({});
  
  const now = new Date();
  const yesterday = subDays(now, 1);
  const twoDaysAgo = subDays(now, 2);

  // 今日の日付でのコスト取得
  const currentResponse = await costExplorer.getCostAndUsage({
    TimePeriod: {
      Start: format(yesterday, 'yyyy-MM-dd'),
      End: format(now, 'yyyy-MM-dd'),
    },
    Granularity: 'DAILY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  });

  // 前日のコスト取得
  const previousResponse = await costExplorer.getCostAndUsage({
    TimePeriod: {
      Start: format(twoDaysAgo, 'yyyy-MM-dd'),
      End: format(yesterday, 'yyyy-MM-dd'),
    },
    Granularity: 'DAILY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  });

  const costs: CostByService[] = [];
  let total = 0;
  let previousTotal = 0;

  // 現在のコストを処理
  const currentCosts = new Map<string, number>();
  if (currentResponse.ResultsByTime && currentResponse.ResultsByTime[0].Groups) {
    for (const group of currentResponse.ResultsByTime[0].Groups) {
      const amount = Number(group.Metrics?.UnblendedCost.Amount || 0);
      total += amount;
      currentCosts.set(group.Keys?.[0] || 'Unknown', amount);
    }
  }

  // 前日のコストを処理
  const previousCosts = new Map<string, number>();
  if (previousResponse.ResultsByTime && previousResponse.ResultsByTime[0].Groups) {
    for (const group of previousResponse.ResultsByTime[0].Groups) {
      const amount = Number(group.Metrics?.UnblendedCost.Amount || 0);
      previousTotal += amount;
      previousCosts.set(group.Keys?.[0] || 'Unknown', amount);
    }
  }

  // すべてのサービスを集計
  const allServices = new Set([...currentCosts.keys(), ...previousCosts.keys()]);
  for (const service of allServices) {
    const currentAmount = currentCosts.get(service) || 0;
    const previousAmount = previousCosts.get(service) || 0;
    const changePercentage = previousAmount === 0 
      ? (currentAmount === 0 ? 0 : 100)
      : ((currentAmount - previousAmount) / previousAmount) * 100;

    costs.push({
      serviceName: service,
      amount: currentAmount,
      previousAmount,
      changePercentage,
      unit: 'USD',
    });
  }

  // コストの降順でソート
  costs.sort((a, b) => b.amount - a.amount);

  // カテゴリー別にコストを集計
  const categories: CostResult['categories'] = {
    ec2: { current: 0, previous: 0, changePercentage: 0 },
    security: { current: 0, previous: 0, changePercentage: 0 },
    management: { current: 0, previous: 0, changePercentage: 0 },
    storage: { current: 0, previous: 0, changePercentage: 0 },
    other: { current: 0, previous: 0, changePercentage: 0 },
    tax: { current: 0, previous: 0, changePercentage: 0 },
  };

  for (const cost of costs) {
    const service = cost.serviceName.toLowerCase();
    const category = 
      service.includes('ec2') ? 'ec2' :
      ['guardduty', 'vpc', 'kms', 'cloudfront'].some(s => service.includes(s)) ? 'security' :
      ['cloudwatch', 'secrets manager'].some(s => service.includes(s)) ? 'management' :
      ['rds', 's3', 'dynamodb', 'glacier'].some(s => service.includes(s)) ? 'storage' :
      service.includes('tax') ? 'tax' : 'other';

    categories[category].current += cost.amount;
    categories[category].previous += cost.previousAmount || 0;
  }

  // カテゴリーごとの変化率を計算
  for (const category of Object.values(categories)) {
    category.changePercentage = category.previous === 0 
      ? (category.current === 0 ? 0 : 100)
      : ((category.current - category.previous) / category.previous) * 100;
  }

  const totalChangePercentage = previousTotal === 0 
    ? (total === 0 ? 0 : 100)
    : ((total - previousTotal) / previousTotal) * 100;

  return {
    costs,
    total,
    previousTotal,
    totalChangePercentage,
    startDate: format(yesterday, 'yyyy-MM-dd'),
    endDate: format(now, 'yyyy-MM-dd'),
    categories,
  };
}

async function createGitHubIssue(costResult: CostResult) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }
  if (!owner) {
    throw new Error('GITHUB_OWNER environment variable is not set');
  }
  if (!repo) {
    throw new Error('GITHUB_REPO environment variable is not set');
  }

  const octokit = new Octokit({ auth: token });

  const formatChangePercentage = (percentage: number) => {
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(1)}%`;
  };

  const issueBody = `# ${format(new Date(), 'yyyy年MM月dd日')} AWSコスト分析レポート

## 概要
- 期間：${costResult.startDate} 〜 ${costResult.endDate}
- 総コスト：${costResult.total.toFixed(2)} USD（前日比: ${formatChangePercentage(costResult.totalChangePercentage)}）

## カテゴリー別コスト
${Object.entries(costResult.categories)
  .sort(([, a], [, b]) => b.current - a.current)
  .map(([category, data]) => {
    const percentage = (data.current / costResult.total * 100).toFixed(1);
    return `### ${category.toUpperCase()}: ${data.current.toFixed(2)} USD (${percentage}%)
- 前日比: ${formatChangePercentage(data.changePercentage)}
- 前日の金額: ${data.previous.toFixed(2)} USD`;
  })
  .join('\n\n')}

## サービス別詳細（前日比較）
${costResult.costs
  .filter(cost => cost.amount > 0 || cost.previousAmount! > 0)
  .map(cost => 
    `- ${cost.serviceName}:
  - 現在: ${cost.amount.toFixed(4)} ${cost.unit}
  - 前日: ${cost.previousAmount?.toFixed(4)} ${cost.unit}
  - 変化率: ${formatChangePercentage(cost.changePercentage!)}`
  )
  .join('\n')}

## 分析と推奨事項

### 注目すべき変化
${costResult.costs
  .filter(cost => Math.abs(cost.changePercentage!) > 10 && cost.amount > 0.01)
  .map(cost => `- ${cost.serviceName}: ${formatChangePercentage(cost.changePercentage!)} の変化`)
  .join('\n')}

### コスト最適化の提案
1. **大きな増加が見られるサービス**
   - 上記の変化率の大きいサービスを重点的に確認
   - 想定外の使用がないか確認

2. **定期的な見直し**
   - 使用率の低いリソースの特定
   - 不要なリソースの削除

## 注意事項
- 上記の金額は推定値であり、確定額は月末の請求書で確認できます
- 為替レートにより日本円での金額は変動する可能性があります
- 前日比は日次の変動を示しており、月間の傾向とは異なる可能性があります`;

  await octokit.issues.create({
    owner,
    repo,
    title: `${format(new Date(), 'yyyy年MM月dd日')} AWSコスト分析レポート`,
    body: issueBody,
    labels: ['cost', 'monitoring', 'daily-report']
  });
}

async function main() {
  try {
    const result = await getCostsByService();
    
    // コスト情報をJSONとして出力
    console.log(JSON.stringify({
      summary: {
        period: {
          start: result.startDate,
          end: result.endDate,
        },
        totalCost: result.total.toFixed(2),
        previousTotalCost: result.previousTotal.toFixed(2),
        changePercentage: result.totalChangePercentage.toFixed(1),
        currency: 'USD',
      },
      categories: Object.entries(result.categories).map(([name, data]) => ({
        name,
        current: data.current.toFixed(2),
        previous: data.previous.toFixed(2),
        changePercentage: data.changePercentage.toFixed(1),
        percentage: ((data.current / result.total) * 100).toFixed(1),
      })),
      details: result.costs.map(cost => ({
        service: cost.serviceName,
        current: cost.amount.toFixed(4),
        previous: cost.previousAmount?.toFixed(4),
        changePercentage: cost.changePercentage?.toFixed(1),
        unit: cost.unit,
      })),
    }, null, 2));

    // GitHub Issueを作成
    await createGitHubIssue(result);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 