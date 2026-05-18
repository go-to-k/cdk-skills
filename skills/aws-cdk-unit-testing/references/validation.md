# バリデーションテスト

## 概要

Stack や Construct の props に対する**バリデーション処理が正しく動作している**ことを確認するテスト。許容しない入力値が渡された際にエラーが発生することを保証する。

## 前提: CDK でのバリデーション実装

props のプロパティが特定の範囲・形式に収まっているかを `throw` で検証する。CDK 特有の注意点として、props に渡された値が **Token (デプロイ時に解決される値)** の場合があり、その場合は値の比較ができないので `cdk.Token.isUnresolved` でスキップする。

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export interface MyStackProps extends cdk.StackProps {
  lifecycleDays: number;
}

export class MyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    // Token でない場合のみ範囲チェック
    if (!cdk.Token.isUnresolved(props.lifecycleDays) && props.lifecycleDays > 400) {
      throw new Error('ライフサイクル日数は400日以下にしてください');
    }

    new Bucket(this, 'Bucket', {
      lifecycleRules: [
        { expiration: cdk.Duration.days(props.lifecycleDays) },
      ],
    });
  }
}
```

## バリデーションテストの書き方

`expect(() => { ... }).toThrowError(...)` で例外発生を確認する。

```typescript
import { App } from 'aws-cdk-lib';
import { MyStack } from '../lib/my-stack';

describe('Validation tests', () => {
  test('lifecycle days must be lower than or equal to 400 days', () => {
    const app = new App();

    expect(() => {
      new MyStack(app, 'MyStack', { lifecycleDays: 500 });
    }).toThrowError('ライフサイクル日数は400日以下にしてください');
  });
});
```

## 判断指針

- **バリデーション処理を実装しているなら必ず書く**。バリデーションは「正しく弾けること」が本体の挙動なので、テストしないと意味がない。
- **バリデーションごとに 1 テストケース** を用意するのが基本(範囲下限、範囲上限、不正フォーマット、必須プロパティ欠落、など)。
- バリデーションを何も実装していない場合は**不要**。

## ありがちな落とし穴

- `toThrowError` のメッセージは部分一致でも OK だが、メッセージを変更した時にテストの追従漏れが起きやすい。エラーメッセージを実装定数として切り出し、両方から参照すると安全。
- Token を考慮していないバリデーション(例: `cross-stack reference` で渡される値)はデプロイ時に意図せず素通りすることがある。`cdk.Token.isUnresolved` チェックの有無も含めてテストで意識する。

## 参考

実装パターンの詳細は記事 [AWS CDK におけるバリデーションの使い分け方を学ぶ](https://aws.amazon.com/jp/builders-flash/202406/cdk-validation/) を参照。
