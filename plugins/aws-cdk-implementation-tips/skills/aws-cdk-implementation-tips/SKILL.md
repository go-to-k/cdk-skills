---
name: aws-cdk-implementation-tips
description: AWS CDK の Stack / Construct を実装するとき・レビューするときに必ず使用する。「props のバリデーションどう書く?」「複数リソースに横断的に同じ設定を当てたい」「L2 Construct が自動で IAM ポリシー付けるの抑制したい」「Aspect / PropertyInjector / Mixin の使い分けは?」「Stage 導入したらリソース置換が走った」「自作 Construct を Python / Java から使えるようにしたい」などの相談に該当する。具体的には Construct / Stack の `constructor` で props を検証するコード、`Token.isUnresolved` の使用、`Aspects.of` / `IAspect` 実装、`PropertyInjectors.of` / `IPropertyInjector` 実装、`Mixins.of` / `Mixin` 拡張、`RemovalPolicies.of` / `MissingRemovalPolicies.of` 使用、`addValidation` / `IValidation` 実装、`Annotations.of(...).addWarningV2` / `addError`、`Role.withoutPolicyUpdates()`、`Role.fromRoleArn(... { mutable: false })`、`Role.customizeRoles()`、`addPropertyOverride`、`new Stage()` 導入や非 Stage → Stage リファクタ時の論理 ID / 物理名変化、`projen` / `jsii` / Construct Hub 公開を意識した Union 型回避、などのコード編集時に該当する。
---

# AWS CDK 実装 Tips

CDK で **Stack や Construct を実装するときの道具・テクニック集**。基本的なリソース定義の書き方ではなく、「props 検証」「横断的な設定適用」「L2 の自動挙動を抑制する」「Stage 移行で何が起きるか」「自作ライブラリを他言語に公開するときの制約」といった、**ハマりやすい / 知っていると強い** トピックに絞って判断基準と書き方を提供する。

## 前提となる思想

- **エラーは早く落とす**: Construct 生成時点で検出できるエラーは即時 throw する。CloudFormation デプロイまで持ち越さない。
- **横断的な設定は専用機能で表現する**: 「全 Bucket に同じポリシーを当てる」を for ループで書かない。Aspects / PropertyInjectors / Mixins / RemovalPolicies のどれかで宣言的に表現する。
- **CDK の自動挙動は便利だが、抑制したい場面もある**: L2 Construct の IAM ポリシー自動付与は便利だが、IAM を自前管理したいプロジェクトでは明示的に止める。
- **Construct パスは論理 ID / 物理名に滲み出る**: Stage 導入や Construct リファクタで「Construct パス」が変わると、一部リソースは論理 ID や物理名が変わり、デプロイ時に置換される。
- **TypeScript の便利機能はライブラリとして他言語に公開するなら制約**: jsii が他言語に変換する都合上、Union 型などは公開ライブラリでは非推奨。

## 判断フロー (Stack / Construct のコードを見たらまずこれ)

```text
Construct / Stack を実装する
  │
  ├─ props に対するバリデーションが必要?
  │    ├─ Construct 生成時点で判定できる              → 1. 即時スロー (Construct フェーズ)
  │    │    ※ ただし値が Token の可能性がある場合は `Token.isUnresolved` でスキップ
  │    ├─ メソッドを呼んで後から値が変わる            → 3. addValidation (Validate フェーズ、遅延評価)
  │    ├─ スタック内の特定種類リソース全てを検査       → 2. Aspects (Prepare フェーズ)
  │    └─ エラーまでではない警告を出したい / 1 スタック失敗で他スタックは生かしたい
  │                                                  → 4. Annotations (Synthesize フェーズ発火)
  │
  ├─ 複数リソースに横断的に同じ設定を当てたい?
  │    ├─ L1 プロパティ (CloudFormation 直)         → Aspects (Prepare フェーズで visit)
  │    ├─ L2 / L3 props (Construct API レベル)      → PropertyInjectors (Construct 生成時)
  │    ├─ 個別 Construct に選択的・即時に適用        → Mixins (呼び出した瞬間に適用、それ以前の Construct が対象)
  │    └─ RemovalPolicy だけ全リソースに当てたい     → RemovalPolicies / MissingRemovalPolicies
  │
  ├─ L2 Construct が自動付与する IAM を抑制したい?
  │    ├─ 自前作成の Role を渡すが権限自動追加だけ止める → `role.withoutPolicyUpdates()`
  │    ├─ `fromRoleArn` でインポートしたロールに対して  → `{ mutable: false }`
  │    └─ 自前管理するため事前にロール構成をレポート化  → `Role.customizeRoles(stack, { usePrecreatedRoles: { ... } })`
  │
  ├─ Stage を導入する / Construct パスが変わるリファクタ?
  │    └─ → [references/stage-replacement.md](references/stage-replacement.md)
  │         (SecurityGroup の description、Provider 内 LogGroup、SqsEventSource、fromGeneratedSecret などで置換)
  │
  ├─ ライフサイクルのどのフェーズで何が動くか不明?
  │    └─ → [references/lifecycle.md](references/lifecycle.md)
  │         (Construct / Prepare / Validate / Synthesize の 4 フェーズと各機能の対応)
  │
  └─ 自作 Construct を TypeScript 以外の言語 (Python / Java / Go / C#) に公開したい?
       └─ → [references/jsii-library-authoring.md](references/jsii-library-authoring.md)
            (Union 型は非推奨 / Union-Like Class / Enum-Like Class / jsii ランタイムアーキテクチャ)
```

## 1. props バリデーションの使い分け

| 方法 | 実行フェーズ | エラー時の挙動 | 使い所 |
|---|---|---|---|
| 即時スロー (`throw new Error()`) | Construct | デプロイ前に CDK が即終了 | **基本的にはこれ**。生成時点で確定する値の検査 |
| Aspects (`Aspects.of`) | Prepare | デプロイ前に CDK が終了 | スタック内の全 `CfnBucket` などを一括検査 |
| addValidation (`node.addValidation`) | Validate | デプロイ前に終了、エラーメッセージは配列で複数返せる | メソッド呼び出しで後から値が変わる遅延評価 |
| Annotations (`Annotations.of(...).addError` / `addWarningV2`) | (アタッチタイミング次第)、出力は Synthesize | **synth は成功する**。エラーがあっても他スタックは合成成功 | 環境的要因のエラー / 警告 (deprecated 等) / 1 スタック失敗で他スタックを生かしたい |

### 1-1. 即時スロー (基本形)

```typescript
export class MyConstruct extends Construct {
  constructor(scope: Construct, id: string, props: MyConstructProps) {
    super(scope, id);
    if (props.myFlag && props.myParam !== undefined) {
      throw new Error('myParam は myFlag が true の場合は指定できません');
    }
  }
}
```

**注意: Token の扱い**

props の値が `Token` (`!Ref` などデプロイ時に解決される値) のとき、即時スローで `if (param < 0)` のような数値比較をすると、内部の仮値 (`-1.88815458970875e+289` 等) で誤判定する。`Token.isUnresolved` で必ずスキップする:

```typescript
import { Token } from 'aws-cdk-lib';
if (!Token.isUnresolved(props.myParam) && props.myParam < 0) {
  throw new Error('myParam は 0 以上である必要があります');
}
```

`Bucket.bucketName` や `CfnParameter.valueAsString` のように、L2 から渡ってくる値が Token である可能性は常にあるため、外部から渡される props は Token を疑う。

### 1-2. addValidation (遅延評価)

`new` 直後ではなく、メソッド呼び出しで props の状態が変わってから検証したい場合:

```typescript
export class MyConstruct extends Construct {
  public readonly myVariables: string[];

  constructor(scope: Construct, id: string, props: MyConstructProps) {
    super(scope, id);
    this.myVariables = props.myVariables;
    this.node.addValidation({ validate: () => this.validateVariables() });
  }

  private validateVariables(): string[] {
    const errors: string[] = [];
    if (this.myVariables.length > 3) {
      errors.push(`myVariables の要素は 3 つまで, 現在: ${this.myVariables.length}`);
    }
    return errors;
  }

  public addVariable(v: string) { this.myVariables.push(v); }
}
```

エラーは `string[]` 配列で返す (複数まとめて返せる)。

### 1-3. Annotations (警告 / 1 スタック失敗を切り離す)

```typescript
Annotations.of(this).addWarningV2(
  'MyConstruct:oldParam',
  `'oldParam' は非推奨です。'newParam' を使ってください。`,
);
Annotations.of(this).addError(`'arrayParam' は空ではいけません`);
```

- `addError` でも **synth は成功し、クラウドアセンブリが生成される**。エラーのアタッチされたスタックの `cdk synth StackA` は失敗するが、`cdk synth StackB` は成功する。
- 即時スロー / addValidation だと 1 スタックのエラーで全 synth が落ちる。
- 主用途: 非推奨警告、context メソッドで取得できなかった環境依存のエラー。基本は即時スロー優先。

### 1-4. addPropertyOverride との関係 (落とし穴)

`CfnBucket.addPropertyOverride('VersioningConfiguration.Status', 'Enabled')` のようなテンプレート直書き換えは **Synthesize フェーズで実行**。

- Aspect (Prepare) で書き換え → addValidation (Validate) で「Versioning 有効か?」を検証 → **検証時点ではまだ書き換えが反映されていない** ため、意図しないバリデーションエラーが出る
- override 後の値を検証したいケースは、対応するバリデーション機能では完全には実現できない

## 2. 複数リソースへの一括適用の使い分け

| 機能 | 対象 | 実行タイミング | 使い所 |
|---|---|---|---|
| **Aspects** | L1 Construct のプロパティ | Prepare フェーズ (Construct ツリー完成後) | L1 (CloudFormation プロパティ) 単位の上書き / 全リソースを横断検査 |
| **PropertyInjectors** | L2 / 一部 L3 Construct の props | **Construct 生成時** (Construct フェーズ) | L2 props 単位の宣言的な上書き、L2 内部バリデーションを通過させたい場合 |
| **Mixins** | L1 + L2 Construct | **`Mixins.of(...).apply` 呼び出した瞬間** | 個別 Construct に選択的・即時に機能を合成 (RFC 推奨: 変更は Mixin、検証は Aspect) |
| **RemovalPolicies** | 全リソースの RemovalPolicy | Construct フェーズ | スタック / アプリ全体の RemovalPolicy 一括設定 |

### 2-1. Aspects

`IAspect` を実装し、`visit` 内で対象の Construct を判定して操作する:

```typescript
export class BucketVersioningChecker implements cdk.IAspect {
  public visit(node: IConstruct) {
    if (node instanceof CfnBucket) {
      if (!node.versioningConfiguration ||
          (!cdk.Tokenization.isResolvable(node.versioningConfiguration) &&
           node.versioningConfiguration.status !== 'Enabled')) {
        throw new Error('バージョニングが有効になっていません');
      }
    }
  }
}

cdk.Aspects.of(stack).add(new BucketVersioningChecker());
```

**優先度** (`AspectPriority` / `priority`): v2.172.0 以降、複数 Aspect の実行順を制御可能。`MUTATING`=200 (上書き系)、`DEFAULT`=500、`READONLY`=1000 (検証系)。`cdk-nag` のような検証 Aspect は順序を遅らせる:

```typescript
Aspects.of(stack).add(new AspectForOverride(),  { priority: AspectPriority.MUTATING });
Aspects.of(stack).add(new AspectForValidation(), { priority: AspectPriority.READONLY });
```

### 2-2. PropertyInjectors

v2.196.0 (2025/5) 以降。`IPropertyInjector` を実装し、対象 L2 Construct の `PROPERTY_INJECTION_ID` を指定して props を上書きする:

```typescript
export class MyBucketPropsInjector implements IPropertyInjector {
  public readonly constructUniqueId = Bucket.PROPERTY_INJECTION_ID;

  public inject(originalProps: BucketProps, _ctx: InjectionContext): BucketProps {
    return { blockPublicAccess: BlockPublicAccess.BLOCK_ALL, ...originalProps };
  }
}

PropertyInjectors.of(app).add(new MyBucketPropsInjector());
// または Stack props で:
new Stack(app, 'MyStack', { propertyInjectors: [new MyBucketPropsInjector()] });
```

- **生成時に実行**されるため、Aspects と違い L2 の **内部バリデーションを通過させる用途で使える**
- **Stack 生成より前に登録**する必要あり (`PropertyInjectors.of(app).add(...)` を Stack の new より後に書くと適用されない)
- 同じ型を再帰生成すると無限ループの罠 (`serverAccessLogsBucket` に Bucket を渡す等)。`_skip` フラグでガードする

### 2-3. Mixins

v2.241.0 で GA。`Mixins.of(...).apply(...)` または `construct.with(...)` で **その時点で** 機能を合成する:

```typescript
import { Mixins, ConstructSelector } from 'aws-cdk-lib';
import { BucketVersioning, BucketAutoDeleteObjects } from 'aws-cdk-lib/aws-s3/mixins';

const bucket = new CfnBucket(stack, 'MyBucket');
Mixins.of(bucket).apply(new BucketVersioning()).apply(new BucketAutoDeleteObjects());

// scope 配下に一括適用 (型で絞り込みも可能)
Mixins.of(construct, ConstructSelector.resourcesOfType(CfnBucket.CFN_RESOURCE_TYPE_NAME))
  .apply(new BucketVersioning());
```

- **適用前に存在していた Construct のみ**に効く (適用後に new した Construct は対象外)
- Aspects との変換 `Shims.asMixin(aspect)` / `Shims.asAspect(mixin)` でフェーズの遅延 / 即時を切替可能
- RFC 推奨: **変更には Mixin、検証には Aspect**

### 2-4. RemovalPolicies / MissingRemovalPolicies

v2.183.0 以降。RemovalPolicy 専用の一括適用:

```typescript
RemovalPolicies.of(app).destroy();
RemovalPolicies.of(app).retain();

// 既に RemovalPolicy が設定されているものは触らない
MissingRemovalPolicies.of(app).destroy();
```

## 3. L2 Construct が自動付与する IAM の制御

L2 Construct は自動で「必要な権限を持った IAM ロール」を作るが、IAM を自前管理したい場合に抑制する 3 つの手段:

### 3-1. `role.withoutPolicyUpdates()`

自前で作った Role を L2 に渡すが、L2 内部で勝手にポリシーが追加されるのを止める:

```typescript
const role = new iam.Role(stack, 'ExecutionRole', {
  assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
});
role.addToPrincipalPolicy(statement); // 必要なポリシーは自分で

new agentcore.Runtime(stack, 'TestRuntime', {
  agentRuntimeArtifact: runtimeArtifact,
  executionRole: role.withoutPolicyUpdates(), // 自動付与を止める
});
```

### 3-2. `fromRoleArn(..., { mutable: false })`

スタック外で作成済みのロールをインポートする場合、`mutable: false` でポリシー自動アタッチを止める:

```typescript
const importedRole = iam.Role.fromRoleArn(stack, 'ImportedRole', 'my-role-arn', {
  mutable: false,
});
```

### 3-3. `Role.customizeRoles()`

L2 が必要とするロール / ポリシーを **実際には作成せずレポートに書き出す**。それを元に IAM を別管理 (別ロールでデプロイなど) する運用に切り替えられる:

```typescript
iam.Role.customizeRoles(stack);
// → iam-policy-report.txt / iam-policy-report.json が生成される

// レポートを元に手で IAM を作り、precreated 名を指定して切り替え:
iam.Role.customizeRoles(stack, {
  usePrecreatedRoles: {
    'LambdaStack/Handler/ServiceRole': 'lambda-service-role',
  },
});
```

CI/CD で「IAM 変更だけ別の権限の強いロールに任せる」運用などで使う。

## 4. Stage 移行で置換が発生するリソース

非 Stage → Stage 移行は基本的に論理 ID を変えないが、**Construct パスが論理 ID / 物理名 / Replacement プロパティに使われている一部のリソース** では置換が発生する。

代表例:

| リソース | 原因 |
|---|---|
| `SecurityGroup` (`description` 未指定) | `description` のデフォルトに `this.node.path` が使われる (Replacement プロパティ) |
| `SecurityGroup` の Ingress/Egress (`addIngressRule` 等) | `Names.nodeUniqueId` が論理 ID に使われる |
| `Provider` 内の StateMachine LogGroup (`isCompleteHandler` 指定時) | LogGroup 名の物理名に `this.node.addr` が使われる |
| Lambda の `addEventSource` (SQS / SNS / S3 / DynamoDB / Kinesis) | EventSourceMapping や Permission の論理 ID が変わる |
| SNS `addSubscription(LambdaSubscription)` / S3 `addEventNotification(LambdaDestination)` | 内部で `Permission` の論理 ID が変わる |
| RDS / Aurora の `Credentials.fromGeneratedSecret` | Secret の論理 ID を `Names.uniqueId` で override |

詳細リストとリンク付き原因は [references/stage-replacement.md](references/stage-replacement.md)。Stage 構成導入や Construct リファクタの **前にスナップショットテスト** で差分を確認する (姉妹 Skill `aws-cdk-unit-testing` 参照)。

非 Stage → Stage 移行ではさらに **スタック名** にも注意。デフォルトでは `${stageName}-${スタック ID}` になるため、既存スタックを引き継ぐ場合は `stackName` を明示する。

## 5. CDK アプリケーションライフサイクル

各機能がいつ動くかの理解は、特に Aspects / バリデーションのデバッグで重要。4 フェーズ:

1. **Construct フェーズ** — CDK コードが上から実行され、Construct ツリーが構築される。**ユーザコードのほとんどはここで動く**
2. **Prepare フェーズ** — Aspects 実行、`DependsOn` の解決、クロススタック参照の `Outputs` + `ImportValue` 生成
3. **Validate フェーズ** — `node.addValidation` でアタッチされたバリデーションがまとめて実行
4. **Synthesize フェーズ** — CloudFormation テンプレート生成、トークン解決、論理 ID 計算、`addOverride` 反映。`cdk.out` 生成

詳しい解説は [references/lifecycle.md](references/lifecycle.md)。

## 6. Construct ライブラリを多言語配布する (jsii) のサブテーマ

**自作 Construct を npm 以外の言語 (Python / Java / Go / C#) でも使えるように Construct Hub に公開** する場合、TypeScript ならではの記法に制約がかかる。

- **Union 型は非推奨**: 公開 props に `'A' | 'B'` や `TypeA | TypeB` を使うと、他言語では `Object` / `interface{}` 等の汎用型に変換され型安全性が落ちる
- 代替: **Enum** / **Union-Like Class** (`fromXxx` static メソッドで具象クラスを返す abstract クラス) / **Enum-Like Class** (任意値を許す `of()` メソッド付き enum パターン)
- 実装内部は TS の便利機能 (ジェネリクス、ユーザ定義型ガード等) を使って良い。**公開 API の型シグネチャだけ** が jsii 制約の対象

実装パターン詳細・jsii のランタイムアーキテクチャ (node ランタイム必須の理由) は [references/jsii-library-authoring.md](references/jsii-library-authoring.md)。

**プロダクト開発で CDK を使うだけの場合は対象外**。あくまで「自作 Construct ライブラリを多言語公開する人」向け。

## アンチパターン (やらないこと)

1. **数値 props を `Token` チェックなしで `if (param < 0)` のように比較する**
   Token が来ると仮値で誤判定する。`Token.isUnresolved` で必ずスキップ。

2. **「全リソースに同じ props を当てたい」を for ループで書く**
   Aspects / PropertyInjectors / Mixins / RemovalPolicies のどれかを使う。それぞれ「いつ動くか」が違うので使い分け。

3. **Aspect (Prepare) で `addPropertyOverride` し、addValidation (Validate) で同じプロパティを検証する**
   `addPropertyOverride` の反映は Synthesize フェーズなので、Validate 時点では未反映。検証が想定通りに動かない。

4. **L2 が自動付与する IAM を許容できないプロジェクトで、それを知らずに使う**
   `withoutPolicyUpdates` / `mutable: false` / `customizeRoles` を選んで明示的に止める。

5. **Stage 構成を導入する / Construct パスが変わるリファクタを、スナップショットテストなしで行う**
   一部リソースは静かに置換される。事前確認なしだと本番で削除→再作成が発生する。

6. **公開する自作 Construct の props に Union 型 (`'A' | 'B'`) を使う**
   jsii で他言語に変換するとき型が崩れる。Enum か Union-Like Class を使う。

7. **`PropertyInjectors.of(app).add(...)` を Stack の `new` の後に書く**
   既存 Stack には適用されない。Stack 生成より前か、Stack props の `propertyInjectors` で渡す。

## 関連ファイル

- [references/lifecycle.md](references/lifecycle.md) — Construct / Prepare / Validate / Synthesize の 4 フェーズと各機能の実行タイミングマップ
- [references/stage-replacement.md](references/stage-replacement.md) — 非 Stage → Stage 移行で置換されるリソース一覧と CDK 内部コードでの原因
- [references/jsii-library-authoring.md](references/jsii-library-authoring.md) — Union 型回避パターン (Union-Like Class / Enum-Like Class)、jsii ランタイムアーキテクチャ、node ランタイム必須の理由
