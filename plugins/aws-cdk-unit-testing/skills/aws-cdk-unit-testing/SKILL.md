---
name: aws-cdk-unit-testing
description: AWS CDK のテストを書く / レビューする / 戦略を考える全ての場面で必ず使用する。「CDK のテスト書いて」「このスタックのテスト書きたい」「CDK のテストはどう書けばいい?」「Stack / Construct のテストどうしよう?」などの依頼にも該当する。スナップショット / Fine-grained assertions / バリデーションの 3 種類のうちどれを書くべきか・書かなくて良いかの判断基準とコード例を提供。具体的には `*.test.ts` 編集時、`Template.fromStack` や `aws-cdk-lib/assertions` 使用時、Stack/Construct の単体テスト新規追加時、既存テストレビュー時に該当する。
---

# AWS CDK 単体テストガイド

AWS CDK における単体テストは「全てのリソースに細かく書く」のではなく、**コードの性質に応じて適切なテストを選ぶ**ことが重要。本 Skill は「どの場面でどのテストを書くべきか」「どの場面では書かなくて良いか」の判断基準を提供する。

## 前提となる思想

- AWS CDK は **宣言的に書くのが基本**(「○○ というリソースを作成する」)。
- 宣言的な定義を Fine-grained assertions テストで重複検証すると、**リソース定義側とほぼ同じコードがテスト側に出来上がり**、二重定義の煩わしさとメンテナンスコスト増を招く。
- 一方、**手続き的な処理(ループ・条件分岐・override 等)** や **props 経由の値**は「実際に何が生成されるか自明でない」ため、テストで保証すべき。
- スナップショットテストは**ほぼ必須**(開発初期を除く)。Fine-grained は**選別して書く**。バリデーションテストは**実装したバリデーションごとに書く**。

## 3 種類のテスト早見表

| テスト種別 | 目的 | 必須度 |
|---|---|---|
| スナップショット | 合成された CloudFormation テンプレートの差分検出 | ★★★ ほぼ必須 |
| Fine-grained assertions | テンプレートの一部に対する細かい assertions | ★★☆ 選別して書く |
| バリデーション | props のバリデーション処理の挙動検証 | ★★☆ 実装時のみ必須 |

## 判断フロー(コードを見たらまずこれ)

```
CDK コードを見る
  │
  ├─ Stack / Construct がある?
  │    └─ Yes → スナップショットテストを書く(原則必須)
  │
  ├─ 手続き的な処理がある?
  │    ├─ for / map でリソース生成    → Fine-grained (ループ)
  │    ├─ if 分岐でリソース/プロパティ → Fine-grained (条件分岐, Match.absent)
  │    ├─ addPropertyOverride       → Fine-grained (override)
  │    └─ addDependency             → Fine-grained (依存関係)
  │
  ├─ props 経由で値を流している?
  │    └─ Yes → Fine-grained (値の流入確認、props そのものを参照)
  │
  ├─ 特に保証したい「意思表示」レベルの定義がある?
  │    └─ Yes → Fine-grained (Match.anyValue で値変動に強くする選択肢も)
  │
  ├─ props に対してバリデーション処理を実装している?
  │    └─ Yes → バリデーションテスト(各バリデーションごとに 1 テスト)
  │
  └─ 上記いずれでもない「宣言的な定義」のみ?
       └─ Fine-grained を**書かない**選択肢を強く検討(スナップショットで十分)
```

## 使い所マトリクス

| コードパターン | 書くべきテスト | 参照 |
|---|---|---|
| Stack / Construct 全体 | スナップショット | [references/snapshot.md](references/snapshot.md) |
| `for` / `map` でリソース生成 | Fine-grained (ループ) | [references/fine-grained.md](references/fine-grained.md) |
| `if (props.xxx)` 分岐 | Fine-grained (条件分岐) + `Match.absent` | [references/fine-grained.md](references/fine-grained.md) |
| `addPropertyOverride` | Fine-grained (override 確認) | [references/fine-grained.md](references/fine-grained.md) |
| `addDependency` | Fine-grained (DependsOn 確認) | [references/fine-grained.md](references/fine-grained.md) |
| props → リソースプロパティ | Fine-grained (値の流入確認) | [references/fine-grained.md](references/fine-grained.md) |
| 要件上必ず保証したい定義 | Fine-grained (意思表示) | [references/fine-grained.md](references/fine-grained.md) |
| props バリデーション実装 | バリデーション | [references/validation.md](references/validation.md) |
| 宣言的なリソース定義のみ | Fine-grained は**書かない** | [references/pitfalls.md](references/pitfalls.md) |

## アンチパターン(やらないこと)

1. **宣言的な定義に対する Fine-grained テストの量産**
   リソース定義とほぼ同じコードがテストに出来上がる。スナップショットで代替する。

2. **自動生成リソースを含めた個数チェック**
   L2 Construct は内部で追加リソースを自動生成することがある。`resourceCountIs` の数値だけ見ても後から内訳がわからず認知負荷を招く。詳しくは [references/pitfalls.md](references/pitfalls.md)。

3. **全 Construct に網羅的に Construct 単位のテストを書く**
   Stack のテストと重複しメンテが大変になる。**再利用性を担保したい Construct のみ**に絞る。

4. **バリデーションを実装していないのにバリデーションテストを書く**
   何も検証していない。書く必要はない。

## オススメの最小構成

導入の負荷を抑えたい場合、**まずスナップショットテストから**。合成テンプレートの差分検出だけで CDK バージョンアップ時のリグレッション検知に強力に効く。

## 関連ファイル

- [references/snapshot.md](references/snapshot.md) — スナップショットテストの書き方・運用・3 つの使い所
- [references/fine-grained.md](references/fine-grained.md) — 5 つの使い所別のコード例集 + `Match.*` 使い分け
- [references/validation.md](references/validation.md) — バリデーション実装とテストの書き方(`Token.isUnresolved` 含む)
- [references/pitfalls.md](references/pitfalls.md) — 個数チェック / 自動生成リソース / Construct 単位テスト
- [examples/test-template.ts](examples/test-template.ts) — そのままコピペできる雛形
