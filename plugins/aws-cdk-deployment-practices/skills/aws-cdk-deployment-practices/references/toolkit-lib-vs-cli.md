# CDK Toolkit Library と CDK CLI のデフォルト挙動の差分

`@aws-cdk/toolkit-lib` (2025/5 GA) は TypeScript プログラム内に直接 CDK のデプロイ処理を埋め込めるライブラリ。`cdk deploy` の CLI を介さずに `Toolkit.deploy(...)` の形でデプロイできるが、**CDK CLI とデフォルト挙動が複数箇所で異なる**ため、既存 CDK プロジェクトを Toolkit Library に置き換えると静かに挙動が変わることがある。

## 検証バージョン (記事執筆時の参考値)

- CDK Library (`aws-cdk-lib`): 2.200.1
- CDK CLI (`aws-cdk`): 2.1018.1
- CDK Toolkit Library (`@aws-cdk/toolkit-lib`): 1.1.1

(あくまで検証時点。今後仕様変更の可能性あり)

## Toolkit Library の基本形

```typescript
import { Toolkit } from '@aws-cdk/toolkit-lib';

const toolkit = new Toolkit();
const cloudAssemblySource = await toolkit.fromAssemblyBuilder(async () => {
  const app = new cdk.App();
  new MyStack(app, 'MyStack');
  return app.synth();
});
await toolkit.deploy(cloudAssemblySource);
```

Cloud Assembly Source を作る方法は 3 種類 + Custom:

- `fromCdkApp('ts-node app.ts')` — 既存の CDK App コマンドから (**CLI 互換挙動**)
- `fromAssemblyBuilder(async () => app.synth())` — インラインで App を組む (**多くの差分あり**)
- `fromAssemblyDirectory('cdk.out')` — 既存の cdk.out から

複数操作 (deploy + list 等) を実行する場合は `await toolkit.synth(cloudAssemblySource)` の結果を使い回し、最後に `await cloudAssembly.dispose()` でロックファイルを解放する。

```typescript
const cloudAssembly = await toolkit.synth(cloudAssemblySource);
try {
  await toolkit.deploy(cloudAssembly, { /* options */ });
  await toolkit.list(cloudAssembly, { /* options */ });
} finally {
  await cloudAssembly.dispose();
}
```

## 差分一覧

| 項目 | CDK CLI | Toolkit Library デフォルト |
|---|---|---|
| `requireApproval` | `BROADENING` (IAM 変更で承認待ち) | `NEVER` (無確認で進行) |
| `outdir` (cdk.out の出力先) | プロジェクトルートの `cdk.out` | `fromAssemblyBuilder` だと **一時ディレクトリ** (`/private/var/folders/...` 等) |
| `cdk.json` の読込 (機能フラグ含む) | 自動で読まれる | `fromAssemblyBuilder` は **読まない** |
| `cdk.context.json` の読書 | 自動 | `fromAssemblyBuilder` は **読み書きしない** |

※ `fromCdkApp` の場合はデフォルトで CLI と同等に挙動する (`contextStore` に `CdkAppMultiContext` がデフォルトで設定されているため)。

## 1. requireApproval が NEVER

CDK CLI では IAM ポリシー削除のような変更があるとユーザーに承認を求める (`BROADENING` がデフォルト)。Toolkit Library では内部の `NonInteractiveIoHost` がユーザーとのやり取りを一切しないため、`Do you wish to deploy these changes` の表示と同時にデプロイが進む。

CI 用途で意図して `NEVER` にしているなら問題ないが、ローカル実行スクリプトを Toolkit Library で書き直すときに **危険な IAM 変更を見落とす** リスクがある。

## 2. outdir が一時ディレクトリ

`fromAssemblyBuilder` で何も指定しないと、cdk.out はプロジェクトルートではなく OS の一時ディレクトリに作られる。プロジェクトルートに出したい場合は明示する:

```typescript
await toolkit.fromAssemblyBuilder(
  async (_props) => {
    const app = cdkApp();
    return await app.synth();
  },
  {
    outdir: path.resolve(__dirname, '../cdk.out'),
  },
);
```

`cdk.out` を CI artifact にしたい場合は必須。

## 3. cdk.json が読まれない (機能フラグ未適用)

`cdk.json` の `context` に格納される **機能フラグ** (`@aws-cdk/aws-iam:minimizePolicies` 等) は、`fromAssemblyBuilder` では読まれない。

例: `@aws-cdk/aws-iam:minimizePolicies = true` がコミットされているプロジェクトで以下を書くと、

```typescript
role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: ['arn:aws:s3:::my-bucket/*'] }));
role.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: ['arn:aws:s3:::my-bucket/*'] }));
```

CDK CLI 経由なら 2 つの Statement が統合されて 1 つになるが、Toolkit Library の `fromAssemblyBuilder` だと **統合されず 2 つのまま** 出力される。

```json
"Statement": [
  { "Action": "s3:GetObject", "Effect": "Allow", "Resource": "arn:aws:s3:::my-bucket/*" },
  { "Action": "s3:PutObject", "Effect": "Allow", "Resource": "arn:aws:s3:::my-bucket/*" }
]
```

これは **既存 CDK プロジェクトを Toolkit Library に置き換えただけ** で生成物が変わることを意味する。回避策は次節。

## 4. cdk.context.json が読まれない

`Vpc.fromLookup` 等の context メソッドが書き込み・参照する `cdk.context.json` も、`fromAssemblyBuilder` ではデフォルトで読み書きされない。キャッシュが効かないので毎回 AWS SDK の呼び出しが走り、非決定性とデプロイ速度低下を両方踏む。

## 回避策: contextStore に CdkAppMultiContext を渡す

`cdk.json` / `cdk.context.json` を読み書きさせるには、第 2 引数の `contextStore` に `CdkAppMultiContext` を渡す。引数にはプロジェクトルート (`cdk.json` がある場所) のパスを指定する:

```typescript
import { CdkAppMultiContext } from '@aws-cdk/toolkit-lib';

await toolkit.fromAssemblyBuilder(
  async (_props) => {
    const app = cdkApp();
    return await app.synth();
  },
  {
    outdir: path.resolve(__dirname, '../cdk.out'),
    contextStore: new CdkAppMultiContext(path.resolve(__dirname, '..')),
  },
);
```

これで CLI 経由と同等に `cdk.json` の機能フラグが効き、`cdk.context.json` のキャッシュも読み書きされる。

## まとめ

- 新規で Toolkit Library を採用 → 上記差分を意識して `outdir` / `contextStore` を明示する
- 既存 CLI プロジェクトを Toolkit Library に置き換え → `fromCdkApp` を使うか、`fromAssemblyBuilder` の場合は `contextStore: new CdkAppMultiContext(...)` を必ず付ける
- IAM 変更を見逃したくないなら `requireApproval` を明示的に CDK CLI と同じ `BROADENING` に揃える検討も
