# cdk-skills

AWS CDK 開発を支援する AI コーディングエージェント用 Skills 集です。SKILL.md フォーマット (YAML frontmatter + 本文) に対応するエージェントで利用できます。

## 収録 Skills

### [aws-cdk-unit-testing](./skills/aws-cdk-unit-testing/)

AWS CDK の単体テストの**使い所を判断する**ための Skill。

> 元記事: [AWS CDK における単体テストの使い所を学ぶ (builders.flash)](https://aws.amazon.com/jp/builders-flash/202411/learn-cdk-unit-test/)

CDK の単体テストには **スナップショット / Fine-grained assertions / バリデーション** の 3 種類がありますが、「どの場面でどれを書くべきか」「どこには書かないべきか」を判断するのは慣れが要ります。この Skill は元記事の内容をベースに、AI コーディングエージェントがコードを見て**適切なテストを書く / レビューする**ための判断基準とコード雛形を提供します。

主な内容:

- 3 種類のテストの判断フローチャート
- コードパターン → 書くべきテストのマトリクス
- 5 つの「Fine-grained を書くべき場面」(ループ / 条件分岐 / override / 意思表示 / props)別のコード例
- アンチパターン(宣言的定義への過剰テスト、自動生成リソース含む個数チェック、など)
- そのままコピペできるテスト雛形

## インストール

### Claude Code

Plugin marketplace 機能でインストールします。

```bash
# 1. マーケットプレースを追加
/plugin marketplace add go-to-k/cdk-skills

# 2. プラグインをインストール(全 Skill が同梱されます)
/plugin install cdk-skills@cdk-skills
```

#### 更新 / アンインストール

```bash
/plugin marketplace update cdk-skills
/plugin uninstall cdk-skills@cdk-skills
```

### npx skills (Vercel Labs)

[`npx skills`](https://github.com/vercel-labs/agent-skills) 経由で個別の Skill を選択して install できます。

```bash
# 個別の Skill を指定して install
npx skills add go-to-k/cdk-skills --skill aws-cdk-unit-testing

# 全 Skill を install
npx skills add go-to-k/cdk-skills
```

### その他のエージェント

`skills/aws-cdk-unit-testing/` ディレクトリ自体が SKILL.md フォーマットの Skill です。お使いのエージェントの Skills 配置場所にコピーまたはシンボリックリンクしてください。

```bash
# 例: Codex
ln -s "$(pwd)/skills/aws-cdk-unit-testing" ~/.codex/skills/aws-cdk-unit-testing
```

## 発動条件

インストール後、以下のような状況で `aws-cdk-unit-testing` Skill が自動的に発動します。

- `aws-cdk-lib/assertions` を import している
- `Template.fromStack(...)` を使っている
- CDK の `*.test.ts` ファイルを編集している
- CDK の Stack / Construct のテスト戦略について相談された

## ディレクトリ構成

```text
cdk-skills/
├── .claude-plugin/
│   ├── marketplace.json          # マーケットプレース定義
│   └── plugin.json               # プラグイン定義
└── skills/
    └── aws-cdk-unit-testing/
        ├── SKILL.md              # 判断ガイド本体
        ├── references/           # 詳細リファレンス
        └── examples/             # コピペ用雛形
```

## 開発

ローカルディレクトリを直接マーケットプレースとして追加して動作確認できます。

```bash
# このリポジトリを clone した後、絶対パスで指定
/plugin marketplace add /path/to/cdk-skills
/plugin install cdk-skills@cdk-skills
```

Skill を編集したら、Claude Code を再起動すれば反映されます。

## ライセンス

[MIT](./LICENSE)

## 著者

[go-to-k](https://github.com/go-to-k) (AWS DevTools Hero, AWS CDK Top Contributor)
