# スナップショットテスト

## 概要

CDK コードから合成される CloudFormation テンプレートを出力し、以前のテスト実行時に生成したテンプレートと比較して**差分を検出**するテスト。

## 基本形

テストファイルは `cdk init` で生成される `test/` ディレクトリ配下に `my-stack.test.ts` として配置するのが一般的。

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MyStack } from '../lib/my-stack';

describe('MyStack Tests', () => {
  test('Snapshot Tests', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack');

    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
```

## 運用フロー

1. `npm run test` で実行 → 初回は `test/__snapshots__/my-stack.test.ts.snap` が作成される。
2. 2 回目以降は前回のスナップショットと比較し、差分があれば**テスト失敗**。
3. 差分が**意図したもの**なら `npx jest --updateSnapshot` でスナップショットを更新する。

## 使い所(3 つ)

### 1. AWS CDK のバージョンアップデート

CDK ライブラリのバージョン更新で、生成される CloudFormation テンプレートが変わることがまれにある。スナップショットテストが green なら**デプロイ済みリソースへの影響がないことを保証できる**。

CDK の OSS 側でも破壊的変更を防ぐ仕組みはあるが、ユーザー側でも検知できるようにしておくのが安全。

### 2. CDK コードのリファクタリング

リファクタリング前後でテンプレートが変わらないことを確認できる。CDK のリファクタは「挙動 = テンプレート」が同じであることが要件なので、スナップショットがそのまま回帰テストになる。

### 3. バージョン管理システムでの差分管理

スナップショットファイルを Git にコミットしておくと、PR レビュー時に **CloudFormation テンプレート粒度の差分**が可視化される。CDK コード上ではわかりづらい思わぬ変更も拾える。

## 判断指針

- 開発初期(構成が固まっていない時期)を除けば**ほぼ必須**。
- まず最初に導入すべきテスト。これだけでも CDK のリグレッション検知に強力に効く。
