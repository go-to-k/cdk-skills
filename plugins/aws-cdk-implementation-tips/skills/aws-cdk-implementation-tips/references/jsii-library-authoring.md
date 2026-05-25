# 自作 Construct ライブラリを多言語に配布する場合の jsii 制約

> 対象は **自作 Construct ライブラリを Construct Hub などに公開して、Python / Java / Go / C# でも使えるようにしたい人** だけ。
> プロダクト開発で CDK を **使うだけ** なら、本ガイドの制約は気にしなくて良い (Union 型もガンガン使って良い)。

## jsii とは

AWS CDK は複数の言語 (TypeScript / Python / Java / Go / C#) で記述できる。これは **jsii** というツールが、TypeScript で書かれた CDK 本体や Construct ライブラリを **各言語用のライブラリに変換** して配布しているから。

```typescript
// TypeScript で書く側 (ライブラリ作者)
export class Greeter {
  public greet(name: string) {
    return `Hello, ${name}!`;
  }
}
```

これを jsii が変換することで、各言語で同じ Construct を呼べる:

```csharp
// C#
var greeter = new Greeter();
greeter.Greet("World");
```

```python
# Python
greeter = Greeter()
greeter.greet("World")
```

## なぜ TypeScript ならではの記法が「公開ライブラリでは」非推奨か

jsii は他言語に変換するときに **対応する型概念がない記法** に遭遇すると、エラーにせず **非可逆な緩い型** (`Object` / `interface{}` / `any` 相当) に変換する。結果として **他言語のユーザは型の恩恵を受けられない**。

代表例が **Union 型**:

```typescript
// TS の Union 型
public myMethod(myType: MyTypeA | MyTypeB) { ... }
```

各言語ではこうなる:

```java
// Java
public void myMethod(Object myType) { ... }
```
```csharp
// C#
public void MyMethod(object myType) { ... }
```
```go
// Go
func (this *Sample) myMethod(myType interface{}) { ... }
```

具体値の Union (`'VALUE_A' | 'VALUE_B'`) も他言語では単なる `string` 型になる。

## 代替パターン 1: Enum

具体値の Union は `enum` で代替:

```typescript
export enum MyEnum {
  VALUE_A = 'VALUE_A',
  VALUE_B = 'VALUE_B',
}

export interface MyConstructProps {
  readonly myValue: MyEnum;
}
```

> ※通常 TS アプリ開発では enum 非推奨と言われがちだが、**CDK 公開ライブラリでは enum を使う**。jsii で各言語の enum 概念にきちんと変換されるため。

## 代替パターン 2: Union-Like Class

クラスや具象型の Union (`InlineCode | AssetCode | S3Code`) は、**abstract クラス + 各具象クラスを返す `fromXxx` static メソッド** で代替する。

```typescript
export abstract class Code {
  public static fromInline(code: string): InlineCode { return new InlineCode(code); }
  public static fromAsset(path: string, opts?: AssetOptions): AssetCode { return new AssetCode(path, opts); }
  public static fromBucket(bucket: IBucket, key: string, ver?: string): S3Code {
    return new S3Code(bucket, key, ver);
  }
}

export class InlineCode extends Code { /* ... */ }
export class AssetCode  extends Code { /* ... */ }
export class S3Code     extends Code { /* ... */ }

export interface MyConstructProps {
  readonly code: Code; // 実態は InlineCode | AssetCode | S3Code のいずれか
}

new MyConstruct(scope, 'MyConstruct', {
  code: Code.fromAsset('./assets'),
});
```

abstract クラスを公開型として使い、各言語でも同じ `fromXxx` パターンで呼べる形にする。AWS CDK 本体の `Code` (`aws-lambda`) や `MachineImage` などがこのパターンを採用している。

CDK 公式の Design Guidelines も Union 型回避を明文化している (`aws/aws-cdk/docs/DESIGN_GUIDELINES.md#unions`)。

## 代替パターン 3: Enum-Like Class

「決まった enum 値」+ 「ユーザが任意値を渡せる `of()` メソッド」を組み合わせるパターン:

```typescript
export class Cpu {
  public static readonly ONE_VCPU = new Cpu('1 vCPU');
  public static readonly TWO_VCPU = new Cpu('2 vCPU');

  public static of(unit: string): Cpu {
    return new Cpu(unit);
  }

  private constructor(public readonly unit: string) {}
}

new MyConstruct(scope, 'MyConstruct1', { cpu: Cpu.ONE_VCPU });
new MyConstruct(scope, 'MyConstruct2', { cpu: Cpu.of('4 vCPU') }); // 任意値も許容
```

ECS の `Cpu` / `MemorySize` などで採用されている。Design Guidelines の `#enums` を参照。

## 内部実装は TS の便利機能を使って良い

jsii 制約がかかるのは **公開 API の型シグネチャ** だけ。Construct 内部の実装は TypeScript ならではの機能 (ユーザ定義型ガード、ジェネリクス、複雑な型操作など) を使って構わない。

実際 AWS CDK 本体の Construct コードでも、公開 API は jsii 互換に保ちつつ内部は型ガード関数やジェネリクスを使っている箇所が多い。

## jsii のランタイムアーキテクチャ

jsii 経由でビルドされた各言語ライブラリの中には、**ライブラリ作成者の書いた TypeScript (実体は JavaScript) のコードがバンドル** されている。各言語から関数を呼ぶと、その言語ホストプロセスは内部的に **別プロセスとして node ランタイムを起動** し、そこで JavaScript の実処理が実行される。

```
[Python / Java / C# / Go プロセス]
       ↓ (jsii プロトコル経由でメソッド呼出を委譲)
[node プロセス (TypeScript ライブラリの実体)]
```

つまり:
- **どの言語で CDK を書いても、内部実行は node ランタイム**
- そのため、各言語の CDK プロジェクトでも **node ランタイムが必須**
- pytest 等の言語ネイティブなテストランナーから CDK ユニットテストを動かす場合も、裏で node が起動する

詳細は jsii 公式ドキュメントの `overview/runtime-architecture/` を参照。

## まとめ

- 公開 props や public API の型に **Union 型は使わない**
- 代わりに **Enum** / **Union-Like Class** (abstract + `fromXxx`) / **Enum-Like Class** (`of()` 付き) を使う
- 内部実装は TS の便利機能を自由に使って良い (公開シグネチャだけ jsii 互換であれば OK)
- 各言語ライブラリの内部実行は node ランタイム上で動くため、利用環境に node が要る
- プロダクト開発で CDK を使うだけなら、この制約は無関係
