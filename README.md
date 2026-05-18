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

# 2-a. 個別の Skill plugin をインストール
/plugin install aws-cdk-unit-testing@cdk-skills

# 2-b. すべての Skill plugin を一括インストール(bundle)
/plugin install cdk-pack@cdk-skills
```

`cdk-pack` は dependencies で全 plugin を pull するメタ plugin です。個別に絞りたい場合は `aws-cdk-unit-testing` のように plugin 名を直接指定してください。

#### 更新 / アンインストール

```bash
/plugin marketplace update cdk-skills
/plugin uninstall aws-cdk-unit-testing@cdk-skills
```

### gh skill (GitHub CLI)

[GitHub CLI v2.90.0+](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/) の `gh skill` で各エージェントの所定の場所(Claude Code なら `~/.claude/skills/`)に直接 install できます。

```bash
gh skill install go-to-k/cdk-skills aws-cdk-unit-testing
```

### npx skills (Vercel Labs)

[`npx skills`](https://github.com/vercel-labs/agent-skills) 経由でも install できます。

```bash
# 個別の Skill を指定して install
npx skills add go-to-k/cdk-skills --skill aws-cdk-unit-testing

# 全 Skill を install
npx skills add go-to-k/cdk-skills
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
├── .claude-plugin/marketplace.json            # マーケットプレース定義
├── plugins/
│   ├── aws-cdk-unit-testing/                  # Skill plugin
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/
│   │       └── aws-cdk-unit-testing/          # ← skill の実ファイル
│   │           ├── SKILL.md
│   │           ├── references/
│   │           └── examples/
│   └── cdk-pack/                              # Bundle plugin (dependencies で全 plugin を pull)
│       └── .claude-plugin/plugin.json
└── skills/
    └── aws-cdk-unit-testing                    # symlink(gh skill / npx skills 用)
```

**Skill の実ファイルは `plugins/<plugin 名>/skills/<skill 名>/` 配下にあり、リポジトリルート直下の `skills/<skill 名>` はそこへの symlink** です。

- Claude Code は `plugins/<plugin 名>/` を plugin dir として読む
- `gh skill` / `npx skills` はルート直下の `skills/<skill 名>/SKILL.md` を読む(symlink を辿って実体に到達)

## 開発

ローカルディレクトリを直接マーケットプレースとして追加して動作確認できます。

```bash
# このリポジトリを clone した後、絶対パスで指定
/plugin marketplace add /path/to/cdk-skills
/plugin install aws-cdk-unit-testing@cdk-skills
```

Skill を編集したら、Claude Code を再起動すれば反映されます。

## ライセンス

[MIT](./LICENSE)

## 著者

[go-to-k](https://github.com/go-to-k) (AWS DevTools Hero, AWS CDK Top Contributor)
