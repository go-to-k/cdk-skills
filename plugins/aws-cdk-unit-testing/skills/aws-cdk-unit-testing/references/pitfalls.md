# CDK 単体テストで覚えておくべき落とし穴

## 個数チェックと自動生成リソース

まず前提として、**リソースの有無(`0` / `1`)を確認する用途の `resourceCountIs` は問題なし**。例えば「`isProd` 時のみ WAF が作られる」の検証で `resourceCountIs('AWS::WAFv2::WebACL', 1)` のように使うのは適切。

問題になるのは、**自動生成リソースを含む大きな数値を opaque に指定する**ケース。

CDK の L2 Construct はベストプラクティスに沿うため、または開発者体験向上のために、**Construct 内部で自動的にリソースを追加生成する**ことがある(例: Lambda Function を作ると LogGroup や IAM Role が自動生成される)。

```typescript
const template = Template.fromStack(stack);
template.resourceCountIs('AWS::Logs::LogGroup', 5);
```

このような個数チェックは、**自分で 5 個定義したつもりが実際は 6 個生成されていた**といったケースを引き起こしやすい。さらに、合わせて 6 を指定するとしても、後から見た時に「6 のうち 5 が自分の定義、1 が自動生成」という内訳が読み取れず**認知負荷が高い**。

### 対処パターン

#### (a) 個数チェックを捨てる

自動生成リソースの有無は**スナップショットの更新差分から確認可能**。よほど自動生成も含めた個数を保証したい状況でなければ、(有無 0/1 ではない)個数チェックを書かない選択肢が一番シンプル。

#### (b) `resourcePropertiesCountIs` でプロパティ絞り込み

**特定の命名規則・プロパティを持つリソースに絞った個数**を確認する。自動生成リソースは命名規則が違うため除外できる。

```typescript
template.resourcePropertiesCountIs(
  'AWS::Logs::LogGroup',
  {
    LogGroupName: Match.stringLikeRegexp('/aws/lambda/my-app/'),
  },
  5,
);
```

#### (c) どうしても合計個数で書くならコメントを残す

```typescript
// 内訳: 自分で定義した 5 個 + Lambda が自動生成する 1 個 = 6 個
template.resourceCountIs('AWS::Logs::LogGroup', 6);
```

## Construct ごとのテスト

カスタム Construct を作り、それを組み合わせて Stack を定義する場合、**Construct 単体のテスト**を書くことができる。空の Stack を作り、テスト対象 Construct のみを追加してテンプレートを検証する。

```typescript
import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MyConstruct } from '../lib/constructs/my-construct';

test('Construct Tests', () => {
  // 空のスタック
  const stack = new Stack();

  // テスト対象 Construct のみ追加
  new MyConstruct(stack, 'MyConstruct', {
    messageRetentionPeriodInDays: 10,
  });

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SNS::Topic', {
    ArchivePolicy: { MessageRetentionPeriod: 10 },
  });
});
```

**メリット**:
- 他の Construct の影響を受けず、責務に閉じたテストになる。
- Construct 単体の**信頼性・再利用性**を担保できる。
- テストファイルがシンプルになり**理解容易性**が上がる。

### 判断指針

- **全 Construct に網羅的に書くと辛い**。Stack のテストと重複してメンテコストが増える。
- 必ず書いておくべきは**実デプロイ構成である Stack のテスト**。Construct テストは補助的。
- **再利用性を特に担保したい Construct のみ**に絞って書くのがオススメ。
- 再利用しないなら Construct 単位テストは**書かない選択肢**もアリ。

## その他の注意

### 動機のないテストを書かない

- カバレッジを稼ぐためだけのテスト、宣言的な定義に対するハードコード値の二重定義(アンチパターン #1)、内訳の見えない大きな個数チェック(アンチパターン #2)などは避ける。
- テストの本数より、「**なぜこのテストがあるのか**」が説明できることを優先する。

### Match.absent / Match.anyValue を取り違えない

- `Match.absent()` — プロパティが**指定されていない**(キー自体がない)
- `Match.anyValue()` — プロパティが**指定されている**(値は問わない)
- 真逆なので注意。
