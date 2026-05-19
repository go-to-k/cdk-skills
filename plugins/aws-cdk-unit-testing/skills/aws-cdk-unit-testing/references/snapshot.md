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

## TIPS: アセット差分を無視する

Lambda コードや Docker イメージなどのアセットは、CloudFormation テンプレートに**コンテンツハッシュ(SHA-256 / 64 桁 hex)**として埋め込まれる。例えば:

- Lambda アセット → `S3Key: "abc123...def.zip"`
- Docker イメージアセット → ECR URI のタグ `...:abc123def...`

CDK のデフォルトのハッシュ計算方式(`AssetHashType.SOURCE`)では**ソースの内容**を fingerprint するので、コードに変更がなければハッシュは変わらない。一方 `AssetHashType.OUTPUT`(bundling 後の出力ディレクトリをハッシュする方式)を指定している場合、ビルドが非決定的だとソース不変でも hash が変わり得る点には注意(出力に埋め込まれる build ID / タイムスタンプ、`RUN apt-get update` を含む Docker bundling、依存解決の揺らぎ など)。

「アセット内容の差分は別レビューフローで管理しているので、スナップショットではテンプレート構造の差分だけに集中したい」というニーズがある場合、Jest のスナップショットシリアライザーで 64 桁 hex 部分をマスクできる(Lambda / Docker のどちらも同じ正規表現で拾える)。

登録方法は 2 通り。

**方法 A: `expect.addSnapshotSerializer` を呼ぶ**

`expect` が使える場所ならどこからでも登録できる。具体的には:

- **テストファイル内**(トップレベル、`beforeAll`、`describe` 内 など) — そのファイルだけに効かせたい場合に手軽
- **Jest のセットアップファイル**(任意のパス、慣例的に `test/setup.ts` や `jest.setup.ts` などとし、`jest.config` の `setupFilesAfterEnv` で読み込ませる) — プロジェクト全体に効かせたい場合

```typescript
// 例: my-stack.test.ts のトップレベルに直接書く
expect.addSnapshotSerializer({
  test: (val) => typeof val === 'string' && /([A-Fa-f0-9]{64})/.test(val),
  serialize: (val) => `"${val.replace(/([A-Fa-f0-9]{64})/g, '[HASH REMOVED]')}"`,
});
```

**方法 B: `jest.config` の `snapshotSerializers` でモジュールとして指定**

シリアライザーを独立したモジュールに切り出し、config から参照する。プロジェクト全体で常に効かせたい場合は、方法 A のセットアップファイル経由よりこちらの方が宣言的で見通しが良い。

```typescript
// test/serializers/asset-hash.ts
// 注: TS でも `export default {...}` ではなく `module.exports = {...}` を使う。
// ts-jest コンパイル後の `require()` 結果が { __esModule: true, default: {...} } に
// なってしまい、Jest の serializer ローダーがプラグイン形状として認識できないため。
module.exports = {
  test: (val: unknown) => typeof val === 'string' && /([A-Fa-f0-9]{64})/.test(val),
  serialize: (val: string) => `"${val.replace(/([A-Fa-f0-9]{64})/g, '[HASH REMOVED]')}"`,
};
```

```javascript
// jest.config.js
module.exports = {
  snapshotSerializers: ['<rootDir>/test/serializers/asset-hash.ts'],
};
```

⚠️ **注意**: アセット内容の変更もスナップショット上は差分として現れなくなる。これは後述「使い所 §3 (PR レビュー時の差分可視化)」と相反するため、**推奨ではなく選択肢のひとつ**として扱う。チームの運用方針(アセット差分をどこで担保するか)を踏まえて採用を判断する。

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
