# 静的 vs 動的スタック作成

CDK の `bin/*.ts` でスタック (Stage) をどう new するかの 2 つの主要パターン。

## アプローチ A: 動的スタック作成

`stage` コンテキストを受け取って分岐し、**1 回の `cdk deploy` で 1 つの環境だけを合成**する。

```typescript
const app = new cdk.App();
const stage = app.node.tryGetContext('stage') || 'dev';

let config: EnvironmentConfig;
switch (stage) {
  case 'dev':  config = { account: '111111111111', instanceType: 't3.micro', ... }; break;
  case 'prod': config = { account: '222222222222', instanceType: 'm5.large', ... }; break;
  default:     throw new Error(`Unknown stage: ${stage}`);
}

new ApplicationStack(app, `MyApp-${stage}`, {
  env: { account: config.account, region: 'us-east-1' },
  config,
});
```

実行: `cdk deploy -c stage=dev` / `cdk deploy -c stage=prod`。

## アプローチ B: 静的スタック作成

全環境のスタックを **同じ `cdk.App` 内に new** する。`cdk synth` で全環境の CloudFormation テンプレートが一度に生成される。

```typescript
const app = new cdk.App();

new ApplicationStack(app, 'MyApp-dev',  { env: { account: '111111111111', region: 'us-east-1' }, config: { instanceType: 't3.micro', ... } });
new ApplicationStack(app, 'MyApp-prod', { env: { account: '222222222222', region: 'us-east-1' }, config: { instanceType: 'm5.large', ... } });
```

デプロイ対象は `cdk deploy MyApp-prod` のようにスタック名で指定。

## トレードオフ比較

| 観点 | A: 動的 | B: 静的 |
|---|---|---|
| エラー検出 | 該当環境を `cdk synth` するまで気付かない | 1 度の `cdk synth` で全環境を検証 (prod の設定エラーを dev デプロイ前に検出可能) |
| `Synthesize once, deploy many` | 不可 (環境ごとに合成) | **可能** (1 回の `cdk.out` を全環境で再利用) |
| 個人開発環境 | 共有アカウントで `-c stage=alice` で複数開発者が独立スタックを立てやすい | 個人ごとに `new` を書く必要あり (ハイブリッドで Dev だけ動的にする手も) |
| マルチアカウントの明示性 | switch 分岐の中に埋もれがち | `env: { account: ... }` がコード上で並ぶ |
| 合成パフォーマンス | 必要な環境のみ合成 (大規模時に有利) | 全環境合成のため `cdk synth` は遅くなる |
| 環境間依存関係 | 表現しづらい | スタック参照で明示的に表現可能 |

## 決定マトリックス

| 動的を選ぶ場合 | 静的を選ぶ場合 |
|---|---|
| 多数の一時的な開発者環境が必要 | 固定の環境セット (dev/stg/prod) で十分 |
| 共有 AWS アカウントで個人スタックを多数立てる | マルチアカウントで明示的にアカウント境界を示したい |
| 合成パフォーマンスが大規模アプリで深刻 | 環境間のデプロイ決定性が重要 |
| 実行時の柔軟性を重視 | エンタープライズ / コンプライアンス要件あり |

## チームへの質問チェックリスト

1. 一時的な環境が無制限に必要か、固定の環境セットか?
2. デプロイの決定性と開発の柔軟性・合成パフォーマンス、どちらを優先するか?
3. 環境間に依存関係があるか?
4. チームの CDK / TypeScript 経験レベルは?

## ハイブリッド (Dev だけ動的 + Stg/Prod は静的)

共有 Dev アカウントで個人環境を持ちつつ、Stg / Prod は決定性を保つ:

```typescript
const app = new cdk.App();
const owner = app.node.tryGetContext('owner');
const devStageName = owner ? `Dev-${owner}` : 'Dev';

new MyStage(app, devStageName, { ...getProps('Dev'),  env: { account: '111111111111', region: 'us-east-1' } });
new MyStage(app, 'Stg',         { ...getProps('Stg'),  env: { account: '222222222222', region: 'us-east-1' } });
new MyStage(app, 'Prod',        { ...getProps('Prod'), env: { account: '333333333333', region: 'us-east-1' } });
```

`cdk deploy -c owner=alice Dev/*` のようにオーナーを渡す。

## 動的 → 静的の移行手順

1. switch 内に書かれた env-config を Record / Map として外に抽出する
2. 抽出した config で **同じスタック名** を使って静的に new し直す (スタック名を変えると新規作成扱いになる)
3. 古い `tryGetContext('stage')` と switch 文を削除
4. `cdk diff --all` (もしくは `cdk diff MyApp-prod` 等) を実行し、**全環境で差分が出ないこと** を確認する
5. 差分ゼロなら移行完了

```typescript
const configs = {
  dev:  { account: '111111111111', region: 'us-east-1', ... },
  prod: { account: '222222222222', region: 'us-east-1', ... },
};

new ApplicationStack(app, 'MyApp-dev',  { env: { account: configs.dev.account,  region: configs.dev.region  }, ...configs.dev  });
new ApplicationStack(app, 'MyApp-prod', { env: { account: configs.prod.account, region: configs.prod.region }, ...configs.prod });
```

## Lookup の置き場所に関する注意

どちらのアプローチでも、`Vpc.fromLookup` などの **context メソッドは Stack 内の条件分岐の中で呼ばない**。最終的な合成より前に解決され、`cdk.context.json` にキャッシュされるべきもの。

```typescript
// ❌ 条件分岐内で Lookup
if (stage === 'prod') {
  const vpc = Vpc.fromLookup(this, 'VPC', { vpcId: 'vpc-123' });
}

// ✅ Stack の外で vpcId を確定し、Stack 内では引数受け取りで Lookup
const vpc = Vpc.fromLookup(this, 'VPC', { vpcId: props.vpcId });
```
