# Fine-grained assertions テスト

## 概要

生成された CloudFormation テンプレートの**一部を取り出して**チェックを行うテスト。「どんなリソースが生成されるか」「どのプロパティに何が設定されているか」を細かい粒度で検証できる。

## 基本形

```typescript
import { App, assertions } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MyStack } from '../lib/my-stack';

const getTemplate = (): assertions.Template => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack');
  return Template.fromStack(stack);
};

describe('Fine-grained assertions tests', () => {
  test('Lambda has nodejs20.x', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'handler',
      Runtime: 'nodejs20.x',
    });
  });
});
```

## 重要な思想

- CDK は**宣言的に書く**のが基本。「`new Bucket(this, 'Bucket')`」と書けば Bucket が作られるのは自明。
- 自明な宣言的定義に対して `hasResourceProperties` を書くと、**リソース定義側とほぼ同じコード**がテストに出来上がり、二重定義の煩わしさを生む。
- そのため Fine-grained テストは「**自明でない部分**」に絞って書く。

## 書くべき 5 つの使い所

### 1. ループ処理

ループ処理によるリソース生成は**手続き的**になり、何が生成されるか自明でない。ループの正しさを保証するテストを書く。

```typescript
// CDK コード側
export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    // 重複を許容して一意な組み合わせにする
    const appNames = new Set(props.appNames);

    for (const appName of appNames) {
      new Topic(this, `${appName}Topic`, {
        displayName: `${appName}Topic`,
      });
    }
  }
}
```

```typescript
// テスト側
test('SNS Topics are created', () => {
  const appNames = ['App1', 'App1', 'App2'];
  const expectedNumberOfTopics = 2;  // 重複排除されるので 2

  const app = new App();
  const stack = new MyStack(app, 'MyStack', { appNames });
  const template = Template.fromStack(stack);

  template.resourcePropertiesCountIs(
    'AWS::SNS::Topic',
    { DisplayName: Match.stringLikeRegexp('Topic') },
    expectedNumberOfTopics,
  );
});
```

**ポイント**:
- `resourcePropertiesCountIs` で「特定プロパティを持つリソースの個数」を確認できる。
- 単純な `resourceCountIs` だと自動生成リソースに引っかかる可能性があるため、プロパティで絞り込むと安全 ([pitfalls.md](pitfalls.md) 参照)。

### 2. 条件分岐

`if` による生成有無やプロパティ指定有無の分岐は、両分岐を確認する。

#### (a) リソース自体を分岐する場合

```typescript
// CDK コード
if (props.isProd) {
  new CfnWebACL(this, 'WebAcl', { /* ... */ });
}
```

```typescript
// テスト
test('Web ACL is created in prod', () => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack', { isProd: true });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
});
```

#### (b) プロパティの指定を分岐する場合 — `Match.absent`

「指定されていないこと」を確認する場合は `Match.absent()` を使う。

```typescript
// CDK コード
new Distribution(this, 'Distribution', {
  webAclId: props.isProd ? webAclId : undefined,
});
```

```typescript
// テスト
test('Web ACL is not associated in dev', () => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack', { isProd: false });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      WebACLId: Match.absent(),
    },
  });
});
```

### 3. プロパティの override(エスケープハッチ)

`addPropertyOverride` 等で L1 にキャストして上書きする場合、**Construct の型補完が効かず**手書きになり、特に階層構造のプロパティでミスしやすい。意図通り反映されているかを確認する。

```typescript
// CDK コード
const bucket = new Bucket(this, 'Bucket');
const cfnSrcBucket = bucket.node.defaultChild as CfnBucket;
cfnSrcBucket.addPropertyOverride(
  'NotificationConfiguration.EventBridgeConfiguration.EventBridgeEnabled',
  true,
);
```

```typescript
// テスト
test('EventBridge is enabled', () => {
  const template = getTemplate();
  template.hasResourceProperties('AWS::S3::Bucket', {
    NotificationConfiguration: {
      EventBridgeConfiguration: { EventBridgeEnabled: true },
    },
  });
});
```

### 4. 特に保証したい定義(意思表示)

宣言的な定義であっても、要件上「絶対にこのプロパティはこうあってほしい」という設計意図がある場合、**「意思表示」としてテストを書く**。後の開発者が変更してテストが落ちることで、元の設計意図が伝搬する。

```typescript
// CDK コード
new Bucket(this, 'Bucket', {
  lifecycleRules: [{ expiration: cdk.Duration.days(100) }],
});
```

```typescript
// 具体値も保証する場合
test('Expiration for lifecycle must be specified', () => {
  const template = getTemplate();
  template.hasResourceProperties('AWS::S3::Bucket', {
    LifecycleConfiguration: {
      Rules: [{ ExpirationInDays: 100, Status: 'Enabled' }],
    },
  });
});
```

**メンテコストを下げたい場合は `Match.anyValue`** — 「指定されていること」だけを確認する:

```typescript
template.hasResourceProperties('AWS::S3::Bucket', {
  LifecycleConfiguration: {
    Rules: [{ ExpirationInDays: Match.anyValue(), Status: 'Enabled' }],
  },
});
```

#### 依存関係(`addDependency`)も同様

```typescript
// CDK コード
hostedZone.node.addDependency(resourcePolicy);
```

```typescript
// テスト
test('HostedZone depends on QueryLogResourcePolicy', () => {
  const template = getTemplate();
  template.hasResource('AWS::Route53::HostedZone', {
    DependsOn: [Match.stringLikeRegexp('QueryLogResourcePolicy')],
  });
});
```

`hasResource` (not `hasResourceProperties`) を使うのは `DependsOn` がリソースのトップレベル属性のため。

### 5. props を使った値の指定

props 経由で値を流す場合、**渡し忘れ**を検知するためにテストを書く。

```typescript
// シンプルなパターン
test('messageRetentionPeriodInDays from props', () => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack', { messageRetentionPeriodInDays: 10 });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SNS::Topic', {
    ArchivePolicy: { MessageRetentionPeriod: 10 },
  });
});
```

#### 実 props をそのまま使うパターン(推奨)

実際にデプロイされる構成をテストできる + 具体値の二重管理を避けられる。

```typescript
import { myStackProps } from '../lib/config';

test('messageRetentionPeriodInDays from props', () => {
  const app = new App();
  const stack = new MyStack(app, 'MyStack', myStackProps);  // 実 props
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SNS::Topic', {
    ArchivePolicy: { MessageRetentionPeriod: myStackProps.messageRetentionPeriod },
  });
});
```

## `Match.*` の使い分け早見表

| Matcher | 用途 |
|---|---|
| `Match.absent()` | プロパティが**指定されていない**ことを確認 |
| `Match.anyValue()` | プロパティが**指定されている**ことだけ確認(値は問わない) |
| `Match.stringLikeRegexp('xxx')` | 値が正規表現にマッチすることを確認(論理 ID の部分一致など) |
| (リテラル) | 値の完全一致 |

## 使う API 早見表

| メソッド | 用途 |
|---|---|
| `template.hasResourceProperties(type, props)` | 指定 type のリソースに、指定 props を含むものが**少なくとも 1 つ**ある |
| `template.hasResource(type, body)` | プロパティだけでなくトップレベル属性(`DependsOn` 等)も含めて確認 |
| `template.resourceCountIs(type, n)` | 指定 type のリソース個数 |
| `template.resourcePropertiesCountIs(type, props, n)` | 指定 props を持つリソース個数(自動生成リソース対策に有用) |
