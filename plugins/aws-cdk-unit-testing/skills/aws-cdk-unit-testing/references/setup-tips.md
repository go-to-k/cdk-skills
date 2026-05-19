# テスト環境セットアップ Tips

CDK 単体テスト(`Template.fromStack`)で当たりやすい 2 点を扱う。

- 機能フラグ(`cdk.json` の `context`)が**テストでは反映されない** → 実環境とテストでテンプレート差分が出る
  - CDK 単体テストは **CDK CLI を通さず CDK App を直接呼ぶ**ため、CLI が読む `cdk.json` の context が効かない
- `NodejsFunction` などの **esbuild バンドルが毎テスト実行で走る** → テストが遅い
  - こちらは CLI/App の構造とは無関係。バンドルは synth の一部として実行されるため、`Template.fromStack` を呼ぶ度に走る

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

**CDK プロジェクトなら原則常に適用してよい**。副作用がなく(実環境と揃えるだけ)、コストもほぼゼロ。

`cdk init` 直後の時点で `cdk.json` には複数の機能フラグが書き込まれる。一方テストは `cdk.json` を読まないため、**プロジェクト作成直後から実環境とテストでテンプレートが乖離している**(手動でフラグを追加したかどうかは関係ない)。
よって「フラグを触ったか」で判定する意味は薄く、特に**スナップショットテストを採用しているなら入れておく**のが安全。

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
