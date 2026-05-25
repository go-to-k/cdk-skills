# cdk.context.json をコミットすべき理由

`cdk.context.json` は **合成 (synthesize) 中に AWS アカウントから取得した値をキャッシュするためのファイル**。`Vpc.fromLookup` / `StringParameter.valueFromLookup` などの **context メソッド (Lookup メソッド)** が値を取得して自動で書き込む。

## 結論

**コミットする (`.gitignore` に入れない)**。AWS CDK 公式ドキュメントにも明記されている。

## context メソッドの例

```typescript
const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });
const parameter = StringParameter.valueFromLookup(this, parameterName);
```

これらを実行すると、内部で AWS SDK が AWS アカウントから値を取得し、結果が `cdk.context.json` に記録される。次回以降の合成では **ファイル内のキャッシュが優先** され、SDK 呼び出しはスキップされる。

## コミットすべき理由 1: 非決定的な動作の回避

例えば「EC2 の最新 AMI を `fromLookup` で取得する」コードがあるとする。新 AMI バージョンがリリースされた瞬間、既にデプロイ済みの EC2 と AMI ID が一致しなくなり、**EC2 の置換 (再構築) が走る**。

`cdk.context.json` をコミットしておけばキャッシュが使われ、毎回同じ値が解決されるため **「決定的」な動作が保証** される。

完全な決定性を要求する場合は `--lookups false` を指定する。キャッシュに無い値があるとき deploy / synth がエラーになる:

```text
--lookups    Perform context lookups (synthesis fails if this is
             disabled and context lookups need to be performed)
                   [boolean] [default: true]
```

## コミットすべき理由 2: デプロイ速度の向上

これは見落とされがちだが大きい。`cdk.context.json` に必要な値がない場合、CDK は **合成 (synthesize) を 2 回走らせる** 仕組みになっている。

実際のコード (`CloudExecutable.doSynthesize` 相当) は while ループの中で:

1. 1 回目の synthesize を走らせる
2. `assembly.manifest.missing` (キャッシュにないコンテキスト) が空でなければ、SDK で値を取得して `cdk.context.json` に保存
3. `continue` で while の頭に戻り、**もう一度 synthesize を実行**

合成が 2 回走ると、合成自体の処理時間に加えて **Lambda コードや Docker イメージのビルド処理も再実行** されることがあり、デプロイ時間が大きく増える。

`cdk.context.json` をコミットしておけば 1 回目で missing がゼロになり、合成は 1 回で済む。

## 注意: 最新値を取りたい Lookup がある場合

SSM パラメータストアなど **毎デプロイで最新値を取りたい** 場合、コミット済みキャッシュが邪魔になる。この場合は `cdk context` コマンドでキャッシュをクリアする:

```bash
# 特定のキャッシュをリセット (キー名または番号で指定)
npx cdk context --reset 2
npx cdk context --reset <KEY>

# 全部クリア
npx cdk context --clear

# 現在のキャッシュ一覧
npx cdk context
```

実行例:

```text
$ npx cdk context
Context found in cdk.json:
┌───┬─────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ # │ Key                                                         │ Value                                        │
├───┼─────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ 1 │ availability-zones:account=123456789012:region=eu-central-1 │ [ "eu-central-1a", "eu-central-1b", ... ]   │
│ 2 │ availability-zones:account=123456789012:region=eu-west-1    │ [ "eu-west-1a", "eu-west-1b", ... ]         │
└───┴─────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

毎回最新を取りに行く運用にすると **再度 synth が 2 回走る** ため、その値だけは context メソッドではなく直接スタック props に渡す設計も検討する。

## コミットしなくて良いケース

毎回 **全部のキャッシュを完全にクリアしたい** ようなプロジェクト。例えば「context メソッドは SSM パラメータの最新値取得にしか使っていない」場合。

ただし将来 `Vpc.fromLookup` 等が増えたとき、コミット忘れに気付かず合成が 2 回走り続けるリスクがある。基本はコミット、特殊ケースだけ例外、と認識しておく方が安全。

## コンテキスト (≠ cdk.context.json) の話

`cdk.json` の `context` フィールドや `cdk deploy -c KEY=VALUE` で渡すコンテキストは、**スタック定義の外から情報を渡す仕組み**。アプリの「stage」「owner」などをこの形で受け取る。`cdk.context.json` とは別ファイルだが、CDK の機能フラグも `cdk.json` の context に格納されるため、両者をまとめて「CDK のコンテキスト関連ファイル」と認識すると整理しやすい。

```bash
npx cdk deploy -c ENV=dev
```

```typescript
const env = app.node.tryGetContext('ENV') as string;
```
