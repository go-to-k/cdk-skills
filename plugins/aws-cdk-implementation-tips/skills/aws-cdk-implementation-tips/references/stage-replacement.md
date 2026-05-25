# Stage 移行で置換が発生するリソース

非 Stage 構成 (`Stack` を直接 `App` の下に new) から Stage 構成 (`Stage` を間に挟む) に移行すると、**Construct パスが変わる** ことで一部のリソースに **論理 ID / 物理名 / Replacement プロパティ** の変化が起き、結果として CloudFormation の置換 (= 削除→新規作成) が発生する。

## 大前提: 基本的には置換は起きない

論理 ID は **スタックから下の Construct パス** を元に計算されるため、Stage を挟んでもスタック直下の構造が変わらなければ論理 ID は変わらない。**多くのリソースは Stage 移行で影響を受けない**。

ただし、以下のケースに該当するリソースは置換が走る。

## 置換が発生する 3 つの原因

1. **論理 ID の変更**: 内部で `Names.nodeUniqueId(node)` / `Names.uniqueId(node)` を使って Construct ID を組み立てているケース
2. **物理名の変更**: `logGroupName` のような物理名に `this.node.addr` などのパスベース値が使われているケース
3. **Replacement プロパティの変更**: 値の変更で必ず replacement が起きる CloudFormation プロパティ (`GroupDescription` 等) のデフォルト値が `this.node.path` になっているケース

つまり、**Construct パスに依存する内部実装をしているリソースで置換が起きる**。

## 代表的なリソース一覧

> ※以下は確認済みの代表例。**網羅ではない**ため、Stage 移行 / 大きなリファクタの前は **スナップショットテスト** で `cdk diff` 相当を取って確認すること。

### SecurityGroup (description 未指定)

CloudFormation の `GroupDescription` は **Replacement プロパティ**。`SecurityGroupProps.description` を明示していないと、CDK 内部で `this.node.path` がデフォルト値として使われ、Stage 移行でパスが変わる → 置換。

CDK 内部 (`aws-cdk-lib/aws-ec2/lib/security-group.ts`):

```typescript
const groupDescription = props.description || this.node.path;
```

**回避策**: SecurityGroup を作るときに `description` を明示する。

### SecurityGroup の Ingress / Egress ルール

`addIngressRule` / `addEgressRule` (`allowAllOutbound: false` の場合) で、内部の `determineRuleScope` が `Names.nodeUniqueId(this.node)` を使って ID を組み立てる。Stage 移行でパスが変わる → 論理 ID 変化 → 置換。

```typescript
sg2.addIngressRule(sg1, Port.tcp(80), 'Allow traffic ...');
sg2.addEgressRule(sg1, Port.tcp(80), 'Allow traffic ...'); // allowAllOutbound: false の場合
```

### CustomResource の Provider 内 StateMachine の LogGroup

`Provider` に `isCompleteHandler` を指定すると内部で StateMachine が作られ、その LogGroup の **物理名** に `this.node.addr` が使われる:

```typescript
logGroupName: `/aws/vendedlogs/states/waiter-state-machine-${this.isCompleteHandler.functionName}-${this.node.addr}`,
```

Stage 移行で `node.addr` (Construct パスのハッシュ) が変わる → 物理名変更 → 置換。

### Lambda の addEventSource

`func.addEventSource(new SqsEventSource(queue))` などで EventSourceMapping や Permission の論理 ID が変わる。原因は内部で `Names.nodeUniqueId` が使われている:

```typescript
// aws-lambda-event-sources/lib/sqs.ts
const eventSourceMapping = target.addEventSourceMapping(`SqsEventSource:${Names.nodeUniqueId(this.queue.node)}`, { ... });
```

影響するもの:
- `SqsEventSource` → `AWS::Lambda::EventSourceMapping` の論理 ID 変化
- `SnsEventSource` → 内部の `LambdaSubscription` で `AWS::Lambda::Permission` の論理 ID 変化
- `S3EventSource` / `DynamoEventSource` / `KinesisEventSource` も同様

**置換が発生しないパス**: `addEventSourceMapping` メソッドや `EventSourceMapping` Construct を **直接** 使う場合は影響を受けない。

```typescript
// これは安全
func.addEventSourceMapping('MyEventSourceMapping', { eventSourceArn: '...' });
new EventSourceMapping(this, id, { target: func, eventSourceArn: '...' });
```

### SNS Topic の LambdaSubscription

`topic.addSubscription(new LambdaSubscription(func))` の内部で `Names.nodeUniqueId(topic.node)` が使われ、`AWS::Lambda::Permission` の論理 ID が変わる:

```typescript
// aws-sns-subscriptions/lib/lambda.ts
this.fn.addPermission(`AllowInvoke:${Names.nodeUniqueId(topic.node)}`, { ... });
```

### S3 Bucket の LambdaDestination (addEventNotification)

`bucket.addEventNotification(EventType.OBJECT_CREATED, new LambdaDestination(func))` も内部で同じパターン (`AWS::Lambda::Permission` の論理 ID 変化) で置換が発生する。

### RDS / Aurora の Credentials.fromGeneratedSecret

`DatabaseCluster` / `DatabaseInstance` で `credentials: Credentials.fromGeneratedSecret('...')` を使うと、内部 `DatabaseSecret` の中で SecretsManager の `Secret` の論理 ID を `Names.uniqueId` 由来の値で **`overrideLogicalId`** している:

```typescript
// aws-rds/lib/database-secret.ts
const logicalId = `${Names.uniqueId(this)}${hash}`;
const secret = this.node.defaultChild as secretsmanager.CfnSecret;
secret.overrideLogicalId(logicalId.slice(-255));
```

→ Stage 移行で論理 ID 変化 → Secret 置換。

**置換が発生しない代替**: `Credentials.fromPassword` / `fromUsername` / `fromSecret`。

## 安全な移行手順

1. Stage 移行前のコードに対して **スナップショットテスト** を 1 本入れておく
2. Stage 構成にリファクタ
3. `cdk diff` または スナップショットテスト差分を確認し、**置換が走るリソースを特定**
4. 置換を許容できないリソースがあれば、対応する回避策 (description 明示 / `addEventSourceMapping` 直接使用 / `fromSecret` 等) に書き換え
5. 確認完了後、本番にデプロイ

このフェーズの差分確認には **CDK の合成 CloudFormation テンプレートに対するスナップショットテスト** が最も向いている。スナップショットテストの書き方・運用は、同 marketplace `cdk-skills` の **`aws-cdk-unit-testing`** Skill (`aws-cdk-pack` plugin で本 Skill と一緒に install 可) が扱う。

## 補足: スタック名の変更にも注意

Stage を導入するとスタック名は `${stageName}-${スタック ID}` (例: `MyStage-SampleStack`) になる。既存スタックを引き継ぐには `StackProps.stackName` を明示する:

```typescript
class MyStage extends Stage {
  constructor(scope: App, id: string, props?: StageProps) {
    super(scope, id, props);
    new SampleStack(this, 'SampleStack', { stackName: 'SampleStack' }); // 旧名を明示
  }
}
```

明示しないと **新規スタックが作られて元のスタックが残る** (削除はされない) ため、二重デプロイになる。
