# cdk.out (クラウドアセンブリ) の役割と再利用

`cdk synth` / `cdk deploy` 実行時に生成される **クラウドアセンブリ** を格納するディレクトリ。CDK コードから AWS にデプロイする際の **中間成果物** であり、合成とデプロイを分離する基盤になる。

## クラウドアセンブリの主な構成要素

| ファイル / ディレクトリ | 中身 |
|---|---|
| `<スタック名>.template.json` | CDK が生成した CloudFormation テンプレート |
| `<スタック名>.assets.json` | スタックが使うアセット (Lambda コード / Docker イメージ等) のメタデータ |
| `<スタック名>.metadata.json` | CDK メタデータ |
| `manifest.json` | クラウドアセンブリ全体のメタデータ |
| `tree.json` | Construct ツリー構造 |
| `cdk.out` (ファイル) | Cloud Assembly スキーマのバージョン情報 |
| `asset.<hash>/` | アセットファイルの実体 (S3 / ECR への upload 前のもの) |
| `assembly-<ステージ名>/` | Stage Construct を使っている場合、Stage 単位のクラウドアセンブリ |

## なぜ cdk.out が必要か

`cdk deploy` の内部では `cdk synth` 相当の合成処理が走る。同じプロジェクトで dev/stg/prod に別々に deploy するたびに合成が走ると:

1. **1 回目と 2 回目の合成結果が変わるリスク**: 非決定性
2. **環境差異の混入**: dev / prod の合成タイミングがズレる
3. **時間の浪費**: 大規模アプリだと合成だけで数分かかる

**cdk.out を介して合成とデプロイを分離する** ことでこれらを回避する。

## --app オプションによる再利用

`cdk deploy --app <path>` で **既に合成済みの cdk.out** を指定すると、deploy コマンド内の合成処理をスキップする:

```bash
npx cdk synth
npx cdk deploy --app ./cdk.out DevStack
npx cdk deploy --app ./cdk.out ProdStack
```

これが **Synthesize once, deploy many** の基盤。1 回の synth で全環境分のクラウドアセンブリが生成されていることが前提のため、**静的スタック作成** と相性が良い (動的スタック作成だと毎回 1 環境分しか合成されないので、この恩恵を受けにくい)。

## CI/CD パイプラインでの活用

`actions/upload-artifact` などで `cdk.out` をアーティファクトとして保存し、後続の deploy ジョブで download → `--app cdk.out` でデプロイ:

```yaml
jobs:
  synthesize:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npx cdk synth
      - uses: actions/upload-artifact@v6
        with:
          name: cdk-out
          path: cdk.out

  deploy-dev:
    needs: synthesize
    steps:
      - uses: actions/download-artifact@v6
        with: { name: cdk-out, path: cdk.out }
      - run: npx cdk deploy --app cdk.out DevStack

  deploy-prod:
    needs: deploy-dev
    steps:
      - uses: actions/download-artifact@v6
        with: { name: cdk-out, path: cdk.out }
      - run: npx cdk deploy --app cdk.out ProdStack
```

## アセットキャッシュとしての側面

`cdk.out` 配下の `asset.<hash>/` は **アセットのハッシュベースのキャッシュ** にもなっている。同じアセットが既に存在していれば bundle 処理がスキップされる。

## --app に「合成コマンド」を渡す形

`--app` には cdk.out のパスだけでなく、**CDK コードを合成するコマンド** も渡せる:

```bash
npx cdk deploy --app "npx ts-node --prefer-ts-exts bin/cdk-sample.ts"
```

これは通常 `cdk.json` の `app` プロパティに書かれているコマンドと同じ。明示的に指定することで合成とデプロイの実行タイミングを制御できる。

## cdk.out が肥大化するときの対処

合成を繰り返すと `asset.<hash>/` が積み上がり、数 GB になることがある (Docker イメージ用アセットが特に大きい)。対策ツールとして `cdk-agc` (`npx cdk-agc`) があり、現在のスタックで使っていない古いアセットや、対応するローカル Docker イメージ、`$TMPDIR` 内の一時 CDK ディレクトリをまとめてクリーンアップできる。

```bash
npx cdk-agc            # 実行
npx cdk-agc -d         # ドライラン
npx cdk-agc -k 24      # 24 時間以内に変更されたものは保持
npx cdk-agc -t         # $TMPDIR もクリーンアップ
```

CI/CD で `cdk.out` をキャッシュしている場合のキャッシュサイズ削減にも効く。
