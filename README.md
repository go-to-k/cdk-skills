# cdk-skills

AWS CDK 開発を支援する AI コーディングエージェント用 Skills 集です。SKILL.md フォーマット (YAML frontmatter + 本文) に対応するエージェントで利用できます。

## 収録 Skills

### [aws-cdk-unit-testing](./plugins/aws-cdk-unit-testing/skills/aws-cdk-unit-testing/SKILL.md)

AWS CDK の単体テスト(スナップショット / Fine-grained assertions / バリデーション)の「**どの場面でどれを書くべきか / 書かなくて良いか**」を Coding Agent に判断させる Skill。判断フロー・コードパターン別の例・アンチパターンを含む。

> 元記事: [AWS CDK における単体テストの使い所を学ぶ (builders.flash)](https://aws.amazon.com/jp/builders-flash/202411/learn-cdk-unit-test/)

詳細は [SKILL.md](./plugins/aws-cdk-unit-testing/skills/aws-cdk-unit-testing/SKILL.md) を参照。

### [aws-cdk-deployment-practices](./plugins/aws-cdk-deployment-practices/skills/aws-cdk-deployment-practices/SKILL.md)

AWS CDK のデプロイ実行・複数環境管理・CI/CD パイプライン設計に関するベストプラクティスを Coding Agent に判断させる Skill。静的 vs 動的スタック作成 + Stage / Synthesize once deploy many / `cdk publish-assets` でのアセット publish 分離 / `cdk.context.json` コミット / CDK Toolkit Library と CDK CLI のデフォルト挙動差分などを扱う。

詳細は [SKILL.md](./plugins/aws-cdk-deployment-practices/skills/aws-cdk-deployment-practices/SKILL.md) を参照。

### [aws-cdk-implementation-tips](./plugins/aws-cdk-implementation-tips/skills/aws-cdk-implementation-tips/SKILL.md)

AWS CDK の Construct / Stack を実装するときの **道具・テクニック集** Skill。props バリデーション 4 方法 (即時スロー / Aspects / `addValidation` / Annotations) の使い分け、プロパティ一括適用 (Aspects / PropertyInjectors / Mixins / RemovalPolicies)、L2 が自動付与する IAM ロール / ポリシーの制御 (`withoutPolicyUpdates` / `mutable: false` / `customizeRoles`)、Stage 移行で置換が発生するリソース、Construct ライブラリを多言語配布する場合の jsii 制約 (Union 型回避) などを扱う。

詳細は [SKILL.md](./plugins/aws-cdk-implementation-tips/skills/aws-cdk-implementation-tips/SKILL.md) を参照。

## インストール

### Claude Code

Plugin marketplace 機能でインストールします。

```bash
# 1. マーケットプレースを追加
/plugin marketplace add go-to-k/cdk-skills

# 2-a. 個別の Skill plugin をインストール
/plugin install aws-cdk-unit-testing@cdk-skills

# 2-b. すべての Skill plugin を一括インストール(bundle)
/plugin install aws-cdk-pack@cdk-skills
```

`aws-cdk-pack` は dependencies で全 plugin を pull するメタ plugin です。個別に絞りたい場合は `aws-cdk-unit-testing` のように plugin 名を直接指定してください。

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

## ディレクトリ構成

```text
cdk-skills/
├── .claude-plugin/marketplace.json                  # マーケットプレース定義
├── plugins/
│   ├── aws-cdk-unit-testing/                        # Skill plugin
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/
│   │       └── aws-cdk-unit-testing/                # ← skill の実ファイル
│   │           ├── SKILL.md
│   │           ├── references/
│   │           └── examples/
│   ├── aws-cdk-deployment-practices/                # Skill plugin
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/
│   │       └── aws-cdk-deployment-practices/
│   │           ├── SKILL.md
│   │           └── references/
│   ├── aws-cdk-implementation-tips/                 # Skill plugin
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/
│   │       └── aws-cdk-implementation-tips/
│   │           ├── SKILL.md
│   │           └── references/
│   └── aws-cdk-pack/                                # Bundle plugin (dependencies で全 plugin を pull)
│       └── .claude-plugin/plugin.json
└── skills/                                          # symlink (gh skill / npx skills 用)
    ├── aws-cdk-unit-testing
    ├── aws-cdk-deployment-practices
    └── aws-cdk-implementation-tips
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
