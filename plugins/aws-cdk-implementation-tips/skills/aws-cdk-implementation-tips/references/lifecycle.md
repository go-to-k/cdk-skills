# CDK アプリケーションライフサイクル

CDK の `cdk synth` / `cdk deploy` の合成 (Synthesize) 処理は **4 つのフェーズ** に分かれて実行される。各機能がどのフェーズで動くかを理解しないと、Aspects / バリデーション / プロパティ override のデバッグで混乱する。

## 4 フェーズの概要

| 順序 | フェーズ | 主にやること |
|---|---|---|
| 1 | **Construct** | CDK コードを上から実行、Construct ツリーを構築 |
| 2 | **Prepare** | Aspects 実行、`DependsOn` の追加、クロススタック / クロスリージョン参照の解決 |
| 3 | **Validate** | `node.addValidation` でアタッチされたバリデーションをまとめて実行 |
| 4 | **Synthesize** | CloudFormation テンプレート生成、トークン解決、論理 ID 計算、`addOverride` 反映、`cdk.out` 生成 |

## 各機能 × フェーズの対応表

| 機能 | 動くフェーズ | エラー時の挙動 |
|---|---|---|
| 即時スロー (`throw` in constructor) | Construct | 即時 CDK 終了 |
| PropertyInjectors / Mixins | Construct (生成時 / apply 時) | 即時 |
| Aspects (`Aspects.of(...).add`) | Prepare (ツリー完成後) | `throw` すれば CDK 終了 |
| `node.addValidation` | Validate | エラーメッセージ配列を返す、複数まとめて表示 |
| `Annotations.of(...).addError` / `addWarningV2` の出力発火 | Synthesize | **synth は成功する**、stack 単位でエラーが切り離される |
| `addPropertyOverride` の反映 | Synthesize | テンプレート直書き換え |
| 論理 ID / 物理名の確定 | Synthesize | この時点まで決まらない値が Token として扱われる |

## Construct フェーズ

ユーザの定義した CDK コードを **上から順に実行** し、Construct インスタンスを生成。`App` → `Stage` → `Stack` → 各種 Construct (ネスト可能) というツリー構造を形成する。

**ユーザの書いた CDK コードのほとんどはここで実行される。** 以降のフェーズでは、構築済みツリーに対する操作が中心。

```typescript
// このコードは Construct フェーズで実行される
const app = new App();
const stack = new Stack(app, 'MyStack');
new MyConstruct(stack, 'MyConstruct'); // ← この Construct の constructor 内のコードも Construct フェーズ
```

`PropertyInjectors` も Construct 生成時に動くため、ここのフェーズ。

## Prepare フェーズ

### Aspects の適用

ツリー完成後、ツリーのルートから順に Aspect がアタッチされているかを確認し、アタッチされた Construct のノードから子孫すべてに対して `visit` を実行する。

```typescript
const myConstruct = new MyConstruct(this, 'MyConstruct');
Aspects.of(myConstruct).add(new MyAspect());
// MyAspect.visit は MyConstruct とその子孫すべてに対して Prepare フェーズで実行される
```

注意: Aspect の `add` を呼んだ時点では実行されない。**Construct フェーズが完了して** から実行される。「`Aspects.of(...).add(...)` の直後に `addResource()` を呼んだら Aspect の処理は addResource の前に走るはず」というのは誤解。

### その他の Prepare 処理

- L2 Construct 間の依存を、L1 Construct 間の `DependsOn` に落とし込む
- クロススタック参照: `Outputs` + `ImportValue` の生成
- クロスリージョン参照: カスタムリソースを使った仕組みに展開
- ネストスタック参照: `Outputs` や `Parameters` の解決
- ネストスタック処理: 子スタックのテンプレートを先に生成し、親スタックの S3 アセットとして追加

## Validate フェーズ

`node.addValidation(...)` でアタッチされたバリデーションが **まとめて発火** する。

```typescript
this.node.addValidation({ validate: () => this.validateVariables() });

private validateVariables(): string[] {
  const errors: string[] = [];
  if (this.myVariables.length > 2) {
    errors.push(`myVariables must not have more than 2 elements, got: ${this.myVariables.length}`);
  }
  return errors;
}
```

- エラーは `string[]` 配列で返す ⇒ 1 回の検証で複数のエラーをまとめて出せる
- Construct フェーズ後に評価されるため、生成後にメソッドで状態を変えるケース (`addVariable()` 連打) を後から検証できる = **遅延評価**

```typescript
const c = new MyConstruct(this, 'MyConstruct');
c.addVariable('v1');
c.addVariable('v2');
c.addVariable('v3');  // ← この時点でバリデーションは走らない
c.addVariable('v4');
// Validate フェーズに入ったタイミングで初めて validateVariables() が呼ばれ、要素数 4 でエラー
```

## Synthesize フェーズ

Construct ツリーから CloudFormation テンプレートを生成する最終フェーズ。

- L1 Construct を抽出し、対応する CloudFormation リソースを書き出す
- [Token](https://docs.aws.amazon.com/ja_jp/cdk/v2/guide/tokens.html) の解決 (`!Ref` などの実値解決)
- **論理 ID の計算** (Construct パスがここで論理 ID に変換される)
- `addOverride` / `addPropertyOverride` の反映
- `cdk.out` ディレクトリにクラウドアセンブリ (`*.template.json` / `*.assets.json` / `manifest.json` / `tree.json` / アセットファイル) を出力

`Annotations.of(...).addError` の出力もこのフェーズで発火するが、**synth 自体は成功** する点が他のバリデーションと異なる (= スタック単位でエラーを切り離せる)。

## 落とし穴

### Aspect (Prepare) で override → addValidation (Validate) で検証 が動かない

```typescript
// 1. S3 Bucket を作成 (versioning 未指定)
// 2. Aspect (Prepare フェーズ) で addPropertyOverride で versioning を Enabled に
// 3. addValidation (Validate フェーズ) で versioning が Enabled かをチェック
//    → addPropertyOverride の反映は Synthesize フェーズなので、Validate 時点では未反映
//    → 「Enabled でない」と誤判定されてバリデーションエラー
```

回避策: addPropertyOverride 経由の値はバリデーションでは検証しない / PropertyInjectors を使って Construct 生成時に props を書き換える。

### Aspect 内で Annotations.addError しても、その後の addValidation エラーで上書きされる

Annotations のエラーは Synthesize フェーズで発火するが、Validate フェーズで `addValidation` 由来のエラーが先に発生すると CDK はそこで終了するため、Annotations のエラーは出力されない。

## ライフサイクルの昔話 (補足)

`prepare` / `validate` / `synthesize` というメソッドは CDK v1 時代に Construct に存在していたもの。CDK v2 では実装構造が変わっているが、フェーズ名は概念として残っている。公式ドキュメントにもまだ v1 由来の記述が残っているため、文献を読むときは「現在の実装と少しずれている可能性」を意識すると良い。
