# AWS Cost Notifier MCP Server

AWSの月間コストを取得し、サービス別の内訳を表示するMCPサーバーです。
日次でコストの変動を監視し、前日比較のレポートをGitHub Issueとして自動作成します。

## 機能

- 日次のAWSコスト総額の取得
- サービス別のコスト内訳
- カテゴリー別のコスト集計（EC2、セキュリティ、管理、ストレージなど）
- 前日比較による変動の分析
- コスト情報のJSON形式での出力
- GitHub Issueへの自動レポート投稿

## セットアップ

1. リポジトリのクローン:
```bash
git clone https://github.com/yourusername/aws-cost-notifier-mcp-server.git
cd aws-cost-notifier-mcp-server
```

2. 依存パッケージのインストール:
```bash
npm install
```

3. 環境変数の設定:
   - `.env.example`を`.env`にコピー
   ```bash
   cp .env.example .env
   ```
   - `.env`ファイルを編集して必要な情報を設定
   ```
   # AWS Configuration
   AWS_PROFILE=default
   AWS_REGION=ap-northeast-1
   AWS_SDK_LOAD_CONFIG=1

   # GitHub Configuration
   GITHUB_TOKEN=your_github_token_here

   # Target Repository
   GITHUB_OWNER=your_organization_or_username
   GITHUB_REPO=your_repository_name
   ```

4. TypeScriptのビルド:
```bash
npm run build
```

## 使用方法

### MCPサーバーとして使用

1. `.cursor/mcp.json`に以下の設定を追加:
```json
{
  "mcpServers": {
    "aws-cost-notifier": {
      "command": "node",
      "args": [
        "/path/to/aws-cost-notifier-mcp-server/build/index.js"
      ],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "ap-northeast-1",
        "AWS_SDK_LOAD_CONFIG": "1",
        "GITHUB_TOKEN": "your_github_token",
        "GITHUB_OWNER": "your_organization_or_username",
        "GITHUB_REPO": "your_repository_name"
      }
    }
  }
}
```

2. AWS認証情報の設定:
- AWS CLIの設定が完了していること
- 適切なIAMポリシー（`ce:GetCostAndUsage`権限）が付与されていること

3. GitHub認証情報の設定:
- GitHubトークンに必要な権限:
  - `repo` スコープ（プライベートリポジトリの場合）
  - `public_repo` スコープ（パブリックリポジトリの場合）

### 実行

```bash
mcp aws-cost-notifier
```

## 出力形式

```json
{
  "summary": {
    "period": {
      "start": "2025-04-19",
      "end": "2025-04-20"
    },
    "totalCost": "32.14",
    "previousTotalCost": "31.98",
    "changePercentage": "+0.5",
    "currency": "USD"
  },
  "categories": [
    {
      "name": "ec2",
      "current": "22.97",
      "previous": "22.50",
      "changePercentage": "+2.1",
      "percentage": "71.5"
    }
  ],
  "details": [
    {
      "service": "Amazon Elastic Compute Cloud",
      "current": "21.7158",
      "previous": "21.2345",
      "changePercentage": "+2.3",
      "unit": "USD"
    }
  ]
}
```

## 注意事項

- コストは推定値であり、確定額は月末の請求書で確認してください
- AWS Cost Explorerの料金が発生する可能性があります
- 前日比は日次の変動を示しており、月間の傾向とは異なる可能性があります
- GitHubのAPI制限に注意してください 