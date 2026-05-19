# テスト環境セットアップ Tips

CDK 単体テスト(`Template.fromStack`)は **CDK CLI を通さず CDK App を直接呼ぶ**仕組みのため、実デプロイ時と挙動が変わる箇所がいくつかある。ここでは特に当たりやすい 2 点を扱う。

- 機能フラグ(`cdk.json` の `context`)が読まれない → **実環境とテストでテンプレート差分が出る**
- `NodejsFunction` などの esbuild バンドルが毎テスト実行で走る → **テストが遅い**

## 1. 機能フラグを実環境と統一する

### 何が起きるか

CDK の機能フラグは `cdk.json` の `context` に書く。これは CDK CLI が読み込む値で、**`Template.fromStack` で合成されるテンプレートには反映されない**。

例えば `cdk.json` で `@aws-cdk/aws-iam:minimizePolicies: true` を有効にしていても、テスト側ではこのフラグが無効として合成されるため、**実デプロイされるテンプレートとテストのスナップショットが食い違う**。

`minimizePolicies` 程度なら影響は小さいが、**処理の根幹を変える機能フラグもある**ため、信頼できるテストにするには揃えておきたい。

### 対処: cdk.json の context を App に注入

`cdk.json` を読み込んで `App` の props の `context` に渡すヘルパーを用意する。

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

const getContext = (): Record<string, any> => {
  const cdkJsonPath = path.join(__dirname, '..', 'cdk.json');
  const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
  return cdkJson.context ?? {};
};

const getTemplate = (): Template => {
  const app = new App({
    context: {
      ...getContext(),
    },
  });
  const stack = new MyStack(app, 'MyStack');
  return Template.fromStack(stack);
};
```

これで実デプロイ時と同じ機能フラグが効いた状態でテンプレートが合成される。スナップショットの信頼性が向上する。

### 適用判断

- `cdk.json` の `context` に **デフォルト以外の機能フラグが追加されている**(プロジェクト固有のオプトイン設定がある)
- 特に **スナップショットテスト**を採用しているプロジェクト
- 既存 CDK プロジェクトを長く運用していて、過去に `cdk.json` を手動でいじった履歴がある

該当しない(`cdk init` 直後で `cdk.json` を触っていない)場合は無理に入れる必要はない。

## 2. バンドル処理をスキップしてテストを高速化する

### 何が起きるか

`NodejsFunction` などは、CDK App の合成中に esbuild で Lambda コードをバンドルする。**単体テスト中もバンドルが走る**ため、関数数が多いとテストが体感で遅くなる。

※`bundling.forceDockerBundling: true` や `Code.fromDockerBuild()` のように **Docker バンドル**を使うケースでは、esbuild ではなく Docker が走る。後述のスキップ手段は効かない。

### 対処: BUNDLING_STACKS に空配列を渡す

`context` の `BUNDLING_STACKS` に空配列を指定すると、**全スタックの esbuild バンドルがスキップ**される。

```typescript
import { App } from 'aws-cdk-lib';
import { BUNDLING_STACKS } from 'aws-cdk-lib/cx-api';
import { Template } from 'aws-cdk-lib/assertions';

const getTemplate = (): Template => {
  const app = new App({
    context: {
      [BUNDLING_STACKS]: [],
    },
  });
  const stack = new MyStack(app, 'MyStack');
  return Template.fromStack(stack);
};
```

### 適用判断

採用すべき条件:

- `NodejsFunction`(または esbuild バンドル)を**複数使用していて**、テストが遅い
- Lambda コード自体のテストは**アプリケーション側のテストで別途行っている**(CDK テストでバンドルの妥当性を担保する必要がない)

採用しなくて良いケース:

- Docker バンドル(`forceDockerBundling: true` / `Code.fromDockerBuild()`)→ 効かない
- イメージアセット(`Code.fromAssetImage()` / `DockerImageFunction` / `DockerImageAsset`)→ **そもそも単体テストで Docker build は走らない**ので不要

### 補足: イメージアセットが単体テストで build されない理由

Lambda コードのバンドルは **CDK App 内**で走るが、イメージアセットの Docker build は **CDK CLI 側**で走る。単体テストは CDK CLI を通さず App を直接呼ぶため、Docker build はそもそも実行されない。

## 機能フラグ統一とバンドルスキップを併用する

両方適用したい場合、`context` をマージするだけ。

```typescript
const getTemplate = (): Template => {
  const app = new App({
    context: {
      ...getContext(),
      [BUNDLING_STACKS]: [],
    },
  });
  const stack = new MyStack(app, 'MyStack');
  return Template.fromStack(stack);
};
```
