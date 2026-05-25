---
name: aws-cdk-deployment-practices
description: AWS CDK のデプロイ・複数環境管理・CI/CD パイプライン設計の場面で必ず使用する。「CDK のデプロイ構成どうしよう?」「dev/stg/prod をどう分ける?」「CI で cdk deploy をどう走らせる?」「cdk.context.json はコミットすべき?」「cdk.out って何?」「CDK Toolkit Library と CLI って何が違う?」などの相談に該当する。具体的には `bin/*.ts` の `new cdk.App()` / `new Stage()` 編集時、`cdk.json` / `cdk.context.json` 編集時、`.github/workflows/*.yml` などの CI/CD 設定編集時、`cdk synth` / `cdk deploy` / `cdk publish-assets` / `--app` オプションの使用検討時、`Vpc.fromLookup` などの context メソッドを書くとき、`@aws-cdk/toolkit-lib` の `Toolkit` / `fromAssemblyBuilder` / `fromCdkApp` を import するとき、静的スタック作成 ↔ 動的スタック作成 (`tryGetContext('stage')` で分岐) の選択を迷ったときに該当する。
---

# AWS CDK デプロイ・環境管理ベストプラクティス

AWS CDK のデプロイ方法・複数環境管理・CI/CD 構成には複数の選択肢があり、適切な選び方を間違えると「非決定的なデプロイ」「合成の冗長実行」「prod 環境の設定エラーが prod デプロイの段になって初めて発覚する」などの落とし穴を踏む。本 Skill は **「どの場面でどのプラクティスを採用すべきか / なぜ避けるべきか」** の判断基準を提供する。

## 前提となる思想

- **デプロイは決定的であるべき**: 同じコードからは同じ CloudFormation テンプレートが出るべき。AWS アカウントの状態(AMI 更新など)や合成タイミングで結果が変わるのは事故の元。
- **合成は 1 回だけ**: `cdk synth` 相当は 1 デプロイ実行あたり 1 回で済むよう構成する。複数回走ると環境差異混入・デプロイ時間増のリスク。
- **アセット build / publish と CloudFormation deploy は分離する**: Twelve-Factor App の「Build / Release / Run」と同じ思想。
- **CI/CD と開発者環境の両方を視野に**: 開発者個人環境の柔軟性と本番デプロイの厳格さのトレードオフは、選ぶアプローチによって変わる。

## 判断フロー (CDK プロジェクトを見たらまずこれ)

```text
CDK プロジェクトを見る
  │
  ├─ App entry (bin/*.ts) は静的 / 動的どちらの構成?
  │    ├─ 静的 (環境ごとに `new Stage()` / `new Stack()` を明示)        → 推奨
  │    └─ 動的 (`tryGetContext('stage')` で分岐し 1 つだけ new)         → ユースケースが合うときのみ
  │       → 判断材料は [references/static-vs-dynamic.md](references/static-vs-dynamic.md) の決定マトリックス
  │
  ├─ Stage Construct を使っているか?
  │    └─ No → 将来 Stack が増える可能性があれば最初から Stage 推奨
  │
  ├─ CI/CD で `cdk synth` と `cdk deploy` を分けているか?
  │    ├─ No (deploy ジョブで毎環境合成) → Synthesize once, deploy many に変える
  │    └─ Yes (一度 synth → cdk.out をアーティファクト化 → 各 env で --app cdk.out) → OK
  │       → [references/cdkout.md](references/cdkout.md) (cdk.out の中身と再利用方法)
  │
  ├─ アセットの build / publish はデプロイと一体になっているか?
  │    └─ Yes → `cdk publish-assets --unstable=publish-assets --app cdk.out` で分離検討
  │
  ├─ `cdk.context.json` はリポジトリにコミットされているか?
  │    ├─ No → コミットする (`.gitignore` から外す)
  │    └─ Yes (ただし `valueFromLookup` などで毎回最新が欲しい値がある) → `cdk context --reset` / `--clear` の運用
  │       → [references/cdk-context-json.md](references/cdk-context-json.md) (非決定性回避と合成 2 回走る挙動)
  │
  └─ デプロイ実行手段は何か?
       ├─ CDK CLI (`cdk deploy`)        → 普通のデフォルト挙動
       ├─ CDK Pipelines                 → Stage ベースで構成
       └─ CDK Toolkit Library (`@aws-cdk/toolkit-lib`) → 既存挙動と差分あり、要注意
          → [references/toolkit-lib-vs-cli.md](references/toolkit-lib-vs-cli.md)
            (requireApproval / outdir / cdk.json / cdk.context.json の読み書き挙動が CLI と異なる)
```

## 4 つのプラクティス使い所マトリクス

| プラクティス | やること | 推奨度 | 参照 |
|---|---|---|---|
| 1. 静的スタック作成 + Stage | 環境ごとに `new MyStage(app, 'Dev'/'Stg'/'Prod', ...)` を明示する | ★★★ 原則 (動的が合うケースを除く) | [references/static-vs-dynamic.md](references/static-vs-dynamic.md) |
| 2. Synthesize once, deploy many | CI で `cdk synth` → `cdk.out` を artifact 化 → 各 env ジョブで `cdk deploy --app cdk.out` | ★★★ CI/CD では原則 | [references/cdkout.md](references/cdkout.md) |
| 3. アセット publish と deploy の分離 | `cdk publish-assets --unstable=publish-assets --app cdk.out` を deploy ジョブの前段に挟む | ★★☆ 厳格な責務分離が必要なら | 下記「アセット publish 分離」セクション |
| 4. cdk.context.json をコミット | `cdk.context.json` を `.gitignore` に入れず Git で共有 | ★★★ ほぼ必須 | [references/cdk-context-json.md](references/cdk-context-json.md) |

## 1. 静的スタック作成 + Stage を使う

**推奨**:

```typescript
const app = new cdk.App();
new MyStage(app, 'Dev',  { ...getProps('Dev'),  env: { account: '111111111111', region: 'us-east-1' } });
new MyStage(app, 'Stg',  { ...getProps('Stg'),  env: { account: '222222222222', region: 'us-east-1' } });
new MyStage(app, 'Prod', { ...getProps('Prod'), env: { account: '333333333333', region: 'us-east-1' } });
```

- **メリット**: 全環境が 1 度の `cdk synth` で合成されるため、prod の設定エラーを dev デプロイ前に検出できる。CI/CD で `Synthesize once, deploy many` が可能になる。
- **動的が合うケース**: 共有 AWS アカウントで多数の個人環境を立てたい / 合成パフォーマンスが大規模アプリで深刻に問題になる。

ハイブリッド (Dev だけ動的個人環境を許容、Stg / Prod は静的) も有効。Dev では `cdk deploy -c owner=alice Dev/*` のように渡し、`Dev-${owner}` の Stage を作る。

詳細な決定マトリックスと移行手順は [references/static-vs-dynamic.md](references/static-vs-dynamic.md)。

### Stage に移行する際の注意点

非 Stage → Stage 移行では、`stackName` を明示指定しないとスタック名に `${stageName}-` プレフィックスが付き、新規スタック作成扱いになる (元スタックは残ったまま)。既存スタックを引き継ぐ場合は必ず指定する。

```typescript
new StackA(this, 'StackA', { stackName: `DevStackA`, ... });
```

また、Stage 移行で **論理 ID / 物理名が変わって個別リソースの置換が発生するケース**がある。代表例:

- **SecurityGroup** (`description` 未指定): `GroupDescription` (Replacement プロパティ) のデフォルトに `this.node.path` が入る
- **Provider** の WaiterStateMachine LogGroup (`isCompleteHandler` 指定時): 物理名 `logGroupName` に `this.node.addr` が使われる
- **Lambda の `addEventSource`** (`SqsEventSource` / `SnsEventSource` / `S3EventSource` 等): 内部の `Names.nodeUniqueId` 由来で論理 ID が変わる
- **RDS / Aurora** の `Credentials.fromGeneratedSecret`: Secret の論理 ID が `Names.uniqueId` で `overrideLogicalId`

Stage 移行や Construct パスが変わるリファクタの前は **CDK の合成 CloudFormation テンプレートに対するスナップショットテスト** で差分を確認すること。網羅的な一覧と CDK 内部コードでの原因は、同 marketplace `cdk-skills` の **`aws-cdk-implementation-tips`** Skill (`aws-cdk-pack` plugin で本 Skill と一緒に install 可) が扱う。

## 2. Synthesize once, deploy many

`cdk deploy` は内部で `cdk synth` 相当を毎回実行する。dev / stg / prod を別々の deploy ジョブで動かすと **環境ごとに合成**が走り、(a) 1 回目と 2 回目で結果が変わるリスク、(b) `cdk synth` 時に走るアセットの bundling 処理 (`NodejsFunction` の esbuild など) の重複実行、(c) 合成時間 × N、を招く。

> ※ **Docker イメージアセットのビルドは `cdk synth` では走らず、`cdk deploy` 時に実行される** (`cdk synth` で生成されるのは Dockerfile を含む `asset.<hash>/` だけ)。そのため Docker ビルドの実行回数は Synthesize once 化しても減らない (各 env の `cdk deploy` で都度走る)。Docker ビルドや S3 / ECR への publish を環境横断で 1 回にしたい場合は、後述の「3. アセット publish と deploy の分離」を併用する。

CI/CD では一度だけ `cdk synth` し、`cdk.out` をアーティファクト化して全 env で再利用する:

```yaml
jobs:
  synth:
    steps:
      - run: npx cdk synth
      - uses: actions/upload-artifact@v4
        with: { name: cdk-out, path: cdk.out }
  deploy-dev:
    needs: synth
    steps:
      - uses: actions/download-artifact@v4
        with: { name: cdk-out, path: cdk.out }
      - run: npx cdk deploy --app cdk.out --require-approval never Dev/*
  deploy-stg:
    needs: deploy-dev
    steps:
      - run: npx cdk deploy --app cdk.out --require-approval never Stg/*
  deploy-prod:
    needs: deploy-stg
    steps:
      - run: npx cdk deploy --app cdk.out --require-approval never Prod/*
```

`cdk.out` の中身 (`manifest.json` / 各スタックの `*.template.json` / `asset.<hash>/` 等) と再利用が成立する仕組みは [references/cdkout.md](references/cdkout.md)。

> ※ 上記は 2 (Synthesize once) のみ適用した最小例。**Lambda / ECS などアセット (S3 / ECR) を使うアプリ** では、`cdk deploy` 内でアセットの build / publish も毎環境走る。これは下記「3. アセットの build / publish とデプロイの分離」と整合しないため、3 も併用して `publish-assets` ジョブを synth と各 deploy の間に挟む構成を検討する。

## 3. アセットの build / publish とデプロイの分離

`cdk deploy` は CloudFormation デプロイの前に「アセットの build → publish (S3 / ECR upload)」も実行する。これを別ジョブに分離するメリット:

- **ビルド失敗とデプロイ失敗が独立**: 一時的なビルドエラーがデプロイ全体を巻き込まない
- **デプロイ失敗時のリトライが軽い**: アセットを再ビルドせずに済む
- **IAM 権限の最小化**: build ジョブと deploy ジョブで権限を分離
- **デプロイ時間短縮**: Docker ビルドなどの重い処理をデプロイの外に出せる
- **deploy ジョブで CDK CLI 不要**: AWS CLI による CloudFormation デプロイも選べる

CDK CLI 2.x には `cdk publish-assets` コマンドがある (2026 年 4 月時点で unstable、`--unstable=publish-assets` 付与が必要):

```yaml
publish-assets:
  needs: synth
  steps:
    - uses: actions/download-artifact@v4
      with: { name: cdk-out, path: cdk.out }
    - run: npx cdk publish-assets --unstable=publish-assets --app cdk.out --all

deploy-dev:
  needs: publish-assets
  steps:
    - run: npx cdk deploy --app cdk.out --require-approval never Dev/*
```

代替として **`cdk-assets`** ライブラリを直接使うアプローチもある。これは CDK CLI が内部でアセット publish に使っているライブラリで、CDK CLI とは別パッケージ (`cdk-assets`) として install して `npx cdk-assets publish ...` で呼び出す。CDK CLI に `cdk publish-assets` が追加される前から存在していた選択肢だが、別パッケージの依存と公式ドキュメントでの紹介の薄さから一般的ではなかった。**今は `cdk publish-assets` の利用を基本としつつ**、unstable オプションを避けたい / CDK CLI 自体を deploy 環境に置きたくないといったケースで `cdk-assets` を選ぶ余地がある。

## 4. cdk.context.json をコミットする

`Vpc.fromLookup` / `StringParameter.valueFromLookup` などの **context メソッド** は内部で AWS SDK を呼び出して値を取りに行き、結果を `cdk.context.json` に書き込む。これをコミットしないと:

- **非決定性**: AMI 最新版が出た瞬間に EC2 が置換される / アカウント状態の変化でデプロイ結果が変わる
- **合成が 2 回走る**: キャッシュがなければ 1 回目で missing 検出 → SDK 取得 → 2 回目の合成、というループ
- **AWS SDK 通信のオーバーヘッド**: 毎デプロイで Lookup が走る

→ **コミットする** (`.gitignore` から外す)。

例外: SSM パラメータストアなど **毎デプロイで最新値を取りたい** 値だけ context メソッドで参照しているケース。この場合は `cdk context --reset <key>` / `--clear` で都度クリアする運用にする。詳細と挙動の根拠は [references/cdk-context-json.md](references/cdk-context-json.md)。

## CDK Toolkit Library を使う場合の差分注意

`@aws-cdk/toolkit-lib` (2025/5 GA) で TS プログラム内に直接 CDK のデプロイ処理を埋め込むときは、**CDK CLI のデフォルト挙動と異なる点**に注意:

| 項目 | CDK CLI | Toolkit Library のデフォルト |
|---|---|---|
| `requireApproval` | `BROADENING` (IAM 変更で承認待ち) | `NEVER` (無確認で進行) |
| `outdir` (cdk.out の出力先) | プロジェクトルートの `cdk.out` | `fromAssemblyBuilder` だと一時ディレクトリ |
| `cdk.json` の読込 | 自動で読まれる | `fromAssemblyBuilder` は読まない (機能フラグ未適用) |
| `cdk.context.json` の読書 | 自動 | `fromAssemblyBuilder` は読み書きしない |

※ `fromCdkApp` の場合はデフォルトで CLI と同等に `cdk.json` / `cdk.context.json` を読み書きする。

既存 CDK プロジェクトを Toolkit Library に移行すると **機能フラグが効かなくなり挙動が変わる** ことがある。`fromAssemblyBuilder` を使う場合は `contextStore: new CdkAppMultiContext(path.resolve(__dirname, '..'))` を明示すること。詳細と最小再現コードは [references/toolkit-lib-vs-cli.md](references/toolkit-lib-vs-cli.md)。

## アンチパターン (やらないこと)

1. **CI/CD の各環境 deploy ジョブで `cdk deploy` を直接実行する**
   毎回 `cdk synth` 相当が走り、環境差異が混入するリスク。`--app cdk.out` で synth 済みアーティファクトを使うこと。

2. **`cdk.context.json` を `.gitignore` に入れる**
   非決定性とデプロイ速度低下の二重の損。例外は「全 Lookup が毎回最新を取りに行きたい SSM パラメータのみ」のときだけ。

3. **動的スタック作成 + 共有 AWS アカウントで個人スタックを立てるが、設定をハードコード**
   `stage` と `owner` を別 context として分けて受け取り、命名規則だけで個人スタックを動的生成する。

4. **Toolkit Library で `fromAssemblyBuilder` を使い、`contextStore` を未指定のまま既存 CDK プロジェクトを動かす**
   `cdk.json` の機能フラグや `cdk.context.json` のキャッシュが読まれず、IAM ポリシー統合などの挙動が静かに変わる。

## 関連ファイル

- [references/static-vs-dynamic.md](references/static-vs-dynamic.md) — 静的 / 動的の決定マトリックス、ユースケース別の選び方、移行手順
- [references/cdkout.md](references/cdkout.md) — `cdk.out` の構成要素、`--app` での再利用、CI/CD での artifact 化
- [references/cdk-context-json.md](references/cdk-context-json.md) — 非決定性回避、合成が 2 回走る挙動の根拠、`cdk context --reset` 運用、コミット例外
- [references/toolkit-lib-vs-cli.md](references/toolkit-lib-vs-cli.md) — `requireApproval` / `outdir` / `cdk.json` / `cdk.context.json` の挙動差分と回避策
